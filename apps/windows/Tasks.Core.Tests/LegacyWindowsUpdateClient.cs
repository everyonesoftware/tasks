using System.Net;
using System.Text.Json;

namespace Tasks.Core;

public enum WindowsUpdateStatus { Available, Current, NoReleases, Development, Failed }

public sealed record WindowsUpdateResult(WindowsUpdateStatus Status, int? BuildNumber = null,
    string ReleaseNotes = "", Uri? DownloadUri = null);

// Frozen legacy-client bridge fixture: retain its tests to protect old installer asset discovery.
// Not compiled into Tasks.Core or used by current Settings; the app uses Velopack.
// Deliberately independent of TasksClient: GitHub never receives the server session.
public sealed class WindowsUpdateClient : IDisposable
{
    private const string Repository = "https://github.com/everyonesoftware/tasks/releases/";
    private const int MetadataLimit = 1024 * 1024;
    private readonly HttpClient http;

    public WindowsUpdateClient(HttpMessageHandler? handler = null)
    {
        http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
        {
            Timeout = TimeSpan.FromSeconds(20)
        };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Tasks-Windows/1.0");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        http.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
    }

    public async Task<WindowsUpdateResult> CheckAsync(int? installedBuild, CancellationToken ct = default)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(http.Timeout);
        var requestToken = deadline.Token;
        try
        {
            using var response = await http.GetAsync("https://api.github.com/repos/everyonesoftware/tasks/releases/latest",
                HttpCompletionOption.ResponseHeadersRead, requestToken);
            if (response.StatusCode == HttpStatusCode.NotFound) return new(WindowsUpdateStatus.NoReleases);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > MetadataLimit) throw new InvalidDataException();
            using var bounded = new MemoryStream();
            await using var stream = await response.Content.ReadAsStreamAsync(requestToken);
            var buffer = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(buffer, requestToken)) != 0)
            {
                if (bounded.Length + count > MetadataLimit) throw new InvalidDataException();
                bounded.Write(buffer, 0, count);
            }
            using var json = JsonDocument.Parse(bounded.ToArray());
            var release = json.RootElement;
            var tag = release.GetProperty("tag_name").GetString() ?? "";
            if (release.GetProperty("draft").GetBoolean() || release.GetProperty("prerelease").GetBoolean()
                || !tag.StartsWith('v') || !int.TryParse(tag.AsSpan(1), out var build)
                || build is < 1 or > 65534 || tag != $"v{build}"
                || release.GetProperty("html_url").GetString() != Repository + "tag/" + tag)
                throw new InvalidDataException();
            var filename = $"Tasks-Windows-{build}-Setup.exe";
            var assets = release.GetProperty("assets").EnumerateArray().ToArray();
            foreach (var name in new[] { filename, filename + ".sha256" })
            {
                var matches = assets.Where(asset => asset.GetProperty("name").GetString() == name).ToArray();
                if (matches.Length != 1 || matches[0].GetProperty("state").GetString() != "uploaded"
                    || matches[0].GetProperty("size").GetInt64() <= 0
                    || matches[0].GetProperty("browser_download_url").GetString() != Repository + $"download/{tag}/{name}")
                    throw new InvalidDataException();
            }
            var notes = release.TryGetProperty("body", out var body) && body.ValueKind != JsonValueKind.Null ? body.GetString() ?? "" : "";
            var status = installedBuild is null ? WindowsUpdateStatus.Development
                : build > installedBuild ? WindowsUpdateStatus.Available : WindowsUpdateStatus.Current;
            return new(status, build, notes, status != WindowsUpdateStatus.Current
                ? new Uri(Repository + $"download/{tag}/{filename}") : null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or JsonException
            or InvalidDataException or InvalidOperationException or KeyNotFoundException or FormatException or IOException)
        {
            return new(WindowsUpdateStatus.Failed);
        }
    }

    public void Dispose() => http.Dispose();
}
