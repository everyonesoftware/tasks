using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;

namespace Tasks.App;

internal static class Program
{
    [STAThread]
    public static void Main()
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(callback =>
        {
            SynchronizationContext.SetSynchronizationContext(
                new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
            _ = new TasksApplication();
        });
    }
}

public sealed partial class TasksApplication : Application, IXamlMetadataProvider
{
    private readonly Microsoft.UI.Xaml.XamlTypeInfo.XamlControlsXamlMetaDataProvider metadata = new();
    private MainWindow? window;

    public IXamlType GetXamlType(Type type) => metadata.GetXamlType(type);
    public IXamlType GetXamlType(string name) => metadata.GetXamlType(name);
    public XmlnsDefinition[] GetXmlnsDefinitions() => metadata.GetXmlnsDefinitions();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // Application resources are available only after the WinUI core has launched.
        Resources.MergedDictionaries.Add(new XamlControlsResources());
        Resources["SystemAccentColor"] = Windows.UI.Color.FromArgb(255, 190, 223, 199);
        window = new MainWindow();
        window.Activate();
    }
}
