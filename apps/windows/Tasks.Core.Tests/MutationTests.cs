using System.Net;
using System.Text.Json;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class MutationTests
{
    [Fact] public async Task Create_posts_camel_case_draft_then_reads_authoritative_state()
    {
        var h = new ClientTests.Wire(); using var c = new TasksClient(new ClientTests.Vault(), h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        string? body = null;
        h.Respond = async (r, _) => {
            if (r.Method == HttpMethod.Post) { body = await r.Content!.ReadAsStringAsync(); return ClientTests.Reply("{\"id\":\"a\",\"title\":\"a\",\"notes\":\"\",\"category\":\"Personal\",\"repeat\":\"once\",\"interval\":1,\"startDate\":\"2026-11-15\",\"priority\":0,\"createdAt\":\"2026-11-15T00:00:00Z\"}", HttpStatusCode.Created); }
            return ClientTests.Reply(FocusTests.Payload(FocusTests.Item("a")));
        };
        var draft = new TaskDraft("a", "", "Personal", "once", 1, "2026-11-15", 0);
        await c.AddTaskAsync(draft, ClientTests.Date); Assert.Equal("a", c.Current!.Title);
        using var json = JsonDocument.Parse(body!); Assert.Equal("2026-11-15", json.RootElement.GetProperty("startDate").GetString());
        Assert.Equal(new[] { "/api/tasks", "/api/state?date=2026-11-15" }, h.Paths.TakeLast(2));
        h.Respond = (_, _) => throw new HttpRequestException("secret");
        await Assert.ThrowsAsync<TasksClientException>(() => c.AddTaskAsync(draft, ClientTests.Date)); Assert.Null(c.State);
    }
    [Theory][InlineData(false)][InlineData(true)]
    public async Task Completion_and_undo_use_server_state_never_optimistic(bool undo)
    {
        var done = undo; var h = new ClientTests.Wire(); string? body = null;
        h.Respond = async (r, _) => {
            if (r.RequestUri!.AbsolutePath == "/api/auth/login") return ClientTests.Reply(ClientTests.LoginJson);
            if (r.Method == HttpMethod.Post) { body = await r.Content!.ReadAsStringAsync(); done = !done; }
            return ClientTests.Reply(FocusTests.Payload(FocusTests.Item("a", done), FocusTests.Item("b")));
        };
        using var c = new TasksClient(new ClientTests.Vault(), h); await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var occurrence = c.State!.Today[0];
        if (undo) await c.UndoAsync(occurrence, ClientTests.Date); else await c.CompleteAsync(occurrence, ClientTests.Date);
        Assert.Equal(!undo, c.State!.Today[0].Completed); Assert.Equal("b", c.Current!.TaskId);
        using var json = JsonDocument.Parse(body!); Assert.Equal("a", json.RootElement.GetProperty("taskId").GetString()); Assert.Equal("2026-11-15", json.RootElement.GetProperty("date").GetString());
        Assert.Equal(undo ? "/api/occurrences/undo" : "/api/occurrences/complete", h.Paths[^1]);
        h.Respond = (_, _) => Task.FromResult(ClientTests.Reply("secret", HttpStatusCode.InternalServerError));
        var latest = c.State.Today[0];
        var requests = h.Paths.Count;
        await Assert.ThrowsAsync<TasksClientException>(() => latest.Completed ? c.UndoAsync(latest, ClientTests.Date) : c.CompleteAsync(latest, ClientTests.Date));
        Assert.Equal(requests + 1, h.Paths.Count); Assert.Null(c.State); Assert.False(c.IsConnected);
    }
}
