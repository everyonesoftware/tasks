using System.Text;
using System.Text.Json;
using Velopack;
using Velopack.Logging;
using Velopack.Sources;
using Xunit;

namespace Tasks.Update.Tests;

public sealed class WindowsFeedTests
{
    private static Task<VelopackAssetFeed> Feed(Downloader downloader, string id = "TasksWindows", string channel = "win-x64")
    {
        var source = new Tasks.App.WindowsGithubSource(downloader);
        return source.GetReleaseFeed(NullVelopackLogger.Instance, id, channel);
    }

    [Fact]
    public async Task Stable_vN_maps_to_Tasks_package_version_and_downloads_same_repository_asset()
    {
        var downloader = new Downloader();
        var feed = await Feed(downloader);
        var asset = Assert.Single(feed.Assets);
        Assert.Equal("TasksWindows", asset.PackageId);
        Assert.Equal("0.1.20", asset.Version.ToString());
        Assert.Equal("TasksWindows-0.1.20-win-x64-full.nupkg", asset.FileName);
        Assert.EndsWith("/v20/releases.win-x64.json", downloader.Requests.Last());
        Assert.All(downloader.Headers, h => Assert.DoesNotContain(h.Keys, k => k.Equals("Authorization", StringComparison.OrdinalIgnoreCase)));
    }

    [Fact]
    public async Task Highest_stable_Windows_release_is_selected_across_mixed_out_of_order_pages()
    {
        var downloader = new Downloader { Pages = new() {
            [1] = Enumerable.Repeat(Release("v999", names: ["Tasks-999.apk"]), 99).Prepend(Release("v9")).ToArray(),
            [2] = [Release("v20"), Release("v30", prerelease: true), Release("v40", draft: true), Release("windows-v0.1.50"), Release("v01"), Release("v65535")]
        } };
        var feed = await Feed(downloader);
        Assert.Equal("0.1.20", Assert.Single(feed.Assets).Version.ToString());
        Assert.Equal(3, downloader.Requests.Count);
        Assert.EndsWith("page=2", downloader.Requests[1]);
        Assert.EndsWith("/v20/releases.win-x64.json", downloader.Requests[2]);
    }

    [Theory]
    [InlineData("origin")]
    [InlineData("duplicate")]
    [InlineData("version")]
    [InlineData("architecture")]
    [InlineData("delta")]
    [InlineData("identity")]
    [InlineData("missing")]
    [InlineData("empty")]
    [InlineData("wrong-channel")]
    [InlineData("wrong-app")]
    [InlineData("digest")]
    [InlineData("size")]
    public async Task Unsafe_selected_feed_fails_closed_without_fallback(string fault)
    {
        var downloader = new Downloader();
        if (fault == "origin") downloader.Pages[1] = [Release(origin: "https://example.org"), Release("v19")];
        if (fault == "duplicate") downloader.Pages[1] = [Release(names: ["releases.win-x64.json", "RELEASES.WIN-X64.JSON", "TasksWindows-0.1.20-win-x64-full.nupkg"])];
        if (fault == "missing") downloader.Pages[1] = [Release(names: ["releases.win-x64.json"])];
        if (fault == "version") downloader.FeedJson = downloader.FeedJson.Replace("0.1.20", "0.1.21");
        if (fault == "architecture") downloader.FeedJson = downloader.FeedJson.Replace("win-x64", "win-arm64");
        if (fault == "delta") downloader.FeedJson = downloader.FeedJson.Replace("Full", "Delta");
        if (fault == "identity") downloader.FeedJson = downloader.FeedJson.Replace("TasksWindows", "OtherApp");
        if (fault == "digest") downloader.FeedJson = downloader.FeedJson.Replace(new string('A', 64), "not-a-hash");
        if (fault == "size") downloader.FeedJson = downloader.FeedJson.Replace("\"Size\":100", "\"Size\":0");
        if (fault == "empty") downloader.FeedJson = "{\"Assets\":[]}";
        await Assert.ThrowsAsync<InvalidDataException>(() => Feed(downloader, fault == "wrong-app" ? "OtherApp" : "TasksWindows", fault == "wrong-channel" ? "win-arm64" : "win-x64"));
        Assert.DoesNotContain(downloader.Requests, u => u.Contains("/v19/"));
    }

    [Fact]
    public async Task Real_velopack_backend_checks_newer_package_but_refuses_apply_before_download()
    {
        var directory = Path.Combine(Path.GetTempPath(), "tasks-update-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        try
        {
            var source = new Tasks.App.WindowsGithubSource(new Downloader());
            var locator = new Velopack.Locators.TestVelopackLocator("TasksWindows", "0.1.19", directory);
            var backend = new Tasks.App.WindowsUpdateBackend(source, locator);
            Assert.Equal(new Version(0,1,20), await backend.CheckAsync());
            Assert.Throws<InvalidOperationException>(() => backend.ApplyAndRestart(new(0,1,20)));
            await Assert.ThrowsAsync<InvalidOperationException>(() => backend.DownloadAsync(new(0,1,21), _ => {}, CancellationToken.None));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task Truncated_inventory_is_an_error_not_a_current_result()
    {
        var downloader = new Downloader { Pages = Enumerable.Range(1, 10).ToDictionary(p => p, _ => Enumerable.Repeat(Release("v100", names: ["Tasks-100.apk"]), 100).ToArray()) };
        await Assert.ThrowsAsync<InvalidDataException>(() => Feed(downloader));
        Assert.Equal(10, downloader.Requests.Count);
    }
    [Fact]
    public async Task Android_only_and_legacy_installer_releases_are_not_in_app_updates()
    {
        var downloader = new Downloader { Pages = new() { [1] = [Release("v21", names: ["Tasks-21.apk"]), Release("v22", names: ["Tasks-Windows-22-Setup.exe", "Tasks-Windows-22-Setup.exe.sha256"])] } };
        Assert.Empty((await Feed(downloader)).Assets);
        Assert.Single(downloader.Requests);
    }
    [Fact]
    public async Task Failed_real_package_download_never_authorizes_apply()
    {
        var directory = Path.Combine(Path.GetTempPath(), "tasks-update-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        try
        {
            var downloader = new Downloader();
            var source = new Tasks.App.WindowsGithubSource(downloader);
            var locator = new Velopack.Locators.TestVelopackLocator("TasksWindows", "0.1.19", directory);
            var backend = new Tasks.App.WindowsUpdateBackend(source, locator);
            var offered = await backend.CheckAsync(); Assert.NotNull(offered);
            Assert.NotNull(await Record.ExceptionAsync(() => backend.DownloadAsync(offered!, _ => {}, CancellationToken.None)));
            Assert.Throws<InvalidOperationException>(() => backend.ApplyAndRestart(offered!));
            Assert.Contains(downloader.Requests, u => u.EndsWith("/v20/TasksWindows-0.1.20-win-x64-full.nupkg"));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task Ambiguous_highest_release_inventory_is_rejected()
    {
        var downloader = new Downloader { Pages = new() { [1] = [Release(), Release()] } };
        await Assert.ThrowsAsync<InvalidDataException>(() => Feed(downloader));
    }

    private static object Release(string tag = "v20", bool prerelease = false, bool draft = false, string? origin = null, string[]? names = null) => new {
        tag_name = tag, prerelease, draft,
        assets = (names ?? ["releases.win-x64.json", "TasksWindows-0.1.20-win-x64-full.nupkg"])
            .Select(name => new { name, browser_download_url = $"{origin ?? "https://github.com/everyonesoftware/tasks"}/releases/download/{tag}/{name}" }).ToArray()
    };

    private sealed class Downloader : IFileDownloader
    {
        public Dictionary<int, object[]> Pages = new() { [1] = [Release()] };
        public string FeedJson = """{"Assets":[{"PackageId":"TasksWindows","Version":"0.1.20","Type":"Full","FileName":"TasksWindows-0.1.20-win-x64-full.nupkg","Size":100,"SHA256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}""";
        public List<string> Requests = [];
        public List<IDictionary<string,string>> Headers = [];
        public Task<string> DownloadString(string url, IDictionary<string,string>? headers = null, double timeout = 30)
        {
            Requests.Add(url); Headers.Add(headers ?? new Dictionary<string,string>());
            return Task.FromResult(JsonSerializer.Serialize(Pages.GetValueOrDefault(int.Parse(url.Split("&page=")[1]), [])));
        }
        public Task<byte[]> DownloadBytes(string url, IDictionary<string,string>? headers = null, double timeout = 30)
        { Requests.Add(url); Headers.Add(headers ?? new Dictionary<string,string>()); return Task.FromResult(Encoding.UTF8.GetBytes(FeedJson)); }
        public Task DownloadFile(string url, string targetFile, Action<int>? progress = null, IDictionary<string,string>? headers = null, double timeout = 30, CancellationToken cancelToken = default)
        { Requests.Add(url); return Task.CompletedTask; }
    }
}
