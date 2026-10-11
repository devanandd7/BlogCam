// ─────────────────────────────────────────────────────────────────────────────
// dexcam_source.cpp  –  Dex Cam Studio OBS video source implementation
//
// Design: OBS_SOURCE_ASYNC_VIDEO
//   Frames are pushed from a dedicated worker thread via obs_source_output_video().
//   The render thread never performs I/O or blocking operations.
//
// Pixel format delivered to OBS: VIDEO_FORMAT_RGBA (matches web Canvas ImageData standard).
// ─────────────────────────────────────────────────────────────────────────────

#include "dexcam_source.h"
#include "settings_ids.h"

// OBS SDK headers – require OBS_INCLUDE_DIR on the include path
#include <obs-module.h>
#include <obs-source.h>
#include <media-io/video-io.h>
#include <obs-hotkey.h>
#include <util/platform.h>

#include <cstring>
#include <algorithm>
#include <cmath>
#include <cstdlib>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

static bool is_valid_ip(const char* s)
{
    if (!s || *s == '\0') return false;
    // Minimal check – Phase 4 can add full IPv4 / hostname validation
    return true;
}

static bool is_valid_port(int p)
{
    return p > 0 && p <= 65535;
}

// ─────────────────────────────────────────────────────────────────────────────
// DexCamSource – constructor
// ─────────────────────────────────────────────────────────────────────────────

namespace dexcam {

DexCamSource::DexCamSource(obs_source_t* source, obs_data* settings)
    : m_source(source)
{
    blog(LOG_INFO, "[DexCam] Source created");

    m_queue    = std::make_shared<FrameQueue>(1 /* strictly 1 frame: zero-latency live drop policy */);
    m_receiver = std::make_unique<WifiReceiver>(m_queue);

    apply_settings(settings);

    // Register hotkeys for remote controls (Step 3)
    obs_hotkey_register_source(
        source,
        "dexcam_hotkey_flip",
        "Dex Cam: Flip Camera (Front / Rear)",
        [](void* data, obs_hotkey_id, obs_hotkey_t*, bool pressed) {
            if (pressed && data) {
                static_cast<DexCamSource*>(data)->flip_camera();
            }
        },
        this
    );

    obs_hotkey_register_source(
        source,
        "dexcam_hotkey_flash",
        "Dex Cam: Toggle Flash (Torch)",
        [](void* data, obs_hotkey_id, obs_hotkey_t*, bool pressed) {
            if (pressed && data) {
                static_cast<DexCamSource*>(data)->toggle_flash();
            }
        },
        this
    );
}

DexCamSource::~DexCamSource()
{
    m_destroyed.store(true, std::memory_order_release);
    stop_receiver();
    blog(LOG_INFO, "[DexCam] Source destroyed");
}

// ─────────────────────────────────────────────────────────────────────────────
// apply_settings  –  parse and validate obs_data, store in members
// ─────────────────────────────────────────────────────────────────────────────

static std::string trim_str(const std::string& s)
{
    auto start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

void DexCamSource::apply_settings(obs_data* settings)
{
    const char* ip   = obs_data_get_string(settings, PROP_RECEIVER_IP);
    int         port = static_cast<int>(obs_data_get_int(settings, PROP_RECEIVER_PORT));
    const char* code = obs_data_get_string(settings, PROP_PAIRING_CODE);

    std::string raw_ip = trim_str((ip && *ip) ? ip : "");
    if (raw_ip.rfind("http://", 0) == 0) raw_ip = raw_ip.substr(7);
    if (raw_ip.rfind("https://", 0) == 0) raw_ip = raw_ip.substr(8);
    auto colon_idx = raw_ip.find(':');
    if (colon_idx != std::string::npos) {
        int parsed_port = std::atoi(raw_ip.substr(colon_idx + 1).c_str());
        if (is_valid_port(parsed_port)) {
            port = parsed_port;
        }
        raw_ip = raw_ip.substr(0, colon_idx);
    }
    auto slash_idx = raw_ip.find('/');
    if (slash_idx != std::string::npos) {
        raw_ip = raw_ip.substr(0, slash_idx);
    }

    m_receiver_ip   = trim_str(raw_ip);
    m_receiver_port = is_valid_port(port) ? static_cast<uint16_t>(port)
                                           : DEFAULT_RECEIVER_PORT;
    m_pairing_code  = trim_str((code && *code) ? code : "");

    // Resolution
    const char* res = obs_data_get_string(settings, PROP_RESOLUTION);
    if (res && strcmp(res, "1080p") == 0) {
        m_width  = 1920;
        m_height = 1080;
    } else {
        m_width  = 1280;
        m_height = 720;
    }

    m_fps_target     = static_cast<uint32_t>(
        std::max(1, static_cast<int>(obs_data_get_int(settings, PROP_FPS_TARGET))));
    m_auto_reconnect = obs_data_get_bool(settings, PROP_RECONNECT);

    // Shape & Ratio settings
    const char* shape_val = obs_data_get_string(settings, PROP_CAMERA_SHAPE);
    {
        std::lock_guard<std::mutex> lock(m_shape_mutex);
        m_shape_cfg.shape = (shape_val && *shape_val) ? shape_val : SHAPE_ORIGINAL;
        m_shape_cfg.offset_x = static_cast<int>(obs_data_get_int(settings, PROP_CROP_OFFSET_X));
        m_shape_cfg.offset_y = static_cast<int>(obs_data_get_int(settings, PROP_CROP_OFFSET_Y));
        int zoom_val = static_cast<int>(obs_data_get_int(settings, PROP_CROP_ZOOM));
        m_shape_cfg.zoom = (zoom_val >= 100) ? zoom_val : 100;
        int rad_val = static_cast<int>(obs_data_get_int(settings, PROP_CORNER_RADIUS));
        m_shape_cfg.corner_radius = (rad_val > 0) ? rad_val : 20;
        int cw = static_cast<int>(obs_data_get_int(settings, PROP_CUSTOM_ASPECT_W));
        int ch = static_cast<int>(obs_data_get_int(settings, PROP_CUSTOM_ASPECT_H));
        m_shape_cfg.custom_w = (cw > 0) ? cw : 16;
        m_shape_cfg.custom_h = (ch > 0) ? ch : 9;
    }
}

static bool is_valid_ipv4(const std::string& ip)
{
    if (ip.empty()) return false;
    int octets = 0;
    int cur = 0;
    bool has_digit = false;
    for (char c : ip) {
        if (c >= '0' && c <= '9') {
            cur = cur * 10 + (c - '0');
            if (cur > 255) return false;
            has_digit = true;
        } else if (c == '.') {
            if (!has_digit) return false;
            octets++;
            cur = 0;
            has_digit = false;
        } else {
            return false;
        }
    }
    return (octets == 3 && has_digit);
}

void DexCamSource::update(obs_data* settings)
{
    std::lock_guard<std::mutex> lock(m_receiver_mutex);

    std::string prev_ip   = m_receiver_ip;
    uint16_t    prev_port = m_receiver_port;
    std::string prev_pin  = m_pairing_code;

    apply_settings(settings);

    bool changed = (prev_ip != m_receiver_ip || prev_port != m_receiver_port || prev_pin != m_pairing_code);
    if (!changed && m_conn_state.load() != ConnectionState::DISCONNECTED) {
        return;
    }

    bool was_running = (m_conn_state.load() != ConnectionState::DISCONNECTED);
    if (was_running) {
        stop_receiver();
    }

    if (m_active.load() && is_valid_ipv4(m_receiver_ip) && m_pairing_code.length() == 4) {
        start_receiver();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// activate / deactivate
// ─────────────────────────────────────────────────────────────────────────────

void DexCamSource::activate()
{
    m_active.store(true);
    std::lock_guard<std::mutex> lock(m_receiver_mutex);
    if (is_valid_ipv4(m_receiver_ip) && m_pairing_code.length() == 4) {
        start_receiver();
    }
}

void DexCamSource::deactivate()
{
    m_active.store(false);
    std::lock_guard<std::mutex> lock(m_receiver_mutex);
    stop_receiver();
}

// ─────────────────────────────────────────────────────────────────────────────
// start_receiver / stop_receiver
// ─────────────────────────────────────────────────────────────────────────────

bool DexCamSource::start_receiver()
{
    // Guard: must hold m_receiver_mutex
    if (!m_receiver) return false;
    if (m_conn_state.load() != ConnectionState::DISCONNECTED) return false;

    if (!is_valid_ipv4(m_receiver_ip) || m_pairing_code.length() != 4) {
        blog(LOG_INFO, "[DexCam] Waiting for complete IP and 4-digit PIN (got IP='%s', PIN='%s')",
             m_receiver_ip.c_str(), m_pairing_code.c_str());
        return false;
    }

    ReceiverConfig cfg;
    cfg.host          = m_receiver_ip.empty() ? "127.0.0.1" : m_receiver_ip;
    cfg.port          = m_receiver_port;
    cfg.pairing_code  = m_pairing_code;
    cfg.desired_width  = m_width;
    cfg.desired_height = m_height;
    cfg.desired_fps    = m_fps_target;

    // Rebuild queue (clean state: 1 frame zero-latency policy)
    m_queue    = std::make_shared<FrameQueue>(1);
    m_receiver = std::make_unique<WifiReceiver>(m_queue);


    bool ok = m_receiver->start(
        cfg,
        [this](ConnectionState st, std::string reason) {
            if (m_destroyed.load(std::memory_order_acquire)) return;
            m_conn_state.store(st, std::memory_order_release);
            blog(LOG_INFO, "[DexCam] State -> %s (%s)",
                 connection_state_name(st), reason.c_str());
        },
        [this](std::string msg) {
            if (m_destroyed.load(std::memory_order_acquire)) return;
            blog(LOG_WARNING, "[DexCam] Receiver error: %s", msg.c_str());
        });

    if (ok) {
        m_conn_state.store(ConnectionState::CONNECTING, std::memory_order_release);
        blog(LOG_INFO, "[DexCam] Receiver started for %s:%u",
             cfg.host.c_str(), cfg.port);
    } else {
        blog(LOG_ERROR, "[DexCam] Failed to start receiver");
    }
    return ok;
}

void DexCamSource::stop_receiver()
{
    if (m_receiver) {
        m_receiver->stop();
    }
    if (m_queue) {
        m_queue->shutdown();
    }
    m_conn_state.store(ConnectionState::DISCONNECTED, std::memory_order_release);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimensions
// ─────────────────────────────────────────────────────────────────────────────

uint32_t DexCamSource::get_width() const  { return m_width; }
uint32_t DexCamSource::get_height() const { return m_height; }

// ─────────────────────────────────────────────────────────────────────────────
// video_tick  –  called every video frame by OBS; pump queue → OBS
// ─────────────────────────────────────────────────────────────────────────────

void DexCamSource::video_tick(float /*seconds*/)
{
    if (m_destroyed.load(std::memory_order_acquire)) return;
    pump_frames();
}


// ─────────────────────────────────────────────────────────────────────────────
// Frame Shape & Aspect-Ratio Processing Engine
// ─────────────────────────────────────────────────────────────────────────────

static bool process_frame_shape(
    const DecodedFrame& in,
    const DexCamSource::ShapeConfig& cfg,
    std::vector<uint8_t>& out_buf,
    uint32_t& out_w,
    uint32_t& out_h)
{
    if (in.width == 0 || in.height == 0 || in.data.empty()) return false;

    // 1. Determine Target Aspect Ratio
    float target_ar = (float)in.width / (float)in.height;
    bool is_circle   = (cfg.shape == SHAPE_CIRCLE);
    bool is_squircle = (cfg.shape == SHAPE_SQUIRCLE);
    bool is_square   = (cfg.shape == SHAPE_SQUARE);
    bool is_portrait = (cfg.shape == SHAPE_PORTRAIT);
    bool is_four_three = (cfg.shape == SHAPE_FOUR_THREE);
    bool is_custom   = (cfg.shape == SHAPE_CUSTOM);

    if (is_circle || is_square || is_squircle) {
        target_ar = 1.0f;
    } else if (is_portrait) {
        target_ar = 9.0f / 16.0f;
    } else if (is_four_three) {
        target_ar = 4.0f / 3.0f;
    } else if (is_custom) {
        int cw = std::max(1, cfg.custom_w);
        int ch = std::max(1, cfg.custom_h);
        target_ar = (float)cw / (float)ch;
    }

    // 2. Compute Base Crop Dimensions
    float in_ar = (float)in.width / (float)in.height;
    uint32_t crop_w0, crop_h0;

    if (target_ar <= in_ar) {
        crop_h0 = in.height;
        crop_w0 = static_cast<uint32_t>(std::round(crop_h0 * target_ar));
    } else {
        crop_w0 = in.width;
        crop_h0 = static_cast<uint32_t>(std::round(crop_w0 / target_ar));
    }
    crop_w0 = std::min(crop_w0, in.width);
    crop_h0 = std::min(crop_h0, in.height);

    // 3. Apply Digital Zoom / Crop Scale
    int zoom = std::clamp(cfg.zoom, 100, 300);
    float zoom_scale = 100.0f / (float)zoom;

    uint32_t crop_w = static_cast<uint32_t>(std::round(crop_w0 * zoom_scale));
    uint32_t crop_h = static_cast<uint32_t>(std::round(crop_h0 * zoom_scale));

    crop_w = std::max(32u, crop_w) & ~1u;
    crop_h = std::max(32u, crop_h) & ~1u;
    crop_w = std::min(crop_w, in.width);
    crop_h = std::min(crop_h, in.height);

    // 4. Calculate Pan Offsets (Horizontal / Vertical)
    int max_dx = (static_cast<int>(in.width) - static_cast<int>(crop_w)) / 2;
    int max_dy = (static_cast<int>(in.height) - static_cast<int>(crop_h)) / 2;

    int offset_x_pixels = static_cast<int>(std::round(max_dx * (std::clamp(cfg.offset_x, -50, 50) / 50.0f)));
    int offset_y_pixels = static_cast<int>(std::round(max_dy * (std::clamp(cfg.offset_y, -50, 50) / 50.0f)));

    int start_x = max_dx + offset_x_pixels;
    int start_y = max_dy + offset_y_pixels;

    start_x = std::clamp(start_x, 0, static_cast<int>(in.width - crop_w));
    start_y = std::clamp(start_y, 0, static_cast<int>(in.height - crop_h));

    bool needs_mask = (is_circle || is_squircle);
    if (!needs_mask && crop_w == in.width && crop_h == in.height && start_x == 0 && start_y == 0) {
        out_w = in.width;
        out_h = in.height;
        return false; // Direct zero-copy pass-through
    }

    out_w = crop_w;
    out_h = crop_h;
    size_t needed_bytes = static_cast<size_t>(crop_w) * crop_h * 4;
    if (out_buf.size() != needed_bytes) {
        out_buf.resize(needed_bytes);
    }

    const uint8_t* in_data = in.data.data();

    // Fast Rectangular Crop (Square 1:1, Portrait 9:16, 4:3 Classic, Custom, or Panned 16:9)
    if (!needs_mask) {
        for (uint32_t y = 0; y < crop_h; ++y) {
            const uint8_t* src_row = in_data + ((start_y + y) * in.width + start_x) * 4;
            uint8_t* dst_row = out_buf.data() + (y * crop_w) * 4;
            std::memcpy(dst_row, src_row, crop_w * 4);
        }
        return true;
    }

    // High-Speed Anti-Aliased Circle Facecam Mask (1:1 with Transparent Background)
    if (is_circle) {
        float cx = crop_w / 2.0f;
        float cy = crop_h / 2.0f;
        float R = std::min(cx, cy);
        float feather = 1.5f;
        float R_outer = R;
        float R_inner = std::max(0.0f, R - feather);
        float R_outer2 = R_outer * R_outer;
        float R_inner2 = R_inner * R_inner;

        for (uint32_t y = 0; y < crop_h; ++y) {
            const uint32_t* src_row = reinterpret_cast<const uint32_t*>(in_data + ((start_y + y) * in.width + start_x) * 4);
            uint32_t* dst_row = reinterpret_cast<uint32_t*>(out_buf.data() + (y * crop_w) * 4);

            float dy = (static_cast<float>(y) + 0.5f) - cy;
            float dy2 = dy * dy;

            if (dy2 >= R_outer2) {
                // Completely outside circle: full transparent
                std::memset(dst_row, 0, crop_w * 4);
                continue;
            }

            float dx_max = std::sqrt(R_outer2 - dy2);
            int x_left_outer  = std::clamp(static_cast<int>(std::floor(cx - dx_max)), 0, static_cast<int>(crop_w));
            int x_right_outer = std::clamp(static_cast<int>(std::ceil(cx + dx_max)),  0, static_cast<int>(crop_w));

            float dx_inner = (dy2 < R_inner2) ? std::sqrt(R_inner2 - dy2) : 0.0f;
            int x_left_inner  = std::clamp(static_cast<int>(std::ceil(cx - dx_inner)),  0, static_cast<int>(crop_w));
            int x_right_inner = std::clamp(static_cast<int>(std::floor(cx + dx_inner)), 0, static_cast<int>(crop_w));

            // Outer left transparent
            if (x_left_outer > 0) {
                std::memset(dst_row, 0, x_left_outer * 4);
            }
            // Outer right transparent
            if (x_right_outer < static_cast<int>(crop_w)) {
                std::memset(dst_row + x_right_outer, 0, (crop_w - x_right_outer) * 4);
            }

            // Inner solid opaque pixels (zero math, instant memcpy)
            if (x_right_inner > x_left_inner) {
                std::memcpy(dst_row + x_left_inner, src_row + x_left_inner, (x_right_inner - x_left_inner) * 4);
            }

            // Left subpixel anti-aliased edge
            for (int x = x_left_outer; x < x_left_inner; ++x) {
                float dx = (static_cast<float>(x) + 0.5f) - cx;
                float dist = std::sqrt(dx * dx + dy2);
                float alpha_f = std::clamp((R_outer - dist) / feather, 0.0f, 1.0f);
                uint32_t a = static_cast<uint32_t>(alpha_f * 255.0f);
                dst_row[x] = (src_row[x] & 0x00FFFFFFu) | (a << 24);
            }

            // Right subpixel anti-aliased edge
            for (int x = x_right_inner; x < x_right_outer; ++x) {
                float dx = (static_cast<float>(x) + 0.5f) - cx;
                float dist = std::sqrt(dx * dx + dy2);
                float alpha_f = std::clamp((R_outer - dist) / feather, 0.0f, 1.0f);
                uint32_t a = static_cast<uint32_t>(alpha_f * 255.0f);
                dst_row[x] = (src_row[x] & 0x00FFFFFFu) | (a << 24);
            }
        }
        return true;
    }

    // High-Speed Anti-Aliased Squircle (Rounded Square with Smooth Corners)
    if (is_squircle) {
        float rad_pct = std::clamp(cfg.corner_radius, 5, 50) / 100.0f;
        float R = std::min(crop_w, crop_h) * 0.5f * rad_pct;
        float feather = 1.5f;
        float R_outer = R;
        float R_inner = std::max(0.0f, R - feather);
        float R_outer2 = R_outer * R_outer;
        float R_inner2 = R_inner * R_inner;

        uint32_t band_r = static_cast<uint32_t>(std::ceil(R));
        band_r = std::min(band_r, crop_h / 2);

        for (uint32_t y = 0; y < crop_h; ++y) {
            const uint32_t* src_row = reinterpret_cast<const uint32_t*>(in_data + ((start_y + y) * in.width + start_x) * 4);
            uint32_t* dst_row = reinterpret_cast<uint32_t*>(out_buf.data() + (y * crop_w) * 4);

            bool is_top_corner    = (y < band_r);
            bool is_bottom_corner = (y >= crop_h - band_r);

            if (!is_top_corner && !is_bottom_corner) {
                // Central vertical span: 100% solid horizontal scanline
                std::memcpy(dst_row, src_row, crop_w * 4);
                continue;
            }

            float cy = is_top_corner ? R : (crop_h - R);
            float dy = (static_cast<float>(y) + 0.5f) - cy;
            float dy2 = dy * dy;

            if (dy2 >= R_outer2) {
                int inner_start = std::clamp(static_cast<int>(std::ceil(R)), 0, static_cast<int>(crop_w));
                int inner_end   = std::clamp(static_cast<int>(std::floor(crop_w - R)), 0, static_cast<int>(crop_w));
                if (inner_start > 0) std::memset(dst_row, 0, inner_start * 4);
                if (inner_end < static_cast<int>(crop_w)) std::memset(dst_row + inner_end, 0, (crop_w - inner_end) * 4);
                if (inner_end > inner_start) {
                    std::memcpy(dst_row + inner_start, src_row + inner_start, (inner_end - inner_start) * 4);
                }
                continue;
            }

            float dx_max = std::sqrt(R_outer2 - dy2);
            float dx_inner = (dy2 < R_inner2) ? std::sqrt(R_inner2 - dy2) : 0.0f;

            float cx_l = R;
            float cx_r = crop_w - R;

            int x_tl_outer = std::clamp(static_cast<int>(std::floor(cx_l - dx_max)), 0, static_cast<int>(crop_w));
            int x_tl_inner = std::clamp(static_cast<int>(std::ceil(cx_l - dx_inner)), 0, static_cast<int>(crop_w));

            int x_tr_inner = std::clamp(static_cast<int>(std::floor(cx_r + dx_inner)), 0, static_cast<int>(crop_w));
            int x_tr_outer = std::clamp(static_cast<int>(std::ceil(cx_r + dx_max)), 0, static_cast<int>(crop_w));

            // Outer corners transparent
            if (x_tl_outer > 0) std::memset(dst_row, 0, x_tl_outer * 4);
            if (x_tr_outer < static_cast<int>(crop_w)) std::memset(dst_row + x_tr_outer, 0, (crop_w - x_tr_outer) * 4);

            // Middle solid span
            if (x_tr_inner > x_tl_inner) {
                std::memcpy(dst_row + x_tl_inner, src_row + x_tl_inner, (x_tr_inner - x_tl_inner) * 4);
            }

            // Left corner feather
            for (int x = x_tl_outer; x < x_tl_inner; ++x) {
                float dx = (static_cast<float>(x) + 0.5f) - cx_l;
                float dist = std::sqrt(dx * dx + dy2);
                float alpha_f = std::clamp((R_outer - dist) / feather, 0.0f, 1.0f);
                uint32_t a = static_cast<uint32_t>(alpha_f * 255.0f);
                dst_row[x] = (src_row[x] & 0x00FFFFFFu) | (a << 24);
            }

            // Right corner feather
            for (int x = x_tr_inner; x < x_tr_outer; ++x) {
                float dx = (static_cast<float>(x) + 0.5f) - cx_r;
                float dist = std::sqrt(dx * dx + dy2);
                float alpha_f = std::clamp((R_outer - dist) / feather, 0.0f, 1.0f);
                uint32_t a = static_cast<uint32_t>(alpha_f * 255.0f);
                dst_row[x] = (src_row[x] & 0x00FFFFFFu) | (a << 24);
            }
        }
        return true;
    }

    return false;
}

void DexCamSource::pump_frames()
{
    if (!m_queue || m_destroyed.load(std::memory_order_acquire)) return;

    ShapeConfig shape_cfg;
    {
        std::lock_guard<std::mutex> lock(m_shape_mutex);
        shape_cfg = m_shape_cfg;
    }

    // Drain at most a few frames per tick to avoid stalling the render thread
    for (int i = 0; i < 2; ++i) {
        auto frame_opt = m_queue->pop();
        if (!frame_opt.has_value()) break;

        const DecodedFrame& f = *frame_opt;
        if (f.width == 0 || f.height == 0 || f.data.empty()) continue;

        uint32_t out_w = f.width;
        uint32_t out_h = f.height;
        const uint8_t* out_pixels = f.data.data();

        bool processed = process_frame_shape(f, shape_cfg, m_processed_buf, out_w, out_h);
        if (processed) {
            out_pixels = m_processed_buf.data();
        }

        m_width  = out_w;
        m_height = out_h;

        struct obs_source_frame obs_frame = {};
        obs_frame.format    = VIDEO_FORMAT_RGBA;
        obs_frame.width     = out_w;
        obs_frame.height    = out_h;
        obs_frame.timestamp = os_gettime_ns(); // Current OBS clock: renders on next scanline without buffering
        obs_frame.data[0]   = const_cast<uint8_t*>(out_pixels);
        obs_frame.linesize[0] = out_w * 4u; // RGBA: 4 bytes/pixel

        obs_source_output_video(m_source, &obs_frame);
    }
}

std::string DexCamSource::get_shape() const
{
    std::lock_guard<std::mutex> lock(m_shape_mutex);
    return m_shape_cfg.shape;
}

ConnectionState DexCamSource::connection_state() const
{
    return m_conn_state.load(std::memory_order_acquire);
}

void DexCamSource::flip_camera()
{
    std::lock_guard<std::mutex> lock(m_receiver_mutex);
    if (m_receiver) {
        blog(LOG_INFO, "[DexCam] Triggering Flip Camera");
        m_receiver->send_control("flip");
    }
}

void DexCamSource::toggle_flash()
{
    std::lock_guard<std::mutex> lock(m_receiver_mutex);
    if (m_receiver) {
        bool next_flash = !m_flash_state.load();
        blog(LOG_INFO, "[DexCam] Toggling Flash -> %s", next_flash ? "ON" : "OFF");
        if (m_receiver->send_control("flash", std::string("\"enabled\":") + (next_flash ? "true" : "false"))) {
            m_flash_state.store(next_flash);
        }
    }
}




// ─────────────────────────────────────────────────────────────────────────────
// OBS callback trampolines
// ─────────────────────────────────────────────────────────────────────────────

const char* callbacks::get_name(void*) { return "Dex Cam Studio"; }

void* callbacks::create(obs_data* settings, obs_source_t* source)
{
    auto* inst = new (std::nothrow) DexCamSource(source, settings);
    return inst;
}

void callbacks::destroy(void* data)
{
    delete static_cast<DexCamSource*>(data);
}

void callbacks::get_defaults(obs_data* settings)
{
    obs_data_set_default_string(settings, PROP_CONN_MODE,      CONN_MODE_WIFI);
    obs_data_set_default_string(settings, PROP_RECEIVER_IP,    "");
    obs_data_set_default_int   (settings, PROP_RECEIVER_PORT,   DEFAULT_RECEIVER_PORT);
    obs_data_set_default_string(settings, PROP_PAIRING_CODE,   "");
    obs_data_set_default_string(settings, PROP_RESOLUTION,     DEFAULT_RESOLUTION);
    obs_data_set_default_int   (settings, PROP_FPS_TARGET,      DEFAULT_FPS_TARGET);
    obs_data_set_default_bool  (settings, PROP_RECONNECT,       true);

    // Shape & Ratio defaults
    obs_data_set_default_string(settings, PROP_CAMERA_SHAPE,    SHAPE_ORIGINAL);
    obs_data_set_default_int   (settings, PROP_CROP_OFFSET_X,   0);
    obs_data_set_default_int   (settings, PROP_CROP_OFFSET_Y,   0);
    obs_data_set_default_int   (settings, PROP_CROP_ZOOM,       100);
    obs_data_set_default_int   (settings, PROP_CORNER_RADIUS,   20);
    obs_data_set_default_int   (settings, PROP_CUSTOM_ASPECT_W, 16);
    obs_data_set_default_int   (settings, PROP_CUSTOM_ASPECT_H, 9);
}

static bool shape_changed_callback(obs_properties_t* props, obs_property_t* /*property*/, obs_data_t* settings)
{
    const char* shape = obs_data_get_string(settings, PROP_CAMERA_SHAPE);
    bool is_custom   = (shape && strcmp(shape, SHAPE_CUSTOM) == 0);
    bool is_squircle = (shape && strcmp(shape, SHAPE_SQUIRCLE) == 0);
    bool is_original = (!shape || strcmp(shape, SHAPE_ORIGINAL) == 0);

    obs_property_t* p_custom_w = obs_properties_get(props, PROP_CUSTOM_ASPECT_W);
    obs_property_t* p_custom_h = obs_properties_get(props, PROP_CUSTOM_ASPECT_H);
    obs_property_t* p_radius   = obs_properties_get(props, PROP_CORNER_RADIUS);
    obs_property_t* p_pan_x    = obs_properties_get(props, PROP_CROP_OFFSET_X);
    obs_property_t* p_pan_y    = obs_properties_get(props, PROP_CROP_OFFSET_Y);

    if (p_custom_w) obs_property_set_visible(p_custom_w, is_custom);
    if (p_custom_h) obs_property_set_visible(p_custom_h, is_custom);
    if (p_radius)   obs_property_set_visible(p_radius, is_squircle);
    if (p_pan_x)    obs_property_set_visible(p_pan_x, !is_original);
    if (p_pan_y)    obs_property_set_visible(p_pan_y, !is_original);

    return true;
}

obs_properties_t* callbacks::get_properties(void* data)
{
    obs_properties_t* props = obs_properties_create();

    // Connection mode (Wi-Fi only for now)
    obs_property_t* conn_mode = obs_properties_add_list(
        props, PROP_CONN_MODE, "Connection Mode",
        OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);
    obs_property_list_add_string(conn_mode, "Wi-Fi", CONN_MODE_WIFI);

    // Phone IP
    obs_properties_add_text(props, PROP_RECEIVER_IP,
                             "Phone IP Address", OBS_TEXT_DEFAULT);

    // Signaling port
    obs_properties_add_int(props, PROP_RECEIVER_PORT,
                            "Signaling Port", 1, 65535, 1);

    // Pairing code
    obs_properties_add_text(props, PROP_PAIRING_CODE,
                             "Pairing Code (from app)", OBS_TEXT_DEFAULT);

    // Resolution
    obs_property_t* res = obs_properties_add_list(
        props, PROP_RESOLUTION, "Resolution",
        OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);
    obs_property_list_add_string(res, "720p  (1280x720)",  "720p");
    obs_property_list_add_string(res, "1080p (1920x1080)", "1080p");

    // FPS target
    obs_properties_add_int(props, PROP_FPS_TARGET,
                            "Target Frame Rate (FPS)", 1, 60, 1);

    // Auto-reconnect
    obs_properties_add_bool(props, PROP_RECONNECT, "Auto-reconnect on disconnect");

    // ── Camera Shape & Ratio Settings ────────────────────────────────────────
    obs_property_t* shape_list = obs_properties_add_list(
        props, PROP_CAMERA_SHAPE, "Camera Shape & Ratio",
        OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);
    obs_property_list_add_string(shape_list, "Original (16:9 Full Frame)",   SHAPE_ORIGINAL);
    obs_property_list_add_string(shape_list, "Circle Facecam (Round 1:1)",   SHAPE_CIRCLE);
    obs_property_list_add_string(shape_list, "Square (1:1)",                 SHAPE_SQUARE);
    obs_property_list_add_string(shape_list, "Rounded Square (Squircle 1:1)", SHAPE_SQUIRCLE);
    obs_property_list_add_string(shape_list, "Vertical (9:16 Shorts/Reels)",  SHAPE_PORTRAIT);
    obs_property_list_add_string(shape_list, "Standard (4:3 Classic)",       SHAPE_FOUR_THREE);
    obs_property_list_add_string(shape_list, "Custom Ratio",                 SHAPE_CUSTOM);

    obs_property_set_modified_callback(shape_list, shape_changed_callback);

    obs_property_t* p_pan_x = obs_properties_add_int_slider(
        props, PROP_CROP_OFFSET_X, "Pan Horizontal (X Offset)", -50, 50, 1);
    obs_property_int_set_suffix(p_pan_x, "%");

    obs_property_t* p_pan_y = obs_properties_add_int_slider(
        props, PROP_CROP_OFFSET_Y, "Pan Vertical (Y Offset)", -50, 50, 1);
    obs_property_int_set_suffix(p_pan_y, "%");

    obs_property_t* p_zoom = obs_properties_add_int_slider(
        props, PROP_CROP_ZOOM, "Digital Zoom / Scale", 100, 200, 1);
    obs_property_int_set_suffix(p_zoom, "%");

    obs_property_t* p_radius = obs_properties_add_int_slider(
        props, PROP_CORNER_RADIUS, "Corner Rounding", 5, 50, 1);
    obs_property_int_set_suffix(p_radius, "%");

    obs_property_t* p_cw = obs_properties_add_int(props, PROP_CUSTOM_ASPECT_W, "Custom Ratio: Width", 1, 64, 1);
    obs_property_t* p_ch = obs_properties_add_int(props, PROP_CUSTOM_ASPECT_H, "Custom Ratio: Height", 1, 64, 1);

    // Evaluate initial visibility
    std::string cur_shape = data ? static_cast<DexCamSource*>(data)->get_shape() : SHAPE_ORIGINAL;
    bool is_custom   = (cur_shape == SHAPE_CUSTOM);
    bool is_squircle = (cur_shape == SHAPE_SQUIRCLE);
    bool is_original = (cur_shape == SHAPE_ORIGINAL);

    obs_property_set_visible(p_cw, is_custom);
    obs_property_set_visible(p_ch, is_custom);
    obs_property_set_visible(p_radius, is_squircle);
    obs_property_set_visible(p_pan_x, !is_original);
    obs_property_set_visible(p_pan_y, !is_original);

    // ── Camera Hardware Controls ─────────────────────────────────────────────
    obs_properties_add_button2(props, PROP_BTN_FLIP, "Flip Camera (Front / Rear)",
        [](obs_properties_t*, obs_property_t*, void* priv) -> bool {
            if (priv) static_cast<DexCamSource*>(priv)->flip_camera();
            return false;
        }, data);

    obs_properties_add_button2(props, PROP_BTN_FLASH, "Toggle Flash (Torch ON / OFF)",
        [](obs_properties_t*, obs_property_t*, void* priv) -> bool {
            if (priv) static_cast<DexCamSource*>(priv)->toggle_flash();
            return false;
        }, data);

    return props;
}

void callbacks::update(void* data, obs_data* settings)
{
    static_cast<DexCamSource*>(data)->update(settings);
}

uint32_t callbacks::get_width(void* data)
{
    return static_cast<DexCamSource*>(data)->get_width();
}

uint32_t callbacks::get_height(void* data)
{
    return static_cast<DexCamSource*>(data)->get_height();
}

void callbacks::video_tick(void* data, float seconds)
{
    static_cast<DexCamSource*>(data)->video_tick(seconds);
}

void callbacks::activate(void* data)
{
    static_cast<DexCamSource*>(data)->activate();
}

void callbacks::deactivate(void* data)
{
    static_cast<DexCamSource*>(data)->deactivate();
}

} // namespace dexcam

// ─────────────────────────────────────────────────────────────────────────────
// Populate obs_source_info
// ─────────────────────────────────────────────────────────────────────────────

void dexcam_source_info_init(obs_source_info* info)
{
    memset(info, 0, sizeof(*info));

    info->id             = DEXCAM_SOURCE_ID;
    info->type           = OBS_SOURCE_TYPE_INPUT;
    // Asynchronous video source – frames delivered via obs_source_output_video()
    info->output_flags   = OBS_SOURCE_ASYNC_VIDEO | OBS_SOURCE_DO_NOT_DUPLICATE;

    info->get_name       = dexcam::callbacks::get_name;
    info->create         = dexcam::callbacks::create;
    info->destroy        = dexcam::callbacks::destroy;
    info->get_defaults   = dexcam::callbacks::get_defaults;
    info->get_properties = dexcam::callbacks::get_properties;
    info->update         = dexcam::callbacks::update;
    info->get_width      = dexcam::callbacks::get_width;
    info->get_height     = dexcam::callbacks::get_height;
    info->video_tick     = dexcam::callbacks::video_tick;
    info->activate       = dexcam::callbacks::activate;
    info->deactivate     = dexcam::callbacks::deactivate;
}
