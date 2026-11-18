using System.Net;
using System.Text.Json;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class TaskInteractionTests
{
    [Fact]
    public void Actions_require_a_live_today_occurrence_and_reject_future_or_stale_rows()
    {
        var item = FocusTests.Item("a");
        var state = new DayState("2026-11-15", [], [item, FocusTests.Item("done", true)], [], new(1, 2));
        Assert.True(TaskActions.CanFocus(state, item, ClientTests.Date));
        Assert.True(TaskActions.CanComplete(state, item, ClientTests.Date));
        Assert.True(TaskActions.CanUndo(state, state.Today[1], ClientTests.Date));
        Assert.False(TaskActions.CanFocus(state, state.Today[1], ClientTests.Date));
        Assert.False(TaskActions.CanComplete(state, item with { DueDate = "2026-11-16" }, ClientTests.Date));
        Assert.False(TaskActions.CanComplete(state, FocusTests.Item("missing"), ClientTests.Date));
        Assert.False(TaskActions.CanComplete(state, item, ClientTests.Date.AddDays(1)));
        Assert.False(TaskActions.CanUndo(null, state.Today[1], ClientTests.Date));
    }
    [Theory]
    [InlineData(false, false)][InlineData(true, true)]
    public async Task Occurrence_mutations_reject_a_snapshot_from_before_midnight(bool undo, bool completed)
    {
        var item = FocusTests.Item("a", completed);
        var h = new ClientTests.Wire { Respond = (r, _) => Task.FromResult(ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : FocusTests.Payload(item))) };
        using var c = new TasksClient(new ClientTests.Vault(), h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var requests = h.Paths.Count;
        await Assert.ThrowsAsync<TasksClientException>(() => undo ? c.UndoAsync(item, ClientTests.Date.AddDays(1)) : c.CompleteAsync(item, ClientTests.Date.AddDays(1)));
        Assert.Equal(requests, h.Paths.Count);
    }

    [Theory]
    [InlineData(false, true, false)][InlineData(true, false, false)]
    [InlineData(false, false, true)][InlineData(true, true, true)]
    public async Task Occurrence_mutations_require_correct_completed_status_in_latest_snapshot(bool undo, bool completed, bool stale)
    {
        var item = FocusTests.Item("a", completed);
        var h = new ClientTests.Wire { Respond = (r, _) => Task.FromResult(ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : FocusTests.Payload(item))) };
        using var c = new TasksClient(new ClientTests.Vault(), h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var requests = h.Paths.Count;
        var supplied = stale ? item with { Completed = !completed } : item;
        await Assert.ThrowsAsync<TasksClientException>(() => undo ? c.UndoAsync(supplied, ClientTests.Date) : c.CompleteAsync(supplied, ClientTests.Date));
        Assert.Equal(requests, h.Paths.Count);
    }

    [Theory][InlineData(false)][InlineData(true)]
    public async Task Occurrence_mutations_reject_missing_today_membership(bool undo)
    {
        var h = new ClientTests.Wire(); using var c = new TasksClient(new ClientTests.Vault(), h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var requests = h.Paths.Count;
        var item = FocusTests.Item("missing", undo);
        await Assert.ThrowsAsync<TasksClientException>(() => undo ? c.UndoAsync(item, ClientTests.Date) : c.CompleteAsync(item, ClientTests.Date));
        Assert.Equal(requests, h.Paths.Count);
    }

    [Fact]
    public async Task Future_occurrences_cannot_be_completed_by_the_client()
    {
        var h = new ClientTests.Wire(); using var c = new TasksClient(new ClientTests.Vault(), h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var requests = h.Paths.Count;
        await Assert.ThrowsAsync<TasksClientException>(() => c.CompleteAsync(FocusTests.Item("future") with { DueDate = "2026-11-16" }, ClientTests.Date));
        Assert.Equal(requests, h.Paths.Count);
    }
    [Theory][InlineData(false)][InlineData(true)]
    public async Task Edit_and_archive_refresh_authoritative_state_and_fail_closed(bool archive)
    {
        var h = new ClientTests.Wire(); using var c = new TasksClient(new ClientTests.Vault(), h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var draft = new TaskDraft("Edited", "notes", "Work", "weekly", 2, "2026-11-15", 2);
        string? body = null;
        h.Respond = async (r, _) => {
            if (r.Method == HttpMethod.Get) return ClientTests.Reply(FocusTests.Payload());
            if (archive) return new HttpResponseMessage(HttpStatusCode.NoContent);
            body = await r.Content!.ReadAsStringAsync();
            return ClientTests.Reply(JsonSerializer.Serialize(new TaskItem("a", draft.Title, draft.Notes, draft.Category, draft.Repeat, draft.Interval, draft.StartDate, draft.Priority, ""), new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        };
        if (archive) await c.ArchiveTaskAsync("a", ClientTests.Date); else await c.EditTaskAsync("a", draft, ClientTests.Date);
        Assert.Equal(new[] { "/api/tasks/a", "/api/state?date=2026-11-15" }, h.Paths.TakeLast(2));
        if (!archive) Assert.Contains("\"title\":\"Edited\"", body);
        Assert.NotNull(c.State);
        h.Respond = (_, _) => throw new HttpRequestException();
        await Assert.ThrowsAsync<TasksClientException>(() => archive ? c.ArchiveTaskAsync("a", ClientTests.Date) : c.EditTaskAsync("a", draft, ClientTests.Date));
        Assert.Null(c.State);
    }
}
