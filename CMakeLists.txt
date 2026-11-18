cmake_minimum_required(VERSION 3.16)
project(RaceTrackPi C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# ── Libraries ────────────────────────────────────────────────────────────────
# LovyanGFX (drawing, SDL panel) and ArduinoJson (weather JSON). Point these at
# existing checkouts (for example the Arduino libraries folder), or leave them
# empty to download the same versions the ESP32 build uses.
set(LGFX_DIR "" CACHE PATH "LovyanGFX source folder (contains src/LovyanGFX.hpp)")
set(ARDUINOJSON_DIR "" CACHE PATH "ArduinoJson source folder (contains src/ArduinoJson.h)")

include(FetchContent)
if(NOT LGFX_DIR)
  FetchContent_Declare(lovyangfx GIT_REPOSITORY https://github.com/lovyan03/LovyanGFX.git GIT_TAG 1.2.21 GIT_SHALLOW TRUE)
  FetchContent_Populate(lovyangfx)
  set(LGFX_DIR ${lovyangfx_SOURCE_DIR})
endif()
if(NOT ARDUINOJSON_DIR)
  FetchContent_Declare(arduinojson GIT_REPOSITORY https://github.com/bblanchon/ArduinoJson.git GIT_TAG v6.21.6 GIT_SHALLOW TRUE)
  FetchContent_Populate(arduinojson)
  set(ARDUINOJSON_DIR ${arduinojson_SOURCE_DIR})
endif()

find_package(SDL2 REQUIRED)
find_package(CURL REQUIRED)
find_package(Threads REQUIRED)

# The parts of LovyanGFX an SDL build needs (as in its examples_for_PC/CMake_SDL).
file(GLOB LGFX_SOURCES CONFIGURE_DEPENDS
  ${LGFX_DIR}/src/lgfx/Fonts/efont/*.c
  ${LGFX_DIR}/src/lgfx/Fonts/IPA/*.c
  ${LGFX_DIR}/src/lgfx/Fonts/lvgl/*.c
  ${LGFX_DIR}/src/lgfx/utility/*.c
  ${LGFX_DIR}/src/lgfx/v1/*.cpp
  ${LGFX_DIR}/src/lgfx/v1/lv_font/*.c
  ${LGFX_DIR}/src/lgfx/v1/misc/*.cpp
  ${LGFX_DIR}/src/lgfx/v1/panel/Panel_Device.cpp
  ${LGFX_DIR}/src/lgfx/v1/panel/Panel_FrameBufferBase.cpp
  ${LGFX_DIR}/src/lgfx/v1/platforms/sdl/*.cpp)
add_library(lgfx_sdl STATIC ${LGFX_SOURCES})
target_include_directories(lgfx_sdl PUBLIC ${LGFX_DIR}/src)
target_compile_definitions(lgfx_sdl PUBLIC LGFX_SDL)
target_link_libraries(lgfx_sdl PUBLIC SDL2::SDL2 Threads::Threads)
target_compile_options(lgfx_sdl PRIVATE -w)

# ── The game ─────────────────────────────────────────────────────────────────
add_executable(race_track src/main.cpp platform/platform.cpp)
target_include_directories(race_track PRIVATE src platform ${ARDUINOJSON_DIR}/src)
target_compile_definitions(race_track PRIVATE
  RT_PC=1
  ARDUINOJSON_ENABLE_ARDUINO_STRING=1
  ARDUINOJSON_ENABLE_ARDUINO_STREAM=0
  ARDUINOJSON_ENABLE_ARDUINO_PRINT=0
  ARDUINOJSON_ENABLE_PROGMEM=0)
if(WIN32)
  target_compile_definitions(race_track PRIVATE _POSIX_THREAD_SAFE_FUNCTIONS)
endif()
target_compile_options(race_track PRIVATE -Wall -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable -Wno-misleading-indentation -Wno-enum-compare)
target_link_libraries(race_track PRIVATE lgfx_sdl CURL::libcurl Threads::Threads)
