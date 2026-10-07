import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  type CameraDevice,
  type CameraPosition,
} from 'react-native-vision-camera';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import RemoteControlSession from './RemoteControlSession';

type CaptureMode = 'photo' | 'video';
type FlashMode = 'off' | 'auto' | 'on';
type RecentCapture = { uri: string; type: CaptureMode };
type AudioMode = 'off' | 'dsp' | 'deep';

type AudioCapability = {
  hasHardwareNoiseSuppressor: boolean;
  hasAcousticEchoCanceler: boolean;
  hasAutomaticGainControl: boolean;
  microphoneCount: number;
  micDetails: string;
  deviceModel: string;
  androidVersion: number;
  currentAudioMode: AudioMode;
  recommendedMode: 'dsp' | 'raw';
};

function fileUri(path: string) {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function App() {
  return (
    <SafeAreaProvider>
      <CameraScreen />
    </SafeAreaProvider>
  );
}

const CAMERA_HANDOFF_TIMEOUT_MS = 2500;

function CameraScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<Camera>(null);
  const [facing, setFacing] = useState<CameraPosition>('back');
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [zoom, setZoom] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recentCapture, setRecentCapture] = useState<RecentCapture | null>(
    null,
  );
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remoteMode, setRemoteMode] = useState(false);
  const [isHandingOffCamera, setIsHandingOffCamera] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioMode>('dsp');
  const [voiceBoost, setVoiceBoost] = useState(true);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [processingTitle, setProcessingTitle] = useState('');
  const [processingSubtitle, setProcessingSubtitle] = useState('');
  const [audioCapability, setAudioCapability] =
    useState<AudioCapability | null>(null);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showDeepFilterWarning, setShowDeepFilterWarning] = useState(false);
  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const {
    hasPermission: hasMicrophonePermission,
    requestPermission: requestMicrophonePermission,
  } = useMicrophonePermission();

  const device = useCameraDevice(facing);
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const canFlip = Boolean(frontDevice && backDevice);
  const canUseFlash = Boolean(
    device &&
      facing === 'back' &&
      (mode === 'photo' ? device.hasFlash : device.hasTorch),
  );

  useEffect(() => {
    if (!hasPermission) {
      requestPermission().catch(error => {
        setErrorMessage(
          `Could not request camera permission: ${error.message}`,
        );
      });
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }

    const timer = setInterval(
      () => setRecordingSeconds(seconds => seconds + 1),
      1000,
    );
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    if (!isHandingOffCamera) {
      return;
    }

    const timeout = setTimeout(() => {
      setIsHandingOffCamera(false);
      setRemoteMode(true);
    }, CAMERA_HANDOFF_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isHandingOffCamera]);

  useEffect(() => {
    if (facing === 'front') {
      setFlash('off');
    }
    setZoom(device?.neutralZoom ?? 1);
    setIsReady(false);
  }, [device, facing]);

  useEffect(() => {
    if (!focusPoint) {
      return;
    }
    const timeout = setTimeout(() => setFocusPoint(null), 900);
    return () => clearTimeout(timeout);
  }, [focusPoint]);

  useEffect(() => {
    if (Platform.OS === 'android' && NativeModules.BlogCamAudioModule) {
      NativeModules.BlogCamAudioModule.checkAudioCapabilities()
        .then((caps: AudioCapability) => {
          setAudioCapability(caps);
          const initialMode =
            caps.currentAudioMode === 'off' || caps.currentAudioMode === 'deep'
              ? caps.currentAudioMode
              : caps.hasHardwareNoiseSuppressor
              ? 'dsp'
              : 'off';
          setAudioMode(initialMode);
          if (caps.hasHardwareNoiseSuppressor) {
            setStartupNotice(
              `🎙 ${caps.deviceModel}: Hardware DSP Active (0% CPU, No Lag)`,
            );
          } else {
            setStartupNotice(
              `⚠️ ${caps.deviceModel}: Hardware DSP not found. Raw/Deep mode ready.`,
            );
          }
          const timer = setTimeout(() => setStartupNotice(null), 5000);
          return () => clearTimeout(timer);
        })
        .catch((error: Error) => {
          console.warn(`Audio diagnostic check failed: ${error.message}`);
        });
    }
  }, []);

  const handleSelectAudioMode = (nextMode: AudioMode) => {
    if (nextMode === 'deep') {
      setShowDeepFilterWarning(true);
      return;
    }
    applyAudioMode(nextMode);
  };

  const applyAudioMode = async (nextMode: AudioMode) => {
    setAudioMode(nextMode);
    if (Platform.OS === 'android' && NativeModules.BlogCamAudioModule) {
      await NativeModules.BlogCamAudioModule.setAudioMode(nextMode).catch(
        (error: Error) => {
          console.warn(`Failed to set audio mode: ${error.message}`);
        },
      );
    }
  };

  const saveToGallery = async (path: string, type: CaptureMode) => {
    try {
      if (Platform.OS === 'android' && Number(Platform.Version) < 29) {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        ];
        const results = await PermissionsAndroid.requestMultiple(permissions);
        if (
          permissions.some(
            permission =>
              results[permission] !== PermissionsAndroid.RESULTS.GRANTED,
          )
        ) {
          throw new Error('Gallery storage permission was not granted.');
        }
      }
      const asset = await CameraRoll.saveAsset(fileUri(path), {
        type,
        album: 'BlogCam',
      });
      setRecentCapture({ uri: asset.node.image.uri, type });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        `The ${type} was captured but could not be saved to your gallery: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const changeMode = async (nextMode: CaptureMode) => {
    if (nextMode === 'video' && !hasMicrophonePermission) {
      const granted = await requestMicrophonePermission().catch(error => {
        setErrorMessage(
          `Could not request microphone permission: ${error.message}`,
        );
        return false;
      });
      if (!granted) {
        setErrorMessage('Allow microphone access to record videos with sound.');
        return;
      }
    }
    setMode(nextMode);
    if (nextMode === 'video' && flash === 'auto') {
      setFlash('off');
    }
    setErrorMessage(null);
  };

  const flipCamera = () => {
    if (!canFlip || isRecording || isCapturing) {
      return;
    }
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const cycleFlash = () => {
    setFlash(current => {
      if (mode === 'video') {
        return current === 'on' ? 'off' : 'on';
      }
      return current === 'off' ? 'auto' : current === 'auto' ? 'on' : 'off';
    });
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || isCapturing || !isReady) {
      return;
    }
    setIsCapturing(true);
    setErrorMessage(null);
    try {
      const photo = await cameraRef.current.takePhoto({
        flash: facing === 'back' ? flash : 'off',
      });
      await saveToGallery(photo.path, 'photo');
    } catch (error) {
      setErrorMessage(
        `Could not capture photo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setIsCapturing(false);
    }
  };

  const toggleRecording = async () => {
    const camera = cameraRef.current;
    if (!camera || !isReady || isCapturing) {
      return;
    }
    setErrorMessage(null);

    if (isRecording) {
      try {
        await camera.stopRecording();
      } catch (error) {
        setIsRecording(false);
        setErrorMessage(
          `Could not stop recording: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return;
    }

    if (!hasMicrophonePermission) {
      const granted = await requestMicrophonePermission().catch(error => {
        setErrorMessage(
          `Could not request microphone permission: ${error.message}`,
        );
        return false;
      });
      if (!granted) {
        setErrorMessage('Allow microphone access before recording a video.');
        return;
      }
    }

    try {
      camera.startRecording({
        flash: facing === 'back' && flash === 'on' ? 'on' : 'off',
        onRecordingFinished: async video => {
          setIsRecording(false);
          let videoToSave = video.path;
          if (
            audioMode !== 'off' &&
            Platform.OS === 'android' &&
            NativeModules.BlogCamAudioModule
          ) {
            setIsProcessingAudio(true);
            setProcessingTitle(
              audioMode === 'deep'
                ? 'DEEP NOISE CLEANING'
                : 'DSP AUDIO POLISHING',
            );
            setProcessingSubtitle(
              audioMode === 'deep'
                ? 'Eliminating background noise to zero & boosting voice…'
                : 'Filtering ambient hum & boosting speech clarity…',
            );
            try {
              const result =
                await NativeModules.BlogCamAudioModule.processVideoAudio(
                  video.path,
                  { mode: audioMode, voiceBoost },
                );
              if (result?.outputPath) {
                videoToSave = result.outputPath;
              }
            } catch (err) {
              console.warn(
                'Audio post-processing failed, saving original:',
                err,
              );
            } finally {
              setIsProcessingAudio(false);
            }
          }
          await saveToGallery(videoToSave, 'video');
        },
        onRecordingError: error => {
          setIsRecording(false);
          setErrorMessage(`Recording failed: ${error.message}`);
        },
      });
      setIsRecording(true);
    } catch (error) {
      setIsRecording(false);
      setErrorMessage(
        `Could not start recording: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const focusAtPoint = (x: number, y: number) => {
    if (!device?.supportsFocus || !cameraRef.current) {
      return;
    }
    setFocusPoint({ x, y });
    cameraRef.current.focus({ x, y }).catch(error => {
      setErrorMessage(`Could not focus camera: ${error.message}`);
    });
  };

  const adjustZoom = (direction: -1 | 1, currentDevice: CameraDevice) => {
    const step = Math.max(
      (currentDevice.maxZoom - currentDevice.minZoom) / 20,
      0.05,
    );
    setZoom(current =>
      Math.min(
        currentDevice.maxZoom,
        Math.max(currentDevice.minZoom, current + direction * step),
      ),
    );
  };

  const openRecentCapture = () => {
    if (!recentCapture) {
      return;
    }
    Alert.alert(
      recentCapture.type === 'photo' ? 'Photo saved' : 'Video saved',
      'Your capture is in the BlogCam album in your device gallery.',
    );
  };

  if (remoteMode) {
    return <RemoteControlSession onStop={() => setRemoteMode(false)} />;
  }

  if (!hasPermission) {
    return (
      <View style={[styles.permissionScreen, { paddingTop: insets.top + 32 }]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.permissionIcon}>◉</Text>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionCopy}>
          Allow camera access to take photos and record videos.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            requestPermission().catch(error =>
              setErrorMessage(
                `Could not request camera permission: ${error.message}`,
              ),
            );
          }}
          style={styles.permissionButton}
        >
          <Text style={styles.permissionButtonText}>Allow camera</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            Linking.openSettings().catch(error =>
              setErrorMessage(`Could not open settings: ${error.message}`),
            );
          }}
          style={styles.settingsButton}
        >
          <Text style={styles.settingsButtonText}>Open settings</Text>
        </Pressable>
        {errorMessage ? (
          <Text style={styles.permissionError}>{errorMessage}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" hidden />
      {device ? (
        <>
          <View
            style={StyleSheet.absoluteFill}
            onTouchEnd={event =>
              focusAtPoint(
                event.nativeEvent.locationX,
                event.nativeEvent.locationY,
              )
            }
          >
            <Camera
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={!isHandingOffCamera}
              photo
              video
              audio={hasMicrophonePermission}
              torch={
                facing === 'back' &&
                device.hasTorch &&
                mode === 'video' &&
                flash === 'on'
                  ? 'on'
                  : 'off'
              }
              zoom={zoom}
              enableZoomGesture
              onInitialized={() => setIsReady(true)}
              onStopped={() => {
                if (isHandingOffCamera) {
                  setIsHandingOffCamera(false);
                  setRemoteMode(true);
                }
              }}
              onError={error =>
                setErrorMessage(`Camera error: ${error.message}`)
              }
            />
          </View>
          {focusPoint ? (
            <View
              pointerEvents="none"
              style={[
                styles.focusRing,
                { left: focusPoint.x - 26, top: focusPoint.y - 26 },
              ]}
            />
          ) : null}
          <View
            pointerEvents="box-none"
            style={[
              styles.overlay,
              {
                paddingTop: insets.top + 12,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            {isHandingOffCamera ? (
              <View style={styles.handoffNotice}>
                <ActivityIndicator color="#efbd75" />
                <Text style={styles.handoffText}>Switching camera…</Text>
              </View>
            ) : null}
            {startupNotice ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open audio diagnostic details"
                onPress={() => {
                  setStartupNotice(null);
                  setShowAudioModal(true);
                }}
                style={styles.startupNoticePill}
              >
                <Text style={styles.startupNoticeText}>{startupNotice}</Text>
                <Text style={styles.startupNoticeAction}>DETAILS ›</Text>
              </Pressable>
            ) : null}
            <View style={styles.topBar}>
              <View>
                <Text style={styles.brand}>BLOGCAM</Text>
                <Text style={styles.brandCaption}>BY PRIMADEX</Text>
              </View>
              <View style={styles.topActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Audio noise suppression mode: ${audioMode.toUpperCase()}`}
                  onPress={() => setShowAudioModal(true)}
                  style={[
                    styles.audioButton,
                    audioMode === 'dsp' && styles.audioButtonDsp,
                    audioMode === 'deep' && styles.audioButtonDeep,
                  ]}
                >
                  <Text style={styles.audioButtonIcon}>🎙</Text>
                  <Text style={styles.audioButtonLabel}>
                    {audioMode === 'dsp'
                      ? 'DSP'
                      : audioMode === 'deep'
                      ? 'AI'
                      : 'RAW'}
                  </Text>
                </Pressable>
                {Platform.OS === 'android' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start remote camera controls"
                    disabled={
                      !isReady ||
                      isRecording ||
                      isCapturing ||
                      isHandingOffCamera
                    }
                    onPress={() => setIsHandingOffCamera(true)}
                    style={[
                      styles.remoteButton,
                      (!isReady || isRecording || isCapturing) &&
                        styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.remoteButtonText}>REMOTE</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Flash ${flash}`}
                  disabled={!canUseFlash}
                  onPress={cycleFlash}
                  style={[
                    styles.roundButton,
                    !canUseFlash && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.roundButtonIcon}>ϟ</Text>
                  <Text style={styles.flashLabel}>{flash.toUpperCase()}</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.centerControls}>
              {device.maxZoom > device.minZoom ? (
                <View style={styles.zoomControl}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Zoom out"
                    onPress={() => adjustZoom(-1, device)}
                    style={styles.zoomButton}
                  >
                    <Text style={styles.zoomButtonText}>−</Text>
                  </Pressable>
                  <Text style={styles.zoomValue}>{zoom.toFixed(1)}×</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Zoom in"
                    onPress={() => adjustZoom(1, device)}
                    style={styles.zoomButton}
                  >
                    <Text style={styles.zoomButtonText}>+</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={styles.bottomPanel}>
              {errorMessage ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss message"
                  onPress={() => setErrorMessage(null)}
                  style={styles.errorBanner}
                >
                  <Text style={styles.errorText}>{errorMessage} ×</Text>
                </Pressable>
              ) : null}
              <View style={styles.modeSelector}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === 'photo' }}
                  onPress={() => {
                    changeMode('photo');
                  }}
                  style={[
                    styles.modeButton,
                    mode === 'photo' && styles.activeMode,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeText,
                      mode === 'photo' && styles.activeModeText,
                    ]}
                  >
                    PHOTO
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === 'video' }}
                  onPress={() => {
                    changeMode('video');
                  }}
                  style={[
                    styles.modeButton,
                    mode === 'video' && styles.activeMode,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeText,
                      mode === 'video' && styles.activeModeText,
                    ]}
                  >
                    VIDEO
                  </Text>
                </Pressable>
              </View>

              <View style={styles.captureRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open latest capture"
                  onPress={openRecentCapture}
                  style={styles.thumbnailButton}
                >
                  {recentCapture?.type === 'photo' ? (
                    <Image
                      source={{ uri: recentCapture.uri }}
                      style={styles.thumbnail}
                    />
                  ) : recentCapture?.type === 'video' ? (
                    <Text style={styles.videoThumbnailIcon}>▶</Text>
                  ) : (
                    <Text style={styles.galleryPlaceholder}>▧</Text>
                  )}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'photo'
                      ? 'Take photo'
                      : isRecording
                      ? 'Stop recording'
                      : 'Start recording'
                  }
                  disabled={!isReady || isCapturing}
                  onPress={() => {
                    if (mode === 'photo') {
                      capturePhoto();
                    } else {
                      toggleRecording();
                    }
                  }}
                  style={[
                    styles.shutterOuter,
                    (!isReady || isCapturing) && styles.disabledButton,
                  ]}
                >
                  <View
                    style={[
                      styles.shutterInner,
                      mode === 'video' && styles.videoShutter,
                      isRecording && styles.recordingShutter,
                    ]}
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Flip camera"
                  disabled={!canFlip || isRecording || isCapturing}
                  onPress={flipCamera}
                  style={[
                    styles.roundButton,
                    (!canFlip || isRecording) && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.flipIcon}>↻</Text>
                </Pressable>
              </View>

              <View style={styles.footer}>
                {isRecording ? (
                  <View style={styles.recordingTimer}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.footerLabel}>
                      {formatDuration(recordingSeconds)}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.footerLabel}>
                    {isReady ? 'TAP TO FOCUS' : 'STARTING CAMERA…'}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.unavailableScreen}>
          <Text style={styles.permissionIcon}>◉</Text>
          <Text style={styles.permissionTitle}>Camera unavailable</Text>
          <Text style={styles.permissionCopy}>
            This device does not have a {facing} camera available.
          </Text>
          {canFlip ? (
            <Pressable accessibilityRole="button" onPress={flipCamera}>
              <Text style={styles.settingsButtonText}>
                Try the other camera
              </Text>
            </Pressable>
          ) : null}
          {errorMessage ? (
            <Text style={styles.permissionError}>{errorMessage}</Text>
          ) : null}
        </View>
      )}

      {/* Audio Diagnostics & Noise Suppression Sheet */}
      <Modal
        animationType="slide"
        transparent
        visible={showAudioModal}
        onRequestClose={() => setShowAudioModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>AUDIO NOISE SUPPRESSION</Text>
                <Text style={styles.modalSubtitle}>
                  HARDWARE DSP & ACOUSTIC DIAGNOSTICS
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close audio settings"
                onPress={() => setShowAudioModal(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.modalScroll}
            >
              {/* Diagnostic Card */}
              <View style={styles.diagnosticCard}>
                <View style={styles.diagnosticHeader}>
                  <Text style={styles.diagnosticDeviceTitle}>
                    {audioCapability?.deviceModel || 'Android Device'}
                  </Text>
                  <View
                    style={[
                      styles.diagnosticBadge,
                      audioCapability?.hasHardwareNoiseSuppressor
                        ? styles.diagnosticBadgeSuccess
                        : styles.diagnosticBadgeWarning,
                    ]}
                  >
                    <Text style={styles.diagnosticBadgeText}>
                      {audioCapability?.hasHardwareNoiseSuppressor
                        ? 'DSP READY'
                        : 'NO HARDWARE DSP'}
                    </Text>
                  </View>
                </View>

                <View style={styles.diagnosticDetailsList}>
                  <View style={styles.diagnosticItem}>
                    <Text style={styles.diagnosticLabel}>
                      Hardware Noise Suppressor
                    </Text>
                    <Text
                      style={[
                        styles.diagnosticValue,
                        audioCapability?.hasHardwareNoiseSuppressor
                          ? styles.statusPositive
                          : styles.statusNegative,
                      ]}
                    >
                      {audioCapability?.hasHardwareNoiseSuppressor
                        ? 'Supported (Built-in DSP)'
                        : 'Not Supported on Chipset'}
                    </Text>
                  </View>
                  <View style={styles.diagnosticItem}>
                    <Text style={styles.diagnosticLabel}>
                      Acoustic Echo Canceler
                    </Text>
                    <Text
                      style={[
                        styles.diagnosticValue,
                        audioCapability?.hasAcousticEchoCanceler
                          ? styles.statusPositive
                          : styles.statusNegative,
                      ]}
                    >
                      {audioCapability?.hasAcousticEchoCanceler
                        ? 'Supported (Hardware AEC)'
                        : 'Unavailable'}
                    </Text>
                  </View>
                  <View style={styles.diagnosticItem}>
                    <Text style={styles.diagnosticLabel}>
                      Microphones Detected
                    </Text>
                    <Text style={styles.diagnosticValue}>
                      {audioCapability?.micDetails || '1 built-in microphone'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Modes Selection */}
              <Text style={styles.sectionHeader}>SELECT AUDIO MODE</Text>

              {/* Mode 1: DSP Hardware */}
              <Pressable
                accessibilityRole="button"
                disabled={!audioCapability?.hasHardwareNoiseSuppressor}
                onPress={() => {
                  handleSelectAudioMode('dsp');
                }}
                style={[
                  styles.optionCard,
                  audioMode === 'dsp' && styles.optionCardSelected,
                  !audioCapability?.hasHardwareNoiseSuppressor &&
                    styles.optionCardDisabled,
                ]}
              >
                <View style={styles.optionHeader}>
                  <View style={styles.optionTitleRow}>
                    <Text style={styles.optionTitle}>DSP Hardware (Clean)</Text>
                    <View style={styles.badgeRecommended}>
                      <Text style={styles.badgeRecommendedText}>
                        RECOMMENDED
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.radioCircle,
                      audioMode === 'dsp' && styles.radioCircleSelected,
                    ]}
                  />
                </View>
                <Text style={styles.optionDescription}>
                  Uses your phone's secondary microphone and DSP chipset to
                  subtract fan, AC, and ambient room noise in real-time with 0%
                  CPU load and zero battery drain.
                </Text>
                {!audioCapability?.hasHardwareNoiseSuppressor ? (
                  <Text style={styles.unsupportedWarning}>
                    ⚠️ Your device's audio chipset does not support hardware
                    noise cancellation.
                  </Text>
                ) : null}
              </Pressable>

              {/* Mode 2: Off (Raw) */}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  handleSelectAudioMode('off');
                }}
                style={[
                  styles.optionCard,
                  audioMode === 'off' && styles.optionCardSelected,
                ]}
              >
                <View style={styles.optionHeader}>
                  <View style={styles.optionTitleRow}>
                    <Text style={styles.optionTitle}>Off (Raw Audio)</Text>
                    <View style={styles.badgeNeutral}>
                      <Text style={styles.badgeNeutralText}>AUTHENTIC</Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.radioCircle,
                      audioMode === 'off' && styles.radioCircleSelected,
                    ]}
                  />
                </View>
                <Text style={styles.optionDescription}>
                  Original unaltered sound from the microphone. Preserves all
                  room ambiance, live music, and acoustic reverberation without
                  filtering.
                </Text>
              </Pressable>

              {/* Mode 3: Deep Filter (Studio AI) */}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  handleSelectAudioMode('deep');
                }}
                style={[
                  styles.optionCard,
                  audioMode === 'deep' && styles.optionCardSelectedDeep,
                ]}
              >
                <View style={styles.optionHeader}>
                  <View style={styles.optionTitleRow}>
                    <Text style={styles.optionTitle}>
                      Deep Filter (Studio AI)
                    </Text>
                    <View style={styles.badgeAi}>
                      <Text style={styles.badgeAiText}>AI FILTER</Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.radioCircle,
                      audioMode === 'deep' && styles.radioCircleSelectedDeep,
                    ]}
                  />
                </View>
                <Text style={styles.optionDescription}>
                  Neural software voice isolation. Detects human speech
                  frequencies and aggressively eliminates non-vocal background
                  noise.
                </Text>
                <View style={styles.deepFilterNotice}>
                  <Text style={styles.deepFilterNoticeText}>
                    ⚠️ High CPU & Battery Warning: Takes 1–3s of post-recording
                    processing and increases phone battery consumption on longer
                    videos.
                  </Text>
                </View>
              </Pressable>

              {/* Speech Amplification & Voice Boost Toggle */}
              <Text style={styles.sectionHeader}>SPEECH AMPLIFICATION & CLARITY</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Voice Boost is ${voiceBoost ? 'enabled' : 'disabled'}`}
                onPress={() => setVoiceBoost(prev => !prev)}
                style={[
                  styles.voiceBoostCard,
                  voiceBoost && styles.voiceBoostCardActive,
                ]}
              >
                <View style={styles.voiceBoostHeader}>
                  <View style={styles.voiceBoostTitleRow}>
                    <Text style={styles.voiceBoostTitle}>
                      Voice Boost (Loud & Clear)
                    </Text>
                    <View
                      style={
                        voiceBoost
                          ? styles.badgeRecommended
                          : styles.badgeNeutral
                      }
                    >
                      <Text
                        style={
                          voiceBoost
                            ? styles.badgeRecommendedText
                            : styles.badgeNeutralText
                        }
                      >
                        {voiceBoost ? 'BOOST ON (+5dB)' : 'OFF'}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.toggleSwitch,
                      voiceBoost && styles.toggleSwitchActive,
                    ]}
                  >
                    <View
                      style={[
                        styles.toggleThumb,
                        voiceBoost && styles.toggleThumbActive,
                      ]}
                    />
                  </View>
                </View>
                <Text style={styles.voiceBoostDescription}>
                  Amplifies human speech presence (2.4 kHz) and applies dynamic soft-knee leveling so your voice is loud, crisp, and clear without distortion.
                </Text>
              </Pressable>
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAudioModal(false)}
              style={styles.modalDoneButton}
            >
              <Text style={styles.modalDoneText}>DONE</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Deep Filter Advisory Dialog */}
      <Modal
        animationType="fade"
        transparent
        visible={showDeepFilterWarning}
        onRequestClose={() => setShowDeepFilterWarning(false)}
      >
        <View style={styles.alertBackdrop}>
          <View style={styles.alertCard}>
            <View style={styles.alertIconContainer}>
              <Text style={styles.alertIcon}>⚠️</Text>
            </View>
            <Text style={styles.alertTitle}>High CPU & Battery Advisory</Text>
            <Text style={styles.alertMessage}>
              Deep Filter performs software neural processing on every audio
              frame. On longer video recordings, this will warm up your device,
              increase battery drain, and require 1–3 seconds to save after
              stopping.
              {'\n\n'}
              If your device has Hardware DSP (recommended), it provides
              crystal-clear noise reduction with 0% extra battery drain.
            </Text>
            <View style={styles.alertActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowDeepFilterWarning(false)}
                style={styles.alertCancelButton}
              >
                <Text style={styles.alertCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setShowDeepFilterWarning(false);
                  applyAudioMode('deep');
                }}
                style={styles.alertConfirmButton}
              >
                <Text style={styles.alertConfirmText}>Enable Deep Filter</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Audio Processing Overlay Modal */}
      <Modal
        animationType="fade"
        transparent
        visible={isProcessingAudio}
      >
        <View style={styles.processingBackdrop}>
          <View style={styles.processingCard}>
            <View style={styles.processingIconRing}>
              <ActivityIndicator color="#efbd75" size="large" />
            </View>
            <Text style={styles.processingTitle}>{processingTitle}</Text>
            <Text style={styles.processingSubtitle}>
              {processingSubtitle}
            </Text>
            <View style={styles.processingBadge}>
              <Text style={styles.processingBadgeText}>
                {voiceBoost ? '⚡ VOCAL CLARITY BOOST ACTIVE' : '✨ CLEAN AUDIO'}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#07090c',
  },
  permissionScreen: {
    flex: 1,
    backgroundColor: '#07090c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  unavailableScreen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#07090c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionIcon: {
    color: '#e9b86e',
    fontSize: 50,
    marginBottom: 20,
  },
  permissionTitle: {
    color: '#fff',
    fontSize: 23,
    fontWeight: '700',
    marginBottom: 10,
  },
  permissionCopy: {
    color: '#a8abb2',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: '#e9b86e',
    borderRadius: 24,
    paddingVertical: 13,
    paddingHorizontal: 30,
  },
  permissionButtonText: {
    color: '#16120d',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsButton: {
    padding: 16,
  },
  settingsButtonText: {
    color: '#e9b86e',
    fontSize: 14,
    fontWeight: '600',
  },
  permissionError: {
    color: '#ff9999',
    textAlign: 'center',
    marginTop: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  handoffNotice: {
    position: 'absolute',
    alignSelf: 'center',
    top: '48%',
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: 'rgba(12, 13, 16, 0.82)',
  },
  handoffText: {
    color: '#f3d09b',
    fontSize: 13,
    fontWeight: '700',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brand: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
  },
  brandCaption: {
    color: '#ff3b30',
    fontSize: 8,
    letterSpacing: 2,
    marginTop: 4,
  },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(12, 13, 16, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteButton: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 19,
    backgroundColor: 'rgba(12, 13, 16, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(239, 189, 117, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteButtonText: {
    color: '#f3d09b',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  roundButtonIcon: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 22,
  },
  flashLabel: {
    color: '#f3d09b',
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginTop: 1,
  },
  disabledButton: {
    opacity: 0.45,
  },
  centerControls: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  zoomControl: {
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(12, 13, 16, 0.55)',
    paddingVertical: 5,
  },
  zoomButton: {
    width: 38,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '400',
  },
  zoomValue: {
    color: '#f3d09b',
    fontSize: 11,
    fontWeight: '700',
  },
  bottomPanel: {
    paddingBottom: 4,
  },
  errorBanner: {
    backgroundColor: 'rgba(80, 24, 24, 0.9)',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  errorText: {
    color: '#ffe0e0',
    fontSize: 12,
    lineHeight: 17,
  },
  modeSelector: {
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(12, 13, 16, 0.58)',
    padding: 4,
    borderRadius: 22,
    marginBottom: 18,
  },
  modeButton: {
    minWidth: 82,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 18,
  },
  activeMode: {
    backgroundColor: '#f2c078',
  },
  modeText: {
    color: '#e5e1dc',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  activeModeText: {
    color: '#17120a',
  },
  captureRow: {
    height: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  thumbnailButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(12, 13, 16, 0.62)',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  galleryPlaceholder: {
    color: '#fff',
    fontSize: 22,
  },
  videoThumbnailIcon: {
    color: '#fff',
    fontSize: 18,
  },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  videoShutter: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#f15e54',
  },
  recordingShutter: {
    width: 25,
    height: 25,
    borderRadius: 6,
  },
  flipIcon: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 32,
  },
  footer: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  footerLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  recordingTimer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#f15e54',
    marginRight: 8,
  },
  focusRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderColor: '#f3d09b',
    borderWidth: 1.5,
    borderRadius: 4,
  },
  startupNoticePill: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 20, 26, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(56, 229, 142, 0.4)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  startupNoticeText: {
    color: '#e5e1dc',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  startupNoticeAction: {
    color: '#38e58e',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 8,
    letterSpacing: 0.8,
  },
  audioButton: {
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    backgroundColor: 'rgba(12, 13, 16, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  audioButtonDsp: {
    borderColor: 'rgba(56, 229, 142, 0.8)',
    backgroundColor: 'rgba(16, 36, 25, 0.75)',
  },
  audioButtonDeep: {
    borderColor: 'rgba(168, 85, 247, 0.8)',
    backgroundColor: 'rgba(38, 20, 54, 0.75)',
  },
  audioButtonIcon: {
    fontSize: 12,
  },
  audioButtonLabel: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#12141a',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  modalSubtitle: {
    color: '#e9b86e',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#a8abb2',
    fontSize: 13,
    fontWeight: '700',
  },
  modalScroll: {
    marginBottom: 16,
  },
  diagnosticCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 18,
  },
  diagnosticHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  diagnosticDeviceTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  diagnosticBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  diagnosticBadgeSuccess: {
    backgroundColor: 'rgba(56, 229, 142, 0.18)',
    borderWidth: 1,
    borderColor: '#38e58e',
  },
  diagnosticBadgeWarning: {
    backgroundColor: 'rgba(239, 189, 117, 0.18)',
    borderWidth: 1,
    borderColor: '#e9b86e',
  },
  diagnosticBadgeText: {
    color: '#38e58e',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  diagnosticDetailsList: {
    gap: 8,
  },
  diagnosticItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  diagnosticLabel: {
    color: '#8b8e96',
    fontSize: 12,
  },
  diagnosticValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statusPositive: {
    color: '#38e58e',
    fontWeight: '700',
  },
  statusNegative: {
    color: '#f87171',
    fontWeight: '700',
  },
  sectionHeader: {
    color: '#6f737d',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 4,
  },
  optionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  optionCardSelected: {
    borderColor: '#38e58e',
    backgroundColor: 'rgba(56, 229, 142, 0.07)',
  },
  optionCardSelectedDeep: {
    borderColor: '#a855f7',
    backgroundColor: 'rgba(168, 85, 247, 0.07)',
  },
  optionCardDisabled: {
    opacity: 0.4,
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  badgeRecommended: {
    backgroundColor: 'rgba(56, 229, 142, 0.18)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeRecommendedText: {
    color: '#38e58e',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  badgeNeutral: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeNeutralText: {
    color: '#a8abb2',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  badgeAi: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeAiText: {
    color: '#c084fc',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  radioCircleSelected: {
    borderColor: '#38e58e',
    backgroundColor: '#38e58e',
  },
  radioCircleSelectedDeep: {
    borderColor: '#a855f7',
    backgroundColor: '#a855f7',
  },
  optionDescription: {
    color: '#9ba1ad',
    fontSize: 11,
    lineHeight: 16,
  },
  unsupportedWarning: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 6,
  },
  deepFilterNotice: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  deepFilterNoticeText: {
    color: '#fbbf24',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  modalDoneButton: {
    backgroundColor: '#e9b86e',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDoneText: {
    color: '#16120d',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  alertBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  alertCard: {
    backgroundColor: '#161922',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(239, 189, 117, 0.3)',
  },
  alertIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 189, 117, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  alertIcon: {
    fontSize: 22,
  },
  alertTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  alertMessage: {
    color: '#b0b5c1',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 20,
  },
  alertActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  alertCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)' ,
  },
  alertCancelText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  alertConfirmButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#a855f7',
  },
  alertConfirmText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  voiceBoostCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  voiceBoostCardActive: {
    borderColor: '#38e58e',
    backgroundColor: 'rgba(56, 229, 142, 0.06)',
  },
  voiceBoostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  voiceBoostTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceBoostTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  toggleSwitch: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchActive: {
    backgroundColor: '#38e58e',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleThumbActive: {
    alignSelf: 'flex-end',
  },
  voiceBoostDescription: {
    color: '#9ba1ad',
    fontSize: 11,
    lineHeight: 16,
  },
  processingBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  processingCard: {
    backgroundColor: '#13161f',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 189, 117, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  processingIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 189, 117, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  processingTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 8,
  },
  processingSubtitle: {
    color: '#a8abb2',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  processingBadge: {
    backgroundColor: 'rgba(56, 229, 142, 0.15)',
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 229, 142, 0.3)',
  },
  processingBadgeText: {
    color: '#38e58e',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});

export default App;

