using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class LogoutTests
{
    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task Logout_after_failed_restore_attempts_revocation_without_exposing_tasks(bool stateReadFails, bool logoutFails)
    {
        var v = new ClientTests.Vault { Saved = new("https://example.test", "tester", "saved-token", DateTimeOffset.UtcNow.AddDays(1)) };
        var h = new ClientTests.Wire
        {
            Respond = (r, _) => stateReadFails && r.RequestUri!.AbsolutePath == "/api/auth/session"
                ? Task.FromResult(ClientTests.Reply("{\"username\":\"tester\",\"expiresAt\":\"2099-01-01T00:00:00Z\"}"))
                : throw new HttpRequestException("fixture")
        };
        using var c = new TasksClient(v, h);
        await Assert.ThrowsAsync<TasksClientException>(() => c.RestoreAsync(ClientTests.Date));
        Assert.Null(c.Session); Assert.Null(c.State); Assert.False(c.IsConnected);
        h.Respond = (_, _) => logoutFails ? throw new HttpRequestException("fixture")
            : Task.FromResult(ClientTests.Reply("", System.Net.HttpStatusCode.NoContent));
        if (logoutFails)
        {
            var error = await Assert.ThrowsAsync<TasksClientException>(() => c.SignOutAsync());
            Assert.Contains("revocation could not be confirmed", error.Message);
        }
        else await c.SignOutAsync();
        Assert.Equal("/api/auth/logout", h.Paths[^1]);
        Assert.Equal("saved-token", h.Tokens[^1]);
        Assert.Null(v.Saved); Assert.Null(c.Session); Assert.Null(c.State);
    }

    [Fact]
    public async Task Failed_local_deletion_after_startup_failure_preserves_revocation_for_retry()
    {
        var v = new RetryVault();
        var h = new ClientTests.Wire { Respond = (_, _) => throw new HttpRequestException("fixture") };
        using var c = new TasksClient(v, h);
        await Assert.ThrowsAsync<TasksClientException>(() => c.RestoreAsync(ClientTests.Date));
        await Assert.ThrowsAsync<TasksClientException>(() => c.SignOutAsync());
        Assert.True(c.NeedsSignOutRetry); Assert.NotNull(v.Saved);
        Assert.DoesNotContain("/api/auth/logout", h.Paths);
        v.FailClear = false;
        h.Respond = (_, _) => Task.FromResult(ClientTests.Reply("", System.Net.HttpStatusCode.NoContent));
        await c.SignOutAsync();
        Assert.False(c.NeedsSignOutRetry); Assert.Null(v.Saved);
        Assert.Equal("/api/auth/logout", h.Paths[^1]);
        Assert.Equal("saved-token", h.Tokens[^1]);
    }

    private sealed class RetryVault : ISessionVault
    {
        public SessionProfile? Saved = new("https://example.test", "tester", "saved-token", DateTimeOffset.UtcNow.AddDays(1));
        public bool FailClear = true;
        public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult(Saved);
        public Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default) => throw new InvalidOperationException("unexpected save");
        public Task ClearAsync(CancellationToken cancellationToken = default)
        {
            if (FailClear) throw new IOException("fixture");
            Saved = null;
            return Task.CompletedTask;
        }
    }

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
