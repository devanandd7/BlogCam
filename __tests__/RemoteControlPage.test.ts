import remoteControlPage from '../remote-control-page';
import { parse } from '@babel/parser';

test('provides remote camera controls with fixed preview quality and phone recording', () => {
  expect(remoteControlPage).toContain('RTCPeerConnection');
  expect(remoteControlPage).toContain('iceServers: []');
  expect(remoteControlPage).toContain('Capture photo');
  expect(remoteControlPage).toContain('Flip camera');
  expect(remoteControlPage).toContain('Flash off');
  expect(remoteControlPage).toContain('End recording');
  expect(remoteControlPage).toContain('LIVE CAMERA QUALITY');
  expect(remoteControlPage).toContain('Up to 720p / 30 fps');
  expect(remoteControlPage).not.toContain('Preview paused during native recording');
  expect(remoteControlPage).toContain(
    'Phone recording with microphone. Live camera preview stays on.',
  );
  expect(remoteControlPage).not.toContain('monitorQuality');
  expect(remoteControlPage).not.toContain('id="quality"');
  expect(remoteControlPage).toContain('Videos are recorded on the phone');
  expect(remoteControlPage).toContain('const status = await api("status")');
  expect(remoteControlPage).toContain('PHOTO MODE');
  expect(remoteControlPage).toContain('VIDEO MODE');
  expect(remoteControlPage).toContain('VIDEO MODE READY · STARTING IN');
  expect(remoteControlPage).toContain(
    'Phone recording with microphone. Live camera preview stays on.',
  );
  expect(remoteControlPage).toContain('Phone video saved to Gallery');
  expect(remoteControlPage).toContain('id="closeSession"');
  expect(remoteControlPage).toContain('Remote session closed');
  expect(remoteControlPage).toContain('api("close-session")');
  expect(remoteControlPage).toContain(
    'localStorage.setItem("blogcam_remote_token", token)',
  );
  expect(remoteControlPage).toContain('resumeSavedSession()');
  expect(remoteControlPage).not.toContain('MediaRecorder');
  expect(remoteControlPage).not.toContain('downloadRecording');
  expect(remoteControlPage).not.toContain('id="destination"');
  expect(remoteControlPage).toContain('record-pause');
  expect(remoteControlPage).toContain('record-resume');
  expect(remoteControlPage).toContain('status.flashEnabled === true');
  expect(remoteControlPage).not.toContain(
    'The live preview pauses while the phone camera switches to native recording.',
  );
  expect(remoteControlPage).toContain('PHONE BATTERY');
  expect(remoteControlPage).toContain('PHONE FREE STORAGE');
  expect(remoteControlPage).toContain('oniceconnectionstatechange');
  expect(remoteControlPage).toContain('onplaying');
  expect(remoteControlPage).not.toContain('peer.addTransceiver("audio"');
  expect(remoteControlPage).toContain(
    'Use Reconnect camera to retry without pairing again.',
  );
  expect(remoteControlPage).toContain('Wi-Fi blocked the direct video route');
  expect(remoteControlPage).not.toContain('<script src=');
});

test('serves valid browser JavaScript without a browser-side recorder', () => {
  const script = remoteControlPage.match(/<script>([\s\S]*)<\/script>/)?.[1];
  expect(script).toBeDefined();
  if (!script) {
    throw new Error('Remote page script was not found.');
  }
  expect(() => parse(script, { sourceType: 'script' })).not.toThrow();
  expect(script).not.toContain('record-chunk');
  expect(script).not.toContain('MediaRecorder');
  expect(script).toContain('await api("record-start")');
  expect(script).toContain('command("record-stop")');
});
