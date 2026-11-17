using Tasks.App;
using Xunit;

namespace Tasks.Storage.Tests;

public sealed class EditorOperationGateTests
{
    [Fact]
    public async Task Update_restart_excludes_unsaved_draft_network_write_and_new_operations_until_released()
    {
        var gate = new EditorOperationGate();
        var begin = typeof(EditorOperationGate).GetMethod("TryBeginRestart");
        var end = typeof(EditorOperationGate).GetMethod("EndRestart");
        Assert.NotNull(begin); Assert.NotNull(end);
        bool Begin() => (bool)begin.Invoke(gate, null)!;
        gate.SetConnected(true);
        Assert.True(gate.TryOpenEditor());
        Assert.False(Begin());
        gate.CloseEditor();
        var release = new TaskCompletionSource();
        var operation = gate.ExecuteAsync(() => release.Task);
        Assert.False(Begin());
        release.SetResult(); await operation;
        Assert.True(Begin());
        Assert.False(Begin());
        Assert.False(gate.TryOpenEditor());
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("must not run"), allowDuringEditor: true));
        end.Invoke(gate, null);
        Assert.True(gate.TryOpenEditor());
    }

    [Fact]
    public async Task SignOutSuppressesTaskAccessBeforeBlockedRemoteRevocation()
    {
        var gate = new EditorOperationGate();
        gate.SetConnected(true);
        var remote = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var operation = gate.ExecuteAsync(async () =>
        {
            var begin = typeof(EditorOperationGate).GetMethod("BeginSignOut");
            Assert.NotNull(begin);
            begin.Invoke(gate, null);
            entered.SetResult();
            await remote.Task;
            typeof(EditorOperationGate).GetMethod("EndSignOut")!.Invoke(gate, null);
        });
        // A missing implementation faults the operation before it can enter the remote wait.
        await Task.WhenAny(entered.Task, operation);
        if (operation.IsCompleted) await operation;
        Assert.False(gate.IsConnected);
        Assert.False(gate.CanSubmit);
        Assert.True(typeof(EditorOperationGate).GetProperty("IsSigningOut")?.GetValue(gate) is true);
        gate.SetConnected(true);
        Assert.False(gate.IsConnected);
        remote.SetResult();
        Assert.True(await operation);
        Assert.True(typeof(EditorOperationGate).GetProperty("IsSigningOut")?.GetValue(gate) is false);
        Assert.False(gate.IsConnected);
    }

    [Fact]
    public async Task IdleEditorAllowsMonitoringButExcludesOtherUiOperations()
    {
        var gate = new EditorOperationGate();
        gate.SetConnected(true);
        Assert.True(gate.TryOpenEditor());
        Assert.False(gate.IsBusy);
        Assert.False(gate.TryOpenEditor());
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("must not run")));
        var entered = false;
        Assert.True(await gate.ExecuteAsync(() => { entered = true; return Task.CompletedTask; }, allowDuringEditor: true));
        Assert.True(entered);
        Assert.True(gate.CanSubmit);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MonitoringAndSubmissionBothExcludeDuplicateWritesAndOtherOperations(bool submission)
    {
        var gate = new EditorOperationGate();
        gate.SetConnected(true);
        Assert.True(gate.TryOpenEditor());
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var pending = gate.ExecuteAsync(() => release.Task, allowDuringEditor: !submission, editorSubmission: submission);
        Assert.True(gate.IsBusy);
        Assert.False(gate.CanSubmit);
        Assert.False(gate.TryOpenEditor());
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("duplicate write"), editorSubmission: true));
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("overlapping refresh"), allowDuringEditor: true));
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("other UI operation")));
        release.SetResult();
        Assert.True(await pending);
        Assert.True(gate.CanSubmit);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedOrCancelledSubmissionNeverReturnsSuccessAndReleasesGate(bool cancelled)
    {
        var gate = new EditorOperationGate();
        gate.SetConnected(true);
        Assert.True(gate.TryOpenEditor());
        var reportedSuccess = false;
        var error = await Record.ExceptionAsync(async () =>
        {
            reportedSuccess = await gate.ExecuteAsync(
                () => cancelled ? Task.FromCanceled(new CancellationToken(true)) : Task.FromException(new IOException("fixture")),
                editorSubmission: true);
        });
        Assert.NotNull(error);
        Assert.Equal(cancelled, error is OperationCanceledException);
        Assert.False(reportedSuccess);
        Assert.False(gate.IsBusy);
        Assert.True(gate.CanSubmit);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MonitorFailureInvalidatesOpenDraftUntilRealReconnect(bool expired)
    {
        var gate = new EditorOperationGate();
        gate.SetConnected(true);
        Assert.True(gate.TryOpenEditor());
        var disabledNotifications = 0;
        gate.Changed += () => { if (!gate.CanSubmit) disabledNotifications++; };
        // The shell's finally path publishes the real client's disconnected/expired
        // state before releasing the operation, even when refresh throws.
        await Assert.ThrowsAsync<IOException>(() => gate.ExecuteAsync(() =>
        {
            gate.SetConnected(false);
            throw new IOException(expired ? "expired session fixture" : "network failure fixture");
        }, allowDuringEditor: true));
        Assert.True(gate.IsEditorOpen);
        Assert.False(gate.CanSubmit);
        Assert.True(disabledNotifications > 0);
        Assert.False(await gate.ExecuteAsync(() => throw new Exception("offline write"), editorSubmission: true));
        Assert.True(await gate.ExecuteAsync(() => { gate.SetConnected(true); return Task.CompletedTask; }, allowDuringEditor: true));
        Assert.True(gate.CanSubmit);
        gate.CloseEditor();
        Assert.False(gate.CanSubmit);
        Assert.True(await gate.ExecuteAsync(() => Task.CompletedTask));
    }
}
