# Race Track: Raspberry Pi edition

The Race Track simulation from the CrowPanel ESP32 project, running on a
Raspberry Pi (or in a window on a Windows/Linux PC for development). It is a
separate project: the ESP32 build and its OTA releases are not affected.

The Pi edition adds rigid-body collisions, tyre/pit strategies, motorcycles
and go-karts. A shared 3D webapp can watch the Pi and ESP32 races independently.
See [enable the live webapp](docs/WEBAPP.md).

## GitHub builds and updates

Every push to `main` builds and tests the Pi app, Windows app and spectator.
Version tags (`v0.1.1`, etc.) publish all three as a
[GitHub release](https://github.com/Ayxrion/race-track-pi/releases), with checksums:

- `race-track-pi-linux-arm64.tar.gz`: 64-bit Raspberry Pi OS desktop,
  Bookworm or newer; requires SDL2, libcurl and CA certificates.
- `race-track-pi-windows-x86.zip`: Windows development app with runtime DLLs.
- `race-track-spectator.tar.gz`: compiled webapp and relay for the existing VM.

The application version comes from the tag. Configuration, publishing keys and
saved championships stay outside build artifacts. Keep the application's
existing `data/` directory when replacing its executable. The ESP32's separate
GitHub OTA releases remain unchanged.

On the Pi desktop, `bash deploy/install-desktop-service.sh` starts the installed
race now and at future desktop logins, including automatic login after reboot.
Run it as the desktop user without sudo. See [setup](docs/WEBAPP.md).

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
- `data/pi-publish-token.txt`: runtime Pi publishing key, separate from the
  ESP32 key. No rebuild needed. The default relay URL is
  `https://race.ayxie.com/api/publish/pi`; see [setup](docs/WEBAPP.md).
- Public builds work without `wifi_config.h`; simulated weather is available,
  with UTC for day/night. Source builds can retain their local weather settings.

## Console commands

The ESP32's serial test commands work in the terminal: `next [laps]`,
`finale [laps]`, `newseason [laps]`, `shower [in] [laps] [wet]`, `replay`,
`panel <page>`, `telemetry [on|off]`, and `shot` (saves `data/shot_<n>.bmp`).

## Still to do

- Full screen on the Pi and the Pi's display resolution (it draws 800×480 today).
- Mouse wheel zoom (pinch needs a touch screen).
- Extend web telemetry with detailed motorcycle lean and physics debris.
