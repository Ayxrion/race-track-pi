#!/usr/bin/env bash
# Validate the installed unit without starting a game or changing real services.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT
mkdir -p "$test_dir/app with spaces/deploy" "$test_dir/app with spaces/build" "$test_dir/home" "$test_dir/bin"
cp "$repo/deploy/install-desktop-service.sh" "$test_dir/app with spaces/deploy/"
printf '#!/bin/sh\nexit 0\n' > "$test_dir/app with spaces/build/race_track"
chmod +x "$test_dir/app with spaces/build/race_track"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "$HOME/service-calls"\n' > "$test_dir/bin/systemctl"
chmod +x "$test_dir/bin/systemctl"
HOME="$test_dir/home" PATH="$test_dir/bin:$PATH" bash "$test_dir/app with spaces/deploy/install-desktop-service.sh"
unit="$test_dir/home/.config/systemd/user/race-track-live.service"
systemd-analyze verify "$unit"
grep -Fx "WorkingDirectory=$test_dir/app with spaces" "$unit"
grep -Fx 'Exec=/usr/bin/systemctl --user start race-track-live.service' "$test_dir/home/.config/autostart/race-track-live.desktop"
grep -Fx -- '--user start race-track-live.service' "$test_dir/home/service-calls"
echo 'Desktop service installer passed.'
