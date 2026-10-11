#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// DexCamSource – per-instance state for the "Dex Cam Studio" OBS video source.
//
// One instance is created by OBS for every source added by the user.
// All lifecycle methods are called on the OBS UI/plugin thread; the receiver
// worker thread is internal and never touches OBS APIs directly.
// ─────────────────────────────────────────────────────────────────────────────

#include "connection_state.h"
#include "frame_queue.h"
#include "wifi_receiver.h"

#include <memory>
#include <mutex>
#include <string>
#include <atomic>

// Forward-declare OBS types to avoid pulling in obs-module.h here.
struct obs_source_info;
struct obs_data;
struct obs_properties;
typedef struct obs_source obs_source_t;
typedef struct obs_properties obs_properties_t;

namespace dexcam {

class DexCamSource {
public:
    // Called by OBS create callback.
    explicit DexCamSource(obs_source_t* source, obs_data* settings);
    ~DexCamSource();

    // OBS callback stubs – called from static trampolines in dexcam_source.cpp
    void update(obs_data* settings);
    uint32_t get_width() const;
    uint32_t get_height() const;
    void video_tick(float seconds);
    void activate();
    void deactivate();

    // Camera Hardware Controls
    void flip_camera();
    void toggle_flash();

    // Called by video_tick to pump frames from queue → OBS
    void pump_frames();

    // Shape & Crop configuration struct
    struct ShapeConfig {
        std::string shape         = "original";
        int         offset_x      = 0;
        int         offset_y      = 0;
        int         zoom          = 100;
        int         corner_radius = 20;
        int         custom_w      = 16;
        int         custom_h      = 9;
    };

    // State accessor (thread-safe)
    ConnectionState connection_state() const;
    std::string     get_shape() const;

private:
    void apply_settings(obs_data* settings);
    bool start_receiver();
    void stop_receiver();

    obs_source_t*                    m_source;

    // Current resolved settings
    std::string                      m_receiver_ip;
    uint16_t                         m_receiver_port  = 8000;
    std::string                      m_pairing_code;
    uint32_t                         m_width          = 1280;
    uint32_t                         m_height         = 720;
    uint32_t                         m_fps_target     = 30;
    bool                             m_auto_reconnect = true;

    // Flash hardware state
    std::atomic<bool>                m_flash_state{false};

    // Shape & Crop configuration
    mutable std::mutex               m_shape_mutex;
    ShapeConfig                      m_shape_cfg;

    // Pre-allocated buffer for cropped / masked frames
    std::vector<uint8_t>             m_processed_buf;

    // Receiver pipeline
    std::shared_ptr<FrameQueue>      m_queue;
    std::unique_ptr<WifiReceiver>    m_receiver;

    std::atomic<ConnectionState>     m_conn_state{ConnectionState::DISCONNECTED};

    // Guards start/stop against concurrent calls from update() / activate() / deactivate()
    std::mutex                       m_receiver_mutex;

    // Track whether source is currently active (visible in OBS)
    std::atomic<bool>                m_active{false};

    // Destruction guard: no OBS API calls after this is set
    std::atomic<bool>                m_destroyed{false};
};

// ── Static trampoline functions for obs_source_info ──────────────────────────
// Implemented in dexcam_source.cpp; declared here for module registration.
namespace callbacks {
    const char* get_name(void*);
    void*       create(obs_data* settings, obs_source_t* source);
    void        destroy(void* data);
    void        get_defaults(obs_data* settings);
    obs_properties_t* get_properties(void* data);
    void        update(void* data, obs_data* settings);
    uint32_t    get_width(void* data);
    uint32_t    get_height(void* data);
    void        video_tick(void* data, float seconds);
    void        activate(void* data);
    void        deactivate(void* data);
} // namespace callbacks

} // namespace dexcam

// Populates an obs_source_info struct; called from dexcam_module.cpp
void dexcam_source_info_init(obs_source_info* info);
