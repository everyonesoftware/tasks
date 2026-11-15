using Microsoft.UI;
using DispatcherQueueTimer = Microsoft.UI.Dispatching.DispatcherQueueTimer;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Tasks.Core;
using Windows.System;
using Windows.UI;

namespace Tasks.App;

internal sealed class MainWindow : Window
{
    private readonly Grid root;
    private readonly TasksClient client = new(new WindowsSessionVault());
    private readonly WindowsUpdateClient updates = new();
    private readonly WindowsAppVersion installedVersion = WindowsAppVersion.FromAssembly(typeof(MainWindow).Assembly);
    private WindowsUpdateResult? updateResult;
    private bool checkingUpdates;
    private bool openingDownload;
    private DateTimeOffset? lastUpdateCheck;
    private string? updateNotice;
    private readonly CancellationTokenSource lifetime = new();
    private readonly DispatcherQueueTimer refreshTimer;
    private bool initialized;
    private readonly EditorOperationGate operations = new();
    private bool busy => operations.IsBusy;
    private bool closed;
    private string page = "today";

    public MainWindow()
    {
        Title = "Tasks";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Tasks.ico"));
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1200, 900));
        using var stream = typeof(MainWindow).Assembly.GetManifestResourceStream("Tasks.App.Shell.xaml")
            ?? throw new InvalidOperationException("Missing native shell resource.");
        using var reader = new StreamReader(stream);
        root = (Grid)XamlReader.Load(reader.ReadToEnd());
        Content = root;
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(Find<Border>("TitleBar"));
        AppWindow.TitleBar.ButtonBackgroundColor = Colors.Transparent;
        AppWindow.TitleBar.ButtonInactiveBackgroundColor = Colors.Transparent;
        AppWindow.TitleBar.ButtonForegroundColor = Color.FromArgb(255, 237, 242, 237);
        AppWindow.TitleBar.ButtonInactiveForegroundColor = Color.FromArgb(255, 178, 192, 192);
        operations.Changed += () => { if (!closed) SetBusy(busy); };
        WireControls();
        refreshTimer = DispatcherQueue.CreateTimer();
        refreshTimer.Interval = TimeSpan.FromSeconds(30);
        refreshTimer.Tick += async (_, _) =>
        {
            if (client.Session is not null) await RunAsync(ct => client.RefreshAsync(Today, ct), allowDuringEditor: true);
        };
        root.Loaded += async (_, _) =>
        {
            if (initialized) return;
            initialized = true;
            await RunAsync(async ct => { await client.RestoreAsync(Today, ct); });
            if (!closed) refreshTimer.Start();
        };
        Activated += async (_, args) =>
        {
            if (initialized && args.WindowActivationState != WindowActivationState.Deactivated && client.Session is not null)
                await RunAsync(ct => client.RefreshAsync(Today, ct), allowDuringEditor: true);
        };
        Closed += (_, _) =>
        {
            closed = true;
            refreshTimer.Stop();
            lifetime.Cancel();
            updates.Dispose();
        };
        root.SizeChanged += (_, args) =>
        {
            var sidebar = args.NewSize.Width < 900 ? 170 : 204;
            Find<ColumnDefinition>("SidebarWidth").Width = new GridLength(sidebar);
            Find<StackPanel>("MainContent").Width = Math.Max(0, Math.Min(1000, args.NewSize.Width - sidebar));
            Find<StackPanel>("MainContent").Padding = new Thickness(args.NewSize.Width < 900 ? 24 : 40, 32, args.NewSize.Width < 900 ? 24 : 40, 32);
        };
        var addShortcut = new Microsoft.UI.Xaml.Input.KeyboardAccelerator { Key = VirtualKey.N, Modifiers = VirtualKeyModifiers.Control };
        addShortcut.Invoked += async (_, args) =>
        {
            args.Handled = true;
            if (client.IsConnected) await AddAsync();
        };
        root.KeyboardAcceleratorPlacementMode = Microsoft.UI.Xaml.Input.KeyboardAcceleratorPlacementMode.Hidden;
        root.KeyboardAccelerators.Add(addShortcut);
        Render();
    }

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.Now);
    private T Find<T>(string name) where T : class => root.FindName(name) as T
        ?? throw new InvalidOperationException("Missing native control: " + name);
    private static SolidColorBrush Brush(byte r, byte g, byte b) => new(Color.FromArgb(255, r, g, b));
    private static new Visibility Visible(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    private void WireControls()
    {
        Find<Button>("SignIn").Click += async (_, _) => await SignInAsync();
        Find<PasswordBox>("Password").KeyDown += async (_, args) =>
        {
            if (args.Key == VirtualKey.Enter) { args.Handled = true; await SignInAsync(); }
        };
        Find<TextBox>("ServerUrl").TextChanged += (_, _) =>
            Find<TextBlock>("DevelopmentWarning").Visibility = Visible(Find<TextBox>("ServerUrl").Text.Trim().StartsWith("http:", StringComparison.OrdinalIgnoreCase));
        foreach (var (name, route) in new[] { ("TodayNav", "today"), ("UpcomingNav", "upcoming"), ("RoutinesNav", "routines"), ("SettingsNav", "settings") })
            Find<Button>(name).Click += (_, _) => { page = route; Render(); };
        Find<Button>("MarkDone").Click += async (_, _) =>
        {
            var occurrence = client.Current;
            if (occurrence is not null) await RunAsync(ct => client.CompleteAsync(occurrence, Today, ct), "Task completed.");
        };
        // A flyout has its own namescope; resolve its item through the owner.
        var flyout = (MenuFlyout)Find<Button>("CurrentOptions").Flyout;
        ((MenuFlyoutItem)flyout.Items[0]).Click += (_, _) =>
        {
            if (!busy && !operations.IsEditorOpen && client.IsConnected) { client.NotNow(); Render(); }
        };
        Find<Button>("AddTask").Click += async (_, _) => await AddAsync();
        Find<Button>("Refresh").Click += async (_, _) => await RunAsync(ct => client.RefreshAsync(Today, ct), "Connection verified.");
        Find<Button>("RetryConnection").Click += async (_, _) => await RunAsync(ct => client.RefreshAsync(Today, ct), "Reconnected.");
        Find<Button>("SignOut").Click += async (_, _) => await SignOutAsync();
        Find<Button>("OfflineSignOut").Click += async (_, _) => await SignOutAsync();
        Find<Button>("CheckUpdates").Click += async (_, _) => await CheckUpdatesAsync();
        Find<Button>("DownloadUpdate").Click += async (_, _) => await DownloadUpdateAsync();
    }

    private async Task CheckUpdatesAsync()
    {
        if (checkingUpdates || closed) return;
        checkingUpdates = true;
        updateResult = null;
        updateNotice = null;
        RenderUpdates();
        try
        {
            var result = await updates.CheckAsync(installedVersion.BuildNumber, lifetime.Token);
            if (!closed) { updateResult = result; lastUpdateCheck = DateTimeOffset.Now; }
        }
        catch (OperationCanceledException) when (closed) { }
        finally
        {
            checkingUpdates = false;
            if (!closed) RenderUpdates();
        }
    }

    private async Task DownloadUpdateAsync()
    {
        if (closed || checkingUpdates || openingDownload || updateResult?.DownloadUri is not { } uri) return;
        openingDownload = true;
        updateNotice = null;
        RenderUpdates();
        try
        {
            var opened = await Launcher.LaunchUriAsync(uri);
            if (!closed) updateNotice = opened
                ? "Download opened in your browser. Run the downloaded installer to complete the update."
                : "Could not open your browser. Try Download update again.";
        }
        catch (Exception)
        {
            if (!closed) updateNotice = "Could not open your browser. Try Download update again.";
        }
        finally
        {
            openingDownload = false;
            if (!closed) RenderUpdates();
        }
    }

    private void RenderUpdates()
    {
        Find<TextBlock>("InstalledVersion").Text = installedVersion.Display;
        Find<TextBlock>("UpdateStatus").Text = checkingUpdates ? "Checking GitHub for Windows updates…"
            : updateNotice ?? (updateResult?.Status switch
            {
                WindowsUpdateStatus.Available => $"A new Windows version is available: 0.1.{updateResult.BuildNumber} (build {updateResult.BuildNumber}).",
                WindowsUpdateStatus.Current => $"You’re up to date. Latest published Windows build: {updateResult.BuildNumber}.",
                WindowsUpdateStatus.NoReleases => "No published releases are available yet.",
                WindowsUpdateStatus.Development => $"Latest Windows release: build {updateResult.BuildNumber}. This development build cannot be compared automatically.",
                WindowsUpdateStatus.Failed => "Could not check for updates. Check your connection and try again; GitHub may be temporarily unavailable or rate-limiting requests.",
                _ => "Check GitHub for the latest Windows release."
            });
        Find<ProgressBar>("UpdateProgress").Visibility = Visible(checkingUpdates);
        Find<Button>("CheckUpdates").IsEnabled = !checkingUpdates && !openingDownload && !busy && !operations.IsEditorOpen;
        Find<Button>("CheckUpdates").Content = checkingUpdates ? "Checking…" : "Check for updates";
        Find<Button>("DownloadUpdate").Visibility = Visible(!checkingUpdates && updateResult?.DownloadUri is not null);
        Find<Button>("DownloadUpdate").IsEnabled = !openingDownload && !busy && !operations.IsEditorOpen;
        Find<Button>("DownloadUpdate").Content = updateResult?.Status == WindowsUpdateStatus.Development ? "Download release" : "Download update";
        Find<TextBlock>("LastUpdateCheck").Text = lastUpdateCheck is { } time ? $"Last checked: {time:g}" : "Not checked yet";
        Find<TextBlock>("ReleaseNotes").Text = updateResult?.ReleaseNotes ?? string.Empty;
        Find<Expander>("ReleaseNotesPanel").Visibility = Visible(!checkingUpdates && !string.IsNullOrWhiteSpace(updateResult?.ReleaseNotes));
    }

    private async Task SignInAsync()
    {
        if (busy || closed) return;
        if (operations.IsEditorOpen) return;
        var endpoint = Find<TextBox>("ServerUrl").Text.Trim();
        var username = Find<TextBox>("Username").Text.Trim();
        var password = Find<PasswordBox>("Password").Password;
        Find<PasswordBox>("Password").Password = string.Empty;
        page = "today";
        await RunAsync(ct => client.SignInAsync(endpoint, username, password, Today, ct));
    }

    private Task SignOutAsync() => RunAsync(async ct =>
    {
        operations.BeginSignOut();
        try
        {
            Render();
            await client.SignOutAsync(ct);
            page = "today";
        }
        finally { operations.EndSignOut(); }
    }, "Signed out on this device.");

    private async Task AddAsync()
    {
        if (closed || !client.IsConnected || !operations.TryOpenEditor()) return;
        try
        {
            var added = await TaskEditor.ShowAsync(root.XamlRoot, operations, async draft =>
            {
                var saved = await RunAsync(ct => client.AddTaskAsync(draft, Today, ct), editorSubmission: true);
                if (!saved) throw new InvalidOperationException("The write was not confirmed.");
            });
            if (!closed && added) { page = "today"; Find<TextBlock>("Notice").Text = "Task added."; }
        }
        catch (Exception)
        {
            if (!closed) Find<TextBlock>("Notice").Text = "Could not open the task editor.";
        }
        finally
        {
            operations.CloseEditor();
            if (!closed) Render();
        }
    }

    private async Task<bool> RunAsync(Func<CancellationToken, Task> action, string? success = null,
        bool allowDuringEditor = false, bool editorSubmission = false)
    {
        if (busy || closed) return false;
        try
        {
            var completed = await operations.ExecuteAsync(async () =>
            {
                Find<TextBlock>("Notice").Text = string.Empty;
                try { await action(lifetime.Token); }
                finally { if (!closed) Render(); }
            }, allowDuringEditor, editorSubmission);
            if (completed && !closed && success is not null) Find<TextBlock>("Notice").Text = success;
            return completed;
        }
        catch (OperationCanceledException)
        {
            if (!closed) Find<TextBlock>("Notice").Text = "Operation cancelled. Refresh to confirm the server state.";
        }
        catch (TasksClientException error)
        {
            if (!closed) Find<TextBlock>("Notice").Text = error.Message;
        }
        catch (Exception)
        {
            if (!closed) Find<TextBlock>("Notice").Text = "Could not complete the operation. Reconnect to verify the server state.";
        }
        finally
        {
            if (!closed) { SetBusy(false); Render(); }
        }
        return false;
    }

    private void SetBusy(bool value)
    {
        var enabled = !value && !operations.IsEditorOpen;
        Find<ScrollViewer>("SignInPanel").IsEnabled = enabled;
        SetControlsEnabled(Find<Grid>("Workspace"), enabled);
        SetControlsEnabled(Find<Grid>("ConnectionPanel"), enabled);
        Find<ProgressBar>("BusyProgress").Visibility = Visible(value);
        RenderUpdates();
    }

    private static void SetControlsEnabled(DependencyObject parent, bool enabled)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is Control control) control.IsEnabled = enabled;
            else SetControlsEnabled(child, enabled);
        }
    }

    private void Render()
    {
        RenderUpdates();
        var connected = client.IsConnected && client.State is not null && !operations.IsSigningOut;
        operations.SetConnected(connected);
        Find<ScrollViewer>("SignInPanel").Visibility = Visible(client.Session is null && !client.NeedsSignOutRetry);
        Find<Grid>("ConnectionPanel").Visibility = Visible(client.NeedsSignOutRetry || client.Session is not null && !connected);
        Find<Button>("RetryConnection").Visibility = Visible(!client.NeedsSignOutRetry);
        Find<Grid>("Workspace").Visibility = Visible(connected);
        Find<TextBlock>("OfflineEndpoint").Text = client.Session is { } profile ? profile.Endpoint + "\n" + profile.Username : string.Empty;
        // Always clear detached native views too; hidden controls are not a task cache.
        Find<StackPanel>("QueueList").Children.Clear();
        Find<StackPanel>("CompletedList").Children.Clear();
        Find<StackPanel>("ListPanel").Children.Clear();
        Find<TextBlock>("CurrentTitle").Text = string.Empty;
        Find<TextBlock>("CurrentNotes").Text = string.Empty;
        Find<TextBlock>("CurrentMetadata").Text = string.Empty;
        Find<TextBlock>("ProgressText").Text = string.Empty;
        Find<TextBlock>("QueueCount").Text = string.Empty;
        Find<TextBlock>("ConnectionDetails").Text = string.Empty;
        Find<ProgressBar>("DailyProgress").Value = 0;
        if (!connected) return;
        var state = client.State!;
        Find<TextBlock>("PageTitle").Text = page switch { "upcoming" => "Upcoming", "routines" => "Routines", "settings" => "Settings", _ => "Today" };
        Find<TextBlock>("PageSubtitle").Text = page switch
        {
            "upcoming" => "The next scheduled occurrence of each task",
            "routines" => "All active tasks and their schedules",
            "settings" => "Your connection, account and app updates",
            _ => Today.ToDateTime(TimeOnly.MinValue).ToString("dddd, MMMM d")
        };
        Find<StackPanel>("TodayPanel").Visibility = Visible(page == "today");
        Find<StackPanel>("ListPanel").Visibility = Visible(page is "upcoming" or "routines");
        Find<StackPanel>("SettingsPanel").Visibility = Visible(page == "settings");
        Find<Button>("AddTask").Visibility = Visible(page != "settings");
        foreach (var (name, route, label) in new[] { ("TodayNav", "today", "Today"), ("UpcomingNav", "upcoming", "Upcoming"), ("RoutinesNav", "routines", "Routines"), ("SettingsNav", "settings", "Settings") })
        {
            var nav = Find<Button>(name);
            nav.Background = route == page ? Brush(52, 75, 65) : new SolidColorBrush(Colors.Transparent);
            nav.Foreground = route == page ? Brush(190, 223, 199) : Brush(178, 192, 192);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(nav, label + (route == page ? ", selected" : string.Empty));
        }
        Find<TextBlock>("ProgressText").Text = $"{state.Progress.Completed} of {state.Progress.Total} completed";
        Find<ProgressBar>("DailyProgress").Maximum = Math.Max(1, state.Progress.Total);
        Find<ProgressBar>("DailyProgress").Value = state.Progress.Completed;
        var current = client.Current;
        Find<TextBlock>("CurrentTitle").Text = current?.Title ?? (state.Tasks.Count == 0 ? "No tasks yet" : "All done for today");
        Find<TextBlock>("CurrentMetadata").Text = current is null ? string.Empty : Metadata(current);
        Find<TextBlock>("CurrentNotes").Text = current?.Notes ?? (state.Tasks.Count == 0 ? "Add your first task to get started." : "Nothing else is due today.");
        Find<Button>("MarkDone").Visibility = Visible(current is not null);
        Find<Button>("CurrentOptions").Visibility = Visible(current is not null);
        Find<TextBlock>("QueueCount").Text = $"{client.Waiting.Count} {(client.Waiting.Count == 1 ? "task" : "tasks")}";
        foreach (var occurrence in client.Waiting)
        {
            var selectedId = occurrence.OccurrenceId;
            var button = Row(occurrence.Title, Metadata(occurrence), "↗");
            button.Click += (_, _) => { if (!busy && !operations.IsEditorOpen && client.IsConnected) { client.Select(selectedId); Render(); } };
            Find<StackPanel>("QueueList").Children.Add(button);
        }
        if (client.Waiting.Count == 0) Find<StackPanel>("QueueList").Children.Add(Secondary("Nothing waiting."));
        var completed = state.Today.Where(item => item.Completed).ToArray();
        Find<StackPanel>("CompletedPanel").Visibility = Visible(completed.Length > 0);
        foreach (var occurrence in completed)
        {
            var button = Row(occurrence.Title, "Completed today", "Undo");
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, "Undo completion: " + occurrence.Title);
            button.Click += async (_, _) => await RunAsync(ct => client.UndoAsync(occurrence, Today, ct), "Completion undone.");
            Find<StackPanel>("CompletedList").Children.Add(button);
        }
        if (page == "upcoming")
        {
            foreach (var occurrence in state.Upcoming)
                Find<StackPanel>("ListPanel").Children.Add(ReadOnlyRow(occurrence.Title, $"{occurrence.DueDate}  ·  {occurrence.Category}  ·  {Schedule(occurrence.Repeat, occurrence.Interval)}"));
            if (state.Upcoming.Count == 0) Find<StackPanel>("ListPanel").Children.Add(Secondary("No upcoming tasks."));
        }
        if (page == "routines")
        {
            foreach (var task in state.Tasks)
                Find<StackPanel>("ListPanel").Children.Add(ReadOnlyRow(task.Title, $"{task.Category}  ·  {Schedule(task.Repeat, task.Interval)}  ·  Starts {task.StartDate}"));
            if (state.Tasks.Count == 0) Find<StackPanel>("ListPanel").Children.Add(Secondary("No tasks yet. Add your first task to get started."));
        }
        Find<TextBlock>("ConnectionDetails").Text = client.Session!.Endpoint + "\n" + client.Session.Username;
    }

    private static string Metadata(Occurrence occurrence) => $"{occurrence.Category}  ·  {Schedule(occurrence.Repeat, occurrence.Interval)}  ·  {(occurrence.Overdue ? "Overdue · " + occurrence.DueDate : "Due today")}";
    private static string Schedule(string repeat, int interval) => repeat switch
    {
        "daily" => interval == 1 ? "Daily" : $"Every {interval} days",
        "weekly" => interval == 1 ? "Weekly" : $"Every {interval} weeks",
        "monthly" => interval == 1 ? "Monthly" : $"Every {interval} months",
        "yearly" => interval == 1 ? "Yearly" : $"Every {interval} years",
        _ => "Does not repeat"
    };

    private static TextBlock Secondary(string text) => new()
    {
        Text = text, Foreground = Brush(178, 192, 192), FontSize = 12,
        TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 4)
    };

    private static Border ReadOnlyRow(string title, string metadata)
    {
        var stack = new StackPanel { Spacing = 5 };
        stack.Children.Add(new TextBlock { Text = title, FontSize = 16, TextWrapping = TextWrapping.Wrap });
        stack.Children.Add(Secondary(metadata));
        return new Border { Child = stack, BorderBrush = Brush(59, 75, 80), BorderThickness = new Thickness(0, 0, 0, 1), Padding = new Thickness(4, 14, 4, 14) };
    }

    private static Button Row(string title, string metadata, string action)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new TextBlock { Text = title, FontSize = 15, TextWrapping = TextWrapping.Wrap });
        stack.Children.Add(Secondary(metadata));
        grid.Children.Add(stack);
        var affordance = Secondary(action);
        affordance.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(affordance, 1);
        grid.Children.Add(affordance);
        return new Button
        {
            Content = grid, HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(4, 13, 4, 13),
            Background = new SolidColorBrush(Colors.Transparent), BorderBrush = Brush(59, 75, 80),
            BorderThickness = new Thickness(0, 0, 0, 1), CornerRadius = new CornerRadius(0)
        };
    }
}

internal static class TaskEditor
{
    public static async Task<bool> ShowAsync(XamlRoot xamlRoot, EditorOperationGate operations, Func<TaskDraft, Task> save)
    {
        var title = new TextBox { Header = "Task title", MaxLength = 200 };
        var repeat = new ComboBox { Header = "Repeat", HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var label in new[] { "Does not repeat", "Daily", "Weekly", "Monthly", "Yearly" }) repeat.Items.Add(label);
        repeat.SelectedIndex = 0;
        var interval = new NumberBox { Header = "Every N intervals", Minimum = 1, Maximum = 365, Value = 1, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
        var date = new CalendarDatePicker { Header = "First due date", Date = DateTimeOffset.Now, HorizontalAlignment = HorizontalAlignment.Stretch };
        var category = new TextBox { Header = "Category", Text = "Personal", MaxLength = 60 };
        var priority = new ComboBox { Header = "Priority", HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var label in new[] { "Normal", "Medium", "High" }) priority.Items.Add(label);
        priority.SelectedIndex = 0;
        var notes = new TextBox { Header = "Notes (optional)", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MaxLength = 2000, MinHeight = 80 };
        var error = new TextBlock { Foreground = new SolidColorBrush(Color.FromArgb(255, 242, 181, 173)), TextWrapping = TextWrapping.Wrap };
        var panel = new StackPanel { Spacing = 14, MinWidth = 310 };
        foreach (var control in new UIElement[] { title, repeat, interval, date, category, priority, notes, error }) panel.Children.Add(control);
        var dialog = new ContentDialog
        {
            XamlRoot = xamlRoot, RequestedTheme = ElementTheme.Dark, Title = "Add task",
            Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 560 },
            PrimaryButtonText = "Add task", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary
        };
        var added = false;
        var saving = false;
        void UpdateSubmission()
        {
            dialog.IsPrimaryButtonEnabled = !saving && operations.CanSubmit;
            if (!operations.IsConnected)
                error.Text = "Connection lost or session expired. Your draft is kept here. Cancel to reconnect or sign in.";
        }
        dialog.CloseButtonClick += (_, args) => args.Cancel = saving;
        dialog.Closing += (_, args) => args.Cancel = saving;
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            args.Cancel = true;
            if (saving || !operations.CanSubmit) return;
            if (string.IsNullOrWhiteSpace(title.Text) || date.Date is null || !double.IsFinite(interval.Value) || interval.Value < 1 || interval.Value > 365 || interval.Value != Math.Truncate(interval.Value))
            {
                error.Text = "Enter a title, a first due date, and a whole interval from 1 to 365.";
                return;
            }
            var deferral = args.GetDeferral();
            saving = true;
            dialog.IsPrimaryButtonEnabled = false;
            foreach (var control in panel.Children.OfType<Control>()) control.IsEnabled = false;
            error.Text = string.Empty;
            try
            {
                var draft = new TaskDraft(title.Text.Trim(), notes.Text, category.Text.Trim(),
                    new[] { "once", "daily", "weekly", "monthly", "yearly" }[repeat.SelectedIndex],
                    (int)interval.Value, DateOnly.FromDateTime(date.Date.Value.DateTime).ToString("yyyy-MM-dd"), priority.SelectedIndex);
                await save(draft);
                added = true;
                args.Cancel = false;
            }
            catch (TasksClientException failure) { error.Text = failure.Message; }
            catch (OperationCanceledException) { error.Text = "The write was not confirmed. Reconnect to verify before trying again."; }
            catch (Exception) { error.Text = "The write was not confirmed. Reconnect to verify before trying again."; }
            finally
            {
                saving = false;
                foreach (var control in panel.Children.OfType<Control>()) control.IsEnabled = true;
                UpdateSubmission();
                deferral.Complete();
            }
        };
        operations.Changed += UpdateSubmission;
        try
        {
            UpdateSubmission();
            await dialog.ShowAsync();
        }
        finally { operations.Changed -= UpdateSubmission; }
        return added;
    }
}
