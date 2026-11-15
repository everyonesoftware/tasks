using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class LifetimeTests
{
    private sealed class FailingDeleteVault : ISessionVault
    {
        public SessionProfile? Saved; public bool Fail = true;
        public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult(Saved);
        public Task SaveAsync(SessionProfile p, CancellationToken cancellationToken = default) { Saved = p; return Task.CompletedTask; }
        public Task ClearAsync(CancellationToken cancellationToken = default) { if (Fail) throw new IOException("secret file"); Saved = null; return Task.CompletedTask; }
    }
    [Fact] public async Task Failed_vault_delete_locks_access_until_logout_retry()
    {
        var v = new FailingDeleteVault(); var h = new ClientTests.Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        var e = await Assert.ThrowsAsync<TasksClientException>(() => c.SignOutAsync());
        Assert.Contains("saved sign-in", e.Message); Assert.Null(c.State); Assert.False(c.IsConnected); Assert.NotNull(v.Saved);
        Assert.True(typeof(TasksClient).GetProperty("NeedsSignOutRetry")?.GetValue(c) is true,
            "The native shell needs an explicit sign-out retry state when credential deletion fails.");
        await Assert.ThrowsAsync<TasksClientException>(() => c.RestoreAsync(ClientTests.Date));
        await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync("https://new.test", "u", "password", ClientTests.Date));
        v.Fail = false; await c.SignOutAsync(); Assert.Null(v.Saved);
        Assert.True(typeof(TasksClient).GetProperty("NeedsSignOutRetry")?.GetValue(c) is false);
        await c.SignInAsync("https://new.test", "u", "password", ClientTests.Date); Assert.True(c.IsConnected);
    }
    private sealed class OwnedHandler : HttpMessageHandler
    {
        public bool Disposed;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) => Task.FromResult(ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : ClientTests.StateJson));
        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
    }
    [Fact] public async Task Dispose_clears_memory_but_does_not_dispose_caller_owned_handler()
    {
        using var h = new OwnedHandler(); var c = new TasksClient(new ClientTests.Vault(), h);
        await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date); c.Dispose();
        Assert.Null(c.State); Assert.Null(c.Session); Assert.False(h.Disposed);
        await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync("https://example.test", "u", "password", ClientTests.Date));
    }
}
