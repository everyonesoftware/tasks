using System.Net;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class RefreshTests
{
    [Theory][InlineData("offline")][InlineData("json")][InlineData("expired")][InlineData("cancel")]
    public async Task Refresh_failure_removes_all_task_access(string failure)
    {
        var v = new ClientTests.Vault(); var h = new ClientTests.Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://example.test", "tester", "password", ClientTests.Date);
        h.Respond = (_, _) => failure switch { "offline" => throw new HttpRequestException("secret token"), "cancel" => throw new OperationCanceledException(), "expired" => Task.FromResult(ClientTests.Reply("secret", HttpStatusCode.Unauthorized)), _ => Task.FromResult(ClientTests.Reply("{}")) };
        if (failure == "cancel") await Assert.ThrowsAnyAsync<OperationCanceledException>(() => c.RefreshAsync(ClientTests.Date));
        else { var e = await Assert.ThrowsAsync<TasksClientException>(() => c.RefreshAsync(ClientTests.Date)); Assert.Equal(failure == "expired", e.SessionExpired); Assert.DoesNotContain("secret", e.ToString()); }
        Assert.False(c.IsConnected); Assert.Null(c.State); Assert.Null(c.Current); Assert.Empty(c.Waiting);
        if (failure == "expired") { Assert.Null(c.Session); Assert.Null(v.Saved); }
        else { Assert.NotNull(v.Saved); h.Respond = null; await c.RefreshAsync(ClientTests.Date); Assert.True(c.IsConnected); }
    }
}
