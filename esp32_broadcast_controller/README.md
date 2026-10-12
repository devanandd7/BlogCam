# DexCam Studio - ESP32-S3 IoT Broadcast Controller

Firmware for ESP32-S3 to interface 10 push buttons and 10 status LEDs with the **DexCam Studio** mobile camera app over low-latency WebSocket.

---

## 🚦 LED Indicators & Signals Guide (LED सिग्नल की पूरी जानकारी)

Aapke board par lage **10 LEDs** har broadcast state ko real-time show karte hain. Har LED ka behavior aur signal neeche detail me diya gaya hai:

| LED # | GPIO Pin | Recommended Color | Function / Indicator | LED Signal States (Kaise React Karegi) |
| :---: | :---: | :---: | :--- | :--- |
| **LED 1** | **GPIO 16** | 🟢 **Green** | **App Server & WebSocket Status** | • **Fast Blink (Tez Timtimana):** Wi-Fi Setup Webpage chalu hai (`DexCam-Controller-Setup`).<br>• **Slow Blink:** Wi-Fi se connect ho gaya hai, Mobile App ke judne ka wait ho raha hai.<br>• **Solid ON (Lagaataar Jale):** DexCam Studio App jud chuki hai aur Server bilkul Ready hai!<br>• **OFF:** Wi-Fi disconnected. |
| **LED 2** | **GPIO 17** | 🔵 **Blue** | **OBS Studio Status** | • **Solid ON:** OBS Studio laptop se connect ho gaya hai aur streaming/preview active hai.<br>• **OFF:** OBS Studio connect nahi hai. |
| **LED 3** | **GPIO 18** | 🔴 **Red** | **Recording Tally Light (Universal Rec)** | • **Solid ON (Lagaataar Red):** Camera me **Video Recording CHALU** hai!<br>• **Fast Blink (Blinking Red):** Recording **PAUSED (Ruki hui)** hai.<br>• **OFF:** Camera Idle hai (Recording band hai). |
| **LED 4** | **GPIO 8** | 🟢 **Green** / 🔵 **Blue** | **Torch / Flash Light Indicator** | • **Solid ON:** Mobile camera ka Flash/Torch ON hai.<br>• **OFF:** Flash/Torch OFF hai. |
| **LED 5** | **GPIO 9** | 🟢 **Green** / 🔵 **Blue** | **Camera Lens (Facing) Indicator** | • **Solid ON:** FRONT (Selfie) camera active hai.<br>• **OFF:** REAR (Main Back) camera active hai. |
| **LED 6** | **GPIO 1** | 🔴 / 🔵 / 🟢 | **Action 6 Confirmation** | • **200ms Flash Pulse:** Button 6 press hone par instant visual feedback. |
| **LED 7** | **GPIO 2** | 🔴 / 🔵 / 🟢 | **Action 7 Confirmation** | • **200ms Flash Pulse:** Button 7 press hone par instant visual feedback. |
| **LED 8** | **GPIO 42** | 🔴 / 🔵 / 🟢 | **Action 8 Confirmation** | • **200ms Flash Pulse:** Button 8 press hone par instant visual feedback. |
| **LED 9** | **GPIO 41** | 🔴 / 🔵 / 🟢 | **Action 9 Confirmation** | • **200ms Flash Pulse:** Button 9 press hone par instant visual feedback. |
| **LED 10** | **GPIO 40** | 🔴 / 🔵 / 🟢 | **Action 10 Confirmation** | • **200ms Flash Pulse:** Button 10 press hone par instant visual feedback. |

> **Startup Self-Test:** Board on hote hi sabhi 10 LEDs par ek baar running light (Knight Rider chase) animation chalega. Isse verify ho jata hai ki saari 10 LEDs aur unke connections 100% sahi hain.

---

## 🎛️ Button Controls & Mapping (Push Buttons ka Kaam)

Board par lage **10 Tactile Push Buttons** se mobile app ke controls operate hote hain:

| Button # | GPIO Pin | Action Triggered | Behavior |
| :---: | :---: | :--- | :--- |
| **BTN 1** | **GPIO 4** | **Record Toggle** / **Wi-Fi Reset** | • **Short Press:** Recording Start / Stop toggle karein.<br>• **Hold 3 Seconds:** Wi-Fi reset karke **Setup Webpage** dobara kholein. |
| **BTN 2** | **GPIO 5** | **Record Pause / Resume** | Recording ke dauran Pause karein ya wapas Resume karein. |
| **BTN 3** | **GPIO 6** | **Camera Flip** | Front camera aur Back camera ke beech switch karein. |
| **BTN 4** | **GPIO 7** | **Flash / Torch Toggle** | Mobile torch ko ON ya OFF karein. |
| **BTN 5** | **GPIO 15** | **Photo Capture** | Live photo/snapshot capture karein. |
| **BTN 6** | **GPIO 10** | **Close Remote Session** | Remote broadcast session ko stop/disconnect karein. |
| **BTN 7** | **GPIO 11** | **Custom 7** | Reserved for future studio actions (e.g., Mic Mute). |
| **BTN 8** | **GPIO 12** | **Custom 8** | Reserved for future studio actions. |
| **BTN 9** | **GPIO 13** | **Custom 9** | Reserved for future studio actions. |
| **BTN 10** | **GPIO 14** | **Custom 10** | Reserved for future studio actions. |

---

## 🌐 Network Architecture (Kaise Connect Karein)

DexCam Studio, OBS, aur ESP32 ko aapas me connect karne ke liye **Internet (Data Recharge) ki zaroorat nahi hai**. Sirf local network chahiye:

```text
               ┌─────────────────────────────────────────┐
               │      MOBILE PHONE (DexCam Studio)       │
               │      Hotspot: ON [No Internet Needed]   │
               └───────────────────┬─────────────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
    ┌───────────────────────┐             ┌───────────────────────┐
    │        LAPTOP         │             │       ESP32-S3        │
    │   (OBS / Browser)     │             │ (Broadcast Controller)│
    │ Connected to Hotspot  │             │  Connected to Hotspot │
    └───────────────────────┘             └───────────────────────┘
```

### Steps:
1. Phone ka **Hotspot ON** karein.
2. Laptop aur ESP32 dono ko usi Mobile Hotspot se connect karein.
3. ESP32 par **LED 1** solid green ho jayegi.
4. DexCam Studio app me top par **`● ESP32 ON`** ka green badge show hoga.
5. Buttons daba kar record/pause/torch control karein aur LEDs par live status dekhein!

---

## 🛠️ Wi-Fi Setup Webpage (Captive Portal)
Agar kisi naye Wi-Fi ya Hotspot se judna ho:
1. Board par **BTN 1 ko 3 second tak hold karein**.
2. ESP32 apna hotspot shuru karega: **`DexCam-Controller-Setup`**.
3. Mobile se connect karein aur browser me `http://192.168.4.1` open karein.
4. Naya Wi-Fi choose karke password enter karein aur **SAVE & CONNECT** dabayein.
5. ESP32 usko internal flash me permanently save kar lega.
