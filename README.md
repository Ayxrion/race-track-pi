# Race Track: Raspberry Pi edition

The Race Track simulation from the CrowPanel ESP32 project, running on a
Raspberry Pi (or in a window on a Windows/Linux PC for development). It is a
separate project: the ESP32 build and its OTA releases are not affected.

This is the starting point for the bigger version: real vehicle physics with
hard-hitting contact, which the Pi has the headroom for. Right now it is the
same race as the ESP32's v0.1.21/v0.1.24 code.

## How it works

`src/` holds the game, copied from `race-track` at f77bd27 (the v0.1.21 code)
and kept as close to the ESP32 files as possible so fixes can move between the
two. Only these files are new or different:

| File | ESP32 | Here |
|---|---|---|
| `src/main.cpp` | `race_track.ino` | No OTA or Wi-Fi scan; strips go to the window with `pushImage` instead of GDMA |
| `src/display_config.h` | RGB panel + GT911 touch | LovyanGFX's SDL2 panel (the mouse or a touch screen is the touch) |
| `src/version.h` | Version from the release tag | Its own version |
| `platform/` | Arduino-ESP32 and FreeRTOS | Stand-ins: threads for the two cores, files for NVS, libcurl for HTTPS |

Saves (settings, championship, careers) are files in `data/` (or the folder
named by `RACE_TRACK_DATA`). Delete the folder to start over.

## Build on Windows (development)

Needs MSYS2 with the 32-bit MinGW packages (`mingw-w64-i686-gcc`, `-cmake`,
`-ninja`, `-SDL2`, `-curl`) and the Arduino libraries LovyanGFX and ArduinoJson
in `Documents/Arduino/libraries`. From Git Bash:

```bash
./build-windows.sh
./run-windows.sh
```

`RACE_TRACK_SCALE=2 ./run-windows.sh` opens the window at double size.

## Build on a Raspberry Pi

Raspberry Pi OS (64-bit, desktop), Pi 4 or Pi 5:

```bash
sudo apt install build-essential cmake git libsdl2-dev libcurl4-openssl-dev
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4
./build/race_track
```

CMake downloads LovyanGFX 1.2.21 and ArduinoJson 6.21.6 the first time (or use
`-DLGFX_DIR=... -DARDUINOJSON_DIR=...` to point at existing copies).

## Settings files (not committed)

- `src/wifi_config.h`: copy `wifi_config.h.template`. Only the weather key,
  location and time zone are used (the operating system handles Wi-Fi and the clock).
- `src/telemetry_config.h`: leave this out for now. With the same relay and
  token as the ESP32, both would publish into one feed. The relay needs to
  tell sources apart before the website can show both.

## Console commands

The ESP32's serial test commands work in the terminal: `next [laps]`,
`finale [laps]`, `newseason [laps]`, `shower [in] [laps] [wet]`, `replay`,
`panel <page>`, `telemetry [off]`, and `shot` (saves `data/shot_<n>.bmp`).

## Still to do

- Full screen on the Pi and the Pi's display resolution (it draws 800×480 today).
- Mouse wheel zoom (pinch needs a touch screen).
- A source name in the telemetry feed, so the website can show the ESP32 and the Pi.
- The physics rewrite: cars as rigid bodies with impulse-based contact and damage.
