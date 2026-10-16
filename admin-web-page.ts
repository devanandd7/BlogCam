const adminWebPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DexCam Studio - Developer Admin & Telemetry</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0a0d14;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      padding: 16px;
      font-size: 13px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid #1e293b;
      margin-bottom: 16px;
    }
    .brand {
      color: #f1bd76;
      font-weight: 800;
      font-size: 16px;
      letter-spacing: 1px;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 10px;
      letter-spacing: 0.5px;
    }
    .badge-green { background: rgba(46, 213, 115, 0.2); color: #2ed573; border: 1px solid #2ed573; }
    .badge-red { background: rgba(255, 71, 87, 0.2); color: #ff4757; border: 1px solid #ff4757; }
    .badge-yellow { background: rgba(254, 202, 87, 0.2); color: #feca57; border: 1px solid #feca57; }

    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: #131822;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px;
    }
    .stat-label { color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .stat-value { font-size: 18px; font-weight: 800; color: #fff; margin-top: 4px; }

    .controls-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    input[type="text"] {
      background: #131822;
      border: 1px solid #334155;
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      flex: 1;
      min-width: 180px;
    }
    button {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: #334155; }
    button.btn-danger { background: rgba(255, 71, 87, 0.2); color: #ff4757; border-color: #ff4757; }
    button.btn-danger:hover { background: #ff4757; color: #fff; }
    button.btn-active { background: #f1bd76; color: #0a0d14; border-color: #f1bd76; }

    .terminal {
      background: #05070a;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px;
      height: 520px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 11px;
      line-height: 18px;
    }
    .log-line {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      padding: 3px 0;
    }
    .time { color: #475569; }
    .lvl-ERROR { color: #ff4757; font-weight: 700; }
    .lvl-WARN { color: #feca57; font-weight: 700; }
    .lvl-METRIC { color: #2ed573; font-weight: 700; }
    .lvl-INFO { color: #70a1ff; }
    .lvl-DEBUG { color: #94a3b8; }
    .cat { color: #f1bd76; font-weight: 700; }
    .evt { color: #fff; }
    .data { color: #94a3b8; word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="brand">⚡ DEXCAM DEVELOPER ADMIN</div>
      <div style="color: #64748b; font-size: 11px; margin-top: 2px;" id="deviceInfo">Loading device profile...</div>
    </div>
    <div style="display: flex; gap: 8px;">
      <span class="badge badge-green" id="obsStatus">OBS IDLE</span>
      <span class="badge badge-yellow" id="espStatus">ESP32 CHECKING</span>
    </div>
  </header>

  <div class="grid-stats">
    <div class="stat-card">
      <div class="stat-label">Camera / Preview FPS</div>
      <div class="stat-value" id="statFps">--</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Frame Drops</div>
      <div class="stat-value" id="statDrops">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Quality Limitation</div>
      <div class="stat-value" id="statQuality">NONE</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Battery Temp</div>
      <div class="stat-value" id="statTemp" style="color: #38e58e;">--°C</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Battery % & Charging</div>
      <div class="stat-value" id="statBatt">--%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">RAM Usage</div>
      <div class="stat-value" id="statRam">-- MB</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Thermal Throttling</div>
      <div class="stat-value" id="statThermal">NORMAL</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">ESP32 Status</div>
      <div class="stat-value" id="statEsp">READY</div>
    </div>
  </div>

  <div class="controls-bar">
    <input type="text" id="searchInput" placeholder="Search events, errors, or json payload..." oninput="renderLogs()">
    <button onclick="setFilter('ALL')" id="filterALL" class="btn-active">ALL</button>
    <button onclick="setFilter('OBS')" id="filterOBS">OBS</button>
    <button onclick="setFilter('ESP32')" id="filterESP32">ESP32</button>
    <button onclick="setFilter('CAMERA')" id="filterCAMERA">CAMERA</button>
    <button onclick="setFilter('METRIC')" id="filterMETRIC">METRICS</button>
    <button onclick="setFilter('ERROR')" id="filterERROR">ERRORS</button>
    <button onclick="togglePause()" id="pauseBtn">⏸ PAUSE</button>
    <button onclick="downloadLogs()">📥 DOWNLOAD FILE</button>
    <button onclick="clearLogs()" class="btn-danger">🗑️ CLEAR ALL</button>
  </div>

  <div class="terminal" id="terminal">
    <div style="color: #64748b; text-align: center; padding: 40px;">Connecting to DexCam Studio telemetry engine...</div>
  </div>

  <script>
    let allLogs = [];
    let currentFilter = 'ALL';
    let isPaused = false;

    function setFilter(f) {
      currentFilter = f;
      document.querySelectorAll('.controls-bar button').forEach(b => {
        if (b.id && b.id.startsWith('filter')) b.classList.remove('btn-active');
      });
      const el = document.getElementById('filter' + f);
      if (el) el.classList.add('btn-active');
      renderLogs();
    }

    function togglePause() {
      isPaused = !isPaused;
      document.getElementById('pauseBtn').textContent = isPaused ? '▶ RESUME' : '⏸ PAUSE';
      if (!isPaused) pollLogs();
    }

    async function pollLogs() {
      if (isPaused) return;
      try {
        const res = await fetch('/api/admin-telemetry');
        if (res.ok) {
          const data = await res.json();
          if (data.context) {
            document.getElementById('deviceInfo').textContent =
              data.context.deviceBrand + ' ' + data.context.deviceModel + ' · Android ' + data.context.androidVersion + ' · ' + data.context.totalMemoryMB + 'MB RAM · Build ' + data.context.buildNumber;
          }
          if (data.status) {
            document.getElementById('obsStatus').textContent = data.status.obsConnected ? 'OBS LIVE' : 'OBS IDLE';
            document.getElementById('obsStatus').className = 'badge ' + (data.status.obsConnected ? 'badge-green' : 'badge-yellow');
            document.getElementById('espStatus').textContent = data.status.espConnected ? 'ESP32 ON' : 'ESP32 OFF';
            document.getElementById('espStatus').className = 'badge ' + (data.status.espConnected ? 'badge-green' : 'badge-red');
            document.getElementById('statFps').textContent = data.status.fps || '--';
            document.getElementById('statDrops').textContent = data.status.droppedFrames || '0';
            document.getElementById('statQuality').textContent = data.status.qualityLimit || 'NONE';
            document.getElementById('statEsp').textContent = data.status.espConnected ? 'CONNECTED' : 'WAITING';
          if (data.hardware) {
            const temp = data.hardware.batteryTempC;
            const tempEl = document.getElementById('statTemp');
            if (tempEl) {
              tempEl.textContent = temp.toFixed(1) + '°C';
              tempEl.style.color = temp >= 40 ? '#ff4757' : (temp >= 37 ? '#feca57' : '#2ed573');
            }
            const battEl = document.getElementById('statBatt');
            if (battEl) {
              battEl.textContent = data.hardware.batteryLevel + '% ' + (data.hardware.isCharging ? '⚡ (Charging)' : '');
            }
            const ramEl = document.getElementById('statRam');
            if (ramEl) {
              ramEl.textContent = Math.round(data.hardware.usedMemoryMB) + ' / ' + Math.round(data.hardware.totalMemoryMB) + ' MB';
            }
            const thermalEl = document.getElementById('statThermal');
            if (thermalEl) {
              thermalEl.textContent = data.hardware.thermalStatus || 'NORMAL';
              thermalEl.style.color = data.hardware.thermalStatus && data.hardware.thermalStatus.includes('THROTTLING') ? '#ff4757' : '#2ed573';
            }
          }
          if (Array.isArray(data.logs)) {
            allLogs = data.logs;
            renderLogs();
          }
        }
      } catch (err) {
        console.warn('Poll error:', err);
      }
    }

    function renderLogs() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const filtered = allLogs.filter(item => {
        if (currentFilter === 'ERROR' && item.level !== 'ERROR') return false;
        if (currentFilter !== 'ALL' && currentFilter !== 'ERROR' && item.category !== currentFilter) return false;
        if (q) {
          const hay = (item.event + ' ' + item.category + ' ' + JSON.stringify(item.data || '') + ' ' + (item.error || '')).toLowerCase();
          return hay.includes(q);
        }
        return true;
      });

      const term = document.getElementById('terminal');
      if (filtered.length === 0) {
        term.innerHTML = '<div style="color: #64748b; text-align: center; padding: 40px;">No logs matching current filter</div>';
        return;
      }

      term.innerHTML = filtered.map(item => {
        return '<div class="log-line">' +
          '<span class="time">' + item.timestampLocal + '</span>' +
          '<span class="lvl-' + item.level + '">[' + item.level + ']</span>' +
          '<span class="cat">[' + item.category + ']</span>' +
          '<span class="evt">' + item.event + '</span>' +
          (item.data ? '<span class="data">' + JSON.stringify(item.data) + '</span>' : '') +
          (item.error ? '<span class="lvl-ERROR">❌ ' + item.error + '</span>' : '') +
        '</div>';
      }).join('');

      term.scrollTop = term.scrollHeight;
    }

    async function clearLogs() {
      if (!confirm('Are you sure you want to clear all active and stored logs?')) return;
      await fetch('/api/admin-clear-logs', { method: 'POST' });
      allLogs = [];
      renderLogs();
    }

    function downloadLogs() {
      const text = allLogs.map(l => JSON.stringify(l)).join('\\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dexcam_session_' + Date.now() + '.log';
      a.click();
    }

    setInterval(pollLogs, 2500);
    pollLogs();
  </script>
</body>
</html>`;

export default adminWebPage;
