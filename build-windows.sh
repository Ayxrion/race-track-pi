#!/bin/sh
# Build on Windows with MSYS2's 32-bit MinGW toolchain (g++, CMake, Ninja, SDL2, curl),
# using the LovyanGFX and ArduinoJson copies from the Arduino libraries folder.
set -e
cd "$(dirname "$0")"
M=/c/msys64/mingw32
export PATH="$M/bin:$PATH"
LIBS="$HOME/Documents/Arduino/libraries"
cmake -S . -B build -G Ninja -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ \
  -DLGFX_DIR="$LIBS/LovyanGFX" -DARDUINOJSON_DIR="$LIBS/ArduinoJson"
cmake --build build
