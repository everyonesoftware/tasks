namespace Tasks.Core;
public sealed record SessionProfile(string Endpoint, string Username, string Token, DateTimeOffset ExpiresAt);
public sealed record TaskItem(string Id, string Title, string Notes, string Category, string Repeat, int Interval, string StartDate, int Priority, string CreatedAt);
public sealed record Occurrence(string OccurrenceId, string TaskId, string Title, string Notes, string Category, string Repeat, int Interval, int Priority, string DueDate, bool Completed, bool Overdue, string? CompletedAt);
public sealed record DailyProgress(int Completed, int Total);
public sealed record DayState(string Date, IReadOnlyList<TaskItem> Tasks, IReadOnlyList<Occurrence> Today, IReadOnlyList<Occurrence> Upcoming, DailyProgress Progress);
public sealed record TaskDraft(string Title, string Notes, string Category, string Repeat, int Interval, string StartDate, int Priority);
public interface ISessionVault
{
    Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default);
    Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default);
    Task ClearAsync(CancellationToken cancellationToken = default);
}
public sealed class TasksClientException : Exception
{
    internal TasksClientException(string fixedMessage) : base(fixedMessage) { }
    public bool SessionExpired { get; }
    public TasksClientException(bool sessionExpired = false) : base(sessionExpired ? "Your session has expired. Sign in again." : "Unable to complete the request. Check your connection and try again.") => SessionExpired = sessionExpired;
}
