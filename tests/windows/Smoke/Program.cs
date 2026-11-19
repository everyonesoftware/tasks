using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
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
    var returnedId = await client.AddTaskAsync(new("Native API fixture", "isolated only", "Personal", "once", 1, "2026-11-15", 1), date);
    Check(client.State!.Tasks.Count == 1 && client.Current!.Title == "Native API fixture", "create and focus");
    Check(client.State.Tasks.Single().Id == returnedId, "exact POST identity returned by client");
    await client.RefreshAsync(date); Check(client.State!.Today.Count == 1, "refresh");
    var occurrence = client.Current!;
    await client.CompleteAsync(occurrence, date); Check(client.State!.Progress.Completed == 1 && client.Current is null, "complete");
    await client.UndoAsync(client.State!.Today.Single(), date); Check(client.State!.Progress.Completed == 0 && client.Current is not null, "undo");
    using (var restored = new TasksClient(vault))
    { Check(await restored.RestoreAsync(date) && restored.State!.Tasks.Count == 1, "restore real bearer session"); }
    using (var other = new TasksClient(new MemoryVault()))
    { await other.SignInAsync(endpoint!, "other-fixture", "fixture-password-only", date); Check(other.State!.Tasks.Count == 0, "second user isolation"); await other.SignOutAsync(); }
    var taskId = client.State!.Tasks[0].Id;
    var edit = new TaskDraft("Edited native task", "changed notes", "Work", "weekly", 2, "2026-11-15", 2);
    await client.EditTaskAsync(taskId, edit, date);
    using (var readback = new TasksClient(vault))
    {
        Check(await readback.RestoreAsync(date), "edit independent restore");
        var task = readback.State!.Tasks.Single();
        Check(task.Title == edit.Title && task.Notes == edit.Notes && task.Category == edit.Category && task.Repeat == edit.Repeat && task.Interval == edit.Interval && task.StartDate == edit.StartDate && task.Priority == edit.Priority, "edit all fields server readback");
    }
    var workspace = new TaskWorkspace();
    workspace.Update(client.Session, date, client.State);
    var currentBeforeDetails = client.Current;
    workspace.OpenTask(taskId, "routines", currentBeforeDetails!.OccurrenceId);
    Check(client.Current == currentBeforeDetails && workspace.Origin == "routines", "details never select a task");
    Check(workspace.BeginEdit(client.State), "dedicated edit from real task");
    workspace.Draft!.Title = "Cancelled draft";
    workspace.CancelEdit();
    Check(workspace.ResolveTask(client.State)!.Title == edit.Title && workspace.Mode == "details", "cancel leaves authoritative details unchanged");
    Check(workspace.BeginEdit(client.State), "reopen dedicated edit");
    workspace.Draft!.Title = "Simplified workspace edit";
    workspace.Draft.Repeat = "yearly";
    workspace.Draft.Interval = 2;
    var simplified = workspace.Draft.ToPayload();
    Check(simplified.Notes == edit.Notes && simplified.Category == edit.Category && simplified.Priority == edit.Priority, "hidden fields preserved by simplified editor");
    var concurrentEdit = edit with { Notes = "Other-client updated notes", Category = "Health", Priority = 0 };
    using (var concurrent = new TasksClient(vault))
    {
        Check(await concurrent.RestoreAsync(date), "hidden-field other-client restore");
        await concurrent.EditTaskAsync(taskId, concurrentEdit, date);
    }
    await client.RefreshAsync(date);
    workspace.Update(client.Session, date, client.State);
    Check(await workspace.SaveAsync(client, simplified, date, () => date) && workspace.Mode == "details" && workspace.ResolveTask(client.State)!.Title == simplified.Title, "confirmed save returns refreshed dedicated details");
    using (var readback = new TasksClient(vault))
    {
        Check(await readback.RestoreAsync(date), "simplified edit independent restore");
        var task = readback.State!.Tasks.Single();
        Check(task.Title == simplified.Title && task.Notes == concurrentEdit.Notes && task.Category == concurrentEdit.Category && task.Priority == concurrentEdit.Priority && task.Repeat == "yearly" && task.Interval == 2 && task.StartDate == edit.StartDate, "simplified edit preserves other-client hidden updates and schedule server readback");
    }
    Check(workspace.Back() == "routines", "back retains real originating list");
    await client.CompleteAsync(client.Current!, date);
    await client.ArchiveTaskAsync(taskId, date);
    using (var readback = new TasksClient(vault))
    {
        Check(await readback.RestoreAsync(date) && readback.State!.Tasks.Count == 0 && readback.State.Today.Count == 0, "archive independent server readback");
    }
    using (var exportHttp = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }))
    {
        using var exportRequest = new HttpRequestMessage(HttpMethod.Get, endpoint + "/api/export");
        exportRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var exportResponse = await exportHttp.SendAsync(exportRequest);
        exportResponse.EnsureSuccessStatusCode();
        using var export = System.Text.Json.JsonDocument.Parse(await exportResponse.Content.ReadAsStringAsync());
        Check(export.RootElement.GetProperty("tasks")[0].GetProperty("archived").GetInt32() == 1 && export.RootElement.GetProperty("completions").GetArrayLength() == 1, "archive retains history on server");
    }
    using (var concurrent = new TasksClient(vault))
    {
        Check(await concurrent.RestoreAsync(date), "concurrent client restore");
        using var wire = new CreationReadbackWire(async () => await concurrent.AddTaskAsync(new("Unrelated concurrent task", "", "Personal", "once", 1, "2026-11-15", 0), date));
        using var creating = new TasksClient(vault, wire);
        Check(await creating.RestoreAsync(date), "creating client restore");
        var creation = new TaskWorkspace();
        creation.Update(creating.Session, date, creating.State);
        creation.BeginAdd("routines", date);
        creation.Draft!.Title = "Exact workspace creation";
        var payload = creation.Draft.ToPayload();
        var confirmed = false;
        try { confirmed = await creation.SaveAsync(creating, payload, date, () => date); }
        catch (TasksClientException) { }
        Check(!confirmed, "failed readback never confirms creation");
        Check(wire.Posts == 1 && wire.CreatedId is not null, "fault fixture observed actual POST response");
        Check(!creating.IsConnected && creation.Mode == "edit", "failed readback disconnects and retains editor");
        Check(creation.Draft?.AcknowledgedCreationId == wire.CreatedId, "real POST acknowledgment retained before failed readback");
        await creating.RefreshAsync(date);
        creation.Update(creating.Session, date, creating.State);
        Check(await creation.SaveAsync(creating, payload, date, () => date) && creation.TaskId == wire.CreatedId && creation.ResolveTask(creating.State)?.Title == payload.Title,
            "reconnect reconciles exact POST identity despite concurrent creation");
        Check(wire.Posts == 1 && creating.State!.Tasks.Count == 2, "retry does not duplicate real server task");
        foreach (var task in creating.State!.Tasks.ToArray()) await creating.ArchiveTaskAsync(task.Id, date);
    }
    await client.SignOutAsync(); Check(client.State is null && client.Session is null && vault.Saved is null, "logout local clearing");
    using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
    using var request = new HttpRequestMessage(HttpMethod.Get, endpoint + "/api/state?date=2026-11-15");
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    using var response = await http.SendAsync(request); Check(response.StatusCode == HttpStatusCode.Unauthorized, "logout real remote revocation readback");
    Console.WriteLine("PASS: real API login/create/exact-POST-identity/refresh/complete/undo/restore/isolation/edit-all-fields/dedicated-workspace-cancel-save/hidden-field-preservation/archive/history/acknowledged-create-failed-readback/concurrent-create/reconnect-no-duplicate/logout/revocation; disposable DB only. Native WinUI rendering is not exercised.");
}
finally
{
    process.StandardInput.Close();
    try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)); }
    catch (TimeoutException) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
}
static void Check(bool result, string name) { if (!result) throw new InvalidOperationException("Smoke failed: " + name); }
sealed class CreationReadbackWire(Func<Task> concurrentCreate) : DelegatingHandler(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
{
    public int Posts;
    public string? CreatedId;
    private bool failRead;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (request.Method == HttpMethod.Get && request.RequestUri!.AbsolutePath == "/api/state" && failRead)
        {
            failRead = false;
            throw new IOException("disposable fixture readback interruption");
        }
        var response = await base.SendAsync(request, ct);
        if (request.Method == HttpMethod.Post && request.RequestUri!.AbsolutePath == "/api/tasks" && response.IsSuccessStatusCode)
        {
            Posts++;
            // Buffer without consuming/disposal of the stream the real client must read.
            CreatedId = JsonSerializer.Deserialize<TaskItem>(await response.Content.ReadAsStringAsync(ct), new JsonSerializerOptions(JsonSerializerDefaults.Web))!.Id;
            await concurrentCreate();
            failRead = true;
        }
        return response;
    }
}
sealed class MemoryVault : ISessionVault
{
    public SessionProfile? Saved;
    public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult(Saved);
    public Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default) { Saved = profile; return Task.CompletedTask; }
    public Task ClearAsync(CancellationToken cancellationToken = default) { Saved = null; return Task.CompletedTask; }
}
