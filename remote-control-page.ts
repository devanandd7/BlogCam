const remoteControlPage = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#090b0f">
  <title>BlogCam Remote</title>
  <style>
    :root{color-scheme:dark;--bg:#090b0f;--panel:#131720;--line:#272e3a;--text:#f6f4ef;--muted:#9aa3b2;--gold:#efbd75;--red:#f15e54}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% -25%,#29303d 0,transparent 55%),var(--bg);color:var(--text);font:15px system-ui,-apple-system,"Segoe UI",sans-serif}
    main{width:min(100% - 32px,720px);margin:auto;padding:32px 0 48px}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
    .brand{font-size:19px;font-weight:850;letter-spacing:.16em}.brand span{display:block;color:var(--red);font-size:10px;letter-spacing:.23em;margin-top:4px}
    .badge{border:1px solid var(--line);border-radius:99px;color:var(--muted);padding:7px 11px;font-size:12px}
    .card{background:rgba(19,23,32,.94);border:1px solid var(--line);border-radius:20px;padding:20px;margin:14px 0;box-shadow:0 16px 44px #0003}
    h1{font-size:23px;margin:0 0 8px}p{color:var(--muted);line-height:1.5;margin:0 0 18px}
    input{width:100%;height:54px;border-radius:13px;border:1px solid #353d4b;background:#0c0f15;color:var(--text);font:700 23px system-ui;text-align:center;letter-spacing:.42em;outline:none}
    input:focus{border-color:var(--gold)}button{border:0;border-radius:13px;background:var(--gold);color:#17120b;font:750 14px system-ui;padding:13px 15px;cursor:pointer}
    button:disabled{opacity:.45;cursor:default}.secondary{background:#222936;color:var(--text);border:1px solid #333c4b}.danger{background:#542421;color:#ffe2df;border:1px solid #73332f}
    .wide{display:block;width:100%;margin-top:12px;text-align:center;text-decoration:none}.hidden{display:none!important}
    .error{color:#ffaaa3;margin-top:12px;font-size:13px}.hint{font-size:12px;margin:12px 0 0}
    .video-wrap{position:relative;overflow:hidden;border-radius:18px;background:#030405;aspect-ratio:16/9;display:grid;place-items:center}
    video{display:block;width:100%;height:100%;object-fit:contain}
    .live{position:absolute;left:12px;top:12px;background:#180d0dce;border-radius:99px;padding:6px 9px;color:#fff;font-size:11px;letter-spacing:.08em}
    .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--red);margin-right:6px}
    .controls{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}.controls button{min-height:47px}
    .capture-controls{grid-template-columns:repeat(2,1fr)}
    .mode-controls{grid-template-columns:repeat(2,1fr)}
    .mode-controls .selected{background:var(--gold);color:#17120b;border-color:var(--gold)}
    .record-controls{grid-template-columns:repeat(3,1fr)}.record-controls button{padding-inline:6px}
    .stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat{background:#0d1118;border:1px solid var(--line);border-radius:13px;padding:13px}.stat small{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.stat strong{font-size:18px}
    .notice{font-size:12px;color:var(--muted);margin:12px 2px}.toast{min-height:19px;color:var(--gold);font-size:13px;margin-top:10px}
    .settings-panel{margin-top:12px;padding:14px;background:#0d1118;border:1px solid var(--line);border-radius:14px}
    .settings-panel label{display:block;color:var(--muted);font-size:11px;font-weight:750;letter-spacing:.08em;margin:0 0 6px}
    .settings-panel p{margin:0;color:var(--text);font-size:14px}
    @media(max-width:420px){main{padding-top:20px}.card{padding:16px}.record-controls{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>
<main>
  <header><div class="brand">BLOGCAM<span>BY PRIMADEX</span></div><div id="connection" class="badge">NOT PAIRED</div></header>
  <section id="pairCard" class="card">
    <h1>Connect to your camera</h1>
    <p>Enter the four-digit pairing PIN shown in BlogCam on the phone.</p>
    <input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" aria-label="Four digit pairing PIN" placeholder="••••">
    <button id="pair" class="wide">Pair with PIN</button>
    <div id="pairError" class="error"></div>
    <p class="hint">Only one browser can control the camera at a time. Keep the phone open on the remote-camera screen, and use this unencrypted local connection only on a trusted network.</p>
  </section>
  <section id="cameraCard" class="hidden">
    <div class="card">
      <div class="video-wrap"><video id="preview" autoplay playsinline muted></video><div id="liveBadge" class="live"><span class="dot"></span>LIVE · LOCAL NETWORK</div></div>
      <div id="toast" class="toast"></div>
      <div class="controls mode-controls">
        <button id="photoMode" class="secondary selected">PHOTO MODE</button>
        <button id="videoMode" class="secondary">VIDEO MODE</button>
      </div>
      <div class="controls capture-controls">
        <button id="flip" class="secondary">↻ &nbsp;Flip camera</button>
        <button id="flash" class="secondary">ϟ &nbsp;Flash off</button>
        <button id="settingsToggle" class="secondary" aria-expanded="false">⚙ &nbsp;Settings</button>
        <button id="capture" class="secondary">◎ &nbsp;Capture photo</button>
      </div>
      <div id="settingsPanel" class="settings-panel hidden">
        <label>LIVE CAMERA QUALITY</label>
        <p>Up to 720p / 30 fps</p>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <label style="margin:0">AUDIO NOISE SUPPRESSION</label>
            <span id="audioHwBadge" class="badge" style="padding:2px 8px;font-size:10px;color:#38e58e;border-color:rgba(56,229,142,0.3)">DSP READY</span>
          </div>
          <div class="controls" style="grid-template-columns:repeat(3,1fr);margin-top:6px">
            <button id="audioDsp" class="secondary selected" style="font-size:12px;padding:8px 4px">DSP (Clean)</button>
            <button id="audioRaw" class="secondary" style="font-size:12px;padding:8px 4px">Off (Raw)</button>
            <button id="audioDeep" class="secondary" style="font-size:12px;padding:8px 4px">AI Filter</button>
          </div>
          <p id="audioNotice" style="font-size:11px;color:var(--muted);margin-top:8px">Hardware DSP subtraction active (0% phone CPU load).</p>
        </div>
      </div>
      <div class="controls record-controls">
        <button id="record" class="danger">● &nbsp;Record</button>
        <button id="pause" class="secondary" disabled>Ⅱ &nbsp;Pause</button>
        <button id="resume" class="secondary" disabled>▶ &nbsp;Resume</button>
        <button id="end" class="secondary" disabled>■ &nbsp;End recording</button>
        <button id="disconnect" class="secondary">Reconnect camera</button>
        <button id="closeSession" class="danger">Close session</button>
      </div>
    </div>
    <div class="card stats"><div class="stat"><small>PHONE BATTERY</small><strong id="battery">—</strong></div><div class="stat"><small>PHONE FREE STORAGE</small><strong id="storage">—</strong></div></div>
    <p class="notice">Videos are recorded on the phone and saved to the BlogCam Gallery album. Keep BlogCam open in the foreground. For USB cable control, run <code>adb forward tcp:8000 tcp:8000</code> on the computer.</p>
  </section>
  <section id="closedCard" class="card hidden">
    <h1>Remote session closed</h1>
    <p>Camera access and the remote server have stopped. To connect again, start Remote on the phone and pair with its new PIN.</p>
  </section>
</main>
<script>
(() => {
  const byId = id => document.getElementById(id);
  const apiUrl = new URL("/api", location.href);
  let token = "";
  let peer = null;
  let recordingStarted = false;
  let statusTimer = null;
  let statsTimer = null;
  let captureMode = "photo";
  let isFlashOn = false;
  let flashAvailable = false;
  let pollTimer = null;
  let previewTimer = null;
  let apiQueue = Promise.resolve();

  function tell(message) {
    byId("toast").textContent = message || "";
  }

  async function setMode(mode) {
    if (mode !== "photo" && mode !== "video") throw new Error("Unknown camera mode.");
    if (recordingStarted) {
      throw new Error("Stop the current video before changing camera mode.");
    }
    const result = await api("mode", {mode});
    captureMode = result.mode;
    byId("photoMode").classList.toggle("selected", captureMode === "photo");
    byId("videoMode").classList.toggle("selected", captureMode === "video");
    tell(captureMode.toUpperCase() + " mode ready on BlogCam.");
    return captureMode;
  }

  function api(action, data) {
    const send = async () => {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(Object.assign({action, token}, data || {}))
      });
      const body = await response.json();
      if (response.status === 401 && action !== "pair") {
        token = "";
        localStorage.removeItem("blogcam_remote_token");
      }
      if (!response.ok || body.error) throw new Error(body.error || "Request failed");
      return body;
    };
    const request = apiQueue.then(send);
    apiQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  function waitForIce(peerConnection) {
    if (peerConnection.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        peerConnection.removeEventListener("icegatheringstatechange", changed);
        reject(new Error("Camera connection timed out. Try connecting again."));
      }, 12000);
      function changed() {
        if (peerConnection.iceGatheringState === "complete") {
          clearTimeout(timeout);
          peerConnection.removeEventListener("icegatheringstatechange", changed);
          resolve();
        }
      }
      peerConnection.addEventListener("icegatheringstatechange", changed);
    });
  }

  async function connectCamera() {
    peer = new RTCPeerConnection({iceServers: []});
    const connection = peer;
    const preview = byId("preview");
    peer.addTransceiver("video", {direction: "recvonly"});
    peer.ontrack = event => {
      if (peer !== connection || event.track.kind !== "video") return;
      preview.srcObject = event.streams[0] || new MediaStream([event.track]);
      preview.play().catch(error => {
        tell("Video arrived, but the browser could not start playback: " + error.message);
      });
    };
    preview.onplaying = () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = null;
      tell("Live camera preview is playing.");
    };
    connection.oniceconnectionstatechange = () => {
      if (peer !== connection) return;
      if (connection.iceConnectionState === "checking") {
        byId("connection").textContent = "CONNECTING TO CAMERA";
        tell("Pairing succeeded. Establishing a direct video route over Wi-Fi…");
      } else if (connection.iceConnectionState === "failed") {
        byId("connection").textContent = "VIDEO ROUTE FAILED";
        tell("The browser reached the phone, but Wi-Fi blocked the direct video route. Use the same non-guest Wi-Fi or try a phone hotspot.");
      } else if (connection.iceConnectionState === "disconnected") {
        byId("connection").textContent = "VIDEO DISCONNECTED";
        tell("The direct video route was lost. Check Wi-Fi and reconnect.");
      }
    };
    connection.onconnectionstatechange = () => {
      if (peer !== connection) return;
      if (connection.connectionState === "connected") {
        byId("connection").textContent = "VIDEO LINK CONNECTED";
        tell("Video link connected. Waiting for the first camera frame…");
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
          if (peer === connection && !preview.videoWidth) {
            tell("The video link connected but no frames arrived. Reconnect the camera; if it persists, try another Wi-Fi network.");
          }
        }, 10000);
      } else if (connection.connectionState === "failed") {
        byId("connection").textContent = "VIDEO ROUTE FAILED";
        tell("Could not establish the direct video route. Check Wi-Fi client isolation or try a phone hotspot.");
      } else if (connection.connectionState === "disconnected") {
        byId("connection").textContent = "VIDEO DISCONNECTED";
        tell("Camera connection lost. Reconnect to resume the live view.");
      }
    };
    connection.onicecandidateerror = event => {
      tell("WebRTC network error: " + (event.errorText || "no direct route found"));
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIce(peer);
    const localSdp = peer.localDescription && peer.localDescription.sdp;
    if (!localSdp) throw new Error("The browser could not create a camera offer.");
    const response = await api("offer", {sdp: localSdp});
    await connection.setRemoteDescription({type: "answer", sdp: response.sdp});
  }

  function stopPeer() {
    if (peer) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.onicecandidateerror = null;
      peer.close();
      peer = null;
    }
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    byId("preview").srcObject = null;
    byId("preview").onplaying = null;
  }

  async function pair() {
    byId("pair").disabled = true;
    byId("pairError").textContent = "";
    try {
      const result = await api("pair", {pin: byId("pin").value});
      token = result.token;
      localStorage.setItem("blogcam_remote_token", token);
      byId("pairCard").classList.add("hidden");
      byId("cameraCard").classList.remove("hidden");
      byId("connection").textContent = "CONNECTING";
      await connectCamera();
      updateStats().catch(error => tell("Phone status unavailable: " + error.message));
      await refreshStatus();
      pollTimer = setInterval(() => {
        updateStats().catch(error => tell("Phone status unavailable: " + error.message));
      }, 10000);
      statusTimer = setInterval(() => {
        refreshStatus().catch(error => tell("Camera status unavailable: " + error.message));
      }, 1500);
    } catch (error) {
      stopPeer();
      if (token) {
        byId("pairCard").classList.add("hidden");
        byId("cameraCard").classList.remove("hidden");
        byId("connection").textContent = "CAMERA NOT CONNECTED";
        tell("Pairing succeeded, but video did not connect: " + error.message + " Use Reconnect camera to retry without pairing again.");
        updateStats().catch(statsError => tell("Phone status unavailable: " + statsError.message));
        refreshStatus().catch(statusError => tell("Camera status unavailable: " + statusError.message));
        if (!pollTimer) {
          pollTimer = setInterval(() => {
            updateStats().catch(statsError => tell("Phone status unavailable: " + statsError.message));
          }, 10000);
        }
        if (!statusTimer) {
          statusTimer = setInterval(() => {
            refreshStatus().catch(statusError => tell("Camera status unavailable: " + statusError.message));
          }, 1500);
        }
      } else {
        localStorage.removeItem("blogcam_remote_token");
        byId("cameraCard").classList.add("hidden");
        byId("pairCard").classList.remove("hidden");
        byId("connection").textContent = "NOT PAIRED";
        byId("pair").disabled = false;
        byId("pairError").textContent = error instanceof TypeError
          ? "Cannot reach the phone control server. Check the phone IP and use the same non-guest Wi-Fi with client isolation disabled."
          : error.message;
        byId("connection").textContent = "NOT PAIRED";
        byId("pair").disabled = false;
      }
    }
  }

  async function resumeSavedSession() {
    const savedToken = localStorage.getItem("blogcam_remote_token");
    if (!savedToken) return;
    token = savedToken;
    byId("pairCard").classList.add("hidden");
    byId("cameraCard").classList.remove("hidden");
    byId("connection").textContent = "RESTORING SESSION";
    try {
      const status = await api("status");
      renderRemoteStatus(status);
      if (status.cameraAvailable) {
        await connectCamera();
      } else {
        tell("Phone recording is active. The live preview will reconnect after it is saved.");
      }
      updateStats().catch(error => tell("Phone status unavailable: " + error.message));
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          updateStats().catch(error => tell("Phone status unavailable: " + error.message));
        }, 10000);
      }
      if (!statusTimer) {
        statusTimer = setInterval(() => {
          refreshStatus().catch(error => tell("Camera status unavailable: " + error.message));
        }, 1500);
      }
    } catch (error) {
      stopPeer();
      if (!token) {
        byId("cameraCard").classList.add("hidden");
        byId("pairCard").classList.remove("hidden");
        byId("connection").textContent = "NOT PAIRED";
        byId("pair").disabled = false;
        byId("pairError").textContent =
          "The previous session is no longer active. Start Remote on the phone and pair with its current PIN.";
        return;
      }
      tell("Could not restore the camera preview: " + error.message);
    }
  }

  async function command(action, data) {
    try {
      await api(action, data);
      return true;
    } catch (error) {
      tell(error.message);
      return false;
    }
  }

  function renderRemoteStatus(status) {
    const paused = status.recordingState === "paused";
    const active = status.recordingState === "recording" || paused;
    if (active) {
      recordingStarted = true;
      setRecordingButtons(true, paused);
    } else if (!active && recordingStarted) {
      recordingStarted = false;
      setRecordingButtons(false);
    }
    if (!status.cameraAvailable) {
      if (peer) stopPeer();
      byId("connection").textContent = "CAMERA UNAVAILABLE";
      byId("preview").classList.add("hidden");
      byId("liveBadge").classList.add("hidden");
      tell("The shared camera preview is unavailable. Reconnect the camera.");
    } else {
      byId("preview").classList.remove("hidden");
      byId("liveBadge").classList.remove("hidden");
    }
    isFlashOn = status.flashEnabled === true;
    byId("flash").textContent = flashAvailable
      ? (isFlashOn ? "ϟ  Flash on" : "ϟ  Flash off")
      : byId("flash").textContent;
    byId("photoMode").classList.toggle("selected", status.captureMode === "photo");
    byId("videoMode").classList.toggle("selected", status.captureMode === "video");
    if (status.audioMode) {
      byId("audioDsp").classList.toggle("selected", status.audioMode === "dsp");
      byId("audioRaw").classList.toggle("selected", status.audioMode === "off");
      byId("audioDeep").classList.toggle("selected", status.audioMode === "deep");
    }
    if (status.audioCapabilities) {
      const hasDsp = status.audioCapabilities.hasHardwareNoiseSuppressor;
      byId("audioHwBadge").textContent = hasDsp ? "DSP READY" : "NO HARDWARE DSP";
      byId("audioHwBadge").style.color = hasDsp ? "#38e58e" : "#f59e0b";
      byId("audioHwBadge").style.borderColor = hasDsp ? "rgba(56,229,142,0.3)" : "rgba(245,158,11,0.3)";
      byId("audioDsp").disabled = !hasDsp;
    }
  }

  async function refreshStatus() {
    const status = await api("status");
    renderRemoteStatus(status);
  }

  async function flip() {
    if (await command("flip")) tell("Camera switched.");
  }

  async function flash() {
    if (!flashAvailable) {
      tell("This phone does not have a rear camera flash.");
      return;
    }
    const next = !isFlashOn;
    if (await command("flash", {enabled: next})) {
      isFlashOn = next;
      byId("flash").textContent = next ? "ϟ  Flash on" : "ϟ  Flash off";
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const stride = 0x8000;
    for (let i = 0; i < bytes.length; i += stride) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + stride));
    }
    return btoa(binary);
  }

  async function capture() {
    try {
      await setMode("photo");
    } catch (error) {
      tell("Could not switch to photo mode: " + error.message);
      return;
    }
    const video = byId("preview");
    if (!video.videoWidth || !video.videoHeight) {
      tell("Wait for the live camera preview before taking a photo.");
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d", {alpha: false}).drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) {
      tell("Could not capture a photo from the live stream.");
      return;
    }
    const image = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    if (await command("photo", {image})) tell("Photo saved to the phone gallery.");
  }

  async function startRecording() {
    if (!byId("preview").srcObject || peer?.connectionState !== "connected") {
      tell("Wait for the live camera preview before recording.");
      return;
    }
    byId("record").disabled = true;
    try {
      captureMode = await setMode("video");
      for (let seconds = 3; seconds > 0; seconds--) {
        const result = await api("record-countdown", {seconds});
        tell("VIDEO MODE READY · STARTING IN " + result.seconds);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await api("record-start");
      recordingStarted = true;
      setRecordingButtons(true, false);
      tell("Phone recording with microphone. Live camera preview stays on.");
    } catch (error) {
      if (recordingStarted) {
        await api("record-cancel").catch(() => {});
        recordingStarted = false;
      }
      setRecordingButtons(false);
      tell("Could not start recording: " + error.message);
    }
  }

  function setRecordingButtons(active, paused) {
    byId("record").disabled = active;
    byId("pause").disabled = !active || paused;
    byId("resume").disabled = !active || !paused;
    byId("end").disabled = !active;
    byId("closeSession").disabled = active;
  }

  async function pauseRecording() {
    if (recordingStarted && await command("record-pause")) {
      setRecordingButtons(true, true);
      tell("Phone recording paused.");
    }
  }

  async function resumeRecording() {
    if (recordingStarted && await command("record-resume")) {
      setRecordingButtons(true, false);
      tell("Phone recording resumed.");
    }
  }

  async function endRecording() {
    if (recordingStarted && await command("record-stop")) {
      recordingStarted = false;
      setRecordingButtons(false);
      tell("Phone video saved to Gallery. Live preview is still active.");
    }
  }

  async function closeSession() {
    byId("closeSession").disabled = true;
    try {
      await api("close-session");
      recordingStarted = false;
      token = "";
      localStorage.removeItem("blogcam_remote_token");
      stopPeer();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (statusTimer) clearInterval(statusTimer);
      statusTimer = null;
      byId("cameraCard").classList.add("hidden");
      byId("closedCard").classList.remove("hidden");
      byId("connection").textContent = "SESSION CLOSED";
    } catch (error) {
      byId("closeSession").disabled = false;
      tell(error.message);
    }
  }

  async function updateStats() {
    const stats = await api("stats");
    byId("battery").textContent = stats.battery + "%";
    byId("storage").textContent = stats.freeStorage;
    flashAvailable = stats.flashAvailable === true;
    byId("flash").disabled = !flashAvailable;
    byId("flash").textContent = flashAvailable
      ? (isFlashOn ? "ϟ  Flash on" : "ϟ  Flash off")
      : "ϟ  No flash";
  }

  async function reconnect() {
    if (recordingStarted) {
      tell("Finish the current recording before reconnecting the camera.");
      return;
    }
    stopPeer();
    byId("connection").textContent = "RECONNECTING";
    try {
      await connectCamera();
      await refreshStatus();
    } catch (error) {
      tell(error.message);
      byId("connection").textContent = "CAMERA DISCONNECTED";
    }
  }

  byId("pair").addEventListener("click", pair);
  byId("pin").addEventListener("keydown", event => { if (event.key === "Enter") pair(); });
  byId("flip").addEventListener("click", flip);
  byId("flash").addEventListener("click", flash);
  byId("settingsToggle").addEventListener("click", () => {
    const panel = byId("settingsPanel");
    const opened = panel.classList.toggle("hidden") === false;
    byId("settingsToggle").setAttribute("aria-expanded", String(opened));
  });
  byId("photoMode").addEventListener("click", () => setMode("photo").catch(error => tell(error.message)));
  byId("videoMode").addEventListener("click", () => setMode("video").catch(error => tell(error.message)));
  byId("capture").addEventListener("click", capture);
  byId("record").addEventListener("click", startRecording);
  byId("pause").addEventListener("click", pauseRecording);
  byId("resume").addEventListener("click", resumeRecording);
  byId("end").addEventListener("click", endRecording);
  async function setAudioMode(mode) {
    if (mode === "deep") {
      const proceed = confirm(
        "Deep Filter (Studio AI) Warning:\n\n" +
        "Neural software noise filtering runs on phone CPU. On longer videos, this will cause device warming, higher battery consumption, and a 1–3s save delay.\n\n" +
        "Do you want to enable Deep Filter?"
      );
      if (!proceed) return;
    }
    try {
      const result = await api("audio-mode", {audioMode: mode});
      if (result.ok) {
        byId("audioDsp").classList.toggle("selected", mode === "dsp");
        byId("audioRaw").classList.toggle("selected", mode === "off");
        byId("audioDeep").classList.toggle("selected", mode === "deep");
        if (mode === "dsp") {
          byId("audioNotice").textContent = "Hardware DSP active (secondary mic subtraction, 0% CPU).";
          tell("Audio mode set to DSP Hardware (Clean).");
        } else if (mode === "off") {
          byId("audioNotice").textContent = "Raw audio active (unfiltered natural acoustics).";
          tell("Audio mode set to Off (Raw Audio).");
        } else {
          byId("audioNotice").textContent = "Deep Filter active (Neural AI voice isolation).";
          tell("Audio mode set to Deep Filter (Studio AI).");
        }
      }
    } catch (e) {
      tell("Failed to update audio mode: " + e.message);
    }
  }

  byId("audioDsp").addEventListener("click", () => setAudioMode("dsp"));
  byId("audioRaw").addEventListener("click", () => setAudioMode("off"));
  byId("audioDeep").addEventListener("click", () => setAudioMode("deep"));
  byId("disconnect").addEventListener("click", reconnect);
  byId("closeSession").addEventListener("click", closeSession);
  window.addEventListener("pagehide", () => {
    endRecording();
    stopPeer();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
  });
  resumeSavedSession().catch(error => {
    tell("Could not restore the remote session: " + error.message);
  });
})();
</script>
</body>
</html>`;

export default remoteControlPage;
