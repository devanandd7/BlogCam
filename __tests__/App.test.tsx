/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
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
      (props: { onInitialized?: () => void }, ref: unknown) => {
        onCameraInitialized = props.onInitialized;
        ReactModule.useImperativeHandle(ref, () => ({
          takePhoto: jest.fn().mockResolvedValue({ path: '/capture.jpg' }),
          focus: jest.fn().mockResolvedValue(undefined),
          startRecording: jest.fn(),
          stopRecording: jest.fn().mockResolvedValue(undefined),
        }));
        return ReactModule.createElement(ReactNative.View, {
          testID: 'camera-preview',
        });
      },
    ),
    initializeCamera: () => onCameraInitialized?.(),
    useCameraDevice: (position: 'back' | 'front') => devices[position],
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
    renderer!.root.findByProps({ accessibilityLabel: 'Take photo' }),
  ).toBeTruthy();
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
