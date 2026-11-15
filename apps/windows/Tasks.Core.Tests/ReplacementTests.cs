using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class ReplacementTests
{
    [Fact] public async Task Successful_account_switch_resets_focus_even_if_servers_reuse_ids()
    {
        var h = new ClientTests.Wire { Respond = (r, _) => Task.FromResult(ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : FocusTests.Payload(FocusTests.Item("a"), FocusTests.Item("b")))) };
        var v = new ClientTests.Vault(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://old.test", "u", "password", ClientTests.Date); c.NotNow(); Assert.Equal("b", c.Current!.TaskId);
        await c.SignInAsync("https://new.test", "u", "password", ClientTests.Date);
        Assert.Equal("a", c.Current!.TaskId); Assert.Equal("https://new.test", c.Session!.Endpoint); Assert.Equal(c.Session, v.Saved);
    }
    [Theory][InlineData("null")][InlineData("{}")][InlineData("not json")]
    [InlineData("{\"date\":\"2026-11-15\",\"tasks\":[],\"today\":[null],\"upcoming\":[],\"progress\":{\"completed\":0,\"total\":1}}")]
    public async Task Bad_candidate_state_cannot_replace_working_connection(string payload)
    {
        var v = new ClientTests.Vault(); var h = new ClientTests.Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://old.test", "tester", "password", ClientTests.Date);
        var old = c.Session; var state = c.State;
        h.Respond = (r, _) => Task.FromResult(ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : payload));
        await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync("https://new.test", "tester", "secret", ClientTests.Date));
        Assert.Same(old, c.Session); Assert.Same(state, c.State); Assert.Equal(old, v.Saved);
        Assert.Equal("/api/auth/logout", h.Paths[^1]);
    }
    [Fact] public async Task Vault_failure_rolls_back_candidate_and_revokes_its_token()
    {
        var v = new ClientTests.Vault(); var h = new ClientTests.Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://old.test", "tester", "password", ClientTests.Date); var old = c.Session; var state = c.State;
        v.FailSave = true;
        await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync("https://new.test", "tester", "secret", ClientTests.Date));
        Assert.Same(old, c.Session); Assert.Same(state, c.State); Assert.Equal(old, v.Saved); Assert.Equal("/api/auth/logout", h.Paths[^1]);
    }
}
