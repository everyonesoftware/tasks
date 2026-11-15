using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using Tasks.Core;

var executable = Environment.GetEnvironmentVariable("TASKS_API_FIXTURE") ?? throw new InvalidOperationException("Set TASKS_API_FIXTURE to the disposable Go fixture executable.");
using var process = Process.Start(new ProcessStartInfo(executable) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false }) ?? throw new InvalidOperationException("Fixture failed to start.");
try
{
    var endpoint = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
    Check(Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) && uri.Host == "127.0.0.1", "isolated endpoint");
    var vault = new MemoryVault(); var date = new DateOnly(2026, 11, 15);
    using var client = new TasksClient(vault);
    await client.SignInAsync(endpoint!, "windows-fixture", "fixture-password-only", date);
    Check(client.IsConnected && client.State!.Tasks.Count == 0, "login empty account");
    var token = client.Session!.Token;
    await client.AddTaskAsync(new("Native API fixture", "isolated only", "Personal", "once", 1, "2026-11-15", 1), date);
    Check(client.State!.Tasks.Count == 1 && client.Current!.Title == "Native API fixture", "create and focus");
    await client.RefreshAsync(date); Check(client.State!.Today.Count == 1, "refresh");
    var occurrence = client.Current!;
    await client.CompleteAsync(occurrence, date); Check(client.State!.Progress.Completed == 1 && client.Current is null, "complete");
    await client.UndoAsync(occurrence, date); Check(client.State!.Progress.Completed == 0 && client.Current is not null, "undo");
    using (var restored = new TasksClient(vault))
    { Check(await restored.RestoreAsync(date) && restored.State!.Tasks.Count == 1, "restore real bearer session"); }
    using (var other = new TasksClient(new MemoryVault()))
    { await other.SignInAsync(endpoint!, "other-fixture", "fixture-password-only", date); Check(other.State!.Tasks.Count == 0, "second user isolation"); await other.SignOutAsync(); }
    await client.SignOutAsync(); Check(client.State is null && client.Session is null && vault.Saved is null, "logout local clearing");
    using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
    using var request = new HttpRequestMessage(HttpMethod.Get, endpoint + "/api/state?date=2026-11-15");
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    using var response = await http.SendAsync(request); Check(response.StatusCode == HttpStatusCode.Unauthorized, "logout real remote revocation readback");
    Console.WriteLine("PASS: 10 real API checks; login/create/refresh/complete/undo/restore/isolation/logout/revocation, disposable DB only.");
}
finally
{
    process.StandardInput.Close();
    try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
    catch (TimeoutException) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
}
static void Check(bool result, string name) { if (!result) throw new InvalidOperationException("Smoke failed: " + name); }
sealed class MemoryVault : ISessionVault
{
    public SessionProfile? Saved;
    public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult(Saved);
    public Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default) { Saved = profile; return Task.CompletedTask; }
    public Task ClearAsync(CancellationToken cancellationToken = default) { Saved = null; return Task.CompletedTask; }
}
