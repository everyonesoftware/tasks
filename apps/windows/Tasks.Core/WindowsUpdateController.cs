namespace Tasks.Core;

/// <summary>OS/package boundary; implementations offer only newer Tasks Windows packages.</summary>
public interface IWindowsUpdateBackend
{
    bool IsInstalled { get; }
    Version CurrentVersion { get; }
    Task<Version?> CheckAsync();
    Task DownloadAsync(Version version, Action<int> progress, CancellationToken token);
    void ApplyAndRestart(Version version);
}
public enum WindowsUpdatePhase { Idle, Checking, Current, Available, Downloading, Ready, Restarting, Error, NotInstalled }
public sealed record WindowsUpdateState(WindowsUpdatePhase Phase, string Message, Version? Version = null, int Progress = 0);

/// <summary>Explicit actions only; update failures never mutate task state or expose raw exceptions.</summary>
public sealed class WindowsUpdateController : IDisposable
{
    private readonly IWindowsUpdateBackend backend;
    private readonly Func<Task> preserveSession;
    private readonly CancellationTokenSource lifetime = new();
    private int busy;
    private int downloadGeneration;
    private bool disposed;
    public WindowsUpdateState Status { get; private set; } = new(WindowsUpdatePhase.Idle, "Check for Windows updates when you choose.");
    public event Action<WindowsUpdateState>? Changed;
    public WindowsUpdateController(IWindowsUpdateBackend backend, Func<Task> preserveSession)
    { this.backend = backend; this.preserveSession = preserveSession; }
    private void Set(WindowsUpdateState state)
    {
        if (disposed) return;
        Status = state; Changed?.Invoke(state);
    }
    public async Task CheckAsync()
    {
        if (disposed || Interlocked.CompareExchange(ref busy, 1, 0) != 0) return;
        try
        {
            if (Status.Phase is WindowsUpdatePhase.Ready or WindowsUpdatePhase.Restarting) return;
            if (!backend.IsInstalled)
            {
                Set(new(WindowsUpdatePhase.NotInstalled, "Install Tasks using the Windows installer to enable in-app updates. Loose development builds cannot update."));
                return;
            }
            Set(new(WindowsUpdatePhase.Checking, "Checking Windows releases…"));
            var version = await backend.CheckAsync();
            Set(version is not null && version > backend.CurrentVersion
                ? new(WindowsUpdatePhase.Available, $"Tasks {version} is available. Download it to continue.", version)
                : new(WindowsUpdatePhase.Current, "No newer Windows version is available."));
        }
        catch { Set(new(WindowsUpdatePhase.Error, "Could not check for updates. Check your internet connection or try again later; GitHub may be rate-limiting requests.")); }
        finally { Interlocked.Exchange(ref busy, 0); }
    }
    public async Task DownloadAsync()
    {
        if (disposed || Interlocked.CompareExchange(ref busy, 1, 0) != 0) return;
        try
        {
            if (Status.Phase != WindowsUpdatePhase.Available || Status.Version is not { } version) return;
            int generation = Interlocked.Increment(ref downloadGeneration);
            Set(new(WindowsUpdatePhase.Downloading, $"Downloading Tasks {version}…", version));
            await backend.DownloadAsync(version, value =>
            {
                if (generation == Volatile.Read(ref downloadGeneration) && Status.Phase == WindowsUpdatePhase.Downloading)
                    Set(new(WindowsUpdatePhase.Downloading, $"Downloading Tasks {version}…", version, Math.Clamp(value, 0, 100)));
            }, lifetime.Token);
            Set(new(WindowsUpdatePhase.Ready, $"Tasks {version} is downloaded. Restart and install when you are ready.", version, 100));
        }
        catch { Set(new(WindowsUpdatePhase.Error, "Download failed or was cancelled. Nothing was installed. Check for updates to try again.")); }
        finally { Interlocked.Exchange(ref busy, 0); }
    }
    public async Task RestartAsync()
    {
        if (disposed || Interlocked.CompareExchange(ref busy, 1, 0) != 0) return;
        var version = Status.Version;
        try
        {
            if (Status.Phase != WindowsUpdatePhase.Ready || version is null) return;
            Set(new(WindowsUpdatePhase.Restarting, "Preserving your session before restarting…", version, 100));
            await preserveSession();
            if (!disposed) backend.ApplyAndRestart(version);
        }
        catch { Set(new(WindowsUpdatePhase.Ready, "Could not safely restart. Finish task edits or operations and retry. Your protected session must be saved before installation.", version, 100)); }
        finally { Interlocked.Exchange(ref busy, 0); }
    }
    public void Dispose()
    {
        disposed = true; lifetime.Cancel();
        // Keep CTS alive while an in-flight download may still observe its token.
    }
}
