#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// Bounded lock-free-style decoded-frame queue.
//
// Ownership:
//   - Producer (wifi_receiver worker thread): pushes decoded BGRA frames.
//   - Consumer (OBS video thread via obs_source_output_video): pops frames.
//
// Drop policy (live preview):
//   When the queue is full the oldest frame is discarded so the consumer
//   always gets the freshest available frame.  This keeps end-to-end latency
//   bounded even when the consumer is momentarily slower than the producer.
//
// Thread safety:
//   push() and pop() are safe to call concurrently from exactly one producer
//   thread and one consumer thread.  All other combinations require external
//   synchronisation.
// ─────────────────────────────────────────────────────────────────────────────

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <condition_variable>
#include <vector>
#include <optional>

// Forward-declared to avoid pulling in obs headers here.
struct obs_source_frame;

namespace dexcam {

struct DecodedFrame {
    uint32_t          width  = 0;
    uint32_t          height = 0;
    uint64_t          timestamp_us = 0;   // microseconds, monotonic
    std::vector<uint8_t> data;            // BGRA packed pixels
};

class FrameQueue {
public:
    // max_frames: maximum decoded frames kept in queue before dropping oldest.
    // Recommended: 2–4 for live preview.
    explicit FrameQueue(size_t max_frames = 3);
    ~FrameQueue();

    // Push a decoded frame.  If queue is full the oldest entry is dropped.
    // Safe to call from producer thread only.
    void push(DecodedFrame frame);

    // Pop the next frame.  Returns nullopt if queue is empty.
    // Safe to call from consumer thread only.
    std::optional<DecodedFrame> pop();

    // Unblock any waiting pop() after shutdown.
    void shutdown();

    // Diagnostic counters (approximate – atomic loads, no locks).
    size_t dropped_frames()   const { return m_dropped.load(std::memory_order_relaxed); }
    size_t delivered_frames() const { return m_delivered.load(std::memory_order_relaxed); }
    size_t current_size()     const;

private:
    const size_t                    m_max;
    mutable std::mutex              m_mutex;
    std::condition_variable         m_cv;
    std::vector<DecodedFrame>       m_queue;
    std::atomic<size_t>             m_dropped{0};
    std::atomic<size_t>             m_delivered{0};
    std::atomic<bool>               m_shutdown{false};
};

} // namespace dexcam
