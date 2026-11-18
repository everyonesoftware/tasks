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
    private readonly WindowsUpdateController updates;
    private readonly WindowsUpdatesPanel updatesPanel;
    private readonly CancellationTokenSource lifetime = new();
    private readonly DispatcherQueueTimer refreshTimer;
    private bool initialized;
    private readonly SessionStartup startup = new();
    private readonly EditorOperationGate operations = new();
    private readonly CompletedDisclosure completedDisclosure = new();
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
        updates = new WindowsUpdateController(new WindowsUpdateBackend(), () => client.PrepareForUpdateRestartAsync(lifetime.Token));
        updatesPanel = new WindowsUpdatesPanel(root, DispatcherQueue, RestartUpdatesAsync);
        updatesPanel.Bind(updates, () => busy || operations.IsEditorOpen || operations.IsRestarting);
        Find<TextBlock>("InstalledVersion").Text = WindowsAppVersion.FromAssembly(typeof(MainWindow).Assembly).Display;
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
            await RunAsync(RestoreSessionAsync);
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
            updatesPanel.Dispose();
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
        Find<Button>("CompletedToggle").Click += (_, _) =>
        {
            if (CanAct) { completedDisclosure.Toggle(); Render(); }
        };
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
            var date = Today;
            if (CanAct && occurrence is not null && TaskActions.CanComplete(client.State, occurrence, date))
                await RunAsync(ct => client.CompleteAsync(occurrence, date, ct), "Task completed.");
        };
        // A flyout has its own namescope; resolve its item through the owner.
        var flyout = (MenuFlyout)Find<Button>("CurrentOptions").Flyout;
        ((MenuFlyoutItem)flyout.Items[0]).Click += (_, _) =>
        {
            if (!busy && !operations.IsEditorOpen && client.IsConnected) { client.NotNow(); Render(); }
        };
        var editCurrent = new MenuFlyoutItem { Text = "Edit" };
        editCurrent.Click += async (_, _) => { if (client.Current is { } current) await EditAsync(current.TaskId); };
        var archiveCurrent = new MenuFlyoutItem { Text = "Archive" };
        archiveCurrent.Click += async (_, _) => { if (client.Current is { } current) await ArchiveAsync(current.TaskId); };
        flyout.Items.Add(editCurrent); flyout.Items.Add(archiveCurrent);
        Find<Button>("AddTask").Click += async (_, _) => await AddAsync();
        Find<Button>("Refresh").Click += async (_, _) => await RunAsync(ct => client.RefreshAsync(Today, ct), "Connection verified.");
        Find<Button>("RetryConnection").Click += async (_, _) => await RunAsync(
            ct => startup.NeedsRetry ? RestoreSessionAsync(ct) : client.RefreshAsync(Today, ct));
        Find<Button>("SignOut").Click += async (_, _) => await SignOutAsync();
        Find<Button>("OfflineSignOut").Click += async (_, _) => await SignOutAsync();
    }

    private void RenderUpdates() => updatesPanel.Render(updates.Status, busy || operations.IsEditorOpen || operations.IsRestarting);

    private async Task RestartUpdatesAsync()
    {
        if (closed || !operations.TryBeginRestart()) return;
        try { await updates.RestartAsync(); }
        finally { operations.EndRestart(); }
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

    private Task RestoreSessionAsync(CancellationToken ct)
    {
        var restoring = startup.RestoreAsync(() => client.RestoreAsync(Today, ct));
        Render();
        return restoring;
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
        finally
        {
            if (!client.NeedsSignOutRetry) startup.SignedOut();
            operations.EndSignOut();
        }
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

    private Button TaskOptions(string taskId, string title)
    {
        var menu = new MenuFlyout();
        var edit = new MenuFlyoutItem { Text = "Edit" };
        var archive = new MenuFlyoutItem { Text = "Archive" };
        edit.Click += async (_, _) => await EditAsync(taskId);
        archive.Click += async (_, _) => await ArchiveAsync(taskId);
        menu.Items.Add(edit); menu.Items.Add(archive);
        var button = new Button { Content = "⋯", FontSize = 22, Flyout = menu, VerticalAlignment = VerticalAlignment.Center };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, "Task options: " + title);
        return button;
    }

    private async Task EditAsync(string taskId)
    {
        var task = client.State?.Tasks.FirstOrDefault(t => t.Id == taskId);
        if (closed || task is null || !operations.TryOpenEditor()) return;
        try
        {
            var initial = new TaskDraft(task.Title, task.Notes, task.Category, task.Repeat, task.Interval, task.StartDate, task.Priority);
            var saved = await TaskEditor.ShowAsync(root.XamlRoot, operations, async draft =>
            {
                if (!await RunAsync(ct => client.EditTaskAsync(taskId, draft, Today, ct), editorSubmission: true))
                    throw new InvalidOperationException("The write was not confirmed.");
            }, initial);
            if (!closed && saved) Find<TextBlock>("Notice").Text = "Task updated.";
        }
        catch (Exception) { if (!closed) Find<TextBlock>("Notice").Text = "Could not open the task editor."; }
        finally { operations.CloseEditor(); if (!closed) Render(); }
    }

    private async Task ArchiveAsync(string taskId)
    {
        var task = client.State?.Tasks.FirstOrDefault(t => t.Id == taskId);
        if (closed || task is null || !operations.TryOpenEditor()) return;
        try
        {
            var dialog = new ContentDialog
            {
                XamlRoot = root.XamlRoot, RequestedTheme = ElementTheme.Dark, Title = "Archive task?",
                Content = $"Archive “{task.Title}”? Its completion history will be kept.",
                PrimaryButtonText = "Archive", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close
            };
            void Update() => dialog.IsPrimaryButtonEnabled = operations.CanSubmit;
            operations.Changed += Update;
            try
            {
                Update();
                if (await dialog.ShowAsync() == ContentDialogResult.Primary && !closed)
                    await RunAsync(ct => client.ArchiveTaskAsync(taskId, Today, ct), "Task archived.", editorSubmission: true);
            }
            finally { operations.Changed -= Update; }
        }
        catch (Exception) { if (!closed) Find<TextBlock>("Notice").Text = "Could not archive the task."; }
        finally { operations.CloseEditor(); if (!closed) Render(); }
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
        var enabled = !value && !operations.IsEditorOpen && !operations.IsRestarting;
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
        completedDisclosure.Update(operations.IsSigningOut ? null : client.Session, Today);
        Find<Grid>("StartupPanel").Visibility = Visible(startup.IsRestoring);
        Find<ScrollViewer>("SignInPanel").Visibility = Visible(!startup.IsRestoring && !startup.NeedsRetry && client.Session is null && !client.NeedsSignOutRetry);
        Find<Grid>("ConnectionPanel").Visibility = Visible(!startup.IsRestoring && (startup.NeedsRetry || client.NeedsSignOutRetry || client.Session is not null && !connected));
        Find<Button>("RetryConnection").Visibility = Visible(!client.NeedsSignOutRetry);
        Find<Grid>("Workspace").Visibility = Visible(!startup.IsRestoring && connected);
        Find<TextBlock>("OfflineEndpoint").Text = client.Session is { } profile ? profile.Endpoint + "\n" + profile.Username : string.Empty;
        // Always clear detached native views too; hidden controls are not a task cache.
        Find<StackPanel>("QueueList").Children.Clear();
        Find<StackPanel>("CompletedList").Children.Clear();
        Find<StackPanel>("ListPanel").Children.Clear();
        Find<TextBlock>("CurrentTitle").Text = string.Empty;
        Find<Button>("CurrentTitleActions").Flyout = null;
        Find<Button>("CurrentTitleActions").IsEnabled = false;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(Find<Button>("CurrentTitleActions"), string.Empty);
        Find<TextBlock>("CurrentNotes").Text = string.Empty;
        Find<TextBlock>("CurrentMetadata").Text = string.Empty;
        Find<TextBlock>("ProgressText").Text = string.Empty;
        Find<TextBlock>("QueueCount").Text = string.Empty;
        Find<TextBlock>("ConnectionDetails").Text = string.Empty;
        Find<ProgressBar>("DailyProgress").Value = 0;
        Find<Button>("CompletedToggle").Content = string.Empty;
        Find<StackPanel>("CompletedList").Visibility = Visible(completedDisclosure.IsExpanded);
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
        if (current is not null)
        {
            AttachOccurrenceActions(Find<Button>("CurrentTitleActions"), current);
            Find<Button>("CurrentTitleActions").IsEnabled = CanAct;
        }
        Find<TextBlock>("CurrentMetadata").Text = current is null ? string.Empty : Metadata(current);
        Find<TextBlock>("CurrentNotes").Text = current?.Notes ?? (state.Tasks.Count == 0 ? "Add your first task to get started." : "Nothing else is due today.");
        Find<Button>("MarkDone").Visibility = Visible(current is not null);
        Find<Button>("CurrentOptions").Visibility = Visible(current is not null);
        Find<TextBlock>("QueueCount").Text = $"{client.Waiting.Count} {(client.Waiting.Count == 1 ? "task" : "tasks")}";
        foreach (var occurrence in client.Waiting)
        {
            var button = OccurrenceRow(occurrence, Metadata(occurrence));
            Find<StackPanel>("QueueList").Children.Add(WithOptions(button, occurrence.TaskId, occurrence.Title));
        }
        if (client.Waiting.Count == 0) Find<StackPanel>("QueueList").Children.Add(Secondary("Nothing waiting."));
        var completed = state.Today.Where(item => item.Completed).ToArray();
        Find<StackPanel>("CompletedPanel").Visibility = Visible(completed.Length > 0);
        Find<Button>("CompletedToggle").Content = $"{(completedDisclosure.IsExpanded ? "▾" : "▸")} Completed today ({completed.Length})";
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(Find<Button>("CompletedToggle"),
            $"Completed today ({completed.Length}), {(completedDisclosure.IsExpanded ? "expanded" : "collapsed")}");
        foreach (var occurrence in completed)
        {
            var button = OccurrenceRow(occurrence, "Completed today");
            Find<StackPanel>("CompletedList").Children.Add(WithOptions(button, occurrence.TaskId, occurrence.Title));
        }
        if (page == "upcoming")
        {
            foreach (var occurrence in state.Upcoming)
                Find<StackPanel>("ListPanel").Children.Add(WithOptions(OccurrenceRow(occurrence, $"{occurrence.DueDate}  ·  {occurrence.Category}  ·  {Schedule(occurrence.Repeat, occurrence.Interval)}"), occurrence.TaskId, occurrence.Title));
            if (state.Upcoming.Count == 0) Find<StackPanel>("ListPanel").Children.Add(Secondary("No upcoming tasks."));
        }
        if (page == "routines")
        {
            foreach (var task in state.Tasks)
            {
                var occurrence = state.Today.FirstOrDefault(o => o.TaskId == task.Id) ?? state.Upcoming.FirstOrDefault(o => o.TaskId == task.Id);
                var metadata = $"{task.Category}  ·  {Schedule(task.Repeat, task.Interval)}  ·  Starts {task.StartDate}";
                var row = occurrence is null ? Row(task.Title, metadata, "Actions") : OccurrenceRow(occurrence, metadata);
                if (occurrence is null)
                {
                    var unavailable = new MenuFlyout();
                    unavailable.Items.Add(new MenuFlyoutItem { Text = "No occurrence due today", IsEnabled = false });
                    row.Flyout = unavailable;
                    Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(row, "Task actions: " + task.Title);
                }
                Find<StackPanel>("ListPanel").Children.Add(WithOptions(row, task.Id, task.Title));
            }
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

    private bool CanAct => !closed && !busy && !operations.IsEditorOpen && !operations.IsRestarting && client.IsConnected;

    private Button OccurrenceRow(Occurrence occurrence, string metadata)
    {
        var button = Row(occurrence.Title, metadata, "Actions");
        AttachOccurrenceActions(button, occurrence);
        return button;
    }

    private void AttachOccurrenceActions(Button button, Occurrence occurrence)
    {
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, "Task actions: " + occurrence.Title);
        var menu = new MenuFlyout();
        var focus = new MenuFlyoutItem { Text = "Make current" };
        var complete = new MenuFlyoutItem { Text = "Mark done" };
        var undo = new MenuFlyoutItem { Text = "Undo" };
        focus.Click += (_, _) =>
        {
            if (!CanAct || !TaskActions.CanFocus(client.State, occurrence, Today)) return;
            client.Select(occurrence.OccurrenceId); page = "today"; Render();
        };
        complete.Click += async (_, _) =>
        {
            if (CanAct && TaskActions.CanComplete(client.State, occurrence, Today))
                await RunAsync(ct => client.CompleteAsync(occurrence, Today, ct), "Task completed.");
        };
        undo.Click += async (_, _) =>
        {
            if (CanAct && TaskActions.CanUndo(client.State, occurrence, Today))
                await RunAsync(ct => client.UndoAsync(occurrence, Today, ct), "Completion undone.");
        };
        menu.Opening += (_, _) =>
        {
            menu.Items.Clear();
            if (TaskActions.CanFocus(client.State, occurrence, Today)) { menu.Items.Add(focus); menu.Items.Add(complete); }
            else if (TaskActions.CanUndo(client.State, occurrence, Today)) menu.Items.Add(undo);
            else menu.Items.Add(new MenuFlyoutItem { Text = "Not due today", IsEnabled = false });
            focus.IsEnabled = complete.IsEnabled = undo.IsEnabled = CanAct;
        };
        button.Flyout = menu;
    }

    private Grid WithOptions(Button row, string taskId, string title)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var options = TaskOptions(taskId, title);
        Grid.SetColumn(options, 1); grid.Children.Add(row); grid.Children.Add(options);
        return grid;
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
    public static async Task<bool> ShowAsync(XamlRoot xamlRoot, EditorOperationGate operations, Func<TaskDraft, Task> save, TaskDraft? initial = null)
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
        if (initial is not null)
        {
            title.Text = initial.Title; notes.Text = initial.Notes; category.Text = initial.Category;
            repeat.SelectedIndex = Array.IndexOf(new[] { "once", "daily", "weekly", "monthly", "yearly" }, initial.Repeat);
            interval.Value = initial.Interval; priority.SelectedIndex = initial.Priority;
            date.Date = new DateTimeOffset(DateOnly.ParseExact(initial.StartDate, "yyyy-MM-dd").ToDateTime(TimeOnly.MinValue));
        }
        var error = new TextBlock { Foreground = new SolidColorBrush(Color.FromArgb(255, 242, 181, 173)), TextWrapping = TextWrapping.Wrap };
        var panel = new StackPanel { Spacing = 14, MinWidth = 310 };
        foreach (var control in new UIElement[] { title, repeat, interval, date, category, priority, notes, error }) panel.Children.Add(control);
        var dialog = new ContentDialog
        {
            XamlRoot = xamlRoot, RequestedTheme = ElementTheme.Dark, Title = initial is null ? "Add task" : "Edit task",
            Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 560 },
            PrimaryButtonText = initial is null ? "Add task" : "Save changes", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary
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
