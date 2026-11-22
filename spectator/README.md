# Race Track spectator

The shared 3D viewer and read-only relay for the ESP32 and Raspberry Pi races.
This is the maintained copy of the spectator app, including the refined
motorcycle/go-kart models, onboard cameras, TV director, clickable drivers,
weather, grandstands and vehicle lighting. No audio is included.

## Watching on a phone

The race opens in Auto TV. Use **Camera** for one-tap leader/onboard views,
grandstand seats or the whole circuit. **Drivers** shows the complete race
order; choosing a driver returns directly to the race. **More** contains names,
effects, supported fullscreen controls, connection settings and the explicit
offline demo. Tap the current source tab or use Return to live to leave a demo.

Drag to look around and pinch to zoom. Overview uses the usual orbit gestures.
Camera and timing controls open in native modal sheets on phones, portrait
tablets and short landscape windows. Desktop keeps the side panels. Results
and starting grids open on request rather than interrupting the view.

The mobile update only requires deploying the spectator release. Existing Pi
and ESP32 publishers keep their URLs and credentials; no device update is needed.

## Release deployment

Use `race-track-spectator.tar.gz` from a tagged
[race-track-pi release](https://github.com/Ayxrion/race-track-pi/releases).
GitHub tests and compiles the viewer. The release Dockerfile installs the relay
dependencies and serves that compiled viewer; it does not rebuild the frontend.

On the existing relay VM (`192.168.1.107`):

```bash
cd /opt/race-track
curl -fL https://github.com/Ayxrion/race-track-pi/releases/download/v0.1.1/race-track-spectator.tar.gz -o /tmp/race-track-spectator.tar.gz
sudo tar -xzf /tmp/race-track-spectator.tar.gz -C /opt/race-track
sudo bash deploy/enable-pi.sh
```

This keeps the current ESP32 key, Cloudflare tunnel token and hostname. It adds
a separate Pi publishing key if absent, saves a private copy in
`secrets/pi-publish-token.txt`, and rebuilds/restarts the relay service.
The viewer may briefly reconnect while the relay restarts.
For later updates, replace the version in the download URL with the desired tag.
The release contains no `.env`, `secrets/` or save files.

Transfer the Pi key privately to the race application's `data/pi-publish-token.txt`.
See [Pi setup](https://github.com/Ayxrion/race-track-pi/blob/main/docs/WEBAPP.md).
Use the Pi publishing key, not the ESP32 key or the Cloudflare connector token.
Restart the Pi application after saving it. No compiler is needed to configure a
release binary.

Cloudflare keeps the existing route `race.ayxie.com` → `http://race:8787`.
Both `/api/publish/pi` and `/watch?source=pi` use this route; there is no second
tunnel or public port to open. Interactive challenges/Access must not block
the publisher or WebSocket paths. The existing ESP32 URL stays `/api/publish`.

Verify `https://race.ayxie.com/health`: `sources.pi.configured` becomes true after
the relay update; `sources.pi.connected` becomes true once live frames arrive.
Open [Race Track Pi](https://race.ayxie.com/?source=pi), or use the two tabs to
switch feeds. One authoritative publisher per source; run one relay replica.
The game sends positions including collision slip; the viewer interpolates
them and never controls or re-simulates the race.

For a new VM, the included `deploy/setup-vm.sh` supports Ubuntu 24.04/26.04 and
sets up Docker/Cloudflare, then run `deploy/enable-pi.sh`. Existing deployments
only need the release update above.

## Development

Node 24:

```bash
npm ci
npm test
npm run build
npm run dev
```

Set `RACE_PUBLISH_TOKEN` and the separate `RACE_PI_PUBLISH_TOKEN` in the relay's
environment, then `npm run relay`. Never put keys in browser code or URLs.
Tests cover source isolation, authentication, reconnects, protocol bounds,
interpolation, cameras, model mounts, lights and vehicle animation.

To package locally after building: `node scripts/package-release.mjs`. Packaging
requires a fresh `release/` directory and uses an explicit file allowlist.
Normal updates are GitHub builds triggered by `v*` tags, not local archives.

## Attribution

The Monza preview outline originates from
[bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT), through the
original ESP32 track. Models and scenery are procedural. Dependencies include
Three.js, ws and Vite (MIT); dependency packages retain their license files.
