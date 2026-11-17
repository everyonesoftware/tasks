using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public sealed class UpdateSessionTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Restart_requires_readback_of_the_same_protected_session_without_saving_tasks(bool brokenReadback)
    {
        var vault = new Vault(); var wire = new ClientTests.Wire();
        using var client = new TasksClient(vault, wire);
        await client.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        vault.BrokenReadback = brokenReadback;
        var prepare = typeof(TasksClient).GetMethod("PrepareForUpdateRestartAsync");
        Assert.NotNull(prepare);
        var action = (Task)prepare.Invoke(client, new object[] { CancellationToken.None })!;
        if (brokenReadback) await Assert.ThrowsAsync<TasksClientException>(() => action);
        else await action;
        Assert.NotNull(client.State);
        Assert.Equal(2, wire.Paths.Count);
        Assert.Equal(client.Session, vault.Saved);
    }
    private sealed class Vault : ISessionVault
    {
        public SessionProfile? Saved;
        public bool BrokenReadback;
        public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult(BrokenReadback ? null : Saved);
        public Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default) { Saved = profile; return Task.CompletedTask; }
        public Task ClearAsync(CancellationToken cancellationToken = default) { Saved = null; return Task.CompletedTask; }
    }
}
