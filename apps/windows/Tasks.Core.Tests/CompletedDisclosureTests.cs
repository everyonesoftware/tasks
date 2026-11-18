using Tasks.Core;
using Xunit;
namespace Tasks.Core.Tests;
public class CompletedDisclosureTests
{
    [Fact] public void Disclosure_survives_refresh_disconnect_and_navigation_but_not_account_or_date()
    {
        var view = new CompletedDisclosure();
        var session = new SessionProfile("https://example.test", "a", "token", DateTimeOffset.MaxValue);
        view.Update(session, ClientTests.Date); Assert.False(view.IsExpanded);
        view.Toggle(); view.Update(session, ClientTests.Date); Assert.True(view.IsExpanded);
        view.Update(session with { Username = "b" }, ClientTests.Date); Assert.False(view.IsExpanded);
        view.Toggle(); view.Update(session, ClientTests.Date.AddDays(1)); Assert.False(view.IsExpanded);
        view.Toggle(); view.Update(null, ClientTests.Date.AddDays(1)); Assert.False(view.IsExpanded);
    }
}
