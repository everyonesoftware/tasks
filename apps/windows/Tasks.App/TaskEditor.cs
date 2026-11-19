using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Tasks.Core;
using Windows.System;
using Windows.UI;

namespace Tasks.App;

// The same native in-workspace form is used for creation and editing.
internal sealed class TaskEditor
{
    public StackPanel Panel { get; } = new() { Spacing = 18, MaxWidth = 580, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TextBox title;
    private readonly TaskEditDraft draft;
    private readonly bool isNew;
    private readonly Button submit = new() { Content = "Save changes", HorizontalAlignment = HorizontalAlignment.Right };
    private readonly Button cancel = new() { Content = "Cancel" };
    private readonly TextBlock error = new() { TextWrapping = TextWrapping.Wrap, Foreground = new SolidColorBrush(Color.FromArgb(255, 242, 181, 173)) };
    private bool saving;

    public TaskEditor(TaskEditDraft draft, EditorOperationGate operations, Func<TaskDraft, Task> save, Action cancelEdit, bool isNew)
    {
        this.draft = draft;
        this.isNew = isNew;
        submit.Content = isNew ? "Add task" : "Save changes";
        title = new TextBox { Header = "Task name", Text = draft.Title, MaxLength = 200, FontSize = 16 };
        var repeats = new[] { "once", "daily", "weekly", "monthly", "yearly" };
        var repeat = new ComboBox { Header = "Repeat", HorizontalAlignment = HorizontalAlignment.Stretch, FontSize = 16 };
        foreach (var label in new[] { "Does not repeat", "Daily", "Weekly", "Monthly", "Yearly" }) repeat.Items.Add(label);
        repeat.SelectedIndex = Array.IndexOf(repeats, draft.Repeat);
        var interval = new NumberBox
        {
            Header = "Every (number of intervals)", Minimum = 1, Maximum = 365, Value = draft.Interval,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
            Visibility = draft.Repeat == "once" ? Visibility.Collapsed : Visibility.Visible
        };
        var date = new CalendarDatePicker { Header = "First due date", HorizontalAlignment = HorizontalAlignment.Stretch };
        if (DateOnly.TryParseExact(draft.StartDate, "yyyy-MM-dd", out var firstDue))
            date.Date = new DateTimeOffset(firstDue.ToDateTime(TimeOnly.MinValue));
        title.TextChanged += (_, _) => draft.Title = title.Text;
        repeat.SelectionChanged += (_, _) =>
        {
            if (repeat.SelectedIndex < 0) return;
            draft.Repeat = repeats[repeat.SelectedIndex];
            interval.Visibility = draft.Repeat == "once" ? Visibility.Collapsed : Visibility.Visible;
        };
        interval.ValueChanged += (_, _) => draft.Interval = interval.Value;
        date.DateChanged += (_, _) => draft.StartDate = date.Date is { } value ? DateOnly.FromDateTime(value.DateTime).ToString("yyyy-MM-dd") : null;
        cancel.Click += (_, _) => { if (!saving && !operations.IsBusy) cancelEdit(); };
        Panel.KeyDown += (_, args) =>
        {
            if (args.Key == VirtualKey.Escape && !saving && !operations.IsBusy) { args.Handled = true; cancelEdit(); }
        };
        submit.Click += async (_, _) =>
        {
            if (saving || !operations.CanSubmit) return;
            TaskDraft payload;
            try { payload = draft.ToPayload(); }
            catch (ArgumentException) { error.Text = "Enter a task name, a first due date, and a whole interval from 1 to 365."; return; }
            saving = true;
            error.Text = string.Empty;
            UpdateSubmission(operations);
            try { await save(payload); }
            catch (Exception) { error.Text = "The write was not confirmed. Reconnect to verify before trying again."; }
            finally { saving = false; UpdateSubmission(operations); }
        };
        title.Tag = "name"; repeat.Tag = "repeat"; interval.Tag = "interval"; date.Tag = "date";
        cancel.Tag = "cancel"; submit.Tag = "submit";
        foreach (var element in new UIElement[] { title, repeat, interval, date, error, cancel, submit }) Panel.Children.Add(element);
        UpdateSubmission(operations);
    }

    public void UpdateSubmission(EditorOperationGate operations)
    {
        var pending = draft.AcknowledgedCreationId is not null;
        submit.Content = pending ? "Verify saved task" : isNew ? "Add task" : "Save changes";
        foreach (var control in Panel.Children.OfType<Control>()) control.IsEnabled = !saving && !operations.IsBusy && !pending;
        submit.IsEnabled = !saving && operations.CanSubmit;
        cancel.IsEnabled = !saving && !operations.IsBusy;
    }

    public void FocusName() => Panel.DispatcherQueue.TryEnqueue(() => title.Focus(FocusState.Programmatic));

    public string? FocusedField
    {
        get
        {
            if (Panel.XamlRoot is null) return null;
            var focused = Microsoft.UI.Xaml.Input.FocusManager.GetFocusedElement(Panel.XamlRoot) as DependencyObject;
            while (focused is not null && !ReferenceEquals(focused, Panel))
            {
                if (focused is Control control && Panel.Children.Contains(control)) return control.Tag as string;
                focused = VisualTreeHelper.GetParent(focused);
            }
            return null;
        }
    }

    public void FocusField(string? key) => Panel.DispatcherQueue.TryEnqueue(() =>
    {
        if (Panel.XamlRoot is null || Panel.Visibility != Visibility.Visible) return;
        (Panel.Children.OfType<Control>().FirstOrDefault(c => c.Tag as string == key && c.IsEnabled && c.Visibility == Visibility.Visible)
            ?? (title.IsEnabled ? title : submit)).Focus(FocusState.Programmatic);
    });
}
