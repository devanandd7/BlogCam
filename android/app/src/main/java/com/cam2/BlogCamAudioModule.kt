package com.cam2

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MicrophoneInfo
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BlogCamAudioModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val audioManager: AudioManager by lazy {
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  }

  companion object {
    const val NAME = "BlogCamAudioModule"
    @Volatile
    var currentAudioMode: String = "dsp" // "off", "dsp", "deep"
  }

  override fun getName() = NAME

  @ReactMethod
  fun checkAudioCapabilities(promise: Promise) {
    try {
      val map = Arguments.createMap()

      val hasNs = try {
        NoiseSuppressor.isAvailable()
      } catch (_: Throwable) {
        false
      }

      val hasAec = try {
        AcousticEchoCanceler.isAvailable()
      } catch (_: Throwable) {
        false
      }

      val hasAgc = try {
        AutomaticGainControl.isAvailable()
      } catch (_: Throwable) {
        false
      }

      var micCount = 1
      var micDetails = "Standard built-in microphone"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        try {
          val mics = audioManager.microphones
          if (mics != null && mics.isNotEmpty()) {
            micCount = mics.size
            micDetails = if (micCount > 1) {
              "Multi-microphone array ($micCount mics with hardware beamforming)"
            } else {
              "Single built-in microphone"
            }
          }
        } catch (_: Throwable) {
        }
      }

      val brand = Build.MANUFACTURER.replaceFirstChar { 
        if (it.isLowerCase()) it.titlecase() else it.toString() 
      }
      val device = "$brand ${Build.MODEL}"

      map.putBoolean("hasHardwareNoiseSuppressor", hasNs)
      map.putBoolean("hasAcousticEchoCanceler", hasAec)
      map.putBoolean("hasAutomaticGainControl", hasAgc)
      map.putInt("microphoneCount", micCount)
      map.putString("micDetails", micDetails)
      map.putString("deviceModel", device)
      map.putInt("androidVersion", Build.VERSION.SDK_INT)
      map.putString("currentAudioMode", currentAudioMode)

      // Hardware recommendation
      val recommendedMode = if (hasNs) "dsp" else "raw"
      map.putString("recommendedMode", recommendedMode)

      promise.resolve(map)
    } catch (e: Throwable) {
      promise.reject("AUDIO_CHECK_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun setAudioMode(mode: String, promise: Promise) {
    val normalized = mode.lowercase().trim()
    currentAudioMode = when (normalized) {
      "off", "raw" -> "off"
      "deep", "deepfilter", "ai" -> "deep"
      else -> "dsp"
    }

    promise.resolve(currentAudioMode)
  }

  @ReactMethod
  fun getAudioMode(promise: Promise) {
    promise.resolve(currentAudioMode)
  }
}
