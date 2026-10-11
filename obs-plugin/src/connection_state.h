#pragma once
#include <string>

// ─────────────────────────────────────────────────────────────────────────────
// Connection state machine
//
//   DISCONNECTED ──► PAIRING ──► CONNECTING ──► CONNECTED
//        ▲                            │               │
//        │                    timeout / error         │ disconnect
//        └────────────────────────────┴───────────────┘
//
//   CONNECTED ──► RECONNECTING ──► CONNECTED  (on transient error)
//                               └──► DISCONNECTED (max retries)
//   Any state ──► ERROR  (fatal)
// ─────────────────────────────────────────────────────────────────────────────

enum class ConnectionState : int {
    DISCONNECTED  = 0,
    PAIRING       = 1,
    CONNECTING    = 2,
    CONNECTED     = 3,
    RECONNECTING  = 4,
    ERROR_FATAL   = 5,
};

inline const char* connection_state_name(ConnectionState s) {
    switch (s) {
        case ConnectionState::DISCONNECTED:  return "Disconnected";
        case ConnectionState::PAIRING:       return "Pairing…";
        case ConnectionState::CONNECTING:    return "Connecting…";
        case ConnectionState::CONNECTED:     return "Connected";
        case ConnectionState::RECONNECTING:  return "Reconnecting…";
        case ConnectionState::ERROR_FATAL:   return "Error";
        default:                             return "Unknown";
    }
}
