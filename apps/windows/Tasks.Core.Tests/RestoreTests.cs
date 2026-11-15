using System.Net;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class RestoreTests
{
    [Fact] public async Task Restore_requires_remote_session_validation_and_state_read()
    {
        var v = new ClientTests.Vault { Saved = new("https://example.test", "tester", "saved-token", DateTimeOffset.UtcNow.AddDays(1)) };
        var h = new ClientTests.Wire { Respond = (r, _) => Task.FromResult(ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/session" ? "{\"username\":\"tester\",\"expiresAt\":\"2099-01-01T00:00:00Z\"}" : ClientTests.StateJson)) };
        using var c = new TasksClient(v, h); Assert.True(await c.RestoreAsync(ClientTests.Date));
        Assert.True(c.IsConnected); Assert.Equal(new[] { "/api/auth/session", "/api/state?date=2026-11-15" }, h.Paths); Assert.All(h.Tokens, t => Assert.Equal("saved-token", t));
    }
    [Fact] public async Task No_saved_session_returns_false_without_network()
    { var h = new ClientTests.Wire(); using var c = new TasksClient(new ClientTests.Vault(), h); Assert.False(await c.RestoreAsync(ClientTests.Date)); Assert.Empty(h.Paths); }
    [Theory][InlineData(true)][InlineData(false)]
    public async Task Expired_session_is_removed_without_exposing_data(bool local)
    {
        var v = new ClientTests.Vault { Saved = new("https://example.test", "tester", "saved-token", local ? DateTimeOffset.UtcNow.AddDays(-1) : DateTimeOffset.UtcNow.AddDays(1)) };
        var h = new ClientTests.Wire { Respond = (_, _) => Task.FromResult(ClientTests.Reply("secret", HttpStatusCode.Unauthorized)) };
        using var c = new TasksClient(v, h);
        var e = await Assert.ThrowsAsync<TasksClientException>(() => c.RestoreAsync(ClientTests.Date));
        Assert.True(e.SessionExpired); Assert.Null(v.Saved); Assert.Null(c.State); Assert.Null(c.Session); if (local) Assert.Empty(h.Paths);
    }
}
