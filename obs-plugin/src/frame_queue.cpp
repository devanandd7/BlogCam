#include "frame_queue.h"
#include <algorithm>

namespace dexcam {

FrameQueue::FrameQueue(size_t max_frames)
    : m_max(max_frames > 0 ? max_frames : 1)
{
    m_queue.reserve(m_max + 1);
}

FrameQueue::~FrameQueue()
{
    shutdown();
}

void FrameQueue::push(DecodedFrame frame)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_shutdown.load(std::memory_order_relaxed)) {
        return;
    }

    // Drop oldest frame if queue is full (live-preview drop policy)
    if (m_queue.size() >= m_max) {
        m_queue.erase(m_queue.begin());
        m_dropped.fetch_add(1, std::memory_order_relaxed);
    }

    m_queue.push_back(std::move(frame));
    m_cv.notify_one();
}

std::optional<DecodedFrame> FrameQueue::pop()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_queue.empty()) {
        return std::nullopt;
    }

    DecodedFrame frame = std::move(m_queue.front());
    m_queue.erase(m_queue.begin());
    m_delivered.fetch_add(1, std::memory_order_relaxed);
    return frame;
}

void FrameQueue::shutdown()
{
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_shutdown.store(true, std::memory_order_release);
        m_queue.clear();
    }
    m_cv.notify_all();
}

size_t FrameQueue::current_size() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_queue.size();
}

} // namespace dexcam
