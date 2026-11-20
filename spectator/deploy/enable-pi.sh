#!/usr/bin/env bash
# Run from the extracted GitHub release on the existing relay VM.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
test -s .env || { echo 'Existing relay .env is missing; run initial setup first.' >&2; exit 1; }
umask 077
# Preserve the ESP32 key, existing Pi key and the Cloudflare tunnel configuration.
# Refuse ambiguous/empty entries so a rerun never silently rotates a working key.
if ! grep -q '^RACE_PI_PUBLISH_TOKEN=' .env; then
  printf '\nRACE_PI_PUBLISH_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env
fi
if [[ $(grep -c '^RACE_PI_PUBLISH_TOKEN=' .env) != 1 ]]; then
  echo 'Expected exactly one RACE_PI_PUBLISH_TOKEN entry in .env.' >&2; exit 1
fi
pi_key=$(sed -n 's/^RACE_PI_PUBLISH_TOKEN=//p' .env | tr -d '\r')
esp_key=$(sed -n 's/^RACE_PUBLISH_TOKEN=//p' .env | tr -d '\r')
if [[ ! $pi_key =~ ^[a-zA-Z0-9_-]{32,95}$ || $pi_key == "$esp_key" ]]; then
  echo 'Pi key must be 32-95 URL-safe characters and differ from the ESP32 key. Correct .env before retrying.' >&2; exit 1
fi
install -d -m 700 secrets
printf '%s\n' "$pi_key" > secrets/pi-publish-token.txt
chmod 600 .env secrets/pi-publish-token.txt
unset pi_key esp_key
docker compose -f compose.tunnel.yaml config --quiet
docker compose -f compose.tunnel.yaml up -d --build race
echo 'Pi endpoint enabled. Private key file: secrets/pi-publish-token.txt'
echo 'Copy that key file to the Pi application data/pi-publish-token.txt, then restart the application.'
echo 'Viewer: https://race.ayxie.com/?source=pi'
