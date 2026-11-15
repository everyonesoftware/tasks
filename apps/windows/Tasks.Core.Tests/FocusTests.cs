using System.Text.Json;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class FocusTests
{
    internal static Occurrence Item(string id, bool completed = false) => new(id + "@2026-11-15", id, id, "", "Personal", "once", 1, 0, "2026-11-15", completed, false, null);
    internal static string Payload(params Occurrence[] items) => JsonSerializer.Serialize(new DayState("2026-11-15", [], items, [], new(items.Count(i => i.Completed), items.Length)), new JsonSerializerOptions(JsonSerializerDefaults.Web));
    [Fact] public async Task Focus_select_rotation_and_refresh_preserve_only_in_memory_order()
    {
        var h = new ClientTests.Wire { Respond = (r, _) => Task.FromResult(ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : Payload(Item("a"), Item("b"), Item("c"), Item("done", true)))) };
        using var c = new TasksClient(new ClientTests.Vault(), h); await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
        Assert.Equal("a", c.Current!.TaskId); Assert.Equal(new[] { "b", "c" }, c.Waiting.Select(o => o.TaskId));
        c.NotNow(); Assert.Equal("b", c.Current!.TaskId); c.Select("c@2026-11-15"); Assert.Equal("c", c.Current!.TaskId);
        c.Select("unknown"); Assert.Equal("c", c.Current!.TaskId);
        await c.RefreshAsync(ClientTests.Date); Assert.Equal("c", c.Current!.TaskId);
        c.NotNow(); Assert.Equal("b", c.Current!.TaskId);
    }
}
