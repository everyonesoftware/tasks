using Tasks.App;
using Tasks.Core;
using Xunit;

namespace Tasks.Storage.Tests;

public sealed class SessionStartupTests
{
    [Fact]
    public async Task RealClientRemainsInStartupDuringVaultValidationAndTaskRead()
    {
        var startup = new SessionStartup();
        var vault = new DelayedVault();
        using var wire = new DelayedWire();
        using var client = new TasksClient(vault, wire);
        var restore = startup.RestoreAsync(() => client.RestoreAsync(new DateOnly(2026, 11, 17)));
        Assert.True(startup.IsRestoring);
        Assert.Null(client.Session);
        vault.Load.SetResult(new("https://example.test", "tester", "fixture-token", DateTimeOffset.UtcNow.AddDays(1)));
        await wire.SessionRequested.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(startup.IsRestoring);
        Assert.Null(client.Session);
        wire.SessionResponse.SetResult(Reply("{\"username\":\"tester\",\"expiresAt\":\"2099-01-01T00:00:00Z\"}"));
        await wire.StateRequested.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(startup.IsRestoring);
        Assert.Null(client.Session);
        Assert.Null(client.State);
        wire.StateResponse.SetResult(Reply("{\"date\":\"2026-11-17\",\"tasks\":[],\"today\":[],\"upcoming\":[],\"progress\":{\"completed\":0,\"total\":0}}"));
        await restore;
        Assert.False(startup.IsRestoring);
        Assert.False(startup.NeedsRetry);
        Assert.True(client.IsConnected);
    }

    private static HttpResponseMessage Reply(string json) => new(System.Net.HttpStatusCode.OK)
    {
        Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json")
    };

    private sealed class DelayedVault : ISessionVault
    {
        public TaskCompletionSource<SessionProfile?> Load { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Load.Task.WaitAsync(cancellationToken);
        public Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default) => throw new InvalidOperationException("Restoration must not replace the saved session.");
        public Task ClearAsync(CancellationToken cancellationToken = default) => throw new InvalidOperationException("Valid restoration must not clear the saved session.");
    }

    private sealed class DelayedWire : HttpMessageHandler
    {
        public TaskCompletionSource SessionRequested { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource StateRequested { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<HttpResponseMessage> SessionResponse { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<HttpResponseMessage> StateResponse { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsolutePath == "/api/auth/session")
            {
                SessionRequested.SetResult();
                return SessionResponse.Task.WaitAsync(cancellationToken);
            }
            Assert.Equal("/api/state", request.RequestUri.AbsolutePath);
            StateRequested.SetResult();
            return StateResponse.Task.WaitAsync(cancellationToken);
        }
    }

    [Fact]
    public async Task FailureShowsRetryUntilAnotherRestoreCompletes()
    {
        var startup = new SessionStartup();
        await Assert.ThrowsAsync<TasksClientException>(() => startup.RestoreAsync(
            () => Task.FromException<bool>(new TasksClientException())));
        Assert.False(startup.IsRestoring);
        Assert.True(startup.NeedsRetry);

        var response = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var retry = startup.RestoreAsync(() => response.Task);
        Assert.True(startup.IsRestoring);
        Assert.False(startup.NeedsRetry);
        response.SetResult(true);
        await retry;
        Assert.False(startup.IsRestoring);
        Assert.False(startup.NeedsRetry);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task InitialAndPendingRestoreNeverLookSignedOut(bool savedSession)
    {
        var startup = new SessionStartup();
        Assert.True(startup.IsRestoring);
        var response = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var restore = startup.RestoreAsync(() => response.Task);
        Assert.True(startup.IsRestoring);
        Assert.False(startup.NeedsRetry);
        response.SetResult(savedSession);
        await restore;
        Assert.False(startup.IsRestoring);
        Assert.False(startup.NeedsRetry);
    }

    [Fact]
    public async Task ExpiredSessionReturnsToSignInNotConnectionRetry()
    {
        var startup = new SessionStartup();
        await Assert.ThrowsAsync<TasksClientException>(() => startup.RestoreAsync(
            () => Task.FromException<bool>(new TasksClientException(true))));
        Assert.False(startup.IsRestoring);
        Assert.False(startup.NeedsRetry);
    }

    [Fact]
    public async Task CancellationRemainsRetryableWithoutClaimingSignOut()
    {
        var startup = new SessionStartup();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => startup.RestoreAsync(
            () => Task.FromCanceled<bool>(new CancellationToken(true))));
        Assert.False(startup.IsRestoring);
        Assert.True(startup.NeedsRetry);
    }

    [Fact]
    public async Task LocalSignOutClearsFailedRestore()
    {
        var startup = new SessionStartup();
        await Assert.ThrowsAsync<IOException>(() => startup.RestoreAsync(
            () => Task.FromException<bool>(new IOException("fixture"))));
        Assert.True(startup.NeedsRetry);
        startup.SignedOut();
        Assert.False(startup.NeedsRetry);
        Assert.False(startup.IsRestoring);
    }
}
