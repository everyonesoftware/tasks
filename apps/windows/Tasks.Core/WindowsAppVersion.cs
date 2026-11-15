using System.Reflection;

namespace Tasks.Core;

public sealed record WindowsAppVersion(string Display, int? BuildNumber)
{
    public static WindowsAppVersion FromAssembly(Assembly assembly) => Parse(
        assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version ?? "0.0.0.0",
        assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? string.Empty);

    public static WindowsAppVersion Parse(string fileVersion, string informationalVersion)
    {
        if (!Version.TryParse(fileVersion, out var version))
            return new("Version unknown · Development build", null);
        var label = $"{version.Major}.{version.Minor}.{Math.Max(0, version.Build)}";
        var prefix = label + "+";
        var sourceStamped = informationalVersion.StartsWith(prefix, StringComparison.Ordinal)
            && informationalVersion.Length == prefix.Length + 40
            && informationalVersion[prefix.Length..].All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
        var build = version.Major == 0 && version.Minor == 1 && version.Build is >= 1 and <= 65534 && version.Revision == 0
            && sourceStamped ? version.Build : (int?)null;
        return new($"Version {label} · " + (build is { } number ? $"Build {number}" : "Development build"), build);
    }
}
