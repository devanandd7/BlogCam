import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
  useMicrophonePermission,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import { NetworkInfo } from 'react-native-network-info';
import {
  BridgeServer,
  type Request,
  type Response,
} from 'react-native-http-bridge-refurbished';
import {
  mediaDevices,
  RTCSessionDescription,
  RTCPeerConnection,
  type MediaStream,
  type RTCPeerConnection as RTCPeerConnectionType,
} from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import remoteControlPage from './remote-control-page';

const PORT = 8000;
const MAX_PIN_ATTEMPTS = 5;
const MAX_API_BODY_LENGTH = 6_100_000;
type CaptureMode = 'photo' | 'video';
type RecordingState = 'idle' | 'preparing' | 'recording' | 'paused';
type PreviewProfile = {
  width: number;
  height: number;
  frameRate: number;
};
type ActionRequest = {
  action?: string;
  pin?: string;
  token?: string;
  sdp?: string;
  enabled?: boolean;
  image?: string;
  mode?: CaptureMode;
  seconds?: number;
};

const LIVE_PREVIEW_PROFILE: PreviewProfile = {
  width: 1280,
  height: 720,
  frameRate: 24,
};
const webRtcFrameProcessorPlugin = VisionCameraProxy.initFrameProcessorPlugin(
  'blogcamWebRtc',
  {},
);

type PendingOffer = {
  id: string;
  sdp: string;
  resolve: (result: { answer: string | null; error?: string }) => void;
};

type Props = {
  onStop: () => void;
};

function fileUri(path: string) {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function waitForIceGathering(peer: RTCPeerConnectionType, timeoutMs = 10_000) {
  if (peer.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const previousListener = peer.onicegatheringstatechange;
    const timeout = setTimeout(() => {
      peer.onicegatheringstatechange = previousListener;
      reject(
        new Error(
          'Camera connection timed out while gathering network routes.',
        ),
      );
    }, timeoutMs);

    const checkState = () => {
      if (peer.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        peer.onicegatheringstatechange = previousListener;
        resolve();
      }
    };

    peer.onicegatheringstatechange = checkState;
  });
}

function respondError(response: Response, message: string, status = 400) {
  response.json({ error: message }, status);
}

function isUsableIpv4Address(address: string | null): address is string {
  if (!address || address === '0.0.0.0' || address === '127.0.0.1') {
    return false;
  }
  const octets = address.split('.');
  return (
    octets.length === 4 &&
    octets.every(
      octet =>
        /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255,
    ) &&
    !address.startsWith('169.254.')
  );
}

async function findPhoneIpv4Address(): Promise<string | null> {
  try {
    const address = await Promise.race([
      NetworkInfo.getIPV4Address(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 3_000)),
    ]);
    if (isUsableIpv4Address(address)) {
      return address;
    }
  } catch {
    // Try the interface-based lookup below when Wi-Fi lookup is unavailable.
  }
  try {
    const address = await Promise.race([
      NetworkInfo.getIPAddress(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 3_000)),
    ]);
    return isUsableIpv4Address(address) ? address : null;
  } catch {
    return null;
  }
}

export default function RemoteControlSession({ onStop }: Props) {
  const insets = useSafeAreaInsets();
  const nativeCameraRef = useRef<Camera>(null);
  const {
    hasPermission: hasMicrophonePermission,
    requestPermission: requestMicrophonePermission,
  } = useMicrophonePermission();
  const [nativeAudioEnabled, setNativeAudioEnabled] = useState(
    hasMicrophonePermission,
  );
  const [servicePin, setServicePin] = useState('----');
  const [serverUrl, setServerUrl] = useState('');
  const [serverStarted, setServerStarted] = useState(false);
  const [isFindingAddress, setIsFindingAddress] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Starting camera…');
  const [errorMessage, setErrorMessage] = useState('');
  const [isBrowserConnected, setIsBrowserConnected] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const nativeCameraDevice = useCameraDevice(
    cameraFacing === 'front' ? 'front' : 'back',
  );
  const nativeCameraFormat = React.useMemo(() => {
    if (!nativeCameraDevice?.formats?.length) {
      return undefined;
    }
    const exact720p = nativeCameraDevice.formats.filter(
      format =>
        ((format.videoWidth === LIVE_PREVIEW_PROFILE.width &&
          format.videoHeight === LIVE_PREVIEW_PROFILE.height) ||
          (format.videoWidth === LIVE_PREVIEW_PROFILE.height &&
            format.videoHeight === LIVE_PREVIEW_PROFILE.width)) &&
        format.maxFps >= LIVE_PREVIEW_PROFILE.frameRate,
    );
    if (exact720p.length > 0) {
      return exact720p.sort((left, right) => right.maxFps - left.maxFps)[0];
    }
    const under720p = nativeCameraDevice.formats
      .filter(
        format =>
          Math.max(format.videoWidth, format.videoHeight) <=
            LIVE_PREVIEW_PROFILE.width &&
          Math.min(format.videoWidth, format.videoHeight) <=
            LIVE_PREVIEW_PROFILE.height &&
          format.maxFps >= LIVE_PREVIEW_PROFILE.frameRate,
      )
      .sort(
        (left, right) =>
          right.videoWidth * right.videoHeight -
            left.videoWidth * left.videoHeight || right.maxFps - left.maxFps,
      );
    if (under720p.length > 0) {
      return under720p[0];
    }
    const fallback1080p = nativeCameraDevice.formats
      .filter(
        format =>
          Math.max(format.videoWidth, format.videoHeight) <= 1920 &&
          Math.min(format.videoWidth, format.videoHeight) <= 1080 &&
          format.maxFps >= LIVE_PREVIEW_PROFILE.frameRate,
      )
      .sort(
        (left, right) =>
          left.videoWidth * left.videoHeight -
            right.videoWidth * right.videoHeight || right.maxFps - left.maxFps,
      );
    if (fallback1080p.length > 0) {
      return fallback1080p[0];
    }
    return nativeCameraDevice.formats[0];
  }, [nativeCameraDevice]);
  const nativeRecordingFps = nativeCameraFormat
    ? Math.max(
        nativeCameraFormat.minFps,
        Math.min(30, nativeCameraFormat.maxFps),
      )
    : 30;
  const nativeCameraConfigRef = useRef({
    device: nativeCameraDevice,
    format: nativeCameraFormat,
  });
  nativeCameraConfigRef.current = {
    device: nativeCameraDevice,
    format: nativeCameraFormat,
  };
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [nativeCameraMounted, setNativeCameraMounted] = useState(false);
  const [nativeCameraActive, setNativeCameraActive] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const serverRef = useRef<BridgeServer | null>(null);
  const peerRef = useRef<RTCPeerConnectionType | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const offersRef = useRef<PendingOffer[]>([]);
  const tokenRef = useRef('');
  const servicePinRef = useRef('');
  const pinAttemptsRef = useRef(0);
  const pinLockedRef = useRef(false);
  const pinUsedRef = useRef(false);
  const facingRef = useRef<'user' | 'environment'>('environment');
  const flashRef = useRef(false);
  const nativeCameraMountedRef = useRef(false);
  const nativeCameraReadyRef = useRef(false);
  const nativeCameraReadyResolverRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const nativeFinishResolverRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const openWebRtcCameraRef = useRef<() => Promise<void>>(async () => {});
  const releaseWebRtcCameraRef = useRef<() => void>(() => {});
  const stopNativeRecordingForCleanupRef = useRef<() => void>(() => {});
  const countdownExpectedRef = useRef(0);
  const lastCountdownAtRef = useRef(0);
  const captureModeRef = useRef<CaptureMode>('photo');
  const recordingStateRef = useRef<RecordingState>('idle');
  const isBrowserConnectedRef = useRef(false);
  const setMode = (mode: CaptureMode) => {
    captureModeRef.current = mode;
    setCaptureMode(mode);
  };
  const setRecording = (state: RecordingState) => {
    recordingStateRef.current = state;
    setRecordingState(state);
  };
  const setNativeCameraMountState = (mounted: boolean) => {
    nativeCameraMountedRef.current = mounted;
    setNativeCameraMounted(mounted);
  };
  const frameProcessor = useMemo(
    () => ({
      frameProcessor: (frame: any) => {
        'worklet';
        webRtcFrameProcessorPlugin?.call(frame);
      },
      type: 'readonly' as const,
    }),
    [],
  );
  const setBrowserConnected = (connected: boolean) => {
    isBrowserConnectedRef.current = connected;
    setIsBrowserConnected(connected);
    if (!connected) {
      setRecording('idle');
      setCountdownSeconds(0);
    }
  };

  const refreshServerAddress = async () => {
    setIsFindingAddress(true);
    const address = await findPhoneIpv4Address();
    setIsFindingAddress(false);
    if (!address) {
      setServerUrl('');
      setConnectionStatus('Server running; phone Wi-Fi address unavailable');
      setErrorMessage(
        'The control server is running, but BlogCam could not read a Wi-Fi IPv4 address. Reconnect Wi-Fi or use USB debugging.',
      );
      return;
    }
    setServerUrl(`http://${address}:${PORT}`);
    setErrorMessage('');
    setConnectionStatus('Waiting for a browser to pair');
  };

  const releaseWebRtcCamera = () => {
    closePeer();
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach(track => track.stop());
  };

  const openWebRtcCamera = async () => {
    if (streamRef.current) {
      return;
    }
    const stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: 'blogcam-shared',
        width: {
          ideal: LIVE_PREVIEW_PROFILE.width,
          max: LIVE_PREVIEW_PROFILE.width,
        },
        height: {
          ideal: LIVE_PREVIEW_PROFILE.height,
          max: LIVE_PREVIEW_PROFILE.height,
        },
        frameRate: {
          ideal: LIVE_PREVIEW_PROFILE.frameRate,
          max: LIVE_PREVIEW_PROFILE.frameRate,
        },
      },
    });
    streamRef.current = stream;
    setConnectionStatus('Shared camera preview ready; reconnecting browser…');
  };

  const waitForNativeCameraInitialization = () => {
    if (nativeCameraReadyRef.current) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        nativeCameraReadyResolverRef.current = null;
        reject(new Error('The shared phone camera did not become ready.'));
      }, 15_000);
      nativeCameraReadyResolverRef.current = {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
      };
    });
  };

  const beginNativeCapture = () => {
    const camera = nativeCameraRef.current;
    if (!camera) {
      throw new Error('The shared phone camera is not initialized.');
    }
    let resolveFinished!: () => void;
    let rejectFinished!: (error: Error) => void;
    const finished = new Promise<void>((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });
    nativeFinishResolverRef.current = {
      promise: finished,
      resolve: resolveFinished,
      reject: rejectFinished,
    };

    try {
      camera.startRecording({
        flash: flashRef.current ? 'on' : 'off',
        onRecordingFinished: async video => {
          try {
            const file = await RNFS.stat(video.path);
            if (!file.isFile() || Number(file.size) === 0) {
              throw new Error('The phone camera produced an empty video.');
            }
            await CameraRoll.saveAsset(fileUri(video.path), {
              type: 'video',
              album: 'BlogCam',
            });
            await RNFS.unlink(video.path).catch((error: Error) =>
              console.warn(
                `Could not remove temporary video: ${error.message}`,
              ),
            );
            resolveFinished();
          } catch (error) {
            rejectFinished(
              error instanceof Error
                ? error
                : new Error('Could not save the phone video to the gallery.'),
            );
          }
        },
        onRecordingError: error => {
          rejectFinished(new Error(`Phone recording failed: ${error.message}`));
        },
      });
    } catch (error) {
      nativeFinishResolverRef.current = null;
      throw error instanceof Error
        ? error
        : new Error('Could not start the phone camera recording.');
    }
  };

  const startNativeCapture = async () => {
    if (!nativeCameraDevice) {
      throw new Error(
        'A camera suitable for video recording is unavailable.',
      );
    }
    if (!nativeAudioEnabled && !hasMicrophonePermission) {
      try {
        const granted = await requestMicrophonePermission();
        if (granted) {
          nativeCameraReadyRef.current = false;
          setNativeAudioEnabled(true);
          await waitForNativeCameraInitialization();
        }
      } catch {
        // Continue recording without audio if mic request fails
      }
    }
    if (!nativeCameraReadyRef.current) {
      throw new Error('The shared phone camera is not ready to record.');
    }
    setMode('video');
    setRecording('preparing');
    beginNativeCapture();
    setRecording('recording');
  };

  const stopNativeCapture = async () => {
    const camera = nativeCameraRef.current;
    const completion = nativeFinishResolverRef.current;
    if (!camera || !completion) {
      throw new Error('The phone camera is not recording.');
    }
    await camera.stopRecording();
    try {
      await completion.promise;
    } finally {
      nativeFinishResolverRef.current = null;
      setRecording('idle');
    }
  };

  const pauseNativeCapture = async () => {
    if (!nativeCameraRef.current) {
      throw new Error('The phone camera is not ready to pause.');
    }
    await nativeCameraRef.current.pauseRecording();
    setRecording('paused');
  };

  const resumeNativeCapture = async () => {
    if (!nativeCameraRef.current) {
      throw new Error('The phone camera is not ready to resume.');
    }
    await nativeCameraRef.current.resumeRecording();
    setRecording('recording');
  };

  openWebRtcCameraRef.current = openWebRtcCamera;
  releaseWebRtcCameraRef.current = releaseWebRtcCamera;
  stopNativeRecordingForCleanupRef.current = () => {
    nativeCameraRef.current
      ?.stopRecording()
      .catch((error: Error) =>
        console.warn(
          `Could not stop native video during cleanup: ${error.message}`,
        ),
      );
  };

  const closePeer = () => {
    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.close();
    }
    setBrowserConnected(false);
  };

  const stopSession = () => {
    const server = serverRef.current;
    serverRef.current = null;
    server?.stop();
    closePeer();
    releaseWebRtcCamera();
    flashRef.current = false;
    setFlashEnabled(false);
    NativeModules.BlogCamTorch?.setKeepScreenOn(false).catch((error: Error) =>
      setErrorMessage(`Could not release keep-screen-on: ${error.message}`),
    );
    tokenRef.current = '';
    offersRef.current.splice(0).forEach(offer =>
      offer.resolve({
        answer: null,
        error: 'Remote camera session stopped.',
      }),
    );
  };

  const switchCamera = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!nativeCameraMountedRef.current || !track) {
      throw new Error('The camera is not ready yet.');
    }
    const nextFacing =
      facingRef.current === 'environment' ? 'user' : 'environment';
    facingRef.current = nextFacing;
    nativeCameraReadyRef.current = false;
    setCameraFacing(nextFacing === 'environment' ? 'back' : 'front');
    await waitForNativeCameraInitialization();
    if (nextFacing === 'user' && flashRef.current) {
      flashRef.current = false;
      setFlashEnabled(false);
    }
  };

  const setFlash = async (enabled: boolean) => {
    if (enabled && facingRef.current !== 'environment') {
      throw new Error('Flash is only available on the rear camera.');
    }
    if (!nativeCameraMountedRef.current || !nativeCameraRef.current) {
      throw new Error('The camera is not ready yet.');
    }
    if (enabled && !nativeCameraDevice?.hasTorch) {
      throw new Error('This camera does not have a flash or torch.');
    }
    flashRef.current = enabled;
    setFlashEnabled(enabled);
  };

  const savePhoto = async (base64: string) => {
    if (base64.length > 6_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new Error('The photo data is invalid or exceeds the size limit.');
    }
    const path = `${RNFS.CachesDirectoryPath}/blogcam-${Date.now()}.jpg`;
    await RNFS.writeFile(path, base64, 'base64');
    const asset = await CameraRoll.saveAsset(fileUri(path), {
      type: 'photo',
      album: 'BlogCam',
    });
    await RNFS.unlink(path).catch((error: Error) =>
      console.warn(`Could not remove temporary photo: ${error.message}`),
    );
    return { saved: true, uri: asset.node.image.uri };
  };

  const onNativeCameraInitialized = () => {
    nativeCameraReadyRef.current = true;
    const resolver = nativeCameraReadyResolverRef.current;
    nativeCameraReadyResolverRef.current = null;
    resolver?.resolve();
  };

  const onNativeCameraError = (error: Error) => {
    const ready = nativeCameraReadyResolverRef.current;
    nativeCameraReadyResolverRef.current = null;
    ready?.reject(new Error(`Could not start phone camera: ${error.message}`));
    nativeFinishResolverRef.current?.reject(
      new Error(`Phone camera error: ${error.message}`),
    );
    setErrorMessage(`Phone camera error: ${error.message}`);
  };

  const handleApi = async (request: Request<unknown>, response: Response) => {
    if (
      typeof request.postData !== 'string' ||
      request.postData.length > MAX_API_BODY_LENGTH
    ) {
      respondError(
        response,
        'The request is missing data or exceeds the size limit.',
        413,
      );
      return;
    }

    let data: ActionRequest;
    try {
      data = request.data as ActionRequest;
    } catch {
      respondError(response, 'Send a valid JSON request.');
      return;
    }

    if (request.type !== 'POST' || !data.action) {
      respondError(response, 'Unsupported request.');
      return;
    }

    if (data.action === 'pair') {
      if (pinUsedRef.current) {
        respondError(
          response,
          'This pairing PIN has already been used. Stop and restart remote mode for a new PIN.',
          401,
        );
        return;
      }
      if (pinLockedRef.current) {
        respondError(
          response,
          'Too many incorrect PINs. Stop and restart remote mode for a new PIN.',
          429,
        );
        return;
      }
      if (!data.pin || data.pin !== servicePinRef.current) {
        pinAttemptsRef.current += 1;
        if (pinAttemptsRef.current >= MAX_PIN_ATTEMPTS) {
          pinLockedRef.current = true;
        }
        respondError(response, 'That pairing PIN is incorrect.');
        return;
      }
      pinAttemptsRef.current = 0;
      pinUsedRef.current = true;
      tokenRef.current =
        await NativeModules.BlogCamTorch.generateSessionToken();
      response.json({ token: tokenRef.current });
      return;
    }

    if (!tokenRef.current || !data.token || data.token !== tokenRef.current) {
      respondError(
        response,
        'This remote session is no longer active. Restart Remote on the phone and pair again.',
        401,
      );
      return;
    }

    try {
      switch (data.action) {
        case 'close-session':
          if (recordingStateRef.current !== 'idle') {
            respondError(
              response,
              'Stop and save the current phone recording before closing the remote session.',
              409,
            );
            return;
          }
          response.json({ closed: true });
          setTimeout(() => {
            stopSessionRef.current();
            onStop();
          }, 200);
          return;
        case 'offer': {
          if (!data.sdp || data.sdp.length > 100_000) {
            respondError(response, 'Invalid camera connection offer.');
            return;
          }
          if (offersRef.current.length > 0) {
            respondError(
              response,
              'A camera connection is already being negotiated.',
              409,
            );
            return;
          }
          const id = await NativeModules.BlogCamTorch.generateSessionToken();
          const result = await new Promise<{
            answer: string | null;
            error?: string;
          }>(resolve => {
            offersRef.current.push({ id, sdp: data.sdp!, resolve });
            setConnectionStatus('Connecting remote browser…');
            setTimeout(() => {
              const index = offersRef.current.findIndex(
                offer => offer.id === id,
              );
              if (index >= 0) {
                offersRef.current.splice(index, 1);
                resolve({
                  answer: null,
                  error:
                    'Camera connection timed out while negotiating WebRTC.',
                });
              }
            }, 25_000);
          });
          if (!result.answer) {
            respondError(
              response,
              result.error ?? 'Camera connection timed out. Try reconnecting.',
              504,
            );
            return;
          }
          response.json({ sdp: result.answer });
          return;
        }
        case 'status': {
          response.json({
            recordingState: recordingStateRef.current,
            captureMode: captureModeRef.current,
            cameraAvailable: Boolean(streamRef.current),
            isBrowserConnected: isBrowserConnectedRef.current,
            flashEnabled: flashRef.current && cameraFacing === 'back' && Boolean(nativeCameraDevice?.hasTorch),
          });
          return;
        }
        case 'stats': {
          const [battery, freeStorage, hardwareFlash] = await Promise.all([
            DeviceInfo.getBatteryLevel(),
            DeviceInfo.getFreeDiskStorage(),
            NativeModules.BlogCamTorch.hasFlash().catch(() => false),
          ]);
          if (
            !Number.isFinite(battery) ||
            battery < 0 ||
            !Number.isFinite(freeStorage)
          ) {
            throw new Error('Phone battery or storage status is unavailable.');
          }
          const flashAvailable = cameraFacing === 'back' && Boolean(nativeCameraDevice?.hasTorch ?? hardwareFlash);
          response.json({
            battery: Math.round(battery * 100),
            freeStorage: `${(freeStorage / 1_000_000_000).toFixed(1)} GB`,
            flashAvailable,
          });
          return;
        }
        case 'flip':
          await switchCamera();
          response.json({ ok: true });
          return;
        case 'mode':
          if (data.mode !== 'photo' && data.mode !== 'video') {
            respondError(response, 'Choose photo or video mode.');
            return;
          }
          if (recordingStateRef.current !== 'idle') {
            respondError(
              response,
              'Finish or pause the current video before changing camera mode.',
              409,
            );
            return;
          }
          setMode(data.mode);
          countdownExpectedRef.current = data.mode === 'video' ? 3 : 0;
          lastCountdownAtRef.current = 0;
          setCountdownSeconds(0);
          response.json({ mode: captureModeRef.current });
          return;
        case 'record-countdown':
          if (data.seconds !== 3 && data.seconds !== 2 && data.seconds !== 1) {
            respondError(response, 'Invalid video setup countdown.');
            return;
          }
          if (data.seconds !== countdownExpectedRef.current) {
            respondError(
              response,
              'Complete the video setup countdown in order.',
              409,
            );
            return;
          }
          if (
            data.seconds < 3 &&
            Date.now() - lastCountdownAtRef.current < 900
          ) {
            respondError(
              response,
              'Wait for the camera to finish preparing before continuing.',
              409,
            );
            return;
          }
          if (
            !isBrowserConnectedRef.current ||
            captureModeRef.current !== 'video' ||
            recordingStateRef.current !== 'idle'
          ) {
            respondError(
              response,
              'The camera is not ready for video recording.',
              409,
            );
            return;
          }
          lastCountdownAtRef.current = Date.now();
          countdownExpectedRef.current -= 1;
          setCountdownSeconds(data.seconds);
          response.json({ seconds: data.seconds });
          return;
        case 'flash':
          if (typeof data.enabled !== 'boolean') {
            respondError(
              response,
              'Choose whether the flash should be on or off.',
            );
            return;
          }
          await setFlash(data.enabled);
          response.json({ ok: true });
          return;
        case 'photo':
          if (!data.image) {
            respondError(response, 'The photo data is missing.');
            return;
          }
          if (recordingStateRef.current !== 'idle') {
            respondError(
              response,
              'Finish the current video before taking a photo.',
              409,
            );
            return;
          }
          setMode('photo');
          response.json(await savePhoto(data.image));
          return;
        case 'record-start':
          if (
            !isBrowserConnectedRef.current ||
            captureModeRef.current !== 'video' ||
            recordingStateRef.current !== 'idle' ||
            countdownExpectedRef.current !== 0 ||
            Date.now() - lastCountdownAtRef.current < 900
          ) {
            respondError(
              response,
              'Complete the video-mode setup countdown and wait for the camera to be ready.',
              409,
            );
            return;
          }
          const freeStorage = await DeviceInfo.getFreeDiskStorage();
          if (freeStorage < 256 * 1_024 * 1_024) {
            respondError(
              response,
              'There is not enough free phone storage to start recording.',
              507,
            );
            return;
          }
          setRecordingSeconds(0);
          setCountdownSeconds(0);
          try {
            await startNativeCapture();
          } catch (error) {
            setRecording('idle');
            respondError(
              response,
              error instanceof Error
                ? error.message
                : 'Could not start phone video recording.',
              500,
            );
            return;
          }
          response.json({ ok: true });
          return;
        case 'record-pause':
          if (recordingStateRef.current !== 'recording') {
            respondError(
              response,
              'The video is not currently recording.',
              409,
            );
            return;
          }
          await pauseNativeCapture();
          setRecording('paused');
          response.json({ state: 'paused' });
          return;
        case 'record-resume':
          if (recordingStateRef.current !== 'paused') {
            respondError(response, 'The video is not currently paused.', 409);
            return;
          }
          await resumeNativeCapture();
          setRecording('recording');
          response.json({ state: 'recording' });
          return;
        case 'record-cancel':
        case 'record-stop': {
          if (
            recordingStateRef.current !== 'recording' &&
            recordingStateRef.current !== 'paused'
          ) {
            respondError(response, 'The video recorder is not active.', 409);
            return;
          }
          await stopNativeCapture();
          setRecording('idle');
          setCountdownSeconds(0);
          setRecordingSeconds(0);
          response.json({ saved: true });
          return;
        }
        case 'disconnect':
          closePeer();
          setConnectionStatus('Waiting for a browser to pair');
          response.json({ ok: true });
          return;
        default:
          respondError(response, 'Unknown camera action.', 404);
      }
    } catch (error) {
      respondError(
        response,
        error instanceof Error ? error.message : 'The camera action failed.',
        500,
      );
    }
  };

  const connectOffer = async (offer: PendingOffer) => {
    const stream = streamRef.current;
    if (!stream) {
      offer.resolve({ answer: null, error: 'The phone camera is not ready.' });
      return;
    }

    closePeer();
    const peer = new RTCPeerConnection({ iceServers: [] });
    peerRef.current = peer;
    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) {
        return;
      }
      if (peer.connectionState === 'connected') {
        setConnectionStatus('Browser connected');
        setBrowserConnected(true);
      } else if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'disconnected' ||
        peer.connectionState === 'closed'
      ) {
        setConnectionStatus('Waiting for a browser to pair');
        setBrowserConnected(false);
      }
    };

    try {
      await peer.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp: offer.sdp }),
      );
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No camera video track is available.');
      }
      const sender = peer.addTrack(videoTrack, stream);
      try {
        const parameters = sender.getParameters();
        if (parameters?.encodings && parameters.encodings.length > 0) {
          parameters.encodings.forEach(encoding => {
            encoding.maxBitrate = 1_800_000;
            encoding.maxFramerate = LIVE_PREVIEW_PROFILE.frameRate;
          });
          await sender.setParameters(parameters);
        }
      } catch {
        // Safe to ignore if bitrate tuning is unsupported on device
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) {
        throw new Error('The camera could not create a connection answer.');
      }
      offer.resolve({ answer: sdp });
    } catch (error) {
      peer.close();
      if (peerRef.current === peer) {
        peerRef.current = null;
      }
      offer.resolve({
        answer: null,
        error:
          error instanceof Error
            ? error.message
            : 'Could not connect the remote browser.',
      });
      setConnectionStatus('Waiting for a browser to pair');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not connect the remote browser.',
      );
    }
  };

  const closePeerRef = useRef(closePeer);
  closePeerRef.current = closePeer;
  const connectOfferRef = useRef(connectOffer);
  connectOfferRef.current = connectOffer;
  const handleApiRef = useRef(handleApi);
  handleApiRef.current = handleApi;
  const stopSessionRef = useRef(stopSession);
  stopSessionRef.current = stopSession;

  useEffect(() => {
    let isMounted = true;
    let bridge: BridgeServer | null = null;
    const pendingOffers = offersRef.current;

    const start = async () => {
      if (Platform.OS !== 'android') {
        throw new Error(
          'Remote controls are currently available on Android only.',
        );
      }
      const torchModule = NativeModules.BlogCamTorch;
      if (
        typeof torchModule?.setKeepScreenOn !== 'function' ||
        typeof torchModule?.generatePairingPin !== 'function' ||
        typeof torchModule?.generateSessionToken !== 'function'
      ) {
        throw new Error(
          'The Android camera service is unavailable. Install the latest BlogCam APK and reopen the app.',
        );
      }
      setConnectionStatus('Requesting camera permission…');
      const cameraPermission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      if (cameraPermission !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Allow camera access to start remote controls.');
      }
      if (!isMounted) {
        return;
      }
      if (!hasMicrophonePermission) {
        try {
          const micGranted = await requestMicrophonePermission();
          setNativeAudioEnabled(Boolean(micGranted));
        } catch {
          // Proceed if microphone access is not granted
        }
      } else {
        setNativeAudioEnabled(true);
      }
      setConnectionStatus('Preparing the remote camera…');
      const plugin =
        webRtcFrameProcessorPlugin ??
        VisionCameraProxy.initFrameProcessorPlugin('blogcamWebRtc', {});
      if (!plugin) {
        throw new Error(
          'The shared camera WebRTC frame processor is unavailable. Rebuild the Android app after installing dependencies.',
        );
      }
      await NativeModules.BlogCamTorch.setKeepScreenOn(true);
      if (!isMounted) {
        await NativeModules.BlogCamTorch.setKeepScreenOn(false);
        return;
      }

      const pin = await NativeModules.BlogCamTorch.generatePairingPin();
      servicePinRef.current = pin;
      if (isMounted) {
        setServicePin(pin);
        setConnectionStatus('Opening camera preview…');
      }

      if (!nativeCameraConfigRef.current.device) {
        throw new Error(
          'A camera device is unavailable on this phone.',
        );
      }
      nativeCameraReadyRef.current = false;
      setNativeCameraMountState(true);
      setNativeCameraActive(true);
      await waitForNativeCameraInitialization();
      await openWebRtcCameraRef.current();
      if (!isMounted) {
        releaseWebRtcCameraRef.current();
        return;
      }

      setConnectionStatus('Starting the local control page…');
      bridge = new BridgeServer('blogcam_remote_controls', true);
      bridge.get('/', (_request, response) => response.html(remoteControlPage));
      bridge.post('/api', (request, response) =>
        handleApiRef.current(request, response),
      );
      bridge.listen(PORT);
      serverRef.current = bridge;
      if (isMounted) {
        setServerStarted(true);
        setConnectionStatus('Server started; finding phone address…');
      }
      await refreshServerAddress();
    };

    start().catch(error => {
      stopSessionRef.current();
      if (isMounted) {
        setServerStarted(false);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Could not start the camera server.',
        );
        setConnectionStatus('Camera server failed to start');
      }
    });

    return () => {
      isMounted = false;
      bridge?.stop();
      setServerStarted(false);
      if (serverRef.current === bridge) {
        serverRef.current = null;
      }
      closePeerRef.current();
      releaseWebRtcCameraRef.current();
      if (nativeFinishResolverRef.current) {
        stopNativeRecordingForCleanupRef.current();
      }
      nativeCameraReadyResolverRef.current?.reject(
        new Error('Remote camera session stopped.'),
      );
      nativeCameraReadyResolverRef.current = null;
      NativeModules.BlogCamTorch?.setKeepScreenOn(false).catch((error: Error) =>
        console.warn(`Could not release keep-screen-on: ${error.message}`),
      );
      tokenRef.current = '';
      pendingOffers.splice(0).forEach(offer =>
        offer.resolve({
          answer: null,
          error: 'Remote camera session stopped.',
        }),
      );
    };
  }, []);

  useEffect(() => {
    let active = true;
    const processOffers = async () => {
      while (active) {
        const offer = offersRef.current.shift();
        if (!offer) {
          await new Promise<void>(resolve => setTimeout(resolve, 100));
          continue;
        }
        await connectOfferRef.current(offer);
      }
    };
    processOffers();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (recordingState !== 'recording') {
      return;
    }
    const timer = setInterval(
      () => setRecordingSeconds(seconds => seconds + 1),
      1000,
    );
    return () => clearInterval(timer);
  }, [recordingState]);

  const displayUrl = serverUrl || 'Wi-Fi address unavailable';
  const stopRemoteControls = () => {
    const stop = () => {
      stopSession();
      onStop();
    };

    if (recordingStateRef.current === 'idle') {
      stop();
      return;
    }

    Alert.alert(
      'Stop remote camera?',
      'Finish saving the current phone video, then stop camera access?',
      [
        { text: 'Keep recording', style: 'cancel' },
        {
          text: 'Stop and save',
          style: 'destructive',
          onPress: () => {
            stopNativeCapture()
              .catch(error => {
                Alert.alert(
                  'Could not save video',
                  error instanceof Error ? error.message : String(error),
                );
              })
              .finally(() => {
                setRecording('idle');
                stop();
              });
          },
        },
      ],
    );
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
        },
      ]}
    >
      <View style={StyleSheet.absoluteFill} />
      {nativeCameraMounted && nativeCameraDevice ? (
        <Camera
          ref={nativeCameraRef}
          style={StyleSheet.absoluteFill}
          device={nativeCameraDevice}
          format={nativeCameraFormat}
          fps={nativeRecordingFps}
          isActive={nativeCameraActive}
          photo={false}
          video
          audio={nativeAudioEnabled}
          torch={flashEnabled ? 'on' : 'off'}
          pixelFormat="yuv"
          frameProcessor={frameProcessor}
          onInitialized={onNativeCameraInitialized}
          onError={onNativeCameraError}
        />
      ) : null}
      <View pointerEvents="none" style={styles.scrim} />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>BLOGCAM</Text>
          <Text style={styles.byline}>BY PRIMADEX</Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>
            {isBrowserConnected ? 'REMOTE · CONNECTED' : 'REMOTE'}
          </Text>
        </View>
      </View>

      {!isBrowserConnected ? (
        <View style={styles.settingsCard}>
          <View style={styles.settingGroup}>
            <Text style={styles.settingLabel}>LIVE PREVIEW QUALITY</Text>
            <Text style={styles.settingHint}>Up to 720p / 30 fps</Text>
          </View>
        </View>
      ) : null}

      {isBrowserConnected ? (
        <View style={styles.connectedHud}>
          <View style={styles.cameraHud}>
            <Text style={styles.cameraMode}>
              {captureMode === 'video' ? 'VIDEO MODE' : 'PHOTO MODE'}
            </Text>
            <Text style={styles.cameraState}>
              {countdownSeconds > 0
                ? `Camera ready · recording in ${countdownSeconds}`
                : recordingState === 'preparing'
                ? 'Preparing video recorder…'
                : recordingState === 'recording'
                ? 'Video recording'
                : recordingState === 'paused'
                ? 'Recording paused'
                : 'Camera ready'}
            </Text>
            <Text style={styles.cameraDetails}>
              {cameraFacing.toUpperCase()} CAMERA · FLASH{' '}
              {flashEnabled ? 'ON' : 'OFF'}
            </Text>
            {recordingState === 'recording' || recordingState === 'paused' ? (
              <Text style={styles.cameraTimer}>
                {`${Math.floor(recordingSeconds / 60)
                  .toString()
                  .padStart(2, '0')}:${(recordingSeconds % 60)
                  .toString()
                  .padStart(2, '0')}`}
              </Text>
            ) : null}
            {recordingState === 'recording' ? (
              <View style={styles.recordingIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.recordingText}>
                  RECORDING TO PHONE · HIGH QUALITY
                </Text>
              </View>
            ) : null}
            {recordingState === 'paused' ? (
              <Text style={styles.pausedIndicator}>RECORDING PAUSED</Text>
            ) : null}
            {errorMessage ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errorMessage}
              </Text>
            ) : null}
          </View>
          <View style={styles.connectedActions}>
            <View style={styles.modePills}>
              <View
                style={[
                  styles.modePill,
                  captureMode === 'photo' && styles.modePillActive,
                ]}
              >
                <Text
                  style={[
                    styles.modePillText,
                    captureMode === 'photo' && styles.modePillTextActive,
                  ]}
                >
                  PHOTO
                </Text>
              </View>
              <View
                style={[
                  styles.modePill,
                  captureMode === 'video' && styles.modePillActive,
                ]}
              >
                <Text
                  style={[
                    styles.modePillText,
                    captureMode === 'video' && styles.modePillTextActive,
                  ]}
                >
                  VIDEO
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={stopRemoteControls}
              style={styles.stopButton}
            >
              <Text style={styles.stopText}>STOP REMOTE CAMERA</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.statusCard}>
          <View style={styles.statusHeading}>
            {(!serverStarted && !errorMessage) || isFindingAddress ? (
              <ActivityIndicator color="#efbd75" size="small" />
            ) : null}
            <Text style={styles.statusTitle}>{connectionStatus}</Text>
          </View>
          <Text style={styles.helpText}>
            Open this address on a browser connected to the same Wi-Fi or phone
            hotspot:
          </Text>
          <Text selectable style={styles.url}>
            {serverStarted
              ? displayUrl
              : serverUrl || 'Starting the local server…'}
          </Text>
          {serverStarted && !serverUrl ? (
            <Pressable
              accessibilityRole="button"
              disabled={isFindingAddress}
              onPress={() => {
                refreshServerAddress().catch((error: Error) => {
                  setIsFindingAddress(false);
                  setErrorMessage(
                    `Could not find the phone address: ${error.message}`,
                  );
                });
              }}
              style={styles.retryAddressButton}
            >
              <Text style={styles.retryAddressText}>
                {isFindingAddress ? 'FINDING ADDRESS…' : 'RETRY ADDRESS'}
              </Text>
            </Pressable>
          ) : null}
          {serverStarted && !serverUrl ? (
            <Text style={styles.helpText}>
              For USB debugging, run adb reverse tcp:8000 tcp:8000 on the
              computer and open http://127.0.0.1:8000.
            </Text>
          ) : null}
          <View style={styles.pinBox}>
            <Text style={styles.pinLabel}>ONE-TIME PAIRING PIN</Text>
            <Text selectable style={styles.pin}>
              {servicePin}
            </Text>
          </View>
          <Text style={styles.helpText}>
            Keep this screen open. Remote video recordings use the phone's
            highest supported camera resolution at up to 30 fps and save to the
            BlogCam Gallery album. The webpage live preview is fixed at 720p /
            24 fps. For USB debugging, run adb reverse tcp:8000 tcp:8000 on the
            computer and open http://127.0.0.1:8000 there.
          </Text>
          {errorMessage ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {errorMessage}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={stopRemoteControls}
            style={styles.stopButton}
          >
            <Text style={styles.stopText}>STOP REMOTE CAMERA</Text>
          </Pressable>
        </View>
      )}

      {!isBrowserConnected ? (
        <View style={styles.footer}>
          <Text style={styles.footerText}>PHONE CAMERA PREVIEW</Text>
          <Text style={styles.footerSubtext}>
            Press stop when remote access is no longer needed.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    backgroundColor: '#090b0f',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(4, 6, 10, 0.27)',
  },
  header: {
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
  byline: {
    color: '#ff3b30',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 4,
  },
  liveBadge: {
    borderRadius: 20,
    backgroundColor: 'rgba(14, 16, 20, 0.78)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#f15e54',
    marginRight: 7,
  },
  liveText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  settingsCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(12, 15, 21, 0.92)',
    padding: 13,
  },
  settingGroup: {
    marginBottom: 9,
  },
  settingLabel: {
    color: '#b8bec7',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.3,
    marginBottom: 6,
  },
  settingChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  settingChoice: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333c4b',
    backgroundColor: '#222936',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  settingChoiceSelected: {
    borderColor: '#f1bd76',
    backgroundColor: '#f1bd76',
  },
  settingChoiceText: {
    color: '#f3f4f6',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  settingChoiceTextSelected: {
    color: '#19130b',
  },
  settingHint: {
    color: '#929ba9',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 6,
  },
  statusCard: {
    backgroundColor: 'rgba(12, 15, 21, 0.94)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
  },
  connectedHud: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 18,
    paddingBottom: 18,
  },
  cameraHud: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(12, 15, 21, 0.78)',
  },
  cameraMode: {
    color: '#f3d09b',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  cameraState: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
  },
  cameraDetails: {
    color: '#c7cbd1',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginTop: 7,
  },
  cameraTimer: {
    color: '#fff',
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    marginTop: 5,
  },
  pausedIndicator: {
    color: '#f3d09b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 9,
  },
  connectedActions: {
    alignItems: 'center',
  },
  modePills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 5,
    borderRadius: 24,
    backgroundColor: 'rgba(12, 15, 21, 0.84)',
  },
  modePill: {
    minWidth: 90,
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modePillActive: {
    backgroundColor: '#f1bd76',
  },
  modePillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  modePillTextActive: {
    color: '#19130b',
  },
  statusHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
    marginLeft: 8,
  },
  helpText: {
    color: '#b8bec7',
    fontSize: 13,
    lineHeight: 20,
  },
  url: {
    color: '#f3c984',
    fontSize: 19,
    fontWeight: '700',
    marginTop: 9,
    marginBottom: 18,
  },
  retryAddressButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(239, 189, 117, 0.7)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: -8,
    marginBottom: 14,
  },
  retryAddressText: {
    color: '#f3d09b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  pinBox: {
    backgroundColor: '#191e27',
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 16,
  },
  pinLabel: {
    color: '#a3acb9',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  pin: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 12,
    marginLeft: 12,
    marginTop: 5,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(151, 35, 31, 0.3)',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 13,
  },
  recordingText: {
    color: '#ffe5e3',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  error: {
    color: '#ffaaa3',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  stopButton: {
    backgroundColor: '#f1bd76',
    alignItems: 'center',
    borderRadius: 13,
    marginTop: 17,
    minWidth: 220,
    paddingVertical: 14,
  },
  stopText: {
    color: '#19130b',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.25,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 12,
  },
  footerText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.7,
  },
  footerSubtext: {
    color: '#a4abb4',
    fontSize: 11,
    marginTop: 5,
  },
});
