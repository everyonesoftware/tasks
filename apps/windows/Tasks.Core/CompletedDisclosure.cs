namespace Tasks.Core;

// UI preference only. Never stores task payloads or ordering.
public sealed class CompletedDisclosure
{
    private (string Endpoint, string Username, DateOnly Date)? context;
    public bool IsExpanded { get; private set; }
    public void Update(SessionProfile? session, DateOnly date)
    {
        (string, string, DateOnly)? next = session is null ? null : (session.Endpoint, session.Username, date);
        if (context != next) IsExpanded = false;
        context = next;
    }
    public void Toggle() => IsExpanded = !IsExpanded;
}
