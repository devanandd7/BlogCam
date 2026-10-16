package com.cam2

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BlogCamHardwareModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BlogCamHardware"

  @ReactMethod
  fun getHardwareStats(promise: Promise) {
    try {
      val map = Arguments.createMap()

      // 1. Battery Temp & Level via sticky ACTION_BATTERY_CHANGED intent
      val batteryIntent: Intent? = reactContext.registerReceiver(
        null,
        IntentFilter(Intent.ACTION_BATTERY_CHANGED)
      )
      if (batteryIntent != null) {
        val rawTemp = batteryIntent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
        val tempC = rawTemp / 10.0f
        val level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val status = batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                         status == BatteryManager.BATTERY_STATUS_FULL

        val batteryPct = if (level >= 0 && scale > 0) {
          ((level.toFloat() / scale.toFloat()) * 100).toInt()
        } else {
          level
        }

        map.putDouble("batteryTempC", tempC.toDouble())
        map.putInt("batteryLevel", batteryPct)
        map.putBoolean("isCharging", isCharging)
      } else {
        map.putDouble("batteryTempC", 0.0)
        map.putInt("batteryLevel", -1)
        map.putBoolean("isCharging", false)
      }

      // 2. RAM Information
      val activityManager = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      if (activityManager != null) {
        val memInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memInfo)
        val totalMb = (memInfo.totalMem / (1024 * 1024)).toInt()
        val availMb = (memInfo.availMem / (1024 * 1024)).toInt()
        val usedMb = totalMb - availMb

        map.putInt("totalMemoryMB", totalMb)
        map.putInt("usedMemoryMB", usedMb)
        map.putInt("freeMemoryMB", availMb)
        map.putBoolean("isLowMemory", memInfo.lowMemory)
      }

      // 3. Thermal Throttling Status (Android 10+ / API 29+)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (powerManager != null) {
          val thermal = powerManager.currentThermalStatus
          val thermalStr = when (thermal) {
            PowerManager.THERMAL_STATUS_NONE -> "NONE"
            PowerManager.THERMAL_STATUS_LIGHT -> "LIGHT"
            PowerManager.THERMAL_STATUS_MODERATE -> "MODERATE"
            PowerManager.THERMAL_STATUS_SEVERE -> "SEVERE_THROTTLING"
            PowerManager.THERMAL_STATUS_CRITICAL -> "CRITICAL"
            PowerManager.THERMAL_STATUS_EMERGENCY -> "EMERGENCY"
            PowerManager.THERMAL_STATUS_SHUTDOWN -> "SHUTDOWN"
            else -> "UNKNOWN"
          }
          map.putString("thermalStatus", thermalStr)
          map.putInt("thermalStatusCode", thermal)
        } else {
          map.putString("thermalStatus", "UNSUPPORTED")
          map.putInt("thermalStatusCode", 0)
        }
      } else {
        map.putString("thermalStatus", "UNSUPPORTED")
        map.putInt("thermalStatusCode", 0)
      }

      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("HARDWARE_STATS_ERROR", e.message, e)
    }
  }
}
