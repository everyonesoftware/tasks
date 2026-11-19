using Tasks.Core;
using Xunit;

namespace Tasks.Core.Tests;

public class TaskWorkspaceTests
{
    private static readonly DateOnly Date = new(2026, 11, 15);
    private static readonly SessionProfile Session = new("https://example.test", "u", "token", DateTimeOffset.MaxValue);
    private static TaskItem TaskRecord(string title = "A") => new("a", title, "private notes", "Work", "weekly", 2, "2026-11-15", 2, "2026-11-01T10:00:00Z");
    private static DayState Snapshot(TaskItem task, params Occurrence[] today) => new("2026-11-15", [task], today, [], new(0, today.Length));

    [Fact]
    public void Opening_details_remembers_the_real_list_and_occurrence_without_a_focus_mutation()
    {
        var workspace = new TaskWorkspace();
        workspace.OpenTask("a", "upcoming", "a:2026-11-16");
        Assert.Equal("details", (string)workspace.Mode);
        Assert.Equal("a", workspace.TaskId);
        Assert.Equal("a:2026-11-16", workspace.OccurrenceId);
        Assert.Equal("upcoming", (string)workspace.Back());
        Assert.Equal("list", (string)workspace.Mode);
        Assert.Null((string?)workspace.TaskId);
    }

    [Fact]
    public void Details_resolve_the_latest_record_and_only_the_selected_occurrence_and_clear_on_context_change()
    {
        var workspace = new TaskWorkspace();
        var occurrence = FocusTests.Item("a");
        var state = Snapshot(TaskRecord(), occurrence);
        workspace.Update(Session, Date, state);
        workspace.OpenTask("a", "today", occurrence.OccurrenceId);
        Assert.Equal("A", Assert.IsType<TaskItem>(workspace.ResolveTask(state)).Title);
        Assert.Equal(occurrence, workspace.ResolveOccurrence(state));
        var changed = Snapshot(TaskRecord("Refreshed"), occurrence with { Completed = true });
        workspace.Update(Session, Date, changed);
        Assert.Equal("Refreshed", Assert.IsType<TaskItem>(workspace.ResolveTask(changed)).Title);
        Assert.True(Assert.IsType<Occurrence>(workspace.ResolveOccurrence(changed)).Completed);
        workspace.Update(Session, Date, null);
        Assert.Null((TaskItem?)workspace.ResolveTask(null));
        Assert.Null((Occurrence?)workspace.ResolveOccurrence(null));
        workspace.Update(Session, Date, state);
        workspace.OpenTask("a", "upcoming", "a:future");
        Assert.Null((Occurrence?)workspace.ResolveOccurrence(state));
        workspace.Update(Session, Date.AddDays(1), state);
        Assert.Equal("list", (string)workspace.Mode);
        workspace.OpenTask("a", "routines", null);
        workspace.Update(Session with { Username = "other" }, Date.AddDays(1), state);
        Assert.Null((string?)workspace.TaskId);
    }

    [Fact]
    public void Edit_cancel_and_confirmed_save_use_separate_drafts_preserving_hidden_fields()
    {
        var workspace = new TaskWorkspace();
        var task = TaskRecord();
        var state = Snapshot(task);
        workspace.Update(Session, Date, state);
        workspace.OpenTask("a", "routines", null);
        Assert.True((bool)workspace.BeginEdit(state));
        Assert.NotNull(workspace.Draft);
        workspace.Draft.Title = "Unsaved";
        workspace.CancelEdit();
        Assert.Equal("details", (string)workspace.Mode);
        Assert.Equal("A", Assert.IsType<TaskItem>(workspace.ResolveTask(state)).Title);
        Assert.Null((object?)workspace.Draft);
        workspace.BeginEdit(state);
        Assert.NotNull(workspace.Draft);
        workspace.Draft.Title = "Changed";
        workspace.Draft.Repeat = "monthly";
        workspace.Draft.Interval = 3.0;
        workspace.Draft.StartDate = "2026-12-01";
        TaskDraft payload = workspace.Draft.ToPayload();
        Assert.Equal(new TaskDraft("Changed", task.Notes, task.Category, "monthly", 3, "2026-12-01", task.Priority), payload);
        workspace.Update(Session, Date, null); // An unconfirmed/offline write never closes the draft.
        Assert.Equal("edit", (string)workspace.Mode);
        Assert.Equal("Changed", (string)workspace.Draft.Title);
        Assert.False((bool)workspace.ConfirmSaved(null, "a"));
        var refreshed = Snapshot(task with { Title = payload.Title });
        Assert.True((bool)workspace.ConfirmSaved(refreshed, "a"));
        Assert.Equal("details", (string)workspace.Mode);
        Assert.Null((object?)workspace.Draft);
        Assert.Equal("Changed", Assert.IsType<TaskItem>(workspace.ResolveTask(refreshed)).Title);
        Assert.Equal("routines", (string)workspace.Back());
    }

    [Fact]
    public void Add_uses_existing_defaults_and_returns_to_its_origin_on_cancel_or_new_details_on_save()
    {
        var workspace = new TaskWorkspace();
        workspace.Update(Session, Date, Snapshot(TaskRecord()));
        workspace.BeginAdd("upcoming", Date);
        Assert.NotNull(workspace.Draft);
        workspace.Draft.Title = "New";
        TaskDraft payload = workspace.Draft.ToPayload();
        Assert.Equal(new TaskDraft("New", "", "Personal", "once", 1, "2026-11-15", 0), payload);
        workspace.CancelEdit();
        Assert.Equal("list", (string)workspace.Mode);
        Assert.Equal("upcoming", (string)workspace.Origin);
        workspace.BeginAdd("routines", Date);
        workspace.Draft.Title = "New";
        var state = Snapshot(TaskRecord() with { Id = "new", Title = "New" }, FocusTests.Item("new"));
        Assert.True((bool)workspace.ConfirmSaved(state, "new"));
        Assert.Equal(state.Today[0].OccurrenceId, workspace.OccurrenceId);
        Assert.Equal("details", (string)workspace.Mode);
        workspace.BeginEdit(state);
        workspace.Update(null, Date, null);
        Assert.Null((object?)workspace.Draft);
        Assert.Equal("list", (string)workspace.Mode);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(0)]
    [InlineData(366)]
    [InlineData(1.5)]
    public void Switching_invalid_recurring_interval_to_once_always_emits_one(double invalidInterval)
    {
        var draft = new TaskEditDraft(new("A", "retained", "Work", "weekly", 2, "2026-11-15", 2));
        draft.Interval = invalidInterval;
        Assert.Throws<ArgumentException>(() => draft.ToPayload());
        draft.Repeat = "once"; // Same binding as the native ComboBox; hidden NumberBox retains its value.
        var payload = draft.ToPayload();
        Assert.Equal(1, payload.Interval);
        Assert.Equal("once", payload.Repeat);
        Assert.Equal("retained", payload.Notes);
        draft.Repeat = "weekly";
        Assert.Throws<ArgumentException>(() => draft.ToPayload());
    }

    [Fact]
    public void Saving_a_schedule_change_shows_the_refreshed_due_date_not_the_old_occurrence()
    {
        var workspace = new TaskWorkspace();
        var original = FocusTests.Item("a");
        var state = Snapshot(TaskRecord(), original);
        workspace.Update(Session, Date, state);
        workspace.OpenTask("a", "today", original.OccurrenceId);
        workspace.BeginEdit(state);
        workspace.Draft!.StartDate = "2026-11-20";
        var future = original with { OccurrenceId = "a:2026-11-20", DueDate = "2026-11-20" };
        var refreshed = new DayState("2026-11-15", [TaskRecord() with { StartDate = "2026-11-20" }], [], [future], new(0, 0));
        Assert.True(workspace.ConfirmSaved(refreshed, "a"));
        Assert.Equal(future, workspace.ResolveOccurrence(refreshed));
        Assert.False(TaskActions.CanFocus(refreshed, workspace.ResolveOccurrence(refreshed)!, Date));
        Assert.False(TaskActions.CanComplete(refreshed, workspace.ResolveOccurrence(refreshed)!, Date));
    }
}
