using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class AsyncSafetyTests
{
    private sealed class Context : SynchronizationContext
    {
        public int Posts;
        public override void Post(SendOrPostCallback callback, object? state) { Interlocked.Increment(ref Posts); ThreadPool.QueueUserWorkItem(_ => callback(state)); }
    }
    [Fact] public async Task Core_never_requires_UI_context_to_finish_requests()
    {
        var h = new ClientTests.Wire { Respond = async (r, _) => { await Task.Delay(10).ConfigureAwait(false); return ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : ClientTests.StateJson); } };
        using var c = new TasksClient(new ClientTests.Vault(), h); var context = new Context(); var original = SynchronizationContext.Current; Task task;
        try { SynchronizationContext.SetSynchronizationContext(context); task = c.SignInAsync("https://example.test", "u", "password", ClientTests.Date); }
        finally { SynchronizationContext.SetSynchronizationContext(original); }
        await task; Assert.Equal(0, context.Posts);
    }
    [Fact] public async Task Cancellation_exception_never_contains_transport_secrets()
    {
        var h = new ClientTests.Wire { Respond = (_, _) => throw new OperationCanceledException("secret transport token") };
        using var c = new TasksClient(new ClientTests.Vault(), h);
        var e = await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.SignInAsync("https://example.test", "u", "password", ClientTests.Date));
        Assert.DoesNotContain("secret", e.ToString()); Assert.Null(e.InnerException);
    }
}
