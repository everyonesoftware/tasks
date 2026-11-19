using Tasks.App;
using Tasks.Core;
using Xunit;

namespace Tasks.Storage.Tests;

public sealed class TaskWorkspaceFlowTests
{
    private static readonly DateOnly Date = new(2026, 11, 15);
    private static readonly SessionProfile Session = new("https://example.test", "fixture", "fixture-token", DateTimeOffset.MaxValue);
    private static DayState State => new("2026-11-15", [new("a", "Saved name", "retained notes", "Work", "weekly", 2, "2026-11-15", 2, "")], [], [], new(0, 0));

    [Fact]
    public async Task Failed_save_and_disconnected_monitor_retain_draft_but_never_report_success_or_allow_restart()
    {
        var workspace = new TaskWorkspace();
        var operations = new EditorOperationGate();
        workspace.Update(Session, Date, State);
        workspace.OpenTask("a", "routines", null);
        operations.SetConnected(true);
        Assert.True(operations.TryOpenEditor());
        Assert.True(workspace.BeginEdit(State));
        var draft = Assert.IsType<TaskEditDraft>(workspace.Draft);
        draft.Title = "Keep this draft";
        var success = false;
        await Assert.ThrowsAsync<IOException>(async () => success = await operations.ExecuteAsync(
            () => throw new IOException("unconfirmed write fixture"), editorSubmission: true));
        Assert.False(success);
        Assert.Same(draft, workspace.Draft);
        Assert.Equal("edit", workspace.Mode);
        Assert.False(operations.TryBeginRestart());
        Assert.True(await operations.ExecuteAsync(() =>
        {
            operations.SetConnected(false);
            workspace.Update(Session, Date, null);
            return Task.CompletedTask;
        }, allowDuringEditor: true));
        Assert.Null(workspace.ResolveTask(null));
        Assert.False(await operations.ExecuteAsync(() => throw new Exception("offline save must never execute"), editorSubmission: true));
        Assert.Same(draft, workspace.Draft);
        Assert.Equal("Keep this draft", workspace.Draft!.Title);
        operations.SetConnected(true);
        workspace.Update(Session, Date, State);
        Assert.True(operations.CanSubmit);
        workspace.CancelEdit();
        operations.CloseEditor();
        Assert.Equal("Saved name", workspace.ResolveTask(State)!.Title);
        Assert.True(operations.TryBeginRestart());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Account_or_date_transitions_discard_the_entire_previous_draft(bool newDate)
    {
        var workspace = new TaskWorkspace();
        workspace.Update(Session, Date, State);
        workspace.OpenTask("a", "today", null);
        Assert.True(workspace.BeginEdit(State));
        workspace.Draft!.Title = "Must not leak";
        workspace.Update(newDate ? Session : Session with { Username = "other", Token = "other-token" }, newDate ? Date.AddDays(1) : Date, null);
        Assert.Null(workspace.Draft);
        Assert.Null(workspace.TaskId);
        Assert.Null(workspace.OccurrenceId);
        Assert.Equal("list", workspace.Mode);
    }
}
