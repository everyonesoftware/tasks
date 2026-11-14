package com.everyonesoftware.daymark
import org.junit.Assert.*
import org.junit.Test
class InstallerPolicyTest {
 @Test fun installerNeedsVerifiedFileAndExplicitUserPermission() {
  assertEquals(InstallAction.NONE,installerAction(false,false))
  assertEquals(InstallAction.NONE,installerAction(false,true))
  assertEquals(InstallAction.REQUEST_SOURCE_PERMISSION,installerAction(true,false))
  assertEquals(InstallAction.OPEN_SYSTEM_INSTALLER,installerAction(true,true))
 }
}
