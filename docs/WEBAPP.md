# Enable the Pi live webapp

The Pi remains the authoritative game. The shared viewer follows its positions,
heading (including slides), race order, brakes, weather and lights. It supports
all eight classes, including motorcycles and go-karts. Physics debris and
detailed motorcycle lean are not separate telemetry fields yet.

## 1. Update the relay from the GitHub build

On `raceadmin@192.168.1.107`, follow the
[spectator release instructions](../spectator/README.md#release-deployment).
No Cloudflare DNS or tunnel change is required. The update creates
`/opt/race-track/secrets/pi-publish-token.txt` and preserves the ESP32 feed.

## 2. Install the Pi application build

Download `race-track-pi-linux-arm64.tar.gz` from the matching
[GitHub release](https://github.com/Ayxrion/race-track-pi/releases).
It targets a 64-bit Raspberry Pi OS desktop on Pi 4/5 (Bookworm or newer).
Install the runtime dependencies if needed:

```bash
sudo apt-get update
sudo apt-get install -y libsdl2-2.0-0 libcurl4 ca-certificates
```

Close the current race application before replacing its executable. Extract the
release into its application directory. Keep its existing `data/` directory
and run from the same working directory so settings/championships are retained.
If the existing launcher starts `build/race_track`, replace that executable with
the release's `race_track` or adjust the launcher; do not change its working
directory. `RACE_TRACK_DATA` can explicitly select the existing save directory.

The Windows alternative is `race-track-pi-windows-x86.zip`, with its runtime
DLLs alongside the executable. Launch from the same directory as `data/`.

## 3. Save the Pi publishing key

Copy **only the Pi publishing key** from the relay's private key file to
`data/pi-publish-token.txt` next to the Pi app's saves. A text file with one line
is expected (32–95 URL-safe characters; no label, quotes or UTF-8 BOM).
On the Pi, protect the file:

```bash
chmod 600 data/pi-publish-token.txt
./race_track
```

The default destination is `https://race.ayxie.com/api/publish/pi`.
Alternatively configure the launcher environment:

```bash
export RACE_PI_PUBLISH_TOKEN_FILE=/home/ayxie/.config/race-track/pi-publish-token.txt
export RACE_TELEMETRY_URL=https://race.ayxie.com/api/publish/pi
./race_track
```

An environment variable `RACE_PI_PUBLISH_TOKEN` is also supported for service
managers; use either it or `RACE_PI_PUBLISH_TOKEN_FILE`, never both. Environment
settings take precedence over the default data file. Explicit invalid settings
disable publishing with a diagnostic instead of falling back to another key.
The game continues normally if the key is absent or the network is down.

No compile-time telemetry header is needed. Old saved ESP32-style URL/key
settings are deliberately ignored to prevent publishing into the ESP32 feed.
The console accepts `telemetry off` / `telemetry on`; each takes effect after
restarting the application and preserves the key file. Plain `telemetry`
reports whether the publishing task is enabled, not whether the relay accepted
its latest frame.

TLS certificate verification stays enabled. Releases contain no publishing or
weather keys. Existing local `wifi_config.h` weather settings remain supported
when building from source; clean release builds use simulated weather and UTC.

## 4. Verify

Open [the Pi viewer](https://race.ayxie.com/?source=pi). The Pi tab should show
its live circuit, car positions and timing tower; the ESP32 tab should still
show the separate ESP32 race. `/health` reports both source states independently.
Try follow leader, onboard and a grandstand seat. A relay restart should briefly
disconnect viewers, then the publisher resends the circuit and resumes.

If it remains offline, check the game console:

- `off (no relay configured)`: key file missing, or a more specific settings
  error appears immediately before it. Check the launch working directory.
- HTTP 503: the relay has no Pi key configured.
- HTTP 401: game and relay Pi keys differ.
- HTTP 404: old relay or wrong publisher URL.
- HTTP 400: incompatible telemetry; keep game and viewer on matching releases.
- HTTP 409: relay needs the circuit again; the publisher retries automatically.
- Status -1: network or TLS connection failure; check the Pi clock, internet
  access and CA certificates. Never disable TLS verification to work around it.

Do not post `.env`, publishing keys or tunnel tokens in GitHub issues.
