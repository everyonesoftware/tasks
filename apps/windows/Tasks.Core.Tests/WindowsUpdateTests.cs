using System.Net;
using System.Text.Json;
using Tasks.Core;
using Xunit;

namespace Tasks.Core.Tests;

public class WindowsUpdateTests
{
    [Fact]
    public void Production_transport_does_not_redirect_use_cookies_or_bypass_TLS()
    {
        using var updates = new WindowsUpdateClient();
        var flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
        var http = (HttpClient)typeof(WindowsUpdateClient).GetField("http", flags)!.GetValue(updates)!;
        var handler = (HttpClientHandler)typeof(HttpMessageInvoker).GetField("_handler", flags)!.GetValue(http)!;
        Assert.False(handler.AllowAutoRedirect);
        Assert.False(handler.UseCookies);
        Assert.Null(handler.ServerCertificateCustomValidationCallback);
        Assert.Equal(TimeSpan.FromSeconds(20), http.Timeout);
    }

    internal sealed class Wire(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => respond(request, ct);
    }

    internal static string Release(int build = 16) => JsonSerializer.Serialize(new {
        tag_name = $"v{build}", draft = false, prerelease = false, body = "Windows fixes\nAnd improvements",
        html_url = $"https://github.com/everyonesoftware/tasks/releases/tag/v{build}",
        assets = new[] {
            new { name = $"Tasks-Windows-{build}-Setup.exe", state = "uploaded", size = 1234,
                browser_download_url = $"https://github.com/everyonesoftware/tasks/releases/download/v{build}/Tasks-Windows-{build}-Setup.exe" },
            new { name = $"Tasks-Windows-{build}-Setup.exe.sha256", state = "uploaded", size = 98,
                browser_download_url = $"https://github.com/everyonesoftware/tasks/releases/download/v{build}/Tasks-Windows-{build}-Setup.exe.sha256" }
        }
    });
    internal static HttpResponseMessage Reply(string body, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = new StringContent(body) };

    [Fact]
    public async Task Checks_real_Windows_asset_identity_without_sending_server_credentials()
    {
        using var updates = new WindowsUpdateClient(new Wire((request, _) => {
            Assert.Equal("https://api.github.com/repos/everyonesoftware/tasks/releases/latest", request.RequestUri!.AbsoluteUri);
            Assert.Null(request.Headers.Authorization);
            Assert.False(request.Headers.Contains("Cookie"));
            Assert.Contains(request.Headers.Accept, item => item.MediaType == "application/vnd.github+json");
            Assert.NotEmpty(request.Headers.UserAgent);
            return Task.FromResult(Reply(Release()));
        }));
        var result = await updates.CheckAsync(15);
        Assert.Equal(WindowsUpdateStatus.Available, result.Status);
        Assert.Equal(16, result.BuildNumber);
        Assert.Equal("Windows fixes\nAnd improvements", result.ReleaseNotes);
        Assert.EndsWith("/Tasks-Windows-16-Setup.exe", result.DownloadUri!.AbsoluteUri);
    }

    [Theory]
    [InlineData(16, WindowsUpdateStatus.Current)]
    [InlineData(20, WindowsUpdateStatus.Current)]
    [InlineData(null, WindowsUpdateStatus.Development)]
    public async Task Compares_release_builds_without_downgrading_or_guessing_development_identity(int? installed, WindowsUpdateStatus expected)
    {
        using var updates = new WindowsUpdateClient(new Wire((_, _) => Task.FromResult(Reply(Release()))));
        var result = await updates.CheckAsync(installed);
        Assert.Equal(expected, result.Status);
        Assert.Equal(expected == WindowsUpdateStatus.Development, result.DownloadUri is not null);
    }

    [Theory]
    [InlineData(404, WindowsUpdateStatus.NoReleases)]
    [InlineData(403, WindowsUpdateStatus.Failed)]
    [InlineData(429, WindowsUpdateStatus.Failed)]
    [InlineData(500, WindowsUpdateStatus.Failed)]
    [InlineData(302, WindowsUpdateStatus.Failed)]
    public async Task Missing_releases_are_distinct_from_failed_checks(int code, WindowsUpdateStatus expected)
    {
        using var updates = new WindowsUpdateClient(new Wire((_, _) => Task.FromResult(Reply("private server error", (HttpStatusCode)code))));
        var result = await updates.CheckAsync(15);
        Assert.Equal(expected, result.Status);
        Assert.Null(result.DownloadUri);
        Assert.Empty(result.ReleaseNotes);
    }

    [Theory]
    [InlineData("\"draft\":false", "\"draft\":true")]
    [InlineData("\"prerelease\":false", "\"prerelease\":true")]
    [InlineData("Tasks-Windows-16-Setup.exe", "Tasks-16.apk")]
    [InlineData("https://github.com/", "https://github.com.evil.test/")]
    [InlineData("https://github.com/", "http://github.com/")]
    [InlineData("/download/v16/", "/download/v15/")]
    [InlineData("\"v16\"", "\"v016\"")]
    [InlineData("\"state\":\"uploaded\"", "\"state\":\"new\"")]
    [InlineData("\"size\":1234", "\"size\":0")]
    [InlineData(".exe.sha256", ".exe.missing")]
    [InlineData("\"tag_name\":\"v16\"", "\"tag_name\":null")]
    public async Task Invalid_or_non_Windows_releases_never_offer_downloads(string before, string after)
    {
        using var updates = new WindowsUpdateClient(new Wire((_, _) => Task.FromResult(Reply(Release().Replace(before, after)))));
        Assert.Equal(WindowsUpdateStatus.Failed, (await updates.CheckAsync(15)).Status);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("{\"tag_name\":2}")]
    public async Task Malformed_metadata_fails_safely(string json)
    {
        using var updates = new WindowsUpdateClient(new Wire((_, _) => Task.FromResult(Reply(json))));
        Assert.Equal(WindowsUpdateStatus.Failed, (await updates.CheckAsync(15)).Status);
    }

    [Fact]
    public async Task Bounds_actual_metadata_bytes_even_without_content_length()
    {
        using var updates = new WindowsUpdateClient(new Wire((_, _) => {
            var reply = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new MemoryStream(new byte[1024 * 1024 + 1])) };
            reply.Content.Headers.ContentLength = null;
            return Task.FromResult(reply);
        }));
        Assert.Equal(WindowsUpdateStatus.Failed, (await updates.CheckAsync(15)).Status);
    }

    [Fact]
    public async Task Network_failure_can_be_retried_without_retaining_an_old_download()
    {
        var calls = 0;
        using var updates = new WindowsUpdateClient(new Wire((_, _) => ++calls == 2
            ? throw new HttpRequestException("private details") : Task.FromResult(Reply(Release()))));
        Assert.Equal(WindowsUpdateStatus.Available, (await updates.CheckAsync(15)).Status);
        var failed = await updates.CheckAsync(15);
        Assert.Equal(WindowsUpdateStatus.Failed, failed.Status);
        Assert.Null(failed.DownloadUri);
        Assert.Equal(WindowsUpdateStatus.Available, (await updates.CheckAsync(15)).Status);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_reported_as_a_successful_check()
    {
        using var cancellation = new CancellationTokenSource();
        using var updates = new WindowsUpdateClient(new Wire(async (_, ct) => {
            cancellation.Cancel();
            await Task.Delay(Timeout.Infinite, ct);
            return Reply(Release());
        }));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => updates.CheckAsync(15, cancellation.Token));
    }

    private sealed class StalledStream : MemoryStream
    {
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            await Task.Delay(Timeout.Infinite, ct);
            return 0;
        }
    }

    [Fact]
    public async Task Deadline_covers_the_body_after_headers_have_arrived()
    {
        using var updates = new WindowsUpdateClient(new Wire((_, _) => Task.FromResult(
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new StalledStream()) })));
        var http = (HttpClient)typeof(WindowsUpdateClient).GetField("http", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(updates)!;
        http.Timeout = TimeSpan.FromMilliseconds(30);
        var result = await updates.CheckAsync(15).WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(WindowsUpdateStatus.Failed, result.Status);
    }
}
