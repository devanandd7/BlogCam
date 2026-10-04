package com.cam2

import android.content.Context
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.SecureRandom

class BlogCamTorchModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  @ReactMethod
  fun generatePairingPin(promise: Promise) {
    promise.resolve(random.nextInt(10_000).toString().padStart(4, '0'))
  }

  @ReactMethod
  fun generateSessionToken(promise: Promise) {
    val bytes = ByteArray(32)
    random.nextBytes(bytes)
    promise.resolve(
      bytes.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) },
    )
  }

  @ReactMethod
  fun setKeepScreenOn(enabled: Boolean, promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("ACTIVITY_UNAVAILABLE", "The camera screen is not available.")
      return
    }

    activity.runOnUiThread {
      if (enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getNetworkIpAddresses(promise: Promise) {
    try {
      val array = com.facebook.react.bridge.Arguments.createArray()
      val interfaces = java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())
      for (intf in interfaces) {
        if (intf.isLoopback || !intf.isUp) continue
        val addrs = java.util.Collections.list(intf.inetAddresses)
        for (addr in addrs) {
          if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
            val host = addr.hostAddress
            if (host != null && !host.startsWith("127.") && !host.startsWith("169.254.")) {
              val map = com.facebook.react.bridge.Arguments.createMap()
              map.putString("name", intf.name)
              map.putString("displayName", intf.displayName)
              map.putString("address", host)
              array.pushMap(map)
            }
          }
        }
      }
      promise.resolve(array)
    } catch (e: Exception) {
      promise.resolve(com.facebook.react.bridge.Arguments.createArray())
    }
  }

  @ReactMethod
  fun hasFlash(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(false)
      return
    }

    try {
      promise.resolve(rearCameraFlashId() != null)
    } catch (error: CameraAccessException) {
      promise.reject("FLASH_CHECK_FAILED", "Could not check whether this device has a camera flash.", error)
    }
  }

  @ReactMethod
  fun setTorchEnabled(enabled: Boolean, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.reject("TORCH_UNAVAILABLE", "This Android version does not support camera flash controls.")
      return
    }

    try {
      val cameraManager =
        reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val cameraId = rearCameraFlashId(cameraManager)

      if (cameraId == null) {
        promise.reject("TORCH_UNAVAILABLE", "This device does not have a rear camera flash.")
        return
      }

      val handler = Handler(Looper.getMainLooper())
      var completed = false
      val callback = object : CameraManager.TorchCallback() {
        private fun finish(error: Throwable?) {
          if (completed) return
          completed = true
          handler.removeCallbacksAndMessages(null)
          cameraManager.unregisterTorchCallback(this)
          if (error == null) {
            promise.resolve(null)
          } else {
            promise.reject("TORCH_UNAVAILABLE", error.message, error)
          }
        }

        override fun onTorchModeChanged(changedCameraId: String, torchMode: Boolean) {
          if (changedCameraId == cameraId && torchMode == enabled) {
            finish(null)
          }
        }

        override fun onTorchModeUnavailable(changedCameraId: String) {
          if (changedCameraId == cameraId && enabled) {
            finish(
              IllegalStateException(
                "Android cannot enable the flash while this camera is streaming. This phone may require torch control integrated into the camera capture.",
              ),
            )
          }
        }
      }

      cameraManager.registerTorchCallback(callback, handler)
      handler.postDelayed(
        {
          if (!completed) {
            completed = true
            cameraManager.unregisterTorchCallback(callback)
            promise.reject(
              "TORCH_TIMEOUT",
              "The phone did not confirm that the rear camera flash changed state.",
            )
          }
        },
        2_000,
      )

      if (!completed) {
        cameraManager.setTorchMode(cameraId, enabled)
      }
    } catch (error: CameraAccessException) {
      promise.reject("TORCH_ERROR", "Could not change the camera flash.", error)
    } catch (error: SecurityException) {
      promise.reject("TORCH_PERMISSION_DENIED", "Camera permission is required to use the flash.", error)
    }
  }

  private fun rearCameraFlashId(
    cameraManager: CameraManager =
      reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager,
  ): String? {
    return cameraManager.cameraIdList.firstOrNull { cameraId ->
      val characteristics = cameraManager.getCameraCharacteristics(cameraId)
      characteristics.get(CameraCharacteristics.LENS_FACING) ==
        CameraCharacteristics.LENS_FACING_BACK &&
        characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
    }
  }

  companion object {
    const val NAME = "BlogCamTorch"
    private val random = SecureRandom()
  }
}
