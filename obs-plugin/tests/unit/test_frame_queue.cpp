// ─────────────────────────────────────────────────────────────────────────────
// test_frame_queue.cpp  –  Unit tests for FrameQueue
// Minimal test framework: assert macros + main(), no external deps.
// ─────────────────────────────────────────────────────────────────────────────
#include "frame_queue.h"
#include <cassert>
#include <cstdio>
#include <thread>

using namespace dexcam;

static int g_pass = 0, g_fail = 0;

#define TEST(name) void name(); \
    struct _Reg_##name { _Reg_##name() { \
        try { name(); printf("[PASS] " #name "\n"); ++g_pass; } \
        catch(...) { printf("[FAIL] " #name "\n"); ++g_fail; } } \
    } _reg_##name; void name()

#define ASSERT(cond) do { if (!(cond)) throw std::runtime_error(#cond); } while(0)

// ── Tests ─────────────────────────────────────────────────────────────────────

TEST(empty_pop_returns_nullopt) {
    FrameQueue q(3);
    ASSERT(!q.pop().has_value());
}

TEST(push_then_pop) {
    FrameQueue q(3);
    DecodedFrame f;
    f.width = 1280; f.height = 720; f.timestamp_us = 1000;
    f.data.assign(1280u * 720u * 4u, 0xAB);
    q.push(f);
    auto result = q.pop();
    ASSERT(result.has_value());
    ASSERT(result->width == 1280);
    ASSERT(result->height == 720);
    ASSERT(result->timestamp_us == 1000);
    ASSERT(!q.pop().has_value());
}

TEST(overflow_drops_oldest) {
    FrameQueue q(2);
    for (uint64_t ts = 1; ts <= 3; ++ts) {
        DecodedFrame f;
        f.width = 640; f.height = 480; f.timestamp_us = ts;
        f.data.resize(640u * 480u * 4u, 0);
        q.push(std::move(f));
    }
    // Queue max=2, 3 pushed -> 1 dropped (oldest ts=1)
    ASSERT(q.dropped_frames() == 1);
    auto a = q.pop();
    ASSERT(a.has_value() && a->timestamp_us == 2);
    auto b = q.pop();
    ASSERT(b.has_value() && b->timestamp_us == 3);
    ASSERT(!q.pop().has_value());
}

TEST(shutdown_clears_queue) {
    FrameQueue q(5);
    DecodedFrame f;
    f.width = 1; f.height = 1; f.data.resize(4, 0);
    q.push(f);
    q.shutdown();
    ASSERT(!q.pop().has_value());
}

TEST(delivered_counter) {
    FrameQueue q(4);
    DecodedFrame f;
    f.width = 1; f.height = 1; f.data.resize(4, 0);
    q.push(f);
    q.push(f);
    q.pop();
    ASSERT(q.delivered_frames() == 1);
    q.pop();
    ASSERT(q.delivered_frames() == 2);
}

// ─────────────────────────────────────────────────────────────────────────────
int main()
{
    printf("=== FrameQueue unit tests ===\n");
    printf("Passed: %d  Failed: %d\n", g_pass, g_fail);
    return g_fail > 0 ? 1 : 0;
}
