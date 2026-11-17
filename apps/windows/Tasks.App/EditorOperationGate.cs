namespace Tasks.App;

// UI-thread policy only: a modal draft is not a network operation.
internal sealed class EditorOperationGate
{
    public bool IsBusy { get; private set; }
    public bool IsEditorOpen { get; private set; }
    public bool IsConnected { get; private set; }
    public bool IsSigningOut { get; private set; }
    public bool IsRestarting { get; private set; }
    public bool CanSubmit => IsEditorOpen && IsConnected && !IsBusy && !IsRestarting;
    public bool TryBeginRestart()
    {
        if (IsBusy || IsEditorOpen || IsSigningOut || IsRestarting) return false;
        IsRestarting = true;
        Changed?.Invoke();
        return true;
    }
    public void EndRestart()
    {
        IsRestarting = false;
        Changed?.Invoke();
    }
    public event Action? Changed;

    public bool TryOpenEditor()
    {
        if (IsRestarting || IsEditorOpen || IsBusy || !IsConnected) return false;
        IsEditorOpen = true;
        Changed?.Invoke();
        return true;
    }

    public void CloseEditor()
    {
        IsEditorOpen = false;
        Changed?.Invoke();
    }

    public void SetConnected(bool connected)
    {
        IsConnected = connected && !IsSigningOut;
        Changed?.Invoke();
    }

    public void BeginSignOut()
    {
        IsSigningOut = true;
        IsConnected = false;
        Changed?.Invoke();
    }

    public void EndSignOut()
    {
        IsSigningOut = false;
        Changed?.Invoke();
    }

    public async Task<bool> ExecuteAsync(Func<Task> action, bool allowDuringEditor = false, bool editorSubmission = false)
    {
        if (IsRestarting || IsBusy || (editorSubmission ? !CanSubmit : IsEditorOpen && !allowDuringEditor)) return false;
        IsBusy = true;
        try
        {
            Changed?.Invoke();
            await action();
            return true;
        }
        finally
        {
            IsBusy = false;
            Changed?.Invoke();
        }
    }
}
