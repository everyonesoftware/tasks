using System.Text.Json;
using Tasks.Core;
using Xunit;

namespace Tasks.Core.Tests;

public sealed class TaskWorkspaceEditTests
{
    [Theory]
    [InlineData("removed")]
    [InlineData("date")]
    [InlineData("snapshot-date")]
    [InlineData("draft")]
    [InlineData("account")]
    public async Task Queued_native_edit_rejects_removed_task_or_stale_context_without_PUT(string transition)
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var block = false;
        var puts = 0;
        var task = TaskCreationTests.Record("a");
        var wire = new ClientTests.Wire { Respond = async (r, _) =>
        {
            if (block) { block = false; entered.SetResult(); await release.Task; }
            if (r.RequestUri!.AbsolutePath == "/api/auth/login") return ClientTests.Reply(ClientTests.LoginJson);
            if (r.Method == HttpMethod.Put) { puts++; return ClientTests.Reply(JsonSerializer.Serialize(task)); }
            return ClientTests.Reply(JsonSerializer.Serialize(new DayState(
                transition == "snapshot-date" && entered.Task.IsCompleted ? "2026-11-16" : "2026-11-15",
                transition == "removed" && entered.Task.IsCompleted ? [] : [task], [], [], new(0, 0))));
        } };
        using var client = new TasksClient(new ClientTests.Vault(), wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        var workspace = new TaskWorkspace();
        workspace.Update(client.Session, ClientTests.Date, client.State);
        workspace.OpenTask("a", "routines", null);
        Assert.True(workspace.BeginEdit(client.State));
        var draft = workspace.Draft!;
        var now = ClientTests.Date;
        block = true;
        var pending = transition == "account"
            ? client.SignInAsync("https://other.test", "tester", "password", ClientTests.Date)
            : client.RefreshAsync(transition == "snapshot-date" ? ClientTests.Date.AddDays(1) : ClientTests.Date);
        await entered.Task;
        var save = workspace.SaveAsync(client, draft.ToPayload(), ClientTests.Date, () => now);
        if (transition == "date") now = now.AddDays(1);
        if (transition == "draft") workspace.CancelEdit();
        release.SetResult();
        await pending;
        await Assert.ThrowsAsync<TasksClientException>(() => save);
        Assert.Equal(0, puts);
        Assert.Equal(transition == "draft" ? "details" : "edit", workspace.Mode);
        if (transition != "draft") Assert.Same(draft, workspace.Draft);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Native_save_preserves_hidden_fields_from_refresh_even_when_edit_waits_for_gate(bool queued)
    {
        var task = TaskCreationTests.Record("a");
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var block = false;
        TaskDraft? sent = null;
        var wire = new ClientTests.Wire { Respond = async (r, ct) =>
        {
            if (r.RequestUri!.AbsolutePath == "/api/auth/login") return ClientTests.Reply(ClientTests.LoginJson);
            if (r.Method == HttpMethod.Put)
            {
                sent = JsonSerializer.Deserialize<TaskDraft>(await r.Content!.ReadAsStringAsync(ct), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                return ClientTests.Reply(JsonSerializer.Serialize(task));
            }
            if (block) { block = false; entered.SetResult(); await release.Task; }
            return ClientTests.Reply(JsonSerializer.Serialize(new DayState("2026-11-15", [task], [], [], new(0, 0))));
        } };
        using var client = new TasksClient(new ClientTests.Vault(), wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        var workspace = new TaskWorkspace();
        workspace.Update(client.Session, ClientTests.Date, client.State);
        workspace.OpenTask("a", "routines", null);
        Assert.True(workspace.BeginEdit(client.State));
        workspace.Draft!.Title = "Native name";
        workspace.Draft.Repeat = "weekly";
        workspace.Draft.Interval = 3;
        workspace.Draft.StartDate = "2026-11-16";
        var payload = workspace.Draft.ToPayload();
        task = task with { Notes = "other-client notes", Category = "Work", Priority = 2 };
        block = queued;
        var refresh = client.RefreshAsync(ClientTests.Date);
        if (queued) await entered.Task; else await refresh;
        var save = workspace.SaveAsync(client, payload, ClientTests.Date, () => ClientTests.Date);
        release.TrySetResult();
        await refresh;
        Assert.True(await save);
        Assert.NotNull(sent);
        Assert.Equal(task.Notes, sent.Notes);
        Assert.Equal(task.Category, sent.Category);
        Assert.Equal(task.Priority, sent.Priority);
        Assert.Equal(payload.Title, sent.Title);
        Assert.Equal(payload.Repeat, sent.Repeat);
        Assert.Equal(payload.Interval, sent.Interval);
        Assert.Equal(payload.StartDate, sent.StartDate);
    }
}