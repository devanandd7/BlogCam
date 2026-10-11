# ── Plugin shared library ─────────────────────────────────────────────────────
add_library(
  dex-cam-studio MODULE
  dexcam_module.cpp
  dexcam_source.cpp
  dexcam_source.h
  frame_queue.cpp
  frame_queue.h
  wifi_receiver.cpp
  wifi_receiver.h
  connection_state.h
  settings_ids.h)

target_include_directories(
  dex-cam-studio
  PRIVATE "${OBS_INCLUDE_DIR}"
          "${CMAKE_CURRENT_SOURCE_DIR}/../deps/obs-sdk/include"
          "${CMAKE_CURRENT_SOURCE_DIR}"
          "${CMAKE_CURRENT_BINARY_DIR}/../include")

target_link_libraries(dex-cam-studio PRIVATE "${OBS_LIBRARY}" ws2_32 crypt32 advapi32 wininet windowscodecs ole32)

# Windows: name the output file correctly and set no import-lib
set_target_properties(
  dex-cam-studio
  PROPERTIES PREFIX ""
             OUTPUT_NAME "dex-cam-studio"
             SUFFIX ".dll"
             ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/staging"
             LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/staging/obs-plugins/64bit"
             RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/staging/obs-plugins/64bit")

# OBS plugins must export obs_module_load / obs_module_unload
target_compile_definitions(dex-cam-studio PRIVATE DEXCAM_BUILDING_PLUGIN)
