using Microsoft.UI;
using DispatcherQueueTimer = Microsoft.UI.Dispatching.DispatcherQueueTimer;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
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
    private readonly TaskWorkspace workspace = new();
    private string? returnFocus;
    private TaskEditor? taskEditor;
    private string? detailFocusAction;
    private string? detailFocusTaskId;
    private TaskEditDraft? editorFocusDraft;
    private string? editorFocusField;
    private bool restoreWorkspaceFocus;
    private bool workspaceEditorOpen;
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
            Find<Button>(name).Click += (_, _) => { if (!CanAct) return; workspace.Back(); page = route; Render(); };
        Find<Button>("CurrentTitleActions").Click += (_, _) =>
        {
            if (client.Current is { } current) OpenDetails(current.TaskId, current.OccurrenceId);
        };
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
            ct => startup.NeedsRetry ? RestoreSessionAsync(ct) : client.RefreshAsync(Today, ct), allowDuringEditor: true);
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
    }, "Signed out on this device.", allowDuringEditor: true);

    private Task AddAsync()
    {
        if (closed || !client.IsConnected || !operations.TryOpenEditor()) return Task.CompletedTask;
        workspaceEditorOpen = true;
        workspace.BeginAdd(page, Today);
        Render();
        taskEditor?.FocusName();
        return Task.CompletedTask;
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

    private Task EditAsync(string taskId)
    {
        var task = client.State?.Tasks.FirstOrDefault(t => t.Id == taskId);
        if (closed || task is null || !CanAct || !operations.TryOpenEditor()) return Task.CompletedTask;
        if (workspace.Mode != "details" || workspace.TaskId != taskId)
        {
            var occurrence = client.State!.Today.Concat(client.State.Upcoming).FirstOrDefault(o => o.TaskId == taskId);
            returnFocus = FocusKey(taskId, occurrence?.OccurrenceId);
            workspace.OpenTask(taskId, page, occurrence?.OccurrenceId);
        }
        if (!workspace.BeginEdit(client.State)) { operations.CloseEditor(); return Task.CompletedTask; }
        workspaceEditorOpen = true;
        Render();
        taskEditor?.FocusName();
        return Task.CompletedTask;
    }

    private void CancelWorkspaceEdit()
    {
        if (busy || !workspaceEditorOpen) return;
        workspace.CancelEdit();
        workspaceEditorOpen = false;
        operations.CloseEditor();
        Render();
        if (workspace.Mode == "details") FocusFirst(Find<StackPanel>("TaskDetailsPanel"));
        else Find<Button>("AddTask").Focus(FocusState.Programmatic);
    }

    private async Task SaveWorkspaceAsync(TaskDraft payload)
    {
        Render();
        if (!operations.CanSubmit || workspace.Draft is null) return;
        var taskId = workspace.TaskId;
        var date = Today;
        var confirmed = false;
        var saved = await RunAsync(async ct => confirmed = await workspace.SaveAsync(client, payload, date, () => Today, ct), editorSubmission: true);
        if (!saved)
        {
            if (!closed && workspace.Draft?.AcknowledgedCreationId is not null)
                Find<TextBlock>("Notice").Text = "The server accepted this task, but readback is not confirmed. Reconnect, then verify the saved task.";
            return;
        }
        if (!confirmed)
        {
            Find<TextBlock>("Notice").Text = "The write could not be matched to a refreshed task. Verify the list before trying again.";
            return;
        }
        workspaceEditorOpen = false;
        operations.CloseEditor();
        Render();
        FocusFirst(Find<StackPanel>("TaskDetailsPanel"));
        Find<TextBlock>("Notice").Text = taskId is null ? "Task added." : "Task updated.";
    }

    private async Task ArchiveAsync(string taskId)
    {
        var task = client.State?.Tasks.FirstOrDefault(t => t.Id == taskId);
        if (closed || task is null || !CanAct || !operations.TryOpenEditor()) return;
        var session = client.Session;
        var date = Today;
        try
        {
            var dialog = new ContentDialog
            {
                XamlRoot = root.XamlRoot, RequestedTheme = ElementTheme.Dark, Title = "Archive task?",
                Content = $"Archive “{task.Title}”? Its completion history will be kept.",
                PrimaryButtonText = "Archive", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close
            };
            void Update()
            {
                dialog.IsPrimaryButtonEnabled = operations.CanSubmit && session == client.Session && date == Today && client.State?.Tasks.Any(t => t.Id == taskId) == true;
                dialog.Content = operations.IsConnected && session == client.Session && date == Today
                    ? $"Archive “{task.Title}”? Its completion history will be kept."
                    : "Connection lost or session changed. Reconnect and reopen the task to archive it.";
            }
            operations.Changed += Update;
            try
            {
                Update();
                if (await dialog.ShowAsync() == ContentDialogResult.Primary && !closed && dialog.IsPrimaryButtonEnabled)
                    await RunAsync(ct => client.ArchiveTaskAsync(taskId, date, ct), "Task archived.", editorSubmission: true);
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
        CaptureWorkspaceFocus(); // Capture before the operation gate disables native controls.
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
        SetControlsEnabled(Find<Grid>("ConnectionPanel"), !value && !operations.IsRestarting);
        SetControlsEnabled(Find<StackPanel>("TaskEditorPanel"), !value && !operations.IsRestarting);
        taskEditor?.UpdateSubmission(operations);
        Find<ProgressBar>("BusyProgress").Visibility = Visible(value);
        RenderUpdates();
    }

    private static void SetControlsEnabled(DependencyObject parent, bool enabled)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is Control control && control is not ScrollViewer) control.IsEnabled = enabled;
            else SetControlsEnabled(child, enabled);
        }
    }

    private void Render()
    {
        CaptureWorkspaceFocus();
        RenderUpdates();
        var connected = client.IsConnected && client.State is not null && !operations.IsSigningOut
            && client.State.Date == Today.ToString("yyyy-MM-dd");
        operations.SetConnected(connected);
        completedDisclosure.Update(operations.IsSigningOut ? null : client.Session, Today);
        workspace.Update(operations.IsSigningOut ? null : client.Session, Today, client.State);
        if (workspace.Mode != "details" || detailFocusTaskId != workspace.TaskId)
        {
            detailFocusTaskId = null;
            detailFocusAction = null;
        }
        if (!ReferenceEquals(editorFocusDraft, workspace.Draft))
        {
            editorFocusDraft = workspace.Draft;
            editorFocusField = null;
        }
        if (workspaceEditorOpen && workspace.Draft is null)
        {
            workspaceEditorOpen = false;
            operations.CloseEditor();
        }
        if (!connected || workspace.Draft is null)
        {
            Find<StackPanel>("TaskEditorPanel").Children.Clear();
            taskEditor = null;
        }
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
        Find<StackPanel>("TaskDetailsPanel").Children.Clear();
        Find<TextBlock>("CurrentTitle").Text = string.Empty;
        Find<Button>("CurrentTitleActions").Flyout = null;
        Find<Button>("CurrentTitleActions").IsEnabled = false;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(Find<Button>("CurrentTitleActions"), string.Empty);

        Find<TextBlock>("CurrentMetadata").Text = string.Empty;
        Find<TextBlock>("ProgressText").Text = string.Empty;
        Find<TextBlock>("QueueCount").Text = string.Empty;
        Find<TextBlock>("ConnectionDetails").Text = string.Empty;
        Find<ProgressBar>("DailyProgress").Value = 0;
        Find<Button>("CompletedToggle").Content = string.Empty;
        Find<StackPanel>("CompletedList").Visibility = Visible(completedDisclosure.IsExpanded);
        if (!connected) { Find<TextBlock>("PageTitle").Text = string.Empty; Find<TextBlock>("PageSubtitle").Text = string.Empty; SetBusy(busy); return; }
        var state = client.State!;
        Find<TextBlock>("PageTitle").Text = page switch { "upcoming" => "Upcoming", "routines" => "Routines", "settings" => "Settings", _ => "Today" };
        Find<TextBlock>("PageSubtitle").Text = page switch
        {
            "upcoming" => "The next scheduled occurrence of each task",
            "routines" => "All active tasks and their schedules",
            "settings" => "Your connection, account and app updates",
            _ => Today.ToDateTime(TimeOnly.MinValue).ToString("dddd, MMMM d")
        };
        var listing = workspace.Mode == "list";
        Find<StackPanel>("TodayPanel").Visibility = Visible(listing && page == "today");
        Find<StackPanel>("ListPanel").Visibility = Visible(listing && page is "upcoming" or "routines");
        Find<StackPanel>("SettingsPanel").Visibility = Visible(listing && page == "settings");
        Find<StackPanel>("TaskDetailsPanel").Visibility = Visible(workspace.Mode == "details");
        Find<StackPanel>("TaskEditorPanel").Visibility = Visible(workspace.Mode == "edit");
        Find<Button>("AddTask").Visibility = Visible(listing && page != "settings");
        if (workspace.Mode == "details") RenderDetails();
        if (workspace.Mode == "edit" && workspace.Draft is { } draft)
        {
            Find<TextBlock>("PageTitle").Text = workspace.TaskId is null ? "Add task" : "Edit task";
            Find<TextBlock>("PageSubtitle").Text = "A task name and a schedule. Previous completions stay on your server.";
            if (taskEditor is null)
            {
                taskEditor = new TaskEditor(draft, operations, SaveWorkspaceAsync, CancelWorkspaceEdit, isNew: workspace.TaskId is null);
                Find<StackPanel>("TaskEditorPanel").Children.Add(taskEditor.Panel);
            }
        }
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
            Find<Button>("CurrentTitleActions").Tag = FocusKey(current.TaskId, current.OccurrenceId);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(Find<Button>("CurrentTitleActions"), "View task: " + current.Title);
            Find<Button>("CurrentTitleActions").IsEnabled = CanAct;
        }
        Find<TextBlock>("CurrentMetadata").Text = current is null ? string.Empty : Metadata(current);

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
                Find<StackPanel>("ListPanel").Children.Add(WithOptions(OccurrenceRow(occurrence, $"{occurrence.DueDate}  ·  {Schedule(occurrence.Repeat, occurrence.Interval)}"), occurrence.TaskId, occurrence.Title));
            if (state.Upcoming.Count == 0) Find<StackPanel>("ListPanel").Children.Add(Secondary("No upcoming tasks."));
        }
        if (page == "routines")
        {
            foreach (var task in state.Tasks)
            {
                var occurrence = state.Today.FirstOrDefault(o => o.TaskId == task.Id) ?? state.Upcoming.FirstOrDefault(o => o.TaskId == task.Id);
                var metadata = $"{Schedule(task.Repeat, task.Interval)}  ·  First due {task.StartDate}";
                var row = Row(task.Title, metadata, "View task →");
                row.Tag = FocusKey(task.Id, occurrence?.OccurrenceId);
                row.Click += (_, _) => OpenDetails(task.Id, occurrence?.OccurrenceId);
                Find<StackPanel>("ListPanel").Children.Add(WithOptions(row, task.Id, task.Title));
            }
            if (state.Tasks.Count == 0) Find<StackPanel>("ListPanel").Children.Add(Secondary("No tasks yet. Add your first task to get started."));
        }
        Find<TextBlock>("ConnectionDetails").Text = client.Session!.Endpoint + "\n" + client.Session.Username;
        SetBusy(busy);
        if (!busy && restoreWorkspaceFocus)
        {
            restoreWorkspaceFocus = false;
            if (workspace.Mode == "edit") taskEditor?.FocusField(editorFocusField);
            else if (workspace.Mode == "details" && detailFocusAction is not null)
            {
                var taskId = workspace.TaskId;
                DispatcherQueue.TryEnqueue(() =>
                {
                    if (closed || busy || !client.IsConnected || workspace.Mode != "details" || workspace.TaskId != taskId) return;
                    (FindButton(Find<StackPanel>("TaskDetailsPanel"), detailFocusAction)
                        ?? Find<StackPanel>("TaskDetailsPanel").Children.OfType<Button>().FirstOrDefault())?.Focus(FocusState.Programmatic);
                });
            }
        }
    }

    private static string Metadata(Occurrence occurrence) => $"{Schedule(occurrence.Repeat, occurrence.Interval)}  ·  {(occurrence.Overdue ? "Overdue · " + occurrence.DueDate : "Due today")}";
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
        var button = Row(occurrence.Title, metadata, "View task →");
        button.Tag = FocusKey(occurrence.TaskId, occurrence.OccurrenceId);
        button.Click += (_, _) => OpenDetails(occurrence.TaskId, occurrence.OccurrenceId);
        return button;
    }

    private void OpenDetails(string taskId, string? occurrenceId)
    {
        if (!CanAct || client.State?.Tasks.All(t => t.Id != taskId) != false) return;
        returnFocus = FocusKey(taskId, occurrenceId);
        workspace.OpenTask(taskId, page, occurrenceId);
        Render();
        FocusFirst(Find<StackPanel>("TaskDetailsPanel"));
    }

    private void BackToList()
    {
        if (busy) return;
        page = workspace.Back();
        Render();
        DispatcherQueue.TryEnqueue(() =>
        {
            var target = FindButton(Find<StackPanel>("MainContent"), returnFocus);
            (target ?? Find<Button>(page switch { "upcoming" => "UpcomingNav", "routines" => "RoutinesNav", _ => "TodayNav" })).Focus(FocusState.Programmatic);
        });
    }

    private void CaptureWorkspaceFocus()
    {
        if (root.XamlRoot is null) return;
        if (workspace.Mode == "details" && FocusManager.GetFocusedElement(root.XamlRoot) is Button { Tag: string key }
            && key.StartsWith("details:", StringComparison.Ordinal))
        {
            detailFocusTaskId = workspace.TaskId;
            detailFocusAction = key;
            restoreWorkspaceFocus = true;
        }
        if (workspace.Mode == "edit" && taskEditor?.FocusedField is { } field)
        {
            editorFocusDraft = workspace.Draft;
            editorFocusField = field;
            restoreWorkspaceFocus = true;
        }
    }

    private static string FocusKey(string taskId, string? occurrenceId) => "task:" + taskId + ":" + occurrenceId;
    private static Button? FindButton(DependencyObject parent, string? key)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is Button button && key is not null && button.Tag as string == key && button.Visibility == Visibility.Visible) return button;
            if (child is UIElement element && element.Visibility == Visibility.Collapsed) continue;
            if (FindButton(child, key) is { } found) return found;
        }
        return null;
    }

    private void FocusFirst(StackPanel panel) => DispatcherQueue.TryEnqueue(() => panel.Children.OfType<Control>().FirstOrDefault()?.Focus(FocusState.Programmatic));

    private void RenderDetails()
    {
        Find<TextBlock>("PageTitle").Text = "Task details";
        Find<TextBlock>("PageSubtitle").Text = "A name, a schedule and your available history";
        var panel = Find<StackPanel>("TaskDetailsPanel");
        var back = new Button { Content = "← Back to " + workspace.Origin, Tag = "details:back" };
        back.Click += (_, _) => BackToList();
        panel.Children.Add(back);
        var task = workspace.ResolveTask(client.State);
        if (task is null) { panel.Children.Add(Secondary("This task is no longer available. Return to the list.")); return; }
        panel.Children.Add(new TextBlock { Text = task.Title, FontFamily = new FontFamily("Georgia"), FontSize = 32, TextWrapping = TextWrapping.Wrap });
        var edit = new Button { Content = "✎ Edit task", Tag = "details:edit" };
        edit.Click += async (_, _) => await EditAsync(task.Id);
        panel.Children.Add(edit);
        panel.Children.Add(Secondary(Schedule(task.Repeat, task.Interval)));
        panel.Children.Add(Secondary("First due date: " + task.StartDate));
        var occurrence = workspace.ResolveOccurrence(client.State);
        if (occurrence is not null)
        {
            panel.Children.Add(Secondary((occurrence.Completed ? "Completed occurrence due: " : "Occurrence due: ") + occurrence.DueDate));
            AddDetailActions(panel, occurrence);
        }
        panel.Children.Add(new TextBlock { Text = "Available history", FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        if (!string.IsNullOrWhiteSpace(task.CreatedAt)) panel.Children.Add(Secondary("Created: " + task.CreatedAt));
        if (occurrence is { Completed: true } && !string.IsNullOrWhiteSpace(occurrence.CompletedAt))
            panel.Children.Add(Secondary("Completed: " + occurrence.CompletedAt));
        panel.Children.Add(Secondary("Full completion history is not available in this app. Previous completions remain on your server."));
        var archive = new Button { Content = "Archive task", Tag = "details:archive" };
        archive.Click += async (_, _) => await ArchiveAsync(task.Id);
        panel.Children.Add(archive);
    }

    private void AddDetailActions(StackPanel panel, Occurrence occurrence)
    {
        if (TaskActions.CanFocus(client.State, occurrence, Today))
        {
            var focus = new Button { Content = "Make current", Tag = "details:focus" };
            focus.Click += (_, _) =>
            {
                if (!CanAct || !TaskActions.CanFocus(client.State, occurrence, Today)) return;
                client.Select(occurrence.OccurrenceId); workspace.Back(); page = "today"; Render();
            };
            panel.Children.Add(focus);
            var complete = new Button { Content = "Mark done", HorizontalAlignment = HorizontalAlignment.Right, Tag = "details:complete" };
            complete.Click += async (_, _) =>
            {
                var date = Today;
                if (CanAct && TaskActions.CanComplete(client.State, occurrence, date))
                    await RunAsync(ct => client.CompleteAsync(occurrence, date, ct), "Task completed.");
            };
            panel.Children.Add(complete);
        }
        else if (TaskActions.CanUndo(client.State, occurrence, Today))
        {
            var undo = new Button { Content = "Undo", Tag = "details:undo" };
            undo.Click += async (_, _) =>
            {
                var date = Today;
                if (CanAct && TaskActions.CanUndo(client.State, occurrence, date))
                    await RunAsync(ct => client.UndoAsync(occurrence, date, ct), "Completion undone.");
            };
            panel.Children.Add(undo);
        }
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
