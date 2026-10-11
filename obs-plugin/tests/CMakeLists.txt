# Unit tests – no OBS headers required; test only pure-C++ components
add_executable(test-frame-queue
    unit/test_frame_queue.cpp
    "${CMAKE_CURRENT_SOURCE_DIR}/../src/frame_queue.cpp"
)
target_include_directories(test-frame-queue PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../src")
add_test(NAME TestFrameQueue COMMAND test-frame-queue)

add_executable(test-connection-state
    unit/test_connection_state.cpp
)
target_include_directories(test-connection-state PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../src")
add_test(NAME TestConnectionState COMMAND test-connection-state)
