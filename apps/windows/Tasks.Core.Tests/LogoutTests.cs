using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class LogoutTests
{
    [Theory][InlineData(false)][InlineData(true)]
    public async Task Logout_always_clears_local_vault_even_if_remote_fails_or_cancelled(bool cancel)
    {
        var v = new ClientTests.Vault(); var h = new ClientTests.Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        h.Respond = (_, _) => throw new HttpRequestException("secret");
        var ct = cancel ? new CancellationToken(true) : default;
        var e = await Assert.ThrowsAsync<TasksClientException>(() => c.SignOutAsync(ct));
        Assert.DoesNotContain("secret", e.ToString()); Assert.Null(v.Saved); Assert.Null(c.Session); Assert.Null(c.State); Assert.Empty(c.Waiting); Assert.Null(c.Current);
    }
    [Fact] public async Task Logout_serializes_after_inflight_read_so_tasks_cannot_resurrect()
    {
        var v = new ClientTests.Vault(); var h = new ClientTests.Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        h.Respond = async (r, _) => { if (r.Method == HttpMethod.Get) { entered.SetResult(); await release.Task; } return ClientTests.Reply(ClientTests.StateJson); };
        var refresh = c.RefreshAsync(ClientTests.Date); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var logout = c.SignOutAsync(); Assert.False(logout.IsCompleted); release.SetResult(); await Task.WhenAll(refresh, logout);
        Assert.Null(c.Session); Assert.Null(c.State); Assert.Null(v.Saved); Assert.Equal("/api/auth/logout", h.Paths[^1]);
        await Assert.ThrowsAsync<TasksClientException>(() => c.RefreshAsync(ClientTests.Date)); Assert.Null(c.State);
    }
}
