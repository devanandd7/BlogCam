# BlogCam by Primadex

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Camera features

BlogCam by Primadex uses the device's native camera for a live preview, photo capture, and
video recording. It includes front/back camera switching, flash controls, tap to
focus, pinch and button zoom, and saves captures to the `BlogCam` album in the
device photo gallery. Microphone permission is requested when video recording is
selected. Camera and microphone access must be allowed for the corresponding
features to work. Older Android versions also require storage access to save
captures to the gallery; newer Android versions use scoped media storage.

After installing the camera dependencies, rebuild the native app (a Metro reload
is not enough). On iOS, install the updated CocoaPods dependencies with
`bundle exec pod install` before rebuilding.

## Android remote controls

Tap **REMOTE** in the Android camera screen to start a local HTTP server on port
`8000`. The app displays its actual Wi-Fi/hotspot address and a randomly
generated four-digit PIN. Open the shown URL in a browser on the same local
network, enter the PIN, and use the one-time paired session to access live
preview, camera flip, flash, photo capture, video recording, pause/resume, phone
battery and free storage. The video preview uses a direct WebRTC stream.
Remote video recording always uses VisionCamera's native Android recorder and
saves directly to the `BlogCam` gallery album. The browser only controls the
phone camera; it does not record or save video on the computer. WebRTC and
native recording share one VisionCamera session: native camera frames feed
the WebRTC preview while the native recorder writes video and microphone audio
to the phone. The webpage preview stays live while recording and pause/resume
operate on the native recorder without stopping the camera session. The shared
camera mode is up to 720p and 30 fps, depending on the active camera's supported
formats, to keep frame processing and browser preview responsive.
Photos are still captured from the live stream, not at the camera sensor's
full still-photo resolution.

The remote flash control waits for Android to confirm the torch state and
reports if the active camera prevents the phone from changing it. If the torch
is enabled, BlogCam carries that setting into native recording and keeps it on
until the user turns it off. The webpage reflects the phone's flash state when
reconnecting to an existing remote session.
Starting a remote recording selects video mode and shows a three-second setup
countdown before starting the native phone recorder.
After the browser connects, the phone hides the pairing card and shows the
remote photo/video mode, countdown, recording timer, and pause/resume status
over the camera preview. Remote recordings use the same native VisionCamera
pipeline as manual recordings.

Keep BlogCam open in the foreground during remote use. The session accepts one
PIN pairing; five incorrect PIN attempts lock that PIN until remote mode is
restarted. An authenticated session does not expire due to inactivity; it stays
active until **Close session** is selected in the browser or **Stop remote
camera** is selected in BlogCam. Closing the session stops the server and
camera; start Remote again on the phone to pair with a fresh PIN. The PIN is
consumed by the first browser that pairs. The browser remembers its session
token locally and attempts to reconnect after a page reload while the phone
session is still active.

The camera video travels directly between the phone and browser over WebRTC;
the web page loading only confirms that the HTTP control server is reachable.
Both devices must be able to communicate directly on the same local network.
Guest Wi-Fi, router client/AP isolation, or a firewall can block either the
phone's HTTP port `8000` or the direct video route. Use a non-guest Wi-Fi
network with client isolation disabled, or connect the laptop to the phone's
hotspot. If pairing succeeds but video does not, use **Reconnect camera** and
check that the page reports a connected video link and then a live preview.

The local web server uses plain HTTP, so use it only on a trusted private
network. USB `adb reverse tcp:8000 tcp:8000` can forward the HTTP control page
to `http://127.0.0.1:8000`, but does not forward WebRTC's direct video traffic;
use Wi-Fi or a phone hotspot for live preview and stream-based photo capture.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.

#
