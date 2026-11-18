namespace Tasks.Core;

public static class TaskActions
{
    private static bool IsToday(DayState? state, Occurrence occurrence, DateOnly date) =>
        state?.Date == date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) &&
        state.Today.Contains(occurrence) && DateOnly.TryParseExact(occurrence.DueDate, "yyyy-MM-dd", out var due) && due <= date;
    public static bool CanFocus(DayState? state, Occurrence occurrence, DateOnly date) => IsToday(state, occurrence, date) && !occurrence.Completed;
    public static bool CanComplete(DayState? state, Occurrence occurrence, DateOnly date) => CanFocus(state, occurrence, date);
    public static bool CanUndo(DayState? state, Occurrence occurrence, DateOnly date) => IsToday(state, occurrence, date) && occurrence.Completed;
}
