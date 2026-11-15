using System.Net;
using System.Reflection;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class TransportTests
{
    [Fact] public async Task Json_posts_have_fixed_content_length_required_by_real_server()
    {
        var h = new ClientTests.Wire { Respond = async (r, _) => {
            if (r.Content != null)
            { var length = r.Content.Headers.ContentLength; var bytes = await r.Content.ReadAsByteArrayAsync(); Assert.Equal(bytes.Length, length); }
            return ClientTests.Reply(r.RequestUri!.AbsolutePath == "/api/auth/login" ? ClientTests.LoginJson : ClientTests.StateJson);
        } };
        using var c = new TasksClient(new ClientTests.Vault(), h); await c.SignInAsync("https://example.test", "u", "password", ClientTests.Date);
    }
    [Fact] public void Production_transport_never_redirects_or_uses_cookies_or_tls_override()
    {
        using var c = new TasksClient(new ClientTests.Vault());
        var http = (HttpClient)typeof(TasksClient).GetField("http", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(c)!;
        var handler = (HttpClientHandler)typeof(HttpMessageInvoker).GetField("_handler", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(http)!;
        Assert.False(handler.AllowAutoRedirect); Assert.False(handler.UseCookies); Assert.Null(handler.ServerCertificateCustomValidationCallback);
    }
    [Theory][InlineData(302)][InlineData(401)][InlineData(429)][InlineData(500)]
    public async Task Server_failures_are_private_and_never_followed(int code)
    {
        var h = new ClientTests.Wire { Respond = (_, _) => Task.FromResult(ClientTests.Reply("secret raw failure", (HttpStatusCode)code)) };
        using var c = new TasksClient(new ClientTests.Vault(), h);
        var e = await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync("https://example.test", "u", "secret", ClientTests.Date));
        Assert.DoesNotContain("secret", e.ToString()); Assert.Single(h.Paths); Assert.False(c.IsConnected);
    }
}
