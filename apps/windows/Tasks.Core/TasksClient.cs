using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
namespace Tasks.Core;
public sealed class TasksClient : IDisposable
{
    private readonly ISessionVault vault;
    private readonly HttpClient http;
    private readonly SemaphoreSlim gate = new(1, 1);
    private bool disposed;
    private bool deletionPending;
    private SessionProfile? pendingRevocation;
    private void EnsureAvailable()
    {
        if (disposed || deletionPending) throw new TasksClientException();
    }
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { RespectRequiredConstructorParameters = true, RespectNullableAnnotations = true };
    public TasksClient(ISessionVault vault, HttpMessageHandler? handler = null)
    {
        this.vault = vault;
        http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }, disposeHandler: handler is null);
    }
    private static string ValidateEndpoint(string endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint) || endpoint.Any(c => char.IsControl(c) || char.IsWhiteSpace(c)) || endpoint.Contains('\\') ||
            !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || !uri.IsWellFormedOriginalString() || !string.IsNullOrEmpty(uri.UserInfo) ||
            uri.Host.Length == 0 || uri.Port is < 1 or > 65535 || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) ||
            !System.Text.RegularExpressions.Regex.IsMatch(endpoint, @"\Ahttps?://[^/?#]+/?\z", System.Text.RegularExpressions.RegexOptions.IgnoreCase) ||
            (uri.Scheme != "https" && !(uri.Scheme == "http" && System.Text.RegularExpressions.Regex.IsMatch(endpoint, @"\Ahttp://(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?/?\z", System.Text.RegularExpressions.RegexOptions.IgnoreCase))))
            throw new TasksClientException();
        return uri.GetLeftPart(UriPartial.Authority);
    }
    private static bool ValidToken(string token) => !string.IsNullOrEmpty(token) && token.Length <= 256 && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or '~' or '+' or '/' or '=');
    private sealed record LoginResponse(string Token, string Username, DateTimeOffset ExpiresAt);
    private async Task<T> Request<T>(SessionProfile profile, HttpMethod method, string path, object? body, CancellationToken ct, bool authenticated = true)
    {
        using var request = new HttpRequestMessage(method, profile.Endpoint.TrimEnd('/') + path);
        if (authenticated) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", profile.Token);
        if (body != null) request.Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(body, Json)) { Headers = { ContentType = new MediaTypeHeaderValue("application/json") } };
        using var response = await http.SendAsync(request, ct).ConfigureAwait(false);
        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new TasksClientException(true);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<T>(Json, ct).ConfigureAwait(false))!;
    }
    private async Task<DayState> ReadState(SessionProfile profile, DateOnly date, CancellationToken ct)
    {
        var state = await Request<DayState>(profile, HttpMethod.Get, "/api/state?date=" + date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), null, ct).ConfigureAwait(false);
        return ValidateState(state, date);
    }
    private static DayState ValidateState(DayState state, DateOnly date)
    {
        if (state is null || state.Date != date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) || state.Tasks is null || state.Today is null || state.Upcoming is null || state.Progress is null || state.Tasks.Any(t => t is null) || state.Today.Concat(state.Upcoming).Any(o => o is null)) throw new TasksClientException();
        return state;
    }
    private async Task Revoke(SessionProfile profile, CancellationToken ct)
    {
        using var r = new HttpRequestMessage(HttpMethod.Post, profile.Endpoint + "/api/auth/logout");
        r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", profile.Token);
        using var response = await http.SendAsync(r, ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }
    public SessionProfile? Session { get; private set; }
    public bool NeedsSignOutRetry => deletionPending;
    private readonly object focusLock = new();
    private DayState? state;
    private List<string> order = [];
    public DayState? State
    {
        get { lock (focusLock) return state; }
        private set
        {
            lock (focusLock)
            {
                if (value is null || state?.Date != value.Date) order.Clear();
                state = value;
                var ids = value?.Today.Where(o => !o.Completed).Select(o => o.OccurrenceId).ToList() ?? [];
                order = order.Where(ids.Contains).Concat(ids.Where(id => !order.Contains(id))).ToList();
            }
        }
    }
    public Occurrence? Current { get { lock (focusLock) return state?.Today.FirstOrDefault(o => o.OccurrenceId == order.FirstOrDefault()); } }
    public IReadOnlyList<Occurrence> Waiting { get { lock (focusLock) return Array.AsReadOnly(order.Skip(1).Select(id => state!.Today.First(o => o.OccurrenceId == id)).ToArray()); } }
    public bool IsConnected => Session != null && State != null;
    public async Task SignInAsync(string endpoint, string username, string password, DateOnly date, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        SessionProfile? candidate = null;
        try
        {
            EnsureAvailable();
            endpoint = ValidateEndpoint(endpoint);
            var login = await Request<LoginResponse>(new(endpoint, username, "", default), HttpMethod.Post, "/api/auth/login", new { username, password }, cancellationToken, false).ConfigureAwait(false);
            if (login is null || !ValidToken(login.Token) || string.IsNullOrWhiteSpace(login.Username) || login.ExpiresAt <= DateTimeOffset.UtcNow) throw new TasksClientException();
            candidate = new SessionProfile(endpoint, login.Username, login.Token, login.ExpiresAt);
            var state = await ReadState(candidate, date, cancellationToken).ConfigureAwait(false);
            await vault.SaveAsync(candidate, cancellationToken).ConfigureAwait(false);
            State = null; Session = candidate; State = state; pendingRevocation = null;
            candidate = null;
        }
        catch (OperationCanceledException) { throw new OperationCanceledException("The request was cancelled.", cancellationToken); }
        catch { throw new TasksClientException(); }
        finally
        {
            if (candidate != null) { try { await Revoke(candidate, CancellationToken.None).ConfigureAwait(false); } catch { } }
            gate.Release();
        }
    }
    private sealed record SessionResponse(string Username, DateTimeOffset ExpiresAt);
    public async Task<bool> RestoreAsync(DateOnly date, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureAvailable();
            var saved = await vault.LoadAsync(cancellationToken).ConfigureAwait(false);
            if (saved is null) return false;
            ValidateEndpoint(saved.Endpoint);
            if (saved.ExpiresAt <= DateTimeOffset.UtcNow) throw new TasksClientException(true);
            // Retain a revocation-only handle, never task access, if restoration fails.
            pendingRevocation = saved;
            var valid = await Request<SessionResponse>(saved, HttpMethod.Get, "/api/auth/session", null, cancellationToken).ConfigureAwait(false);
            if (valid is null || valid.Username != saved.Username || valid.ExpiresAt <= DateTimeOffset.UtcNow) throw new TasksClientException(true);
            var state = await ReadState(saved, date, cancellationToken).ConfigureAwait(false);
            Session = saved; State = state; pendingRevocation = null;
            return true;
        }
        catch (TasksClientException e) when (e.SessionExpired)
        {
            Session = null; State = null; pendingRevocation = null;
            try { await vault.ClearAsync(CancellationToken.None).ConfigureAwait(false); } catch { throw new TasksClientException(); }
            throw;
        }
        catch (OperationCanceledException) { State = null; throw new OperationCanceledException("The request was cancelled."); }
        catch { State = null; throw new TasksClientException(); }
        finally { gate.Release(); }
    }
    private async Task ConnectedOperation(Func<SessionProfile, Task> operation, CancellationToken ct, bool requireState = true)
    {
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            EnsureAvailable();
            if (Session is null || (requireState && !IsConnected)) throw new TasksClientException();
            if (Session.ExpiresAt <= DateTimeOffset.UtcNow) throw new TasksClientException(true);
            await operation(Session).ConfigureAwait(false);
        }
        catch (TasksClientException e) when (e.SessionExpired)
        {
            Session = null; State = null;
            try { await vault.ClearAsync(CancellationToken.None).ConfigureAwait(false); } catch { throw new TasksClientException(); }
            throw;
        }
        catch (OperationCanceledException) { State = null; throw new OperationCanceledException("The request was cancelled."); }
        catch { State = null; throw new TasksClientException(); }
        finally { gate.Release(); }
    }
    public Task RefreshAsync(DateOnly date, CancellationToken cancellationToken = default) => ConnectedOperation(async p => State = await ReadState(p, date, cancellationToken).ConfigureAwait(false), cancellationToken, false);
    public Task CompleteAsync(Occurrence occurrence, DateOnly date, CancellationToken cancellationToken = default) => ChangeOccurrence("complete", occurrence, date, cancellationToken);
    public Task UndoAsync(Occurrence occurrence, DateOnly date, CancellationToken cancellationToken = default) => ChangeOccurrence("undo", occurrence, date, cancellationToken);
    private Task ChangeOccurrence(string action, Occurrence occurrence, DateOnly date, CancellationToken ct) => ConnectedOperation(async p =>
    {
        var result = await Request<DayState>(p, HttpMethod.Post, "/api/occurrences/" + action, new { taskId = occurrence.TaskId, dueDate = occurrence.DueDate, date = date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) }, ct).ConfigureAwait(false);
        State = ValidateState(result, date);
    }, ct);
    public Task AddTaskAsync(TaskDraft draft, DateOnly date, CancellationToken cancellationToken = default) => ConnectedOperation(async p =>
    {
        var created = await Request<TaskItem>(p, HttpMethod.Post, "/api/tasks", draft, cancellationToken).ConfigureAwait(false);
        if (created is null) throw new TasksClientException();
        State = await ReadState(p, date, cancellationToken).ConfigureAwait(false);
    }, cancellationToken);
    public async Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        // Local logout is deliberately non-cancellable, including waiting for prior operations.
        await gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (disposed) throw new TasksClientException();
            var old = Session ?? pendingRevocation;
            Session = null; State = null;
            deletionPending = true; pendingRevocation = old;
            try { await vault.ClearAsync(CancellationToken.None).ConfigureAwait(false); }
            catch { throw new TasksClientException("Unable to clear saved sign-in. Access is locked. Retry signing out."); }
            deletionPending = false; pendingRevocation = null;
            if (old != null) await Revoke(old, cancellationToken).ConfigureAwait(false);
        }
        catch (TasksClientException) { throw; }
        catch { throw new TasksClientException("Signed out locally. Server session revocation could not be confirmed."); }
        finally { gate.Release(); }
    }
    /// <summary>Serialize with authentication/writes and verify the existing protected envelope.
    /// No task payload or focus order is persisted for an update restart.</summary>
    public async Task PrepareForUpdateRestartAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureAvailable();
            var saved = await vault.LoadAsync(cancellationToken).ConfigureAwait(false);
            if (Session is not null && saved != Session) throw new TasksClientException();
        }
        catch (OperationCanceledException) { throw new OperationCanceledException("The request was cancelled.", cancellationToken); }
        catch { throw new TasksClientException("Could not verify the protected session. Restart was blocked."); }
        finally { gate.Release(); }
    }
    public void Select(string occurrenceId)
    {
        lock (focusLock) { if (!order.Remove(occurrenceId)) return; order.Insert(0, occurrenceId); }
    }
    public void NotNow()
    {
        lock (focusLock) { if (order.Count < 2) return; var first = order[0]; order.RemoveAt(0); order.Add(first); }
    }
    public void Dispose()
    {
        gate.Wait();
        try
        {
            if (disposed) return;
            disposed = true; Session = null; State = null; pendingRevocation = null;
            http.Dispose();
        }
        finally { gate.Release(); }
    }
}
