import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
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

type CaptureMode = 'photo' | 'video';
type FlashMode = 'off' | 'auto' | 'on';
type RecentCapture = { uri: string; type: CaptureMode };

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
        onRecordingFinished: video => {
          setIsRecording(false);
          saveToGallery(video.path, 'video');
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
              isActive
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
            <View style={styles.topBar}>
              <View>
                <Text style={styles.brand}>BLOGCAM</Text>
                <Text style={styles.brandCaption}>BY PRIMADEX</Text>
              </View>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
});

export default App;
