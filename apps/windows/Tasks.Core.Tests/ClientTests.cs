using System.Net;
using System.Text;
using System.Text.Json;
using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class ClientTests
{
    internal static readonly DateOnly Date = new(2026, 11, 15);
    internal static string StateJson = """{"date":"2026-11-15","tasks":[],"today":[],"upcoming":[],"progress":{"completed":0,"total":0}}""";
    internal static string LoginJson => JsonSerializer.Serialize(new { token = "test-token", username = "tester", expiresAt = DateTimeOffset.UtcNow.AddDays(1) });
    internal sealed class Vault : ISessionVault
    {
        public SessionProfile? Saved; public bool FailSave { get; set; } public int Clears;
        public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult(Saved);
        public Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default) { if (FailSave) throw new IOException("secret"); Saved = profile; return Task.CompletedTask; }
        public Task ClearAsync(CancellationToken cancellationToken = default) { Saved = null; Clears++; return Task.CompletedTask; }
    }
    internal sealed class Wire : HttpMessageHandler
    {
        public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>? Respond { get; set; }
        public List<string> Paths = []; public List<string?> Tokens = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) { Paths.Add(r.RequestUri!.PathAndQuery); Tokens.Add(r.Headers.Authorization?.Parameter); return Respond?.Invoke(r, ct) ?? Task.FromResult(Reply(r.RequestUri.AbsolutePath == "/api/auth/login" ? LoginJson : StateJson)); }
    }
    internal static HttpResponseMessage Reply(string json, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    [Theory]
    [InlineData("https://example.test:443/")][InlineData("http://localhost:80")]
    [InlineData("http://127.0.0.1:9000/")][InlineData("http://[::1]:9000")]
    public async Task Accepts_valid_origins_and_explicit_default_ports(string endpoint)
    { using var c = new TasksClient(new Vault(), new Wire()); await c.SignInAsync(endpoint, "u", "password", Date); Assert.True(c.IsConnected); }
    [Theory]
    [InlineData("https://example.test//")][InlineData("http://127.1")][InlineData("http://2130706433")]
    [InlineData("https://example.test:0")][InlineData("https://example.test?{}")]
    public async Task Rejects_nonliteral_or_ambiguous_origins(string endpoint)
    { var h = new Wire(); using var c = new TasksClient(new Vault(), h); await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync(endpoint, "u", "password", Date)); Assert.Empty(h.Paths); }
    [Theory]
    [InlineData("http://example.test")][InlineData("https://user:secret@example.test")]
    [InlineData("https://example.test/path")][InlineData("https://example.test?x=secret")]
    [InlineData("https://example.test#secret")][InlineData("not a url")]
    [InlineData("http://127.0.0.2")][InlineData("http://localhost.evil.test")]
    [InlineData("https://example.test/../")][InlineData("https://example.test\\\\evil")]
    public async Task Rejects_unsafe_endpoints_without_sending(string endpoint)
    {
        var h = new Wire(); using var c = new TasksClient(new Vault(), h);
        var e = await Assert.ThrowsAsync<TasksClientException>(() => c.SignInAsync(endpoint, "u", "secret", Date));
        Assert.DoesNotContain("secret", e.ToString()); Assert.Empty(h.Paths);
    }
    [Fact] public async Task Login_reads_state_before_exposing_and_persists_only_envelope()
    {
        var v = new Vault(); var h = new Wire(); using var c = new TasksClient(v, h);
        await c.SignInAsync("https://example.test", "tester", "password", Date);
        Assert.True(c.IsConnected); Assert.Equal(Date.ToString("yyyy-MM-dd"), c.State!.Date);
        Assert.Equal(c.Session, v.Saved); Assert.Equal(new[] { "/api/auth/login", "/api/state?date=2026-11-15" }, h.Paths); Assert.Equal("test-token", h.Tokens[1]);
    }
}
