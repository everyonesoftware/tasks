using Tasks.Core;

namespace Tasks.App;

// UI-thread startup policy: unknown authentication is not signed out.
internal sealed class SessionStartup
{
    public bool IsRestoring { get; private set; } = true;
    public bool NeedsRetry { get; private set; }

    public async Task RestoreAsync(Func<Task<bool>> restore)
    {
        IsRestoring = true;
        NeedsRetry = false;
        try { await restore(); }
        catch (TasksClientException error) when (error.SessionExpired) { throw; }
        catch
        {
            NeedsRetry = true;
            throw;
        }
        finally { IsRestoring = false; }
    }

    public void SignedOut() => NeedsRetry = false;
}
