cmake_minimum_required(VERSION 3.24)

# ── Project metadata ──────────────────────────────────────────────────────────
project(
  dex-cam-studio-obs-plugin
  VERSION 0.1.0
  DESCRIPTION "Dex Cam Studio – OBS Studio video source plugin (Wi-Fi via WebRTC)"
  LANGUAGES C CXX)

# ── C++ standard ──────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Build type default ────────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE
      RelWithDebInfo
      CACHE STRING "Build type" FORCE)
endif()

# ── Windows-specific settings ─────────────────────────────────────────────────
if(WIN32)
  add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
  set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS OFF)
endif()

# ── OBS Studio SDK location ───────────────────────────────────────────────────
set(VENDORED_OBS_INCLUDE "${CMAKE_CURRENT_SOURCE_DIR}/deps/obs-studio/libobs")
set(VENDORED_OBS_LIB     "${CMAKE_CURRENT_SOURCE_DIR}/deps/obs-sdk/lib/obs.lib")

if(EXISTS "${VENDORED_OBS_INCLUDE}/obs-module.h")
  set(OBS_INCLUDE_DIR "${VENDORED_OBS_INCLUDE}")
else()
  find_path(
    OBS_INCLUDE_DIR
    NAMES obs-module.h
    HINTS "${OBS_ROOT_DIR}/include"
          "${OBS_ROOT_DIR}/include/obs"
          "C:/Program Files/obs-studio/include"
    DOC "OBS Studio include directory")
endif()

if(NOT OBS_INCLUDE_DIR)
  message(FATAL_ERROR "Could not find obs-module.h.")
endif()

if(EXISTS "${VENDORED_OBS_LIB}")
  set(OBS_LIBRARY "${VENDORED_OBS_LIB}")
else()
  find_library(
    OBS_LIBRARY
    NAMES obs libobs
    HINTS "${OBS_ROOT_DIR}/lib"
          "${OBS_ROOT_DIR}/bin/64bit"
    DOC "OBS Studio libobs library")
endif()

if(NOT OBS_LIBRARY)
  message(FATAL_ERROR "Could not find libobs import library.")
endif()

message(STATUS "[DexCam] OBS include dir : ${OBS_INCLUDE_DIR}")
message(STATUS "[DexCam] OBS library     : ${OBS_LIBRARY}")

configure_file(
  "${CMAKE_CURRENT_SOURCE_DIR}/cmake/plugin-version.h.in"
  "${CMAKE_CURRENT_BINARY_DIR}/include/plugin-version.h" @ONLY)

add_subdirectory(src)

option(DEXCAM_BUILD_TESTS "Build unit tests" ON)
if(DEXCAM_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
