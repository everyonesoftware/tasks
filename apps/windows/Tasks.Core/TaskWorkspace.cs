namespace Tasks.Core;

// Navigation and drafts live only in memory; opening a task never changes focus order.
public sealed class TaskWorkspace
{
    public string Mode { get; private set; } = "list";
    public string Origin { get; private set; } = "today";
    public string? TaskId { get; private set; }
    public string? OccurrenceId { get; private set; }
    public TaskEditDraft? Draft { get; private set; }
    private SessionProfile? session;
    private DateOnly date;

    public void Update(SessionProfile? currentSession, DateOnly currentDate, DayState? state)
    {
        if (session != currentSession || date != currentDate)
            Back();
        session = currentSession;
        date = currentDate;
    }

    private bool IsCurrent(DayState? state) => session is not null && state?.Date == date.ToString("yyyy-MM-dd");
    public TaskItem? ResolveTask(DayState? state) => IsCurrent(state) ? state!.Tasks.FirstOrDefault(t => t.Id == TaskId) : null;
    public Occurrence? ResolveOccurrence(DayState? state) => ResolveTask(state) is not null
        ? state!.Today.Concat(state.Upcoming).FirstOrDefault(o => o.TaskId == TaskId && o.OccurrenceId == OccurrenceId) : null;

    public void OpenTask(string taskId, string origin, string? occurrenceId)
    {
        TaskId = taskId;
        Origin = origin;
        OccurrenceId = occurrenceId;
        Mode = "details";
    }

    public bool BeginEdit(DayState? state)
    {
        var task = ResolveTask(state);
        if (task is null) return false;
        Draft = new(new(task.Title, task.Notes, task.Category, task.Repeat, task.Interval, task.StartDate, task.Priority));
        Mode = "edit";
        return true;
    }

    public void CancelEdit()
    {
        Draft = null;
        Mode = TaskId is null ? "list" : "details";
    }

    public void BeginAdd(string origin, DateOnly startDate)
    {
        Back();
        Origin = origin;
        Draft = new(new("", "", "Personal", "once", 1, startDate.ToString("yyyy-MM-dd"), 0));
        Mode = "edit";
    }

    public async Task<bool> SaveAsync(TasksClient client, TaskDraft payload, DateOnly invocationDate,
        Func<DateOnly> currentDate, CancellationToken cancellationToken = default)
    {
        if (Draft is not { } draft || session != client.Session || date != invocationDate || invocationDate != currentDate()
            || !client.IsConnected || !IsCurrent(client.State)) return false;
        var taskId = TaskId;
        var invocationSession = client.Session;
        var savedId = taskId;
        if (taskId is null)
        {
            if (draft.AcknowledgedCreationId is null)
                await client.AddTaskAsync(payload, invocationDate, id => draft.AcknowledgedCreationId = id,
                    () => invocationSession == client.Session && invocationDate == currentDate() &&
                        ReferenceEquals(Draft, draft) && IsCurrent(client.State), cancellationToken);
            else
                await client.RefreshAsync(invocationDate, cancellationToken);
            savedId = draft.AcknowledgedCreationId;
        }
        else await client.EditWorkspaceTaskAsync(taskId, payload, invocationDate,
            () => invocationSession == client.Session && invocationDate == currentDate() &&
                ReferenceEquals(Draft, draft) && TaskId == taskId && session == invocationSession && date == invocationDate,
            cancellationToken);
        if (invocationSession != client.Session || invocationDate != currentDate() || !ReferenceEquals(Draft, draft)) return false;
        return savedId is not null && ConfirmSaved(client.State, savedId);
    }

    public bool ConfirmSaved(DayState? state, string taskId)
    {
        if (!IsCurrent(state) || state!.Tasks.All(t => t.Id != taskId)) return false;
        var occurrences = state!.Today.Concat(state.Upcoming).Where(o => o.TaskId == taskId).ToArray();
        if (occurrences.All(o => o.OccurrenceId != OccurrenceId))
            OccurrenceId = (Origin == "upcoming" ? state.Upcoming.FirstOrDefault(o => o.TaskId == taskId) : null)?.OccurrenceId
                ?? occurrences.FirstOrDefault()?.OccurrenceId;
        TaskId = taskId;
        Draft = null;
        Mode = "details";
        return true;
    }

    public string Back()
    {
        Mode = "list";
        TaskId = null;
        OccurrenceId = null;
        Draft = null;
        return Origin;
    }
}

public sealed class TaskEditDraft(TaskDraft original)
{
    public string? AcknowledgedCreationId { get; internal set; }
    public string Title { get; set; } = original.Title;
    public string Repeat { get; set; } = original.Repeat;
    public double Interval { get; set; } = original.Interval;
    public string? StartDate { get; set; } = original.StartDate;

    public TaskDraft ToPayload()
    {
        var interval = Repeat == "once" ? 1 : Interval;
        if (string.IsNullOrWhiteSpace(Title) || !new[] { "once", "daily", "weekly", "monthly", "yearly" }.Contains(Repeat) ||
            !double.IsFinite(interval) || interval < 1 || interval > 365 || interval != Math.Truncate(interval) ||
            !DateOnly.TryParseExact(StartDate, "yyyy-MM-dd", out _))
            throw new ArgumentException("Enter a task name, a first due date, and a whole interval from 1 to 365.");
        return original with { Title = Title.Trim(), Repeat = Repeat, Interval = (int)interval, StartDate = StartDate! };
    }
}
