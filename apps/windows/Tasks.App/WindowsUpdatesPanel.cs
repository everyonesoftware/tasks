using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Tasks.Core;

namespace Tasks.App;

/// <summary>Native controls bound once; no network or installation during construction.</summary>
internal sealed class WindowsUpdatesPanel : IDisposable
{
    private readonly DispatcherQueue dispatcher;
    private readonly Func<Task> restartAction;
    private readonly Button check, download, restart;
    private readonly TextBlock status, lastCheck;
    private readonly ProgressBar progress;
    private WindowsUpdateController controller = null!;
    private Func<bool> taskOperationBlocked = () => false;
    private bool disposed;

    public WindowsUpdatesPanel(FrameworkElement root, DispatcherQueue dispatcher, Func<Task> restartAction)
    {
        this.dispatcher = dispatcher; this.restartAction = restartAction;
        check = (Button)root.FindName("CheckUpdates");
        download = (Button)root.FindName("DownloadUpdate");
        status = (TextBlock)root.FindName("UpdateStatus");
        progress = (ProgressBar)root.FindName("UpdateProgress");
        lastCheck = (TextBlock)root.FindName("LastUpdateCheck");
        restart = (Button)root.FindName("RestartUpdate");
    }
    public void Bind(WindowsUpdateController controller, Func<bool> taskOperationBlocked)
    {
        this.controller = controller; this.taskOperationBlocked = taskOperationBlocked;
        check.Click += CheckClicked; download.Click += DownloadClicked; restart.Click += RestartClicked;
        controller.Changed += OnChanged;
        Render(controller.Status, taskOperationBlocked());
    }
    private async void CheckClicked(object sender, RoutedEventArgs e)
    {
        await controller.CheckAsync();
        if (!disposed) lastCheck.Text = $"Last checked: {DateTimeOffset.Now:g}";
    }
    private async void DownloadClicked(object sender, RoutedEventArgs e) => await controller.DownloadAsync();
    private async void RestartClicked(object sender, RoutedEventArgs e) => await restartAction();
    private void OnChanged(WindowsUpdateState _) => dispatcher.TryEnqueue(() =>
    {
        // Queued progress snapshots must not rewind Ready or resurrect a closed window.
        if (!disposed) Render(controller.Status, taskOperationBlocked());
    });
    public void Render(WindowsUpdateState state, bool taskBlocked)
    {
        if (disposed) return;
        status.Text = state.Phase == WindowsUpdatePhase.Downloading ? $"{state.Message} {state.Progress}%" : state.Message;
        bool busy = state.Phase is WindowsUpdatePhase.Checking or WindowsUpdatePhase.Downloading or WindowsUpdatePhase.Restarting;
        check.IsEnabled = !busy && state.Phase is not (WindowsUpdatePhase.Ready or WindowsUpdatePhase.NotInstalled);
        download.Visibility = state.Phase == WindowsUpdatePhase.Available ? Visibility.Visible : Visibility.Collapsed;
        download.IsEnabled = !busy;
        restart.Visibility = state.Phase == WindowsUpdatePhase.Ready ? Visibility.Visible : Visibility.Collapsed;
        restart.IsEnabled = !busy && !taskBlocked;
        progress.Visibility = busy || state.Phase == WindowsUpdatePhase.Ready ? Visibility.Visible : Visibility.Collapsed;
        progress.IsIndeterminate = state.Phase is WindowsUpdatePhase.Checking or WindowsUpdatePhase.Restarting;
        progress.Value = state.Progress;
    }
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        check.Click -= CheckClicked; download.Click -= DownloadClicked; restart.Click -= RestartClicked;
        controller.Changed -= OnChanged;
    }
}
