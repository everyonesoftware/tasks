package com.everyonesoftware.daymark

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class AndroidRecords(context: Context): PrivateRecords {
 private val prefs=context.getSharedPreferences("daymark",Context.MODE_PRIVATE)
 override fun entries()=prefs.all.mapNotNull { (k,v) -> (v as? String)?.let { k to it } }.toMap()
 override fun put(key: String,value: String) { check(prefs.edit().putString(key,value).commit()) }
 override fun remove(key: String) { check(prefs.edit().remove(key).commit()) }
}
class KeystoreTokenCipher: TokenCipher {
 private fun key(): SecretKey {
  val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  return (store.getKey("daymark-session-v2",null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").run {
   init(KeyGenParameterSpec.Builder("daymark-session-v2",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());generateKey()
  }
 }
 override fun encrypt(value: String): String {
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key())
  return Base64.encodeToString(cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8)),Base64.NO_WRAP)
 }
 override fun decrypt(value: String): String {
  val bytes=Base64.decode(value,Base64.NO_WRAP);require(bytes.size>28)
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
  return cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)
 }
}
@Suppress("DEPRECATION")
class AndroidPackages(private val context: Context) {
 private val pm=context.packageManager
 private val flags=if(Build.VERSION.SDK_INT>=28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
 fun installedInfo(): PackageInfo = pm.getPackageInfo(context.packageName,flags)
 private fun identity(info: PackageInfo): ApkIdentity {
  val signatures=if(Build.VERSION.SDK_INT>=28) info.signingInfo?.apkContentsSigners else info.signatures
  return ApkIdentity(info.packageName,if(Build.VERSION.SDK_INT>=28) info.longVersionCode else info.versionCode.toLong(),signatures.orEmpty().map { signature -> MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet())
 }
 fun installed()=identity(installedInfo())
 fun inspect(file: File): ApkIdentity {
  val info=pm.getPackageArchiveInfo(file.absolutePath,flags) ?: error("Invalid APK")
  require((info.applicationInfo?.minSdkVersion ?: Int.MAX_VALUE)<=Build.VERSION.SDK_INT)
  return identity(info)
 }
 fun beginInstall(file: File) {
  require(file.isFile)
  if(installerAction(true,pm.canRequestPackageInstalls())==InstallAction.REQUEST_SOURCE_PERMISSION) {
   context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return
  }
  val uri=FileProvider.getUriForFile(context,"${context.packageName}.updates",file)
  context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
 }
}
