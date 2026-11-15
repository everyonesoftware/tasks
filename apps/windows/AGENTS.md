# Windows client working rules

- This is the selected **Familiar** native WinUI approach. Keep exploration controls and sample tasks out of production.
- `Tasks.Core` owns protocol/authentication, in-memory task state, and focus ordering. `Tasks.App` owns WinUI controls and Windows session protection. Never persist task payloads or ordering.
- Read `../../contracts/auth-and-updates.md` and `README.md` before changing authentication/storage. Use one protected endpoint/account/session envelope, not separately committed secrets and preferences. No password storage, certificate bypass, credential redirects, or raw exception logging.
- Strict vertical RED/GREEN tests for every behavior slice. Run core/storage C# tests and `node --test ../../tests/windows/*.test.mjs`.
- Linux compilation is only a C# gate: `dotnet build Tasks.App/Tasks.App.csproj -c Release -p:OutputType=Library -p:WindowsAppSDKSelfContained=false -p:PrepareForRunDependsOn=CopyFilesToOutputDirectory`. Never apply those overrides to Windows releases.
- Native builds retain self-contained deployment and merged WinUI PRI generation. `build.ps1` requires Windows and checks actual output inventory. Native launch/XAML, data protection, rendering, and installation are separate acceptance gates.
- Installer packaging uses `scripts/build-windows-installer.ps1 -BuildNumber N -AllowUnsigned` and `installer/Tasks.iss`. Preserve the stable Windows AppId and per-user install location; uninstall must not delete the separately protected session directory. Require real self-contained x64 files and merged PRI, never Linux compile-only output.
- The combined release job waits for Android and Windows. Installer upload is gated on the real, isolated hosted-Windows install/render/close/uninstall script; diagnostics stay separate from release files. No personal-machine install/profile cleanup is authorized by a test command.
- No Windows updater feed exists yet. Do not consume the Android manifest or fabricate release availability. No commit, push, publication, installation, or live-account/database modification without authorization.
