const remoteControlPage = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#090b0f">
  <title>DexCam Studio Remote</title>
  <style>
    :root{color-scheme:dark;--bg:#05070a;--panel:#131720;--line:#272e3a;--text:#f6f4ef;--muted:#9aa3b2;--gold:#efbd75;--red:#f15e54;--glass:rgba(19,23,32,0.6)}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% 0%,#1a202c 0,var(--bg) 60%);color:var(--text);font:14px system-ui,-apple-system,sans-serif}
    main{width:min(100%,600px);margin:auto;padding:24px 16px;display:flex;flex-direction:column;gap:16px}
    header{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid var(--line)}
    .brand{font-size:18px;font-weight:800;letter-spacing:.12em}.brand span{display:block;color:var(--red);font-size:10px;letter-spacing:.2em;margin-top:2px}
    .badge{border:1px solid var(--line);border-radius:99px;color:var(--muted);padding:6px 12px;font-size:11px;font-weight:600;letter-spacing:.05em}
    .card{background:var(--glass);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:24px;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,0.4)}
    h1{font-size:20px;margin:0 0 8px;font-weight:600}p{color:var(--muted);line-height:1.5;margin:0 0 16px}
    input{width:100%;height:56px;border-radius:16px;border:1px solid #353d4b;background:#0a0c10;color:var(--text);font:700 24px system-ui;text-align:center;letter-spacing:.5em;outline:none;transition:0.2s}
    input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(239,189,117,0.15)}
    .wide{display:block;width:100%;margin-top:16px;background:var(--text);color:var(--bg);border:none;border-radius:16px;padding:16px;font:700 15px system-ui;cursor:pointer;transition:0.2s}
    .wide:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(255,255,255,0.1)}
    .hidden{display:none!important}
    .error{color:#ffaaa3;margin-top:12px;font-size:13px;text-align:center}.hint{font-size:12px;margin:16px 0 0;text-align:center;opacity:0.8}
    
    /* Video Area */
    .video-wrap{position:relative;border-radius:24px;background:#000;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,0.5);margin:0 auto}
    video{display:block;width:100%;height:100%;object-fit:contain;background:#000;transition:transform 0.25s ease}
    .video-overlay-top{position:absolute;top:12px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}
    .live{background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);border-radius:99px;padding:6px 10px;color:#fff;font-size:11px;font-weight:600;letter-spacing:.08em;display:flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,0.1)}
    .dot{width:6px;height:6px;border-radius:50%;background:var(--red);box-shadow:0 0 8px var(--red)}
    
    /* Icon Buttons overlay */
    .overlay-actions{display:flex;gap:8px;pointer-events:auto}
    .icon-btn{background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:50%;width:38px;height:38px;display:grid;place-items:center;cursor:pointer;font-size:16px;transition:0.2s;padding:0}
    .icon-btn:hover{background:rgba(255,255,255,0.2)}
    
    /* Action Area */
    .action-area{display:flex;flex-direction:column;align-items:center;padding:24px 0}
    .mode-controls{display:flex;background:#151a23;border-radius:99px;padding:4px;margin-bottom:24px}
    .mode-controls button{background:transparent;border:none;color:var(--muted);padding:8px 24px;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer;transition:0.2s}
    .mode-controls .selected{background:#2a3342;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
    
    .primary-controls{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:24px;width:100%}
    .big-btn{border:none;border-radius:24px;padding:16px 32px;font:700 16px system-ui;cursor:pointer;display:flex;align-items:center;gap:8px;transition:0.2s;flex:1;justify-content:center}
    .big-btn:disabled{opacity:0.4;cursor:not-allowed}
    #capture{background:#2a3342;color:#fff}
    #record{background:var(--red);color:#fff}
    
    .secondary-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
    .pill-btn{background:transparent;border:1px solid var(--line);border-radius:99px;padding:8px 16px;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;transition:0.2s}
    .pill-btn:disabled{opacity:0.3;cursor:default}
    .pill-btn:not(:disabled):hover{background:#2a3342}
    .danger-text{color:var(--red);border-color:rgba(241,94,84,0.3)}
    
    .settings-panel{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:20px;margin-top:16px;animation:fadein 0.2s}
    .settings-panel label{display:block;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.1em;margin:0 0 8px}
    .audio-btns{display:flex;gap:8px;margin-top:8px}
    .audio-btns button{flex:1;background:#1a202c;border:1px solid var(--line);border-radius:12px;padding:10px 4px;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer}
    .audio-btns .selected{background:#2a3342;color:#fff;border-color:#4a5568}
    
    .stats{display:flex;gap:16px;margin-top:24px}
    .stat{flex:1;background:rgba(255,255,255,0.03);border-radius:16px;padding:16px;text-align:center}
    .stat small{display:block;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.05em;margin-bottom:4px}
    .stat strong{font-size:20px;font-weight:700}
    
    .toast{text-align:center;color:var(--gold);font-size:13px;min-height:20px;margin-top:12px}
    @keyframes fadein{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
  </style>
</head>
<body>
<main>
  <header><div class="brand">DEXCAM STUDIO<span>BY PRIMADEX</span></div><div id="connection" class="badge">NOT PAIRED</div></header>
  <section id="pairCard" class="card">
    <h1>Connect to your camera</h1>
    <p>Enter the four-digit pairing PIN shown in DexCam Studio on the phone.</p>
    <input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" aria-label="Four digit pairing PIN" placeholder="••••">
    <button id="pair" class="wide">Pair with PIN</button>
    <div id="pairError" class="error"></div>
    <p class="hint">Only one browser can control the camera at a time. Keep the phone open on the remote-camera screen, and use this unencrypted local connection only on a trusted network.</p>
  </section>
  <section id="cameraCard" class="hidden">
    <div class="video-wrap">
      <video id="preview" autoplay playsinline muted></video>
      <div class="video-overlay-top">
        <div style="display:flex;gap:6px;align-items:center">
          <div id="liveBadge" class="live"><span class="dot"></span>LIVE</div>
          <div id="dimBadge" class="live" style="opacity:0.85;font-size:10px">—</div>
        </div>
        <div class="overlay-actions">
          <button id="rotateAngle" class="icon-btn" title="Rotate Angle (+90°)">⟳</button>
          <button id="flip" class="icon-btn" title="Flip camera">↻</button>
          <button id="flash" class="icon-btn" title="Flash off">ϟ</button>
          <button id="settingsToggle" class="icon-btn" title="Settings" aria-expanded="false">⚙</button>
        </div>
      </div>
    </div>
    <div id="toast" class="toast"></div>

    <div id="settingsPanel" class="settings-panel hidden">
      <label>LIVE CAMERA QUALITY</label>
      <p style="font-size:13px;margin-bottom:16px">Up to 720p / 30 fps streaming</p>
      <div style="border-top:1px solid var(--line);padding-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="margin:0">AUDIO NOISE SUPPRESSION</label>
          <span id="audioHwBadge" class="badge" style="color:#38e58e;border-color:rgba(56,229,142,0.3)">DSP READY</span>
        </div>
        <div class="audio-btns">
          <button id="audioDsp" class="selected">DSP (Clean)</button>
          <button id="audioRaw">Off (Raw)</button>
          <button id="audioDeep">AI Filter</button>
        </div>
        <p id="audioNotice" style="font-size:11px;color:var(--muted);margin-top:12px;text-align:center">Hardware DSP subtraction active (0% phone CPU load).</p>
      </div>
    </div>

    <div class="action-area">
      <div class="mode-controls">
        <button id="photoMode" class="selected">PHOTO MODE</button>
        <button id="videoMode">VIDEO MODE</button>
      </div>

      <div class="primary-controls">
        <button id="capture" class="big-btn">◎ Capture photo</button>
        <button id="record" class="big-btn">● Record</button>
      </div>

      <div class="secondary-actions">
        <button id="pause" class="pill-btn" disabled>Ⅱ Pause</button>
        <button id="resume" class="pill-btn" disabled>▶ Resume</button>
        <button id="end" class="pill-btn danger-text" disabled>■ End recording</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><small>PHONE BATTERY</small><strong id="battery">—</strong></div>
      <div class="stat"><small>PHONE FREE STORAGE</small><strong id="storage">—</strong></div>
    </div>
    
    <div style="display:flex;justify-content:center;gap:16px;margin-top:16px">
      <button id="disconnect" class="pill-btn" style="border:none">Reconnect</button>
      <button id="closeSession" class="pill-btn danger-text" style="border:none">Close session</button>
    </div>
    
    <p class="hint">Videos are recorded on the phone and saved to the Gallery album.</p>
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
    byId("capture").classList.toggle("hidden", captureMode === "video");
    byId("record").classList.toggle("hidden", captureMode === "photo");
    tell(captureMode.toUpperCase() + " mode ready on DexCam Studio.");
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
    byId("flash").classList.toggle("active", isFlashOn);
    byId("flash").title = flashAvailable ? (isFlashOn ? "Flash on" : "Flash off") : "Flash off";
    byId("photoMode").classList.toggle("selected", status.captureMode === "photo");
    byId("videoMode").classList.toggle("selected", status.captureMode === "video");
    byId("capture").classList.toggle("hidden", status.captureMode === "video");
    byId("record").classList.toggle("hidden", status.captureMode === "photo");
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
      byId("flash").classList.toggle("active", isFlashOn);
      byId("flash").title = isFlashOn ? "Flash is ON" : "Flash is OFF";
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
    byId("flash").classList.toggle("active", isFlashOn);
    byId("flash").title = flashAvailable ? (isFlashOn ? "Flash is ON" : "Flash is OFF") : "No flash";
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
  
  let activeRotation = parseInt(localStorage.getItem("dexcam_rotation") || "0", 10);

  function applyVideoRotation() {
    const video = byId("preview");
    if (!video) return;

    const rot = activeRotation % 360;
    if (rot === 90 || rot === 270) {
      video.style.transform = "rotate(" + rot + "deg) scale(0.5625)";
    } else if (rot === 180) {
      video.style.transform = "rotate(180deg)";
    } else {
      video.style.transform = "none";
    }

    const badge = byId("dimBadge");
    if (badge && video.videoWidth && video.videoHeight) {
      badge.textContent = video.videoWidth + "×" + video.videoHeight + " (" + rot + "°)";
    }
  }

  byId("rotateAngle").addEventListener("click", () => {
    activeRotation = (activeRotation + 90) % 360;
    localStorage.setItem("dexcam_rotation", String(activeRotation));
    applyVideoRotation();
    tell("Rotation angle set to: " + activeRotation + "°");
  });

  byId("preview").addEventListener("resize", applyVideoRotation);
  byId("preview").addEventListener("loadedmetadata", applyVideoRotation);
  applyVideoRotation();

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
