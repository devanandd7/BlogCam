/*
 * =================================================================================
 * DexCam Studio - IoT Broadcast Controller Firmware
 * Board: ESP32-S3 (ESP32S3 Dev Module)
 * Framework: Arduino IDE
 * 
 * Features:
 *  - Smart Wi-Fi Captive Portal (Webpage setup - No hardcoding required!)
 *  - Permanent NVS Flash memory storage for Wi-Fi credentials
 *  - Real-Time Bidirectional WebSocket Server (Port 81)
 *  - Zero Latency Impact on Video Preview
 *  - No PIN required (Direct auto-pairing over local network)
 *  - 10 Status LEDs showing live broadcast & camera states
 *  - 10 Tactile Push Buttons with hardware debounce
 *  - Hold Button 1 for 3 seconds at any time to re-open Wi-Fi Setup Webpage
 * =================================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebSocketsServer.h>

// =================================================================================
// 1. PIN CONFIGURATION
// =================================================================================

// 10 STATUS LEDs (OUTPUT)
#define PIN_LED_1   16  // LED 1: App Server Ready / Online (Solid ON when connected)
#define PIN_LED_2   17  // LED 2: OBS Studio Status (Solid ON when OBS connected)
#define PIN_LED_3   18  // LED 3: Recording Status (Solid ON = Rec, Blink = Paused, OFF = Idle)
#define PIN_LED_4   8   // LED 4: Flash / Torch Status (ON = Torch Active)
#define PIN_LED_5   9   // LED 5: Camera Facing (ON = Front Camera, OFF = Back Camera)
#define PIN_LED_6   1   // LED 6: Action 6 Indicator
#define PIN_LED_7   2   // LED 7: Action 7 Indicator
#define PIN_LED_8   42  // LED 8: Action 8 Indicator
#define PIN_LED_9   41  // LED 9: Action 9 Indicator
#define PIN_LED_10  40  // LED 10: Action 10 Indicator

// 10 PUSH BUTTONS (INPUT_PULLUP - Pressed connects to GND)
#define PIN_BTN_1   4   // BTN 1: Record Toggle / (Hold 3s to reset Wi-Fi)
#define PIN_BTN_2   5   // BTN 2: Pause / Resume Recording
#define PIN_BTN_3   6   // BTN 3: Camera Flip (Switch Back / Front)
#define PIN_BTN_4   7   // BTN 4: Flash / Torch Toggle
#define PIN_BTN_5   15  // BTN 5: Photo Capture / Snapshot
#define PIN_BTN_6   10  // BTN 6: Close / Stop Remote Session
#define PIN_BTN_7   11  // BTN 7: Reserved / Custom 7
#define PIN_BTN_8   12  // BTN 8: Reserved / Custom 8
#define PIN_BTN_9   13  // BTN 9: Reserved / Custom 9
#define PIN_BTN_10  14  // BTN 10: Reserved / Custom 10

const int LED_PINS[10] = {
  PIN_LED_1, PIN_LED_2, PIN_LED_3, PIN_LED_4, PIN_LED_5,
  PIN_LED_6, PIN_LED_7, PIN_LED_8, PIN_LED_9, PIN_LED_10
};

const int BTN_PINS[10] = {
  PIN_BTN_1, PIN_BTN_2, PIN_BTN_3, PIN_BTN_4, PIN_BTN_5,
  PIN_BTN_6, PIN_BTN_7, PIN_BTN_8, PIN_BTN_9, PIN_BTN_10
};

// =================================================================================
// 2. GLOBAL OBJECTS & CONFIG
// =================================================================================
const char* AP_SSID = "DexCam-Controller-Setup";  // Setup Hotspot Name (Open)
const byte DNS_PORT = 53;
IPAddress apIP(192, 168, 4, 1);

Preferences preferences;
WebServer webServer(80);
DNSServer dnsServer;
WebSocketsServer webSocket(81);

bool inConfigPortal = false;
String savedSsid = "";
String savedPass = "";

// App States (Synced from DexCam Studio)
bool appConnected = false;
bool serverReady = false;
bool obsConnected = false;
String recordingState = "idle";
bool flashEnabled = false;
String cameraFacing = "back";

// Button Debounce and State Tracking
int lastButtonState[10];
unsigned long lastDebounceTime[10];
const unsigned long DEBOUNCE_DELAY = 50;

// Button 1 Long Press for Wi-Fi Reset
unsigned long btn1PressStart = 0;
bool btn1IsHeld = false;

// LED Blink Timers
unsigned long lastBlinkTime = 0;
bool blinkToggle = false;
unsigned long ledFeedbackUntil[10] = {0};

// Forward Declarations
void startConfigPortal();
void handlePortalRoot();
void handlePortalSave();
void handlePortalScan();
bool connectToSavedWifi();
void handleWebSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);
void parseAppStateJson(const String& json);
void sendActionToApp(const char* actionName);
void updateLedStates();
void runLedSelfTest();

// =================================================================================
// 3. SETUP
// =================================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n========================================");
  Serial.println("  DexCam Studio - ESP32-S3 Controller   ");
  Serial.println("========================================");

  // Initialize LEDs
  for (int i = 0; i < 10; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    digitalWrite(LED_PINS[i], LOW);
  }

  // Initialize Buttons
  for (int i = 0; i < 10; i++) {
    pinMode(BTN_PINS[i], INPUT_PULLUP);
    lastButtonState[i] = HIGH;
    lastDebounceTime[i] = 0;
  }

  // Visual LED Self-Test
  Serial.println("[TEST] Running LED startup self-test...");
  runLedSelfTest();
  Serial.println("[TEST] Self-test complete!");

  // Load Saved Wi-Fi Credentials from NVS Flash (No hardcoded credentials)
  preferences.begin("dexcam", false);
  savedSsid = preferences.getString("ssid", "");
  savedPass = preferences.getString("pass", "");

  Serial.print("[NVS] Stored Wi-Fi SSID: ");
  Serial.println(savedSsid.length() > 0 ? savedSsid : "(No Wi-Fi configured yet)");

  // Check if Button 1 is pressed on boot OR no Wi-Fi is saved yet
  if (digitalRead(PIN_BTN_1) == LOW || savedSsid.length() == 0) {
    Serial.println("[CONFIG] Starting Wi-Fi Setup Webpage Portal...");
    startConfigPortal();
    return;
  }

  // Try connecting to saved Wi-Fi
  if (connectToSavedWifi()) {
    // Wi-Fi connected! Start WebSocket Server
    webSocket.begin();
    webSocket.onEvent(handleWebSocketEvent);
    Serial.println("[WS] WebSocket Server started on port 81!");
    Serial.println("[WS] Ready for DexCam Studio connection (No PIN needed).");
  } else {
    // Failed to connect -> Start Webpage Portal
    Serial.println("[WIFI] Could not connect to saved Wi-Fi. Launching Setup Webpage...");
    startConfigPortal();
  }
}

// =================================================================================
// 4. MAIN LOOP
// =================================================================================
void loop() {
  // If in Wi-Fi Configuration Webpage Mode
  if (inConfigPortal) {
    dnsServer.processNextRequest();
    webServer.handleClient();

    // Fast blink on LED 1 to show Config Webpage is active
    unsigned long now = millis();
    if (now - lastBlinkTime > 200) {
      lastBlinkTime = now;
      digitalWrite(PIN_LED_1, !digitalRead(PIN_LED_1));
    }
    return;
  }

  // Normal Operating Mode
  webSocket.loop();

  // Handle Button Presses
  for (int i = 0; i < 10; i++) {
    int reading = digitalRead(BTN_PINS[i]);

    if (reading != lastButtonState[i]) {
      lastDebounceTime[i] = millis();
    }

    if ((millis() - lastDebounceTime[i]) > DEBOUNCE_DELAY) {
      static int currentConfirmedState[10] = {HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH};
      if (reading != currentConfirmedState[i]) {
        currentConfirmedState[i] = reading;

        // Button Pressed DOWN
        if (reading == LOW) {
          Serial.print("[BUTTON] Pressed: Button ");
          Serial.println(i + 1);

          if (i == 0) {
            btn1PressStart = millis();
            btn1IsHeld = true;
          }

          ledFeedbackUntil[i] = millis() + 200;

          switch (i) {
            case 0: // BTN 1 -> Toggle Recording (Start / Stop)
              sendActionToApp("record-toggle");
              break;
            case 1: // BTN 2 -> Pause / Resume Recording
              sendActionToApp("record-pause-toggle");
              break;
            case 2: // BTN 3 -> Flip Camera (Front / Back)
              sendActionToApp("flip");
              break;
            case 3: // BTN 4 -> Flash / Torch Toggle
              sendActionToApp("flash");
              break;
            case 4: // BTN 5 -> Photo Capture
              sendActionToApp("photo");
              break;
            case 5: // BTN 6 -> Close Remote Session
              sendActionToApp("close-session");
              break;
            case 6: // BTN 7
              sendActionToApp("custom-btn-7");
              break;
            case 7: // BTN 8
              sendActionToApp("custom-btn-8");
              break;
            case 8: // BTN 9
              sendActionToApp("custom-btn-9");
              break;
            case 9: // BTN 10
              sendActionToApp("custom-btn-10");
              break;
          }
        } else {
          // Button Released
          if (i == 0) {
            btn1IsHeld = false;
          }
        }
      }
    }
    lastButtonState[i] = reading;
  }

  // Check if Button 1 held for 3 seconds -> Reset to Wi-Fi Config Webpage
  if (btn1IsHeld && (millis() - btn1PressStart > 3000)) {
    Serial.println("[RESET] Button 1 held for 3 seconds! Opening Wi-Fi Setup Portal...");
    btn1IsHeld = false;
    startConfigPortal();
    return;
  }

  // Update LED Indicator States
  updateLedStates();
}

// =================================================================================
// 5. WI-FI CONNECTION ATTEMPT
// =================================================================================
bool connectToSavedWifi() {
  Serial.print("[WIFI] Connecting to: ");
  Serial.println(savedSsid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(savedSsid.c_str(), savedPass.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(400);
    Serial.print(".");
    digitalWrite(PIN_LED_1, !digitalRead(PIN_LED_1));
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.print("[WIFI] Local IP Address: ");
    Serial.println(WiFi.localIP());
    digitalWrite(PIN_LED_1, HIGH);
    return true;
  }

  Serial.println("\n[WIFI] Connection failed or timed out.");
  return false;
}

// =================================================================================
// 6. CAPTIVE PORTAL & WEBPAGE SETUP
// =================================================================================
void startConfigPortal() {
  inConfigPortal = true;
  WiFi.disconnect();
  delay(100);

  // Start Access Point
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(AP_SSID);

  Serial.println("\n========================================");
  Serial.println("[SETUP PORTAL] Hotspot started!");
  Serial.print("[SETUP PORTAL] Connect to Wi-Fi: ");
  Serial.println(AP_SSID);
  Serial.print("[SETUP PORTAL] Open browser at: http://");
  Serial.println(WiFi.softAPIP());
  Serial.println("========================================\n");

  // Captive Portal DNS redirection
  dnsServer.start(DNS_PORT, "*", apIP);

  // Web Server Routes
  webServer.on("/", HTTP_GET, handlePortalRoot);
  webServer.on("/save", HTTP_POST, handlePortalSave);
  webServer.on("/scan", HTTP_GET, handlePortalScan);

  // Captive portal detection endpoints (Android / iOS auto-popup)
  webServer.on("/generate_204", HTTP_GET, handlePortalRoot);
  webServer.on("/gen_204", HTTP_GET, handlePortalRoot);
  webServer.on("/hotspot-detect.html", HTTP_GET, handlePortalRoot);
  webServer.on("/ncsi.txt", HTTP_GET, handlePortalRoot);
  webServer.on("/connecttest.txt", HTTP_GET, handlePortalRoot);

  webServer.onNotFound(handlePortalRoot);
  webServer.begin();
}

void handlePortalRoot() {
  // Scan Wi-Fi Networks
  int n = WiFi.scanNetworks();
  String options = "";
  for (int i = 0; i < n; ++i) {
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    if (ssid.length() > 0) {
      options += "<option value='" + ssid + "'>" + ssid + " (" + String(rssi) + " dBm)</option>";
    }
  }

  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DexCam Studio - Wi-Fi Setup</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0c0f15; color: #fff; margin: 0; padding: 24px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #161b24; border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; padding: 26px; width: 100%; max-width: 380px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
    h2 { color: #f1bd76; margin: 0 0 6px; font-size: 19px; font-weight: 800; letter-spacing: 1px; }
    p { color: #9da6b4; font-size: 13px; margin: 0 0 20px; line-height: 18px; }
    label { display: block; font-size: 11px; font-weight: 700; color: #c4ccd8; letter-spacing: 0.8px; margin-bottom: 6px; }
    select, input { width: 100%; background: #080a0f; border: 1px solid #313a48; border-radius: 10px; color: #fff; font-size: 14px; padding: 12px; margin-bottom: 16px; outline: none; }
    select:focus, input:focus { border-color: #f1bd76; }
    button { width: 100%; background: #f1bd76; color: #12161e; border: none; border-radius: 10px; font-size: 13px; font-weight: 800; letter-spacing: 1px; padding: 14px; cursor: pointer; transition: 0.2s; }
    button:active { transform: scale(0.98); }
    .footer { text-align: center; color: #576171; font-size: 10px; margin-top: 18px; font-weight: 700; letter-spacing: 1.5px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>DEXCAM STUDIO</h2>
    <p>Select your Wi-Fi router or Mobile Hotspot to connect your ESP32-S3 broadcast controller.</p>
    <form action="/save" method="POST">
      <label>AVAILABLE WI-FI NETWORKS</label>
      <select id="sel" onchange="document.getElementById('manual').value=this.value">
        <option value="">-- Choose Wi-Fi --</option>
)rawliteral";

  html += options;

  html += R"rawliteral(
      </select>
      <label>WI-FI NAME (SSID)</label>
      <input type="text" id="manual" name="ssid" placeholder="Enter Wi-Fi name" required>
      <label>WI-FI PASSWORD</label>
      <input type="password" name="pass" placeholder="Enter password">
      <button type="submit">SAVE & CONNECT</button>
    </form>
    <div class="footer">ESP32-S3 BROADCAST CONTROLLER</div>
  </div>
</body>
</html>
)rawliteral";

  webServer.send(200, "text/html", html);
}

void handlePortalSave() {
  if (webServer.hasArg("ssid")) {
    savedSsid = webServer.arg("ssid");
    savedPass = webServer.hasArg("pass") ? webServer.arg("pass") : "";

    // Save to permanent NVS Flash
    preferences.putString("ssid", savedSsid);
    preferences.putString("pass", savedPass);

    String successHtml = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connecting...</title>
  <style>
    body { background: #0c0f15; color: #fff; font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: #161b24; border: 1px solid rgba(46,213,115,0.4); border-radius: 18px; padding: 28px; max-width: 360px; }
    h2 { color: #2ed573; margin-top: 0; }
    p { color: #a4b0be; font-size: 14px; line-height: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Credentials Saved!</h2>
    <p>ESP32 is now connecting to <b>)rawliteral";
    successHtml += savedSsid;
    successHtml += R"rawliteral(</b>.<br><br>Connect your phone back to your Wi-Fi/Hotspot and open DexCam Studio app!</p>
  </div>
</body>
</html>
)rawliteral";

    webServer.send(200, "text/html", successHtml);
    delay(1000);

    // Stop Portal and Restart in Normal Mode
    ESP.restart();
  } else {
    webServer.send(400, "text/plain", "Missing SSID");
  }
}

void handlePortalScan() {
  int n = WiFi.scanNetworks();
  String json = "[";
  for (int i = 0; i < n; ++i) {
    if (i > 0) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]";
  webServer.send(200, "application/json", json);
}

// =================================================================================
// 7. WEBSOCKET EVENT HANDLER
// =================================================================================
void handleWebSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[WS] Client #%u Disconnected!\n", num);
      appConnected = false;
      break;

    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[WS] DexCam Studio Connected from: %d.%d.%d.%d\n", ip[0], ip[1], ip[2], ip[3]);
      appConnected = true;

      // Welcome handshake
      String helloMsg = "{\"type\":\"welcome\",\"device\":\"esp32s3-controller\",\"status\":\"ready\"}";
      webSocket.sendTXT(num, helloMsg);
      break;
    }

    case WStype_TEXT: {
      String message = "";
      for (size_t i = 0; i < length; i++) {
        message += (char)payload[i];
      }
      parseAppStateJson(message);
      break;
    }

    default:
      break;
  }
}

// =================================================================================
// 8. SEND ACTION TO PHONE APP
// =================================================================================
void sendActionToApp(const char* actionName) {
  String json = "{\"type\":\"action\",\"action\":\"" + String(actionName) + "\"}";
  webSocket.broadcastTXT(json);
  Serial.print("[WS] Sent Action: ");
  Serial.println(json);
}

// =================================================================================
// 9. LIGHTWEIGHT JSON STATE PARSER
// =================================================================================
void parseAppStateJson(const String& json) {
  if (json.indexOf("\"type\":\"state\"") == -1 && json.indexOf("\"type\": \"state\"") == -1) {
    return;
  }

  // Parse serverReady
  if (json.indexOf("\"serverReady\":true") != -1 || json.indexOf("\"serverReady\": true") != -1) {
    serverReady = true;
  } else if (json.indexOf("\"serverReady\":false") != -1 || json.indexOf("\"serverReady\": false") != -1) {
    serverReady = false;
  }

  // Parse obsConnected
  if (json.indexOf("\"obsConnected\":true") != -1 || json.indexOf("\"obsConnected\": true") != -1) {
    obsConnected = true;
  } else if (json.indexOf("\"obsConnected\":false") != -1 || json.indexOf("\"obsConnected\": false") != -1) {
    obsConnected = false;
  }

  // Parse recordingState
  if (json.indexOf("\"recordingState\":\"recording\"") != -1 || json.indexOf("\"recordingState\": \"recording\"") != -1) {
    recordingState = "recording";
  } else if (json.indexOf("\"recordingState\":\"paused\"") != -1 || json.indexOf("\"recordingState\": \"paused\"") != -1) {
    recordingState = "paused";
  } else if (json.indexOf("\"recordingState\":\"idle\"") != -1 || json.indexOf("\"recordingState\": \"idle\"") != -1) {
    recordingState = "idle";
  }

  // Parse flashEnabled
  if (json.indexOf("\"flashEnabled\":true") != -1 || json.indexOf("\"flashEnabled\": true") != -1) {
    flashEnabled = true;
  } else if (json.indexOf("\"flashEnabled\":false") != -1 || json.indexOf("\"flashEnabled\": false") != -1) {
    flashEnabled = false;
  }

  // Parse cameraFacing
  if (json.indexOf("\"cameraFacing\":\"front\"") != -1 || json.indexOf("\"cameraFacing\": \"front\"") != -1) {
    cameraFacing = "front";
  } else if (json.indexOf("\"cameraFacing\":\"back\"") != -1 || json.indexOf("\"cameraFacing\": \"back\"") != -1) {
    cameraFacing = "back";
  }

  Serial.printf("[STATE SYNC] Srv:%d | OBS:%d | Rec:%s | Flash:%d | Facing:%s\n",
    serverReady, obsConnected, recordingState.c_str(), flashEnabled, cameraFacing.c_str());
}

// =================================================================================
// 10. LED STATE UPDATE LOGIC
// =================================================================================
void updateLedStates() {
  unsigned long now = millis();

  if (now - lastBlinkTime > 500) {
    lastBlinkTime = now;
    blinkToggle = !blinkToggle;
  }

  // LED 1: Server Ready / Connected
  if (appConnected && serverReady) {
    digitalWrite(PIN_LED_1, HIGH);
  } else if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_LED_1, blinkToggle ? HIGH : LOW);
  } else {
    digitalWrite(PIN_LED_1, LOW);
  }

  // LED 2: OBS Studio Status
  digitalWrite(PIN_LED_2, obsConnected ? HIGH : LOW);

  // LED 3: Recording Status
  if (recordingState == "recording") {
    digitalWrite(PIN_LED_3, HIGH);
  } else if (recordingState == "paused") {
    digitalWrite(PIN_LED_3, blinkToggle ? HIGH : LOW);
  } else {
    digitalWrite(PIN_LED_3, LOW);
  }

  // LED 4: Flash / Torch Status
  digitalWrite(PIN_LED_4, flashEnabled ? HIGH : LOW);

  // LED 5: Camera Facing
  digitalWrite(PIN_LED_5, (cameraFacing == "front") ? HIGH : LOW);

  // LEDs 6 to 10: Feedback pulse when button pressed
  for (int i = 5; i < 10; i++) {
    if (now < ledFeedbackUntil[i]) {
      digitalWrite(LED_PINS[i], HIGH);
    } else {
      digitalWrite(LED_PINS[i], LOW);
    }
  }
}

// =================================================================================
// 11. LED CHASE SELF-TEST ROUTINE
// =================================================================================
void runLedSelfTest() {
  for (int i = 0; i < 10; i++) {
    digitalWrite(LED_PINS[i], HIGH);
    delay(60);
    digitalWrite(LED_PINS[i], LOW);
  }
  for (int i = 9; i >= 0; i--) {
    digitalWrite(LED_PINS[i], HIGH);
    delay(60);
    digitalWrite(LED_PINS[i], LOW);
  }
  for (int b = 0; b < 2; b++) {
    for (int i = 0; i < 10; i++) digitalWrite(LED_PINS[i], HIGH);
    delay(120);
    for (int i = 0; i < 10; i++) digitalWrite(LED_PINS[i], LOW);
    delay(120);
  }
}
