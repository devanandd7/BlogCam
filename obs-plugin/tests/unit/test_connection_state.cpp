#include "connection_state.h"
#include <cassert>
#include <cstdio>
#include <string>
#include <stdexcept>

static int g_pass = 0, g_fail = 0;
#define TEST(name) void name(); \
    struct _Reg_##name { _Reg_##name() { \
        try { name(); printf("[PASS] " #name "\n"); ++g_pass; } \
        catch(...) { printf("[FAIL] " #name "\n"); ++g_fail; } } \
    } _reg_##name; void name()
#define ASSERT(cond) do { if (!(cond)) throw std::runtime_error(#cond); } while(0)

TEST(state_name_disconnected) {
    ASSERT(std::string(connection_state_name(ConnectionState::DISCONNECTED)) == "Disconnected");
}
TEST(state_name_connected) {
    ASSERT(std::string(connection_state_name(ConnectionState::CONNECTED)) == "Connected");
}
TEST(state_name_error) {
    ASSERT(std::string(connection_state_name(ConnectionState::ERROR_FATAL)) == "Error");
}
TEST(state_int_values_stable) {
    // Enum values must remain stable (saved in OBS data)
    ASSERT(static_cast<int>(ConnectionState::DISCONNECTED) == 0);
    ASSERT(static_cast<int>(ConnectionState::PAIRING)      == 1);
    ASSERT(static_cast<int>(ConnectionState::CONNECTING)   == 2);
    ASSERT(static_cast<int>(ConnectionState::CONNECTED)    == 3);
    ASSERT(static_cast<int>(ConnectionState::RECONNECTING) == 4);
    ASSERT(static_cast<int>(ConnectionState::ERROR_FATAL)  == 5);
}

int main()
{
    printf("=== ConnectionState unit tests ===\n");
    printf("Passed: %d  Failed: %d\n", g_pass, g_fail);
    return g_fail > 0 ? 1 : 0;
}
