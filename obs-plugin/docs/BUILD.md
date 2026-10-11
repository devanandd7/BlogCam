# Dex Cam Studio – OBS Plugin Build Guide

## Prerequisites

| Requirement | Version |
|---|---|
| OBS Studio | 32.2.2 (stable) – primary target |
| CMake | 3.24 or newer |
| Visual Studio | 2022 with "Desktop development with C++" workload |
| Windows SDK | 10.0.22000 or newer |

### OBS SDK headers and import library

OBS Studio does **not** ship development headers with the normal installer.
You need either:

**Option A – Build OBS from source** (recommended for development)
```
git clone --recursive https://github.com/obsproject/obs-studio.git
cd obs-studio
git checkout 32.2.2
# Follow https://github.com/obsproject/obs-studio/wiki/build-instructions-for-windows
```
After a successful build the headers are under `obs-studio/libobs/` and the
import library is `obs-studio/build/libobs/Release/obs.lib` (path varies).

**Option B – Use obs-plugintemplate fetch**
Clone the official plugin template and let CMake fetch OBS dependencies.
```
git clone https://github.com/obsproject/obs-plugintemplate.git
```
Copy this plugin's source files into that template structure if needed.

---

## Build steps

```powershell
cd obs-plugin

cmake -B build -S . `
      -DCMAKE_BUILD_TYPE=RelWithDebInfo `
      -DOBS_ROOT_DIR="C:/path/to/obs-studio-build-or-install" `
      -A x64

cmake --build build --config RelWithDebInfo
```

The output DLL will be at:
```
build/staging/obs-plugins/64bit/dex-cam-studio.dll
```

---

## Manual installation in OBS

1. Locate your OBS Studio plugin directory, typically:
   ```
   C:\Program Files\obs-studio\obs-plugins\64bit\
   ```
2. Copy `dex-cam-studio.dll` into that folder.
3. Copy `locale\` folder contents to:
   ```
   C:\Program Files\obs-studio\data\obs-plugins\dex-cam-studio\locale\
   ```
4. Start OBS Studio.
5. In the Sources panel click **+** → **Dex Cam Studio**.

---

## Running unit tests

```powershell
cd build
ctest -C RelWithDebInfo --output-on-failure
```

---

## Phase status

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ Done | Repository inspection + architecture |
| 2 | ✅ Done | Plugin registration + test frame source |
| 3 | 🔲 Next | Frame timing + shutdown hardening |
| 4 | 🔲 Planned | PC receiver interface |
| 5 | 🔲 Planned | WebRTC integration with existing HTTP signaling |
| 6 | 🔲 Planned | Authentication (PIN/pairing) |
| 7 | 🔲 Planned | USB transport adapter |
| 8 | 🔲 Planned | Reconnect, lifecycle, performance tests |
| 9 | 🔲 Planned | Packaging + installer |

---

## Folder layout

```
obs-plugin/
  CMakeLists.txt          Root build file
  cmake/
    plugin-version.h.in   Version header template
  src/
    dexcam_module.cpp     OBS module entry (obs_module_load)
    dexcam_source.cpp/h   OBS async video source
    frame_queue.cpp/h     Bounded decoded-frame queue
    wifi_receiver.cpp/h   Receiver stub (Phase 2) / WebRTC (Phase 5)
    connection_state.h    State machine enum
    settings_ids.h        Stable property key constants
  locale/
    en-US.ini             English strings
  tests/
    CMakeLists.txt
    unit/
      test_frame_queue.cpp
      test_connection_state.cpp
  docs/
    BUILD.md              This file
```
