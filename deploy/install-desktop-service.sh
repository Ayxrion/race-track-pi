#!/usr/bin/env bash
# Run as the desktop user, from a GitHub release or the repository checkout.
# Keeps the publisher key and saves in the application's existing data folder.
set -euo pipefail
if [[ $EUID -eq 0 ]]; then
  echo 'Run as the Pi desktop user, without sudo.' >&2
  exit 1
fi
app_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ -x "$app_dir/build/race_track" ]]; then
  binary="$app_dir/build/race_track"
else
  binary="$app_dir/race_track"
fi
test -x "$binary" || { echo 'Install the Pi release executable first.' >&2; exit 1; }
# Quote literal paths for systemd (including its percent specifiers).
unit_path() {
  local value=$1
  value=${value//\\/\\\\}; value=${value//\"/\\\"}; value=${value//%/%%}
  printf '"%s"' "$value"
}
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/autostart"
cat > "$HOME/.config/systemd/user/race-track-live.service" <<EOF
[Unit]
Description=Race Track Pi live race and spectator publisher
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=${app_dir//%/%%}
ExecStart=$(unit_path "$binary")
Environment=DISPLAY=:0
Environment=XAUTHORITY=%h/.Xauthority
Environment=SDL_VIDEODRIVER=x11
Restart=on-failure
RestartSec=5
EOF
cat > "$HOME/.config/autostart/race-track-live.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Race Track Pi
Comment=Start the race and its live web feed after desktop login
Exec=/usr/bin/systemctl --user start race-track-live.service
Terminal=false
EOF
chmod 644 "$HOME/.config/systemd/user/race-track-live.service" "$HOME/.config/autostart/race-track-live.desktop"
# A previous temporary systemd-run unit must be stopped before loading the
# permanent file. This does not touch credentials or championship data.
systemctl --user stop race-track-live.service || true
systemctl --user daemon-reload
systemctl --user start race-track-live.service
echo 'Race Track Pi now starts with desktop login (including desktop autologin).'
echo 'Status: systemctl --user status race-track-live.service'
echo 'Stop: systemctl --user stop race-track-live.service'
