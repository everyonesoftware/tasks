using System.Text.Json;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class CancellationTests
{
    [Fact] public async Task Cancelled_candidate_read_preserves_existing_account_and_revokes_candidate()
    {
        var v = new ClientTests.Vault(); var h = new ClientTests.Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://old.test", "u", "password", ClientTests.Date); var old = c.Session; var state = c.State;
        using var source = new CancellationTokenSource();
        h.Respond = (r, _) => {
            if (r.RequestUri!.AbsolutePath == "/api/state") source.Cancel();
            return Task.FromResult(ClientTests.Reply(r.RequestUri.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : ClientTests.StateJson));
        };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SignInAsync("https://new.test", "u", "password", ClientTests.Date, source.Token));
        Assert.Same(old, c.Session); Assert.Same(state, c.State); Assert.Equal(old, v.Saved); Assert.Equal("/api/auth/logout", h.Paths[^1]);
    }
    [Theory][InlineData("")][InlineData("bad\r\nsecret")][InlineData("expired")]
    public async Task Invalid_login_envelope_is_never_persisted(string token)
    {
        var v = new ClientTests.Vault(); var h = new ClientTests.Wire { Respond = (_, _) => Task.FromResult(ClientTests.Reply(JsonSerializer.Serialize(new { token, username = "tester", expiresAt = token == "expired" ? DateTimeOffset.UtcNow.AddDays(-1) : DateTimeOffset.UtcNow.AddDays(1) }))) };
        using var c = new TasksClient(v, h);
        await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync("https://example.test", "u", "password", ClientTests.Date));
        Assert.Null(v.Saved); Assert.False(c.IsConnected); Assert.Single(h.Paths);
    }
}
