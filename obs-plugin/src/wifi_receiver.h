#pragma once

#include "frame_queue.h"
#include "connection_state.h"
#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <cstdint>

namespace dexcam {

struct ReceiverConfig {
    std::string host;           // IP address or hostname of the Android phone
    uint16_t    port = 8000;    // HTTP signaling port (default: 8000)
    std::string pairing_code;   // 4-digit PIN shown on the phone
    uint32_t    desired_width  = 1280;
    uint32_t    desired_height = 720;
    uint32_t    desired_fps    = 30;
    uint16_t    ws_server_port = 8765; // Local loopback port for frame bridge
};

using StateChangeCb = std::function<void(ConnectionState, std::string reason)>;
using ErrorCb       = std::function<void(std::string msg)>;
using FrameCb       = std::function<void(DecodedFrame&& frame)>;

class WifiReceiver {
public:
    explicit WifiReceiver(std::shared_ptr<FrameQueue> queue);
    ~WifiReceiver();

    WifiReceiver(const WifiReceiver&) = delete;
    WifiReceiver& operator=(const WifiReceiver&) = delete;

    bool start(const ReceiverConfig& config,
               StateChangeCb state_cb,
               ErrorCb       error_cb,
               FrameCb       frame_cb = nullptr);

    void stop();

    ConnectionState state() const;

    // Send remote camera control action to phone (Step 3)
    bool send_control(const std::string& action, const std::string& extra_json = "");

    struct Stats {
        uint64_t frames_received = 0;
        uint64_t frames_dropped  = 0;
        uint64_t decode_errors   = 0;
        double   fps_estimate    = 0.0;
    };
    Stats stats() const;

private:
    void worker_main(ReceiverConfig cfg,
                     StateChangeCb  state_cb,
                     ErrorCb        error_cb,
                     FrameCb        frame_cb);

    std::shared_ptr<FrameQueue>  m_queue;
    FrameCb                      m_frame_cb;
    std::thread                  m_worker;
    std::atomic<bool>            m_stop_flag{false};
    std::atomic<ConnectionState> m_state{ConnectionState::DISCONNECTED};

    std::string                  m_session_token;
    std::string                  m_phone_host;
    uint16_t                     m_phone_port = 8000;
    uintptr_t                    m_stream_socket{~0ULL};

    std::atomic<uint64_t>        m_stat_received{0};
    std::atomic<uint64_t>        m_stat_decode_errors{0};
};

} // namespace dexcam
