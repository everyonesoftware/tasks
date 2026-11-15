using System.Reflection;
using Tasks.Core;
using Xunit;

namespace Tasks.Core.Tests;

public class WindowsVersionTests
{
    [Fact]
    public void Reads_the_running_assembly_release_identity()
    {
        var version = WindowsAppVersion.FromAssembly(typeof(WindowsVersionTests).Assembly);
        Assert.Contains("Version", version.Display);
        Assert.Null(version.BuildNumber); // Test assembly is not a packaged Tasks release.
    }

    [Theory]
    [InlineData("0.1.15.0", "0.1.15+0123456789abcdef0123456789abcdef01234567", 15, "Version 0.1.15 · Build 15")]
    [InlineData("0.1.0.0", "0.1.0+0123456789abcdef0123456789abcdef01234567", null, "Version 0.1.0 · Development build")]
    [InlineData("1.2.15.0", "1.2.15", null, "Version 1.2.15 · Development build")]
    public void Only_the_packaged_version_scheme_is_comparable(string file, string info, int? build, string display)
    {
        var version = WindowsAppVersion.Parse(file, info);
        Assert.Equal(build, version.BuildNumber);
        Assert.Equal(display, version.Display);
    }

    [Theory]
    [InlineData("0.1.15+")]
    [InlineData("0.1.15+not-a-source-sha")]
    [InlineData("0.1.15+0123456789ABCDEF0123456789ABCDEF01234567")]
    [InlineData("0.1.16+0123456789abcdef0123456789abcdef01234567")]
    public void Unrecognized_source_identity_is_a_development_build(string informational)
    {
        Assert.Null(WindowsAppVersion.Parse("0.1.15.0", informational).BuildNumber);
    }
}
