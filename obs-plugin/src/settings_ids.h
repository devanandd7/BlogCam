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

// Controls (Step 3: Camera hardware controls only)
#define PROP_BTN_FLIP          "btn_flip_camera"
#define PROP_BTN_FLASH         "btn_toggle_flash"

// Shape & Ratio Options
#define PROP_CAMERA_SHAPE      "camera_shape"
#define PROP_CROP_OFFSET_X     "crop_offset_x"
#define PROP_CROP_OFFSET_Y     "crop_offset_y"
#define PROP_CROP_ZOOM         "crop_zoom"
#define PROP_CORNER_RADIUS     "corner_radius"
#define PROP_CUSTOM_ASPECT_W   "custom_aspect_w"
#define PROP_CUSTOM_ASPECT_H   "custom_aspect_h"

// Camera Shape values
#define SHAPE_ORIGINAL         "original"      // 16:9 Full Frame
#define SHAPE_CIRCLE           "circle"        // 1:1 Round Facecam (Transparent)
#define SHAPE_SQUARE           "square"        // 1:1 Square
#define SHAPE_SQUIRCLE         "squircle"      // 1:1 Rounded Rectangle
#define SHAPE_PORTRAIT         "portrait"      // 9:16 Vertical / Shorts / TikTok
#define SHAPE_FOUR_THREE       "four_three"    // 4:3 Standard
#define SHAPE_CUSTOM           "custom"        // Custom Ratio

// Connection mode values
#define CONN_MODE_WIFI    "wifi"
#define CONN_MODE_USB     "usb"

// Default values
#define DEFAULT_RECEIVER_PORT  8000  // phone HTTP signaling server port
#define DEFAULT_FPS_TARGET     30
#define DEFAULT_RESOLUTION     "720p"
