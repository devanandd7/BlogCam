/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  NativeModules,
  PermissionsAndroid,
  Platform,
  Text,
} from 'react-native';
import App from '../App';

jest.mock('react-native-vision-camera', () => {
  const ReactNative = require('react-native');
  const ReactModule = require('react');
  let onCameraInitialized: (() => void) | undefined;
  const devices = {
    back: {
      hasFlash: true,
      hasTorch: true,
      maxZoom: 4,
      minZoom: 1,
      neutralZoom: 1,
      supportsFocus: true,
      position: 'back',
      formats: [
        {
          videoWidth: 1280,
          videoHeight: 720,
          minFps: 24,
          maxFps: 30,
        },
      ],
    },
    front: {
      hasFlash: false,
      hasTorch: false,
      maxZoom: 2,
      minZoom: 1,
      neutralZoom: 1,
      supportsFocus: true,
      position: 'front',
    },
  };

  return {
    Camera: ReactModule.forwardRef(
      (
        props: {
          onInitialized?: () => void;
          isActive?: boolean;
          device?: { position?: string };
        },
        ref: unknown,
      ) => {
        onCameraInitialized = props.onInitialized;
        ReactModule.useImperativeHandle(ref, () => ({
          takePhoto: jest.fn().mockResolvedValue({ path: '/capture.jpg' }),
          focus: jest.fn().mockResolvedValue(undefined),
          startRecording: jest.fn(),
          stopRecording: jest.fn().mockResolvedValue(undefined),
        }));
        return ReactModule.createElement('camera-view', {
          testID: 'camera-preview',
          isActive: props.isActive,
        });
      },
    ),
    initializeCamera: () => onCameraInitialized?.(),
    useCameraDevice: (position: 'back' | 'front') => devices[position],
    useFrameProcessor: (processor: (frame: unknown) => void) => processor,
    VisionCameraProxy: {
      initFrameProcessorPlugin: () => ({ call: jest.fn() }),
    },
    useCameraPermission: () => ({
      hasPermission: true,
      requestPermission: jest.fn().mockResolvedValue(true),
    }),
    useMicrophonePermission: () => ({
      hasPermission: true,
      requestPermission: jest.fn().mockResolvedValue(true),
    }),
  };
});

jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {
    saveAsset: jest.fn().mockResolvedValue({
      node: { image: { uri: 'file:///capture.jpg' } },
    }),
  },
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getBatteryLevel: jest.fn().mockResolvedValue(0.8),
    getFreeDiskStorage: jest.fn().mockResolvedValue(10_000_000_000),
  },
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    CachesDirectoryPath: '/cache',
    appendFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native-network-info', () => ({
  NetworkInfo: {
    getIPAddress: jest.fn().mockResolvedValue('192.168.1.25'),
    getIPV4Address: jest.fn().mockResolvedValue('192.168.1.25'),
  },
}));

jest.mock('react-native-http-bridge-refurbished', () => ({
  BridgeServer: class {
    get = jest.fn();
    post = jest.fn();
    listen = jest.fn();
    stop = jest.fn();
  },
}));

jest.mock('react-native-webrtc', () => {
  const ReactNative = require('react-native');
  return {
    mediaDevices: { getUserMedia: jest.fn() },
    RTCSessionDescription: class {},
    RTCPeerConnection: class {},
    RTCView: ReactNative.View,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');

  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

test('renders correctly', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(renderer!.root.findByProps({ testID: 'camera-preview' })).toBeTruthy();
  const labels = renderer!.root
    .findAllByType(Text)
    .map(node => node.props.children);
  expect(labels).toContain('PHOTO');
  expect(labels).toContain('VIDEO');
  expect(
    renderer!.root.findAllByProps({
      accessibilityLabel: 'Camera recording settings',
    }),
  ).toHaveLength(0);
  expect(
    renderer!.root.findByProps({ accessibilityLabel: 'Take photo' }),
  ).toBeTruthy();
});

test('does not show the removed remote recording destination settings', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(
    renderer!.root.findAll(
      node =>
        node.type === Text &&
        node.props.children === 'SAVE REMOTE RECORDING TO',
    ),
  ).toHaveLength(0);
});

test('saves a captured photo to the device gallery', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  const { initializeCamera } = require('react-native-vision-camera');
  await ReactTestRenderer.act(() => initializeCamera());

  await ReactTestRenderer.act(async () => {
    renderer!.root
      .findByProps({ accessibilityLabel: 'Take photo' })
      .props.onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

  const { CameraRoll } = require('@react-native-camera-roll/camera-roll');
  expect(CameraRoll.saveAsset).toHaveBeenCalledWith('file:///capture.jpg', {
    type: 'photo',
    album: 'BlogCam',
  });
});

test('keeps the shared phone camera preview mounted in remote mode', async () => {
  jest.useFakeTimers();
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  const permissionDescriptor = Object.getOwnPropertyDescriptor(
    PermissionsAndroid,
    'request',
  );
  const torchDescriptor = Object.getOwnPropertyDescriptor(
    NativeModules,
    'BlogCamTorch',
  );
  const remoteStream = {
    getTracks: () => [],
    getVideoTracks: () => [],
    toURL: () => 'remote-preview',
  };
  const { mediaDevices } = require('react-native-webrtc');
  mediaDevices.getUserMedia.mockResolvedValue(remoteStream);
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  Object.defineProperty(PermissionsAndroid, 'request', {
    configurable: true,
    value: jest.fn().mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED),
  });
  Object.defineProperty(NativeModules, 'BlogCamTorch', {
    configurable: true,
    value: {
      generatePairingPin: jest.fn().mockResolvedValue('1234'),
      generateSessionToken: jest.fn().mockResolvedValue('token'),
      hasFlash: jest.fn().mockResolvedValue(true),
      setKeepScreenOn: jest.fn().mockResolvedValue(undefined),
      setTorchEnabled: jest.fn().mockResolvedValue(undefined),
      getNetworkIpAddresses: jest
        .fn()
        .mockResolvedValue([{ name: 'wlan0', address: '192.168.1.25' }]),
    },
  });
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  try {
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    const { initializeCamera } = require('react-native-vision-camera');
    await ReactTestRenderer.act(() => initializeCamera());

    await ReactTestRenderer.act(() => {
      renderer!.root
        .findByProps({ accessibilityLabel: 'Start remote camera controls' })
        .props.onPress();
    });
    expect(
      renderer!.root.findAllByType(Text).map(node => node.props.children),
    ).toContain('Switching camera…');

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2500);
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    });
    await ReactTestRenderer.act(() => initializeCamera());

    expect(
      renderer!.root
        .findAllByProps({ testID: 'camera-preview' })
        .filter(node => node.props.isActive),
    ).toHaveLength(1);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: 'blogcam-shared' }),
      }),
    );
    expect(
      renderer!.root.findAllByType(Text).map(node => node.props.children),
    ).toContain('STOP REMOTE CAMERA');
  } finally {
    if (renderer) {
      await ReactTestRenderer.act(() => renderer!.unmount());
    }
    if (platformDescriptor) {
      Object.defineProperty(Platform, 'OS', platformDescriptor);
    }
    if (permissionDescriptor) {
      Object.defineProperty(
        PermissionsAndroid,
        'request',
        permissionDescriptor,
      );
    }
    if (torchDescriptor) {
      Object.defineProperty(NativeModules, 'BlogCamTorch', torchDescriptor);
    } else {
      delete NativeModules.BlogCamTorch;
    }
    jest.useRealTimers();
  }
});

test('detects hardware audio DSP capabilities on startup and enables noise suppression options', async () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  const mockCaps = {
    hasHardwareNoiseSuppressor: true,
    hasAcousticEchoCanceler: true,
    hasAutomaticGainControl: true,
    microphoneCount: 2,
    micDetails: '2 microphones (Primary, Secondary Noise Canceling)',
    deviceModel: 'Vivo V2568 (Android 16)',
    androidVersion: 36,
    currentAudioMode: 'dsp',
    recommendedMode: 'dsp',
  };
  NativeModules.BlogCamAudioModule = {
    checkAudioCapabilities: jest.fn().mockResolvedValue(mockCaps),
    setAudioMode: jest.fn().mockResolvedValue('dsp'),
    getAudioMode: jest.fn().mockResolvedValue('dsp'),
    processVideoAudio: jest.fn().mockResolvedValue({
      outputPath: '/enhanced.mp4',
      modeApplied: 'dsp',
      voiceBoostApplied: true,
    }),
  };

  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      await Promise.resolve();
    });

    expect(NativeModules.BlogCamAudioModule.checkAudioCapabilities).toHaveBeenCalled();

    const audioBtn = renderer!.root.findByProps({
      accessibilityLabel: 'Audio noise suppression mode: DSP',
    });
    expect(audioBtn).toBeTruthy();

    await ReactTestRenderer.act(() => {
      audioBtn.props.onPress();
    });

    const texts = renderer!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(texts).toContain('AUDIO NOISE SUPPRESSION');
    expect(texts).toContain('DSP Hardware (Clean)');
    expect(texts).toContain('Off (Raw Audio)');
    expect(texts).toContain('Deep Filter (Studio AI)');
  } finally {
    if (renderer) {
      await ReactTestRenderer.act(() => renderer!.unmount());
    }
    if (platformDescriptor) {
      Object.defineProperty(Platform, 'OS', platformDescriptor);
    }
    delete NativeModules.BlogCamAudioModule;
  }
});

