using System.Net;
using System.Net.Http.Json;
using Tasks.App;
using Tasks.Core;
using Xunit;

namespace Tasks.Storage.Tests;

public sealed class TaskCreationFlowTests
{
    private static readonly DateOnly Date = new(2026, 11, 15);
    private sealed class Vault : ISessionVault
    {
        private SessionProfile? saved;
        public Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult(saved);
        public Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default) { saved = profile; return Task.CompletedTask; }
        public Task ClearAsync(CancellationToken cancellationToken = default) { saved = null; return Task.CompletedTask; }
    }
    private sealed class Wire : HttpMessageHandler
    {
        public int Posts;
        public bool FailRead;
        public bool ExactPresent = true;
        public readonly TaskCompletionSource ReadEntered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource ReleaseRead = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private static TaskItem Record(string id) => new(id, id, "", "Personal", "once", 1, "2026-11-15", 0, "");
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            object body;
            if (request.RequestUri!.AbsolutePath == "/api/auth/login")
                body = new { token = "fixture-token", username = "fixture", expiresAt = DateTimeOffset.UtcNow.AddDays(1) };
            else if (request.RequestUri.AbsolutePath == "/api/tasks" && request.Method == HttpMethod.Post)
            {
                Posts++;
                FailRead = true;
                body = Record("exact-created");
            }
            else
            {
                if (FailRead) { ReadEntered.TrySetResult(); await ReleaseRead.Task.WaitAsync(ct); throw new IOException("fixture readback unavailable"); }
                body = new DayState("2026-11-15", Posts == 0 ? [] : ExactPresent ? [Record("unrelated"), Record("exact-created")] : [Record("unrelated")], [], [], new(0, 0));
            }
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(body, body.GetType()) };
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Actual_create_gate_rejects_double_submit_and_reconnect_only_reconciles_acknowledged_identity(bool exactPresent)
    {
        var wire = new Wire { ExactPresent = exactPresent };
        using var client = new TasksClient(new Vault(), wire);
        await client.SignInAsync("https://example.test", "fixture", "fixture-password", Date);
        var workspace = new TaskWorkspace();
        var gate = new EditorOperationGate();
        workspace.Update(client.Session, Date, client.State);
        gate.SetConnected(true);
        Assert.True(gate.TryOpenEditor());
        workspace.BeginAdd("routines", Date);
        var draft = workspace.Draft!;
        draft.Title = "Created";
        var confirmed = false;
        var submit = gate.ExecuteAsync(async () => confirmed = await workspace.SaveAsync(client, draft.ToPayload(), Date, () => Date), editorSubmission: true);
        await wire.ReadEntered.Task;
        Assert.Equal("exact-created", draft.AcknowledgedCreationId);
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("double submission"), editorSubmission: true));
        Assert.False(gate.TryBeginRestart());
        wire.ReleaseRead.SetResult();
        await Assert.ThrowsAsync<TasksClientException>(() => submit);
        Assert.False(confirmed);
        gate.SetConnected(client.IsConnected);
        workspace.Update(client.Session, Date, client.State);
        Assert.Same(draft, workspace.Draft);
        Assert.Null(workspace.ResolveTask(client.State));
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("offline submission"), editorSubmission: true));
        await Assert.ThrowsAsync<TasksClientException>(() => gate.ExecuteAsync(() => client.RefreshAsync(Date), allowDuringEditor: true));
        Assert.Equal("edit", workspace.Mode);
        Assert.Equal(1, wire.Posts);
        wire.FailRead = false;
        Assert.True(await gate.ExecuteAsync(() => client.RefreshAsync(Date), allowDuringEditor: true));
        workspace.Update(client.Session, Date, client.State);
        gate.SetConnected(client.IsConnected);
        Assert.True(await gate.ExecuteAsync(async () => confirmed = await workspace.SaveAsync(client, draft.ToPayload(), Date, () => Date), editorSubmission: true));
        Assert.Equal(exactPresent, confirmed);
        Assert.Equal(exactPresent ? "exact-created" : null, workspace.TaskId);
        Assert.Equal(exactPresent ? "details" : "edit", workspace.Mode);
        Assert.Equal(1, wire.Posts);
        if (!exactPresent)
        {
            Assert.False(await workspace.SaveAsync(client, draft.ToPayload(), Date, () => Date));
            Assert.Equal(1, wire.Posts); // Even repeated missing readbacks never authorize another POST.
        }
    }

    [Theory]
    [InlineData("date")]
    [InlineData("session")]
    [InlineData("signout")]
    public async Task Pending_acknowledgment_is_discarded_with_its_draft_on_context_transition(string transition)
    {
        var wire = new Wire();
        wire.ReleaseRead.SetResult();
        using var client = new TasksClient(new Vault(), wire);
        await client.SignInAsync("https://example.test", "fixture", "fixture-password", Date);
        var workspace = new TaskWorkspace();
        workspace.Update(client.Session, Date, client.State);
        workspace.BeginAdd("today", Date);
        var draft = workspace.Draft!;
        draft.Title = "Created";
        await Assert.ThrowsAsync<TasksClientException>(() => workspace.SaveAsync(client, draft.ToPayload(), Date, () => Date));
        Assert.Equal("exact-created", draft.AcknowledgedCreationId);
        workspace.Update(transition == "signout" ? null : transition == "session" ? client.Session! with { Token = "other-token" } : client.Session,
            transition == "date" ? Date.AddDays(1) : Date, null);
        Assert.Null(workspace.Draft);
        Assert.Null(workspace.TaskId);
        Assert.Equal("list", workspace.Mode);
        Assert.False(await workspace.SaveAsync(client, draft.ToPayload(), Date, () => Date));
        Assert.Equal(1, wire.Posts);
        workspace.BeginAdd("today", Date);
        Assert.Null(workspace.Draft!.AcknowledgedCreationId);
    }
}