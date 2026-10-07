package com.cam2

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

object BlogCamAudioProcessor {
  private const val TAG = "BlogCamAudioProcessor"
  private const val TIMEOUT_US = 10_000L

  /**
   * Processes the recorded video's audio track:
   * 1. Low-cut / High-pass filter (120Hz) to eliminate fan/AC/rumble noise.
   * 2. Intelligent noise gate and attenuation (Deep Clean: ~0 noise, DSP: clean).
   * 3. Vocal presence clarity boost (2.4kHz peaking EQ).
   * 4. Loudness boost and smooth soft-knee limiter.
   * 5. Video direct-copy remuxing (zero video re-encoding, extremely fast).
   */
  fun processVideoAudio(
    inputPath: String,
    mode: String,
    voiceBoost: Boolean = true,
  ): String {
    val inputFile = File(inputPath)
    if (!inputFile.exists() || inputFile.length() == 0L) {
      Log.w(TAG, "Input file does not exist or is empty: $inputPath")
      return inputPath
    }

    if (mode == "off" || mode == "raw") {
      Log.i(TAG, "Audio mode is 'off'/'raw'. Skipping audio processing.")
      return inputPath
    }

    val outputPath = "${inputFile.parent}/enhanced_${System.currentTimeMillis()}_${inputFile.name}"
    val outputFile = File(outputPath)

    var extractor: MediaExtractor? = null
    var muxer: MediaMuxer? = null

    try {
      extractor = MediaExtractor()
      extractor.setDataSource(inputFile.absolutePath)

      var videoTrackIndex = -1
      var audioTrackIndex = -1
      var videoFormat: MediaFormat? = null
      var audioFormat: MediaFormat? = null

      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
        if (mime.startsWith("video/") && videoTrackIndex == -1) {
          videoTrackIndex = i
          videoFormat = format
        } else if (mime.startsWith("audio/") && audioTrackIndex == -1) {
          audioTrackIndex = i
          audioFormat = format
        }
      }

      if (audioTrackIndex == -1 || videoTrackIndex == -1 || videoFormat == null || audioFormat == null) {
        Log.w(TAG, "Video or audio track missing in input file. Returning original.")
        return inputPath
      }

      // Step 1: Decode all audio to PCM in memory
      val decodedAudio = decodeAudioToPcm(extractor, audioTrackIndex, audioFormat)
      if (decodedAudio == null || decodedAudio.pcmData.isEmpty()) {
        Log.w(TAG, "Failed to decode audio to PCM. Returning original.")
        return inputPath
      }

      val sampleRate = decodedAudio.sampleRate
      val channelCount = decodedAudio.channelCount
      val pcmBytes = decodedAudio.pcmData

      // Step 2: Apply DSP / Deep noise suppression and Voice Boost
      val enhancedPcm = enhancePcmAudio(pcmBytes, sampleRate, channelCount, mode, voiceBoost)

      // Step 3: Mux video and re-encoded AAC audio into output MP4
      muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

      encodeAndMux(
        extractor = extractor,
        videoTrackIndex = videoTrackIndex,
        videoFormat = videoFormat,
        enhancedPcm = enhancedPcm,
        sampleRate = sampleRate,
        channelCount = channelCount,
        muxer = muxer,
      )

      Log.i(TAG, "Audio processing complete! Enhanced video saved: ${outputFile.absolutePath}")
      return outputFile.absolutePath
    } catch (e: Throwable) {
      Log.e(TAG, "Error while processing audio in video: ${e.message}", e)
      if (outputFile.exists()) {
        outputFile.delete()
      }
      return inputPath // Graceful fallback: return original video
    } finally {
      try {
        extractor?.release()
      } catch (_: Throwable) {}
    }
  }

  private class DecodedAudio(
    val pcmData: ByteArray,
    val sampleRate: Int,
    val channelCount: Int,
  )

  private fun decodeAudioToPcm(
    extractor: MediaExtractor,
    audioTrackIndex: Int,
    audioFormat: MediaFormat,
  ): DecodedAudio? {
    val mime = audioFormat.getString(MediaFormat.KEY_MIME) ?: return null
    val sampleRate = if (audioFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
      audioFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    } else 48000
    val channelCount = if (audioFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
      audioFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    } else 1

    extractor.selectTrack(audioTrackIndex)
    var decoder: MediaCodec? = null
    val pcmOutputStream = ByteArrayOutputStream()

    try {
      decoder = MediaCodec.createDecoderByType(mime)
      decoder.configure(audioFormat, null, null, 0)
      decoder.start()

      val bufferInfo = MediaCodec.BufferInfo()
      var isInputEos = false
      var isOutputEos = false

      while (!isOutputEos) {
        if (!isInputEos) {
          val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val inBuffer = decoder.getInputBuffer(inIndex)
            if (inBuffer != null) {
              inBuffer.clear()
              val sampleSize = extractor.readSampleData(inBuffer, 0)
              if (sampleSize < 0) {
                decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                isInputEos = true
              } else {
                decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }
        }

        val outIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
        if (outIndex >= 0) {
          val outBuffer = decoder.getOutputBuffer(outIndex)
          if (outBuffer != null && bufferInfo.size > 0) {
            outBuffer.position(bufferInfo.offset)
            outBuffer.limit(bufferInfo.offset + bufferInfo.size)
            val chunk = ByteArray(bufferInfo.size)
            outBuffer.get(chunk)
            pcmOutputStream.write(chunk)
          }
          decoder.releaseOutputBuffer(outIndex, false)
          if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
            isOutputEos = true
          }
        }
      }

      val pcmBytes = pcmOutputStream.toByteArray()
      return DecodedAudio(pcmBytes, sampleRate, channelCount)
    } finally {
      try {
        decoder?.stop()
        decoder?.release()
      } catch (_: Throwable) {}
      extractor.unselectTrack(audioTrackIndex)
    }
  }

  /**
   * Applies:
   * 1. 120Hz Butterworth High-Pass Biquad (eliminates fan/AC rumble)
   * 2. Adaptive Noise Gating & Subtraction (Deep Clean: ~0 noise, DSP: balanced)
   * 3. 2.4kHz Vocal Clarity Peaking EQ
   * 4. Voice Boost Volume Gain (+5dB) & Soft-Knee Limiter
   */
  private const val FFT_SIZE = 512
  private const val HOP_SIZE = 256

  private fun runFft(real: FloatArray, imag: FloatArray, n: Int, inverse: Boolean) {
    var j = 0
    for (i in 0 until n - 1) {
      if (i < j) {
        val tempR = real[i]; real[i] = real[j]; real[j] = tempR
        val tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI
      }
      var k = n shr 1
      while (k <= j) {
        j -= k
        k = k shr 1
      }
      j += k
    }

    var step = 1
    while (step < n) {
      val halfStep = step
      step = step shl 1
      val theta = (if (inverse) 2.0 else -2.0) * Math.PI / step
      val wStepR = cos(theta).toFloat()
      val wStepI = sin(theta).toFloat()

      var k = 0
      while (k < n) {
        var wR = 1.0f
        var wI = 0.0f
        for (m in 0 until halfStep) {
          val uR = real[k + m]
          val uI = imag[k + m]
          val tR = wR * real[k + m + halfStep] - wI * imag[k + m + halfStep]
          val tI = wR * imag[k + m + halfStep] + wI * real[k + m + halfStep]

          real[k + m] = uR + tR
          imag[k + m] = uI + tI
          real[k + m + halfStep] = uR - tR
          imag[k + m + halfStep] = uI - tI

          val nextWR = wR * wStepR - wI * wStepI
          val nextWI = wR * wStepI + wI * wStepR
          wR = nextWR
          wI = nextWI
        }
        k += step
      }
    }

    if (inverse) {
      val invN = 1.0f / n
      for (i in 0 until n) {
        real[i] *= invN
        imag[i] *= invN
      }
    }
  }

  /**
   * Applies Multi-Band Spectral Subtraction (Frequency-Domain Filtering):
   * 1. 85Hz Butterworth High-Pass Filter (eliminates desk vibrations, wind & sub-rumble)
   * 2. STFT Analysis (512-point FFT, 50% overlap, Hanning window)
   * 3. Ambient Room Noise Spectrum Profiling across quiet frames
   * 4. Multi-band Wiener/Spectral Subtraction per frequency bin (eliminates fan/AC
   *    noise even WHILE the speaker is talking, without chopping syllables)
   * 5. Time & Frequency Gain Smoothing (prevents musical noise / chirping)
   * 6. Speech Formant Enhancement & Voice Boost (+4dB clarity at 1.8k-3.2kHz)
   * 7. Synthesis Overlap-Add (OLA) reconstruction & soft-knee peak limiter
   */
  private fun enhancePcmAudio(
    pcmBytes: ByteArray,
    sampleRate: Int,
    channelCount: Int,
    mode: String,
    voiceBoost: Boolean,
  ): ByteArray {
    if (pcmBytes.isEmpty()) return pcmBytes

    val totalShorts = pcmBytes.size / 2
    val samples = ShortArray(totalShorts)
    ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)

    val samplesPerChannel = totalShorts / channelCount
    if (samplesPerChannel < FFT_SIZE) {
      return pcmBytes // Clip too short to perform STFT
    }

    // 1. De-interleave into per-channel float buffers
    val channelData = Array(channelCount) { FloatArray(samplesPerChannel) }
    for (i in 0 until samplesPerChannel) {
      for (ch in 0 until channelCount) {
        channelData[ch][i] = samples[i * channelCount + ch].toFloat()
      }
    }

    // 2. High-Pass Filter Coefficients (85 Hz Butterworth)
    val hpCutoff = 85.0
    val hpW0 = 2.0 * Math.PI * hpCutoff / sampleRate
    val hpAlpha = sin(hpW0) / (2.0 * 0.7071)
    val hpCosW0 = cos(hpW0)
    val hpB0 = ((1.0 + hpCosW0) / 2.0).toFloat()
    val hpB1 = (-(1.0 + hpCosW0)).toFloat()
    val hpB2 = ((1.0 + hpCosW0) / 2.0).toFloat()
    val hpA0 = (1.0 + hpAlpha).toFloat()
    val hpA1 = (-2.0 * hpCosW0).toFloat()
    val hpA2 = (1.0 - hpAlpha).toFloat()

    // 3. Precompute Hanning window
    val window = FloatArray(FFT_SIZE)
    for (i in 0 until FFT_SIZE) {
      window[i] = (0.5 * (1.0 - cos(2.0 * Math.PI * i / FFT_SIZE))).toFloat()
    }

    val numBins = FFT_SIZE / 2 + 1
    val isDeep = mode == "deep"
    val overSubFactor = if (isDeep) 2.2f else 1.5f
    val spectralFloor = if (isDeep) 0.02f else 0.06f // -34dB for deep (~0 noise), -24dB for dsp

    val binHz = sampleRate.toFloat() / FFT_SIZE
    val kBoostStart = (1800.0f / binHz).toInt().coerceIn(0, numBins - 1)
    val kBoostEnd = (3200.0f / binHz).toInt().coerceIn(0, numBins - 1)

    val frontPad = HOP_SIZE
    val paddedLength = frontPad + samplesPerChannel + FFT_SIZE

    val rBuf = FloatArray(FFT_SIZE)
    val iBuf = FloatArray(FFT_SIZE)

    // Process each channel independently
    for (ch in 0 until channelCount) {
      val chSig = channelData[ch]

      // Apply 85Hz High-Pass Filter
      var hpX1 = 0.0f; var hpX2 = 0.0f
      var hpY1 = 0.0f; var hpY2 = 0.0f
      for (i in 0 until samplesPerChannel) {
        val x0 = chSig[i]
        val y0 = (hpB0 / hpA0) * x0 + (hpB1 / hpA0) * hpX1 + (hpB2 / hpA0) * hpX2 -
                 (hpA1 / hpA0) * hpY1 - (hpA2 / hpA0) * hpY2
        hpX2 = hpX1; hpX1 = x0
        hpY2 = hpY1; hpY1 = y0
        chSig[i] = y0
      }

      // Build padded buffer with mirror front
      val padded = FloatArray(paddedLength)
      for (i in 0 until frontPad) {
        padded[i] = chSig[min(frontPad - 1 - i, samplesPerChannel - 1)]
      }
      System.arraycopy(chSig, 0, padded, frontPad, samplesPerChannel)

      // STFT Analysis: collect all frame magnitudes and energies
      val frameMagnitudes = ArrayList<FloatArray>()
      val frameEnergies = ArrayList<Pair<Int, Float>>()
      var start = 0
      var frameIdx = 0

      while (start + FFT_SIZE <= paddedLength) {
        var energy = 0.0f
        for (i in 0 until FFT_SIZE) {
          val s = padded[start + i] * window[i]
          rBuf[i] = s
          iBuf[i] = 0.0f
          energy += s * s
        }
        runFft(rBuf, iBuf, FFT_SIZE, false)

        val mags = FloatArray(numBins)
        for (k in 0 until numBins) {
          mags[k] = sqrt(rBuf[k] * rBuf[k] + iBuf[k] * iBuf[k])
        }
        frameMagnitudes.add(mags)
        frameEnergies.add(Pair(frameIdx, energy))
        frameIdx++
        start += HOP_SIZE
      }

      // Noise profile estimation from quietest 20% frames
      val sortedByEnergy = frameEnergies.sortedBy { it.second }
      val quietCount = max(1, (sortedByEnergy.size * 0.20).toInt())
      val noiseProfile = FloatArray(numBins)
      for (idx in 0 until quietCount) {
        val fIndex = sortedByEnergy[idx].first
        val fMags = frameMagnitudes[fIndex]
        for (k in 0 until numBins) {
          noiseProfile[k] += fMags[k]
        }
      }
      for (k in 0 until numBins) {
        noiseProfile[k] = max(noiseProfile[k] / quietCount, 0.05f)
      }

      // Spectral Subtraction & Overlap-Add Synthesis
      val prevGain = FloatArray(numBins) { spectralFloor }
      val outPadded = FloatArray(paddedLength)
      start = 0

      for (fIndex in 0 until frameMagnitudes.size) {
        val mags = frameMagnitudes[fIndex]
        for (i in 0 until FFT_SIZE) {
          rBuf[i] = padded[start + i] * window[i]
          iBuf[i] = 0.0f
        }
        runFft(rBuf, iBuf, FFT_SIZE, false)

        // Raw multi-band spectral subtraction gain
        val rawGains = FloatArray(numBins)
        for (k in 0 until numBins) {
          val sMag = mags[k]
          val nMag = noiseProfile[k]
          val snr = sMag / nMag

          val g: Float
          if (snr > 1.8f) {
            val sub = 1.0f - (overSubFactor * nMag) / max(sMag, 1e-4f)
            g = max(spectralFloor, sub)
          } else if (snr < 1.15f) {
            g = spectralFloor
          } else {
            val t = (snr - 1.15f) / (1.8f - 1.15f)
            val smoothT = t * t * (3.0f - 2.0f * t)
            val sub = 1.0f - (overSubFactor * nMag) / max(sMag, 1e-4f)
            val targetG = max(spectralFloor, sub)
            g = spectralFloor + (targetG - spectralFloor) * smoothT
          }
          rawGains[k] = g
        }

        // Frequency smoothing across adjacent bins
        val freqSmoothGains = FloatArray(numBins)
        for (k in 0 until numBins) {
          val left = if (k > 0) rawGains[k - 1] else rawGains[0]
          val right = if (k < numBins - 1) rawGains[k + 1] else rawGains[numBins - 1]
          freqSmoothGains[k] = 0.20f * left + 0.60f * rawGains[k] + 0.20f * right
        }

        // Time smoothing & voice clarity boost
        for (k in 0 until numBins) {
          val targetG = freqSmoothGains[k]
          val alphaTime = if (targetG > prevGain[k]) 0.40f else 0.15f
          var finalG = prevGain[k] + alphaTime * (targetG - prevGain[k])

          if (voiceBoost && k in kBoostStart..kBoostEnd && finalG > 0.4f) {
            finalG = min(1.6f, finalG * 1.55f)
          }

          prevGain[k] = finalG

          rBuf[k] *= finalG
          iBuf[k] *= finalG
          if (k > 0 && k < FFT_SIZE / 2) {
            rBuf[FFT_SIZE - k] *= finalG
            iBuf[FFT_SIZE - k] *= finalG
          }
        }

        runFft(rBuf, iBuf, FFT_SIZE, true)

        for (i in 0 until FFT_SIZE) {
          outPadded[start + i] += rBuf[i]
        }
        start += HOP_SIZE
      }

      // Copy unpadded section back into channelData
      for (i in 0 until samplesPerChannel) {
        chSig[i] = outPadded[frontPad + i]
      }
    }

    // 4. Re-interleave into ShortArray with soft-knee peak limiter
    val globalGain = if (voiceBoost) 1.25f else 1.0f
    for (i in 0 until samplesPerChannel) {
      for (ch in 0 until channelCount) {
        val rawSample = channelData[ch][i] * globalGain
        val normalized = rawSample / 32767.0f
        val limited = if (normalized > 0.85f) {
          val over = normalized - 0.85f
          0.85f + 0.14f * (1.0f - exp(-over / 0.14f))
        } else if (normalized < -0.85f) {
          val under = -normalized - 0.85f
          -(0.85f + 0.14f * (1.0f - exp(-under / 0.14f)))
        } else {
          normalized
        }
        samples[i * channelCount + ch] = (limited * 32767.0f).toInt().coerceIn(-32768, 32767).toShort()
      }
    }

    val outputBytes = ByteArray(totalShorts * 2)
    ByteBuffer.wrap(outputBytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(samples)
    return outputBytes
  }

  private fun encodeAndMux(
    extractor: MediaExtractor,
    videoTrackIndex: Int,
    videoFormat: MediaFormat,
    enhancedPcm: ByteArray,
    sampleRate: Int,
    channelCount: Int,
    muxer: MediaMuxer,
  ) {
    val encoderFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channelCount)
    encoderFormat.setInteger(MediaFormat.KEY_BIT_RATE, 192000)
    encoderFormat.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)

    var encoder: MediaCodec? = null

    try {
      encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
      encoder.configure(encoderFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      encoder.start()

      var muxerStarted = false
      var muxerAudioTrack = -1
      var muxerVideoTrack = -1

      val bufferInfo = MediaCodec.BufferInfo()
      val pcmBuffer = ByteBuffer.wrap(enhancedPcm)
      var isInputEos = false
      var isEncoderOutputEos = false
      var audioSamplesWritten = 0L

      // Feed initial input to let encoder output format initialize
      while (!muxerStarted) {
        if (!isInputEos && pcmBuffer.hasRemaining()) {
          val inIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val inBuf = encoder.getInputBuffer(inIndex)
            if (inBuf != null) {
              inBuf.clear()
              val toWrite = min(inBuf.remaining(), pcmBuffer.remaining())
              val temp = ByteArray(toWrite)
              pcmBuffer.get(temp)
              inBuf.put(temp)

              val pts = (audioSamplesWritten * 1_000_000L) / (sampleRate * channelCount * 2)
              audioSamplesWritten += toWrite

              val flags = if (!pcmBuffer.hasRemaining()) {
                isInputEos = true
                MediaCodec.BUFFER_FLAG_END_OF_STREAM
              } else 0

              encoder.queueInputBuffer(inIndex, 0, toWrite, pts, flags)
            }
          }
        }

        val outIndex = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
        if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val actualAudioFormat = encoder.outputFormat
          muxerAudioTrack = muxer.addTrack(actualAudioFormat)
          muxerVideoTrack = muxer.addTrack(videoFormat)
          muxer.start()
          muxerStarted = true
        } else if (outIndex >= 0) {
          // Format not yet changed, release buffer
          encoder.releaseOutputBuffer(outIndex, false)
        }
      }

      // Encode remaining audio and write to muxer
      while (!isEncoderOutputEos) {
        if (!isInputEos) {
          val inIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val inBuf = encoder.getInputBuffer(inIndex)
            if (inBuf != null) {
              inBuf.clear()
              if (pcmBuffer.hasRemaining()) {
                val toWrite = min(inBuf.remaining(), pcmBuffer.remaining())
                val temp = ByteArray(toWrite)
                pcmBuffer.get(temp)
                inBuf.put(temp)

                val pts = (audioSamplesWritten * 1_000_000L) / (sampleRate * channelCount * 2)
                audioSamplesWritten += toWrite

                val flags = if (!pcmBuffer.hasRemaining()) {
                  isInputEos = true
                  MediaCodec.BUFFER_FLAG_END_OF_STREAM
                } else 0

                encoder.queueInputBuffer(inIndex, 0, toWrite, pts, flags)
              } else {
                encoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                isInputEos = true
              }
            }
          }
        }

        val outIndex = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
        if (outIndex >= 0) {
          val outBuf = encoder.getOutputBuffer(outIndex)
          if (outBuf != null && bufferInfo.size > 0 && (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
            outBuf.position(bufferInfo.offset)
            outBuf.limit(bufferInfo.offset + bufferInfo.size)
            muxer.writeSampleData(muxerAudioTrack, outBuf, bufferInfo)
          }
          encoder.releaseOutputBuffer(outIndex, false)
          if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
            isEncoderOutputEos = true
          }
        }
      }

      // Step 4: Direct-copy video track samples from extractor to muxer
      extractor.selectTrack(videoTrackIndex)
      val videoBuffer = ByteBuffer.allocateDirect(1024 * 1024)
      val videoBufferInfo = MediaCodec.BufferInfo()

      while (true) {
        videoBuffer.clear()
        val sampleSize = extractor.readSampleData(videoBuffer, 0)
        if (sampleSize < 0) {
          break
        }
        videoBufferInfo.offset = 0
        videoBufferInfo.size = sampleSize
        videoBufferInfo.presentationTimeUs = extractor.sampleTime
        videoBufferInfo.flags = extractor.sampleFlags

        muxer.writeSampleData(muxerVideoTrack, videoBuffer, videoBufferInfo)
        extractor.advance()
      }
      extractor.unselectTrack(videoTrackIndex)

      muxer.stop()
      muxer.release()
    } finally {
      try {
        encoder?.stop()
        encoder?.release()
      } catch (_: Throwable) {}
    }
  }
}
