using System.Text.Json;
using System.Text.Json.Serialization;
using Velopack;
using Velopack.Logging;
using Velopack.Sources;

namespace Tasks.App;

/// <summary>Anonymous Windows-only feed in the combined stable vN GitHub releases.</summary>
public sealed class WindowsGithubSource : GithubSource
{
    public const string Repository = "https://github.com/everyonesoftware/tasks";
    public const string Channel = "win-x64";
    private readonly Dictionary<GithubRelease, string> versions = new();
    public WindowsGithubSource(IFileDownloader? downloader = null) : base(Repository, accessToken: null, prerelease: false, downloader: downloader) { }

    protected override async Task<GithubRelease[]> GetReleases(bool includePrereleases)
    {
        versions.Clear();
        var result = new List<(GithubRelease Release, int Build)>();
        for (int page = 1; page <= 10; page++)
        {
            string json = await Downloader.DownloadString($"https://api.github.com/repos/everyonesoftware/tasks/releases?per_page=100&page={page}", GetRequestHeaders("application/vnd.github+json"));
            using var document = JsonDocument.Parse(json);
            var items = document.RootElement.EnumerateArray().ToArray();
            foreach (var item in items)
            {
                if (item.GetProperty("draft").GetBoolean() || item.GetProperty("prerelease").GetBoolean()) continue;
                string? tag = item.GetProperty("tag_name").GetString();
                if (tag is null || !tag.StartsWith('v') || !int.TryParse(tag.AsSpan(1), out int build) || build is < 1 or > 65534 || tag != $"v{build}") continue;
                var release = item.Deserialize(WindowsUpdateJsonContext.Default.GithubRelease) ?? throw new InvalidDataException("Missing release.");
                if (!release.Assets.Any(a => a.Name == $"releases.{Channel}.json")) continue;
                versions.Add(release, $"0.1.{build}");
                result.Add((release, build));
            }
            if (items.Length < 100)
            {
                if (result.Count > 0 && result.Count(r => r.Build == result.Max(r => r.Build)) != 1)
                    throw new InvalidDataException("Ambiguous highest Windows release.");
                var selected = result.OrderByDescending(r => r.Build).Take(1).Select(r => r.Release).ToArray();
                foreach (var release in selected)
                {
                    string tag = $"v{Version.Parse(versions[release]).Build}";
                    if (release.Assets.GroupBy(a => a.Name, StringComparer.OrdinalIgnoreCase).Any(g => g.Count() != 1) ||
                        release.Assets.Any(a => a.BrowserDownloadUrl != $"{Repository}/releases/download/{tag}/{a.Name}"))
                        throw new InvalidDataException("Ambiguous or unexpected Windows release asset origin.");
                }
                return selected;
            }
        }
        throw new InvalidDataException("GitHub release inventory exceeded the safe paging limit.");
    }

    public override async Task<VelopackAssetFeed> GetReleaseFeed(IVelopackLogger logger, string? appId, string channel, Guid? stagingId = null, VelopackAsset? latestLocalRelease = null)
    {
        if (channel != Channel || appId is not null && appId != "TasksWindows")
            throw new InvalidDataException("Unexpected Windows update identity.");
        var feed = await base.GetReleaseFeed(logger, appId, channel, stagingId, latestLocalRelease);
        foreach (var asset in feed.Assets)
        {
            if (asset.PackageId != "TasksWindows" || asset is not GitBaseAsset entry ||
                !versions.TryGetValue(entry.Release, out string? version) || asset.Version.ToString() != version ||
                asset.Type != VelopackAssetType.Full || asset.Size <= 0 ||
                asset.SHA256 is not { Length: 64 } digest || !digest.All(char.IsAsciiHexDigit) ||
                asset.FileName != $"TasksWindows-{version}-{Channel}-full.nupkg" ||
                !entry.Release.Assets.Any(a => a.Name == asset.FileName))
                throw new InvalidDataException("Unexpected Windows update package.");
        }
        if (versions.Count > 0 && feed.Assets.Length != 1)
            throw new InvalidDataException("Windows release must contain exactly one matching full package.");
        return feed;
    }
}

/// <summary>Lazy native locator; neither startup nor download applies an update.</summary>
public sealed class WindowsUpdateBackend : Tasks.Core.IWindowsUpdateBackend
{
    private readonly Lazy<UpdateManager> manager;
    private UpdateInfo? offered;
    private bool downloaded;
    public WindowsUpdateBackend() : this(new WindowsGithubSource(), null) { }
    public WindowsUpdateBackend(IUpdateSource source, Velopack.Locators.IVelopackLocator? locator)
    {
        manager = new(() => new UpdateManager(source, new UpdateOptions {
            ExplicitChannel = WindowsGithubSource.Channel,
            AllowVersionDowngrade = false,
            MaximumDeltasBeforeFallback = -1
        }, locator));
    }
    public bool IsInstalled => manager.Value.IsInstalled;
    public Version CurrentVersion => Version.Parse(manager.Value.CurrentVersion?.ToString() ?? "0.0.0");
    public async Task<Version?> CheckAsync()
    {
        offered = null; downloaded = false;
        var update = await manager.Value.CheckForUpdatesAsync();
        if (update is null) return null;
        var version = Version.Parse(update.TargetFullRelease.Version.ToString());
        if (version <= CurrentVersion || update.IsDowngrade || update.TargetFullRelease.PackageId != "TasksWindows")
            throw new InvalidDataException("Unsafe Windows update target.");
        offered = update;
        return version;
    }
    private UpdateInfo RequireOffer(Version version)
    {
        if (offered is null || offered.TargetFullRelease.Version.ToString() != version.ToString() || version <= CurrentVersion)
            throw new InvalidOperationException("No matching newer Windows update.");
        return offered;
    }
    public async Task DownloadAsync(Version version, Action<int> progress, CancellationToken token)
    {
        downloaded = false;
        await manager.Value.DownloadUpdatesAsync(RequireOffer(version), progress, token);
        token.ThrowIfCancellationRequested();
        downloaded = true;
    }
    public void ApplyAndRestart(Version version)
    {
        var update = RequireOffer(version);
        if (!downloaded) throw new InvalidOperationException("Download the Windows update first.");
        manager.Value.ApplyUpdatesAndRestart(update.TargetFullRelease, Array.Empty<string>());
    }
}

[JsonSerializable(typeof(GithubRelease))]
internal partial class WindowsUpdateJsonContext : JsonSerializerContext { }
