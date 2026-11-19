using System.Text.Json;
using Tasks.Core;
using Xunit;

namespace Tasks.Core.Tests;

public sealed class TaskCreationTests
{
    internal static readonly TaskDraft Payload = new("Created", "", "Personal", "once", 1, "2026-11-15", 0);
    internal static TaskItem Record(string id) => new(id, id, "", "Personal", "once", 1, "2026-11-15", 0, "");
    internal static string Snapshot(params string[] ids) => JsonSerializer.Serialize(new DayState("2026-11-15", ids.Select(Record).ToArray(), [], [], new(0, 0)));

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Workspace_opens_only_the_exact_created_task_not_a_concurrent_creation(bool exactPresent)
    {
        var posted = false;
        var wire = new ClientTests.Wire { Respond = (r, _) => Task.FromResult(ClientTests.Reply(
            r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson :
            r.Method == HttpMethod.Post ? Acknowledge() : posted ? Snapshot(exactPresent ? ["unrelated", "exact-created"] : ["unrelated"]) : Snapshot())) };
        string Acknowledge() { posted = true; return JsonSerializer.Serialize(Record("exact-created")); }
        using var client = new TasksClient(new ClientTests.Vault(), wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        var workspace = new TaskWorkspace();
        workspace.Update(client.Session, ClientTests.Date, client.State);
        workspace.BeginAdd("routines", ClientTests.Date);
        workspace.Draft!.Title = Payload.Title;
        var confirmed = await workspace.SaveAsync(client, Payload, ClientTests.Date, () => ClientTests.Date);
        Assert.Equal(exactPresent, confirmed);
        Assert.Equal(exactPresent ? "exact-created" : null, workspace.TaskId);
        Assert.Equal(exactPresent ? "details" : "edit", workspace.Mode);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Acknowledged_create_then_failed_readback_reconciles_on_retry_without_another_POST(bool exactPresent)
    {
        var posts = 0;
        var failRead = false;
        var wire = new ClientTests.Wire { Respond = (r, _) =>
        {
            if (r.RequestUri!.AbsolutePath == "/api/auth/login") return Task.FromResult(ClientTests.Reply(ClientTests.LoginJson));
            if (r.Method == HttpMethod.Post) { posts++; failRead = true; return Task.FromResult(ClientTests.Reply(JsonSerializer.Serialize(Record("exact-created")))); }
            if (failRead) throw new IOException("fixture readback unavailable");
            return Task.FromResult(ClientTests.Reply(posts == 0 ? Snapshot() : Snapshot(exactPresent ? ["unrelated", "exact-created"] : ["unrelated"])));
        } };
        using var client = new TasksClient(new ClientTests.Vault(), wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        var workspace = new TaskWorkspace();
        workspace.Update(client.Session, ClientTests.Date, client.State);
        workspace.BeginAdd("today", ClientTests.Date);
        workspace.Draft!.Title = Payload.Title;
        var draft = workspace.Draft;
        await Assert.ThrowsAsync<TasksClientException>(() => workspace.SaveAsync(client, Payload, ClientTests.Date, () => ClientTests.Date));
        workspace.Update(client.Session, ClientTests.Date, client.State);
        Assert.False(client.IsConnected);
        Assert.Equal("edit", workspace.Mode);
        Assert.Same(draft, workspace.Draft);
        failRead = false;
        await client.RefreshAsync(ClientTests.Date); // actual reconnect boundary
        workspace.Update(client.Session, ClientTests.Date, client.State);
        Assert.Equal(exactPresent, await workspace.SaveAsync(client, Payload, ClientTests.Date, () => ClientTests.Date));
        Assert.Equal(1, posts);
        Assert.Equal(exactPresent ? "exact-created" : null, workspace.TaskId);
        Assert.Equal(exactPresent ? "details" : "edit", workspace.Mode);
    }

    [Fact]
    public async Task Queued_creation_cannot_cross_an_inflight_account_replacement()
    {
        var loginEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseLogin = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var replacing = false;
        var posts = 0;
        var wire = new ClientTests.Wire { Respond = async (r, _) =>
        {
            if (r.RequestUri!.AbsolutePath == "/api/auth/login")
            {
                if (replacing) { loginEntered.SetResult(); await releaseLogin.Task; }
                return ClientTests.Reply(ClientTests.LoginJson);
            }
            if (r.Method == HttpMethod.Post) { posts++; return ClientTests.Reply(JsonSerializer.Serialize(Record("wrong-account"))); }
            return ClientTests.Reply(Snapshot());
        } };
        using var client = new TasksClient(new ClientTests.Vault(), wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        var workspace = new TaskWorkspace();
        workspace.Update(client.Session, ClientTests.Date, client.State);
        workspace.BeginAdd("today", ClientTests.Date);
        replacing = true;
        var replacement = client.SignInAsync("https://other.test", "tester", "password", ClientTests.Date);
        await loginEntered.Task;
        var save = workspace.SaveAsync(client, Payload, ClientTests.Date, () => ClientTests.Date);
        releaseLogin.SetResult();
        await replacement;
        await Assert.ThrowsAsync<TasksClientException>(() => save);
        Assert.Equal(0, posts);
    }

    [Theory]
    [InlineData("date")]
    [InlineData("session")]
    [InlineData("signout")]
    public async Task Stale_workspace_context_rejects_creation_before_POST(string transition)
    {
        var wire = new ClientTests.Wire();
        using var client = new TasksClient(new ClientTests.Vault(), wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        var workspace = new TaskWorkspace();
        workspace.Update(client.Session, ClientTests.Date, client.State);
        workspace.BeginAdd("today", ClientTests.Date);
        var currentDate = transition == "date" ? ClientTests.Date.AddDays(1) : ClientTests.Date;
        if (transition == "session") await client.SignInAsync("https://other.test", "tester", "password", ClientTests.Date);
        if (transition == "signout") { try { await client.SignOutAsync(); } catch (TasksClientException) { } }
        var postsBefore = wire.Paths.Count(p => p == "/api/tasks");
        Assert.False(await workspace.SaveAsync(client, Payload, ClientTests.Date, () => currentDate));
        Assert.Equal(postsBefore, wire.Paths.Count(p => p == "/api/tasks"));
    }

    [Fact]
    public async Task Create_returns_the_POST_identity_even_with_concurrent_unrelated_readback_records()
    {
        var posted = false;
        var wire = new ClientTests.Wire { Respond = (r, _) => Task.FromResult(ClientTests.Reply(
            r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson :
            r.Method == HttpMethod.Post ? Acknowledge() : posted ? Snapshot("unrelated", "exact-created") : Snapshot())) };
        string Acknowledge() { posted = true; return JsonSerializer.Serialize(Record("exact-created")); }
        using var client = new TasksClient(new ClientTests.Vault(), wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        var createdId = await client.AddTaskAsync(Payload, ClientTests.Date);
        Assert.Equal("exact-created", createdId);
        Assert.Equal(2, client.State!.Tasks.Count);
    }
}