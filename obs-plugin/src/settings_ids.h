#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// Stable string identifiers used in OBS scene/source settings.
// NEVER rename these; doing so will break saved OBS scenes.
// ─────────────────────────────────────────────────────────────────────────────

// Source type identifier – registered with obs_register_source()
#define DEXCAM_SOURCE_ID  "dex_cam_studio_source"

// Property / setting keys
#define PROP_CONN_MODE    "connection_mode"
#define PROP_RECEIVER_IP  "receiver_ip"
#define PROP_RECEIVER_PORT "receiver_port"
#define PROP_PAIRING_CODE "pairing_code"
#define PROP_RESOLUTION   "resolution"
#define PROP_FPS_TARGET   "fps_target"
#define PROP_RECONNECT    "auto_reconnect"
#define PROP_STATUS_TEXT  "status_display"  // read-only info label

// Connection mode values
#define CONN_MODE_WIFI    "wifi"
// (USB reserved for future phase)

// Default values
#define DEFAULT_RECEIVER_PORT  8000  // phone HTTP signaling server port
#define DEFAULT_FPS_TARGET     30
#define DEFAULT_RESOLUTION     "720p"
