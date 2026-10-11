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

void DexCamSource::pump_frames()
{
    if (!m_queue || m_destroyed.load(std::memory_order_acquire)) return;

    // Drain at most a few frames per tick to avoid stalling the render thread
    for (int i = 0; i < 2; ++i) {
        auto frame_opt = m_queue->pop();
        if (!frame_opt.has_value()) break;

        const DecodedFrame& f = *frame_opt;
        if (f.width == 0 || f.height == 0 || f.data.empty()) continue;

        m_width  = f.width;
        m_height = f.height;

        struct obs_source_frame obs_frame = {};
        obs_frame.format    = VIDEO_FORMAT_RGBA;
        obs_frame.width     = f.width;
        obs_frame.height    = f.height;
        obs_frame.timestamp = os_gettime_ns(); // Current OBS clock: renders on next scanline without buffering
        obs_frame.data[0]   = const_cast<uint8_t*>(f.data.data());
        obs_frame.linesize[0] = f.width * 4u; // RGBA: 4 bytes/pixel

        obs_source_output_video(m_source, &obs_frame);
    }
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
    obs_data_set_default_string(settings, PROP_CONN_MODE,    CONN_MODE_WIFI);
    obs_data_set_default_string(settings, PROP_RECEIVER_IP,  "");
    obs_data_set_default_int   (settings, PROP_RECEIVER_PORT, DEFAULT_RECEIVER_PORT);
    obs_data_set_default_string(settings, PROP_PAIRING_CODE, "");
    obs_data_set_default_string(settings, PROP_RESOLUTION,   DEFAULT_RESOLUTION);
    obs_data_set_default_int   (settings, PROP_FPS_TARGET,    DEFAULT_FPS_TARGET);
    obs_data_set_default_bool  (settings, PROP_RECONNECT,     true);
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
