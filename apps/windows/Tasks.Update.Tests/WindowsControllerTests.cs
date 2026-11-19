using Tasks.Core;
using Xunit;
namespace Tasks.Update.Tests;

public sealed class WindowsControllerTests
{
    [Fact]
    public async Task Unchecked_checking_failed_and_not_installed_never_claim_current()
    {
        var backend = new Backend();
        using var controller = new WindowsUpdateController(backend, () => Task.CompletedTask);
        Assert.Equal(WindowsUpdatePhase.Idle, controller.Status.Phase);
        Assert.DoesNotContain("No newer", controller.Status.Message);
        var pending = new TaskCompletionSource<Version?>();
        backend.Check = () => pending.Task;
        var check = controller.CheckAsync();
        Assert.Equal(WindowsUpdatePhase.Checking, controller.Status.Phase);
        Assert.DoesNotContain("No newer", controller.Status.Message);
        pending.SetException(new HttpRequestException("private transport failure"));
        await check;
        Assert.Equal(WindowsUpdatePhase.Error, controller.Status.Phase);
        Assert.DoesNotContain("No newer", controller.Status.Message);
        backend.IsInstalled = false;
        await controller.CheckAsync();
        Assert.Equal(WindowsUpdatePhase.NotInstalled, controller.Status.Phase);
        Assert.DoesNotContain("No newer", controller.Status.Message);
        Assert.Equal(new[] { "check" }, backend.Calls);
    }

    [Fact]
    public async Task Explicit_check_download_and_restart_are_separate_and_preserve_session_before_apply()
    {
        var backend = new Backend();
        using var controller = new WindowsUpdateController(backend, () => { backend.Calls.Add("save"); return Task.CompletedTask; });
        Assert.Empty(backend.Calls);
        await controller.RestartAsync(); await controller.DownloadAsync();
        Assert.Empty(backend.Calls);
        await controller.CheckAsync();
        Assert.Equal(WindowsUpdatePhase.Available, controller.Status.Phase);
        Assert.Equal(new[] { "check" }, backend.Calls);
        await controller.DownloadAsync();
        Assert.Equal(WindowsUpdatePhase.Ready, controller.Status.Phase);
        Assert.Equal(100, controller.Status.Progress);
        Assert.Equal(new[] { "check", "download" }, backend.Calls);
        await controller.RestartAsync();
        Assert.Equal(new[] { "check", "download", "save", "apply" }, backend.Calls);
    }
    [Fact]
    public async Task Failed_protected_session_check_keeps_ready_and_does_not_apply_until_retry_succeeds()
    {
        var backend = new Backend(); bool fail = true;
        using var controller = new WindowsUpdateController(backend, () => fail ? Task.FromException(new IOException("secret")) : Task.CompletedTask);
        await controller.CheckAsync(); await controller.DownloadAsync(); await controller.RestartAsync();
        Assert.Equal(WindowsUpdatePhase.Ready, controller.Status.Phase);
        Assert.DoesNotContain("secret", controller.Status.Message);
        Assert.DoesNotContain("apply", backend.Calls);
        fail = false; await controller.RestartAsync();
        Assert.Contains("apply", backend.Calls);
    }
    [Theory]
    [InlineData("0.1.18")]
    [InlineData("0.1.19")]
    [InlineData(null)]
    public async Task Equal_older_or_absent_offer_never_downloads_or_applies(string? offer)
    {
        var backend = new Backend { Offer = offer is null ? null : Version.Parse(offer) };
        using var controller = new WindowsUpdateController(backend, () => throw new Exception("must not save"));
        await controller.CheckAsync(); await controller.DownloadAsync(); await controller.RestartAsync();
        Assert.Equal(WindowsUpdatePhase.Current, controller.Status.Phase);
        Assert.Equal("No newer Windows version is available.", controller.Status.Message);
        Assert.Equal(new[] { "check" }, backend.Calls);
    }
    [Fact]
    public async Task Concurrent_checks_are_serialized_and_failure_clears_stale_offer()
    {
        var backend = new Backend();
        using var controller = new WindowsUpdateController(backend, () => Task.CompletedTask);
        await controller.CheckAsync();
        var pending = new TaskCompletionSource<Version?>();
        backend.Check = () => pending.Task;
        var check = controller.CheckAsync(); await controller.CheckAsync(); await controller.DownloadAsync();
        Assert.Equal(WindowsUpdatePhase.Checking, controller.Status.Phase);
        Assert.Null(controller.Status.Version);
        Assert.Equal(2, backend.Calls.Count);
        pending.SetException(new HttpRequestException("secret")); await check;
        Assert.Equal(WindowsUpdatePhase.Error, controller.Status.Phase);
        Assert.DoesNotContain("secret", controller.Status.Message);
        await controller.DownloadAsync(); Assert.DoesNotContain("download", backend.Calls);
    }
    [Fact]
    public async Task Dispose_cancels_download_and_suppresses_late_completion_or_restart()
    {
        var backend = new Backend(); CancellationToken token = default;
        var pending = new TaskCompletionSource();
        backend.Download = (_, ct) => { token = ct; return pending.Task; };
        var controller = new WindowsUpdateController(backend, () => Task.CompletedTask);
        await controller.CheckAsync(); var download = controller.DownloadAsync();
        controller.Dispose(); Assert.True(token.IsCancellationRequested);
        pending.SetResult(); await download; await controller.RestartAsync();
        Assert.DoesNotContain("apply", backend.Calls);
        Assert.NotEqual(WindowsUpdatePhase.Ready, controller.Status.Phase);
    }
    [Fact]
    public async Task Late_progress_from_failed_download_cannot_rewind_a_new_download()
    {
        var backend = new Backend(); Action<int>? oldProgress = null;
        backend.Download = (progress, _) => { oldProgress = progress; throw new IOException("secret"); };
        using var controller = new WindowsUpdateController(backend, () => Task.CompletedTask);
        await controller.CheckAsync(); await controller.DownloadAsync();
        Assert.Equal(WindowsUpdatePhase.Error, controller.Status.Phase);
        var pending = new TaskCompletionSource();
        backend.Download = (progress, _) => { progress(60); return pending.Task; };
        await controller.CheckAsync(); var download = controller.DownloadAsync();
        oldProgress!(2);
        Assert.Equal(60, controller.Status.Progress);
        pending.SetResult(); await download;
    }
    private sealed class Backend : IWindowsUpdateBackend
    {
        public List<string> Calls = [];
        public bool IsInstalled { get; set; } = true;
        public Version CurrentVersion => new(0,1,19);
        public Version? Offer = new(0,1,20);
        public Func<Task<Version?>>? Check;
        public Func<Action<int>, CancellationToken, Task>? Download;
        public Task<Version?> CheckAsync() { Calls.Add("check"); return Check?.Invoke() ?? Task.FromResult(Offer); }
        public Task DownloadAsync(Version version, Action<int> progress, CancellationToken token) { Calls.Add("download"); progress(50); return Download?.Invoke(progress, token) ?? Task.CompletedTask; }
        public void ApplyAndRestart(Version version) => Calls.Add("apply");
    }
}
