#!/usr/bin/env bash
# Run inside a dedicated Ubuntu VM: sudo bash deploy/setup-vm.sh
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source /etc/os-release
if [[ ${ID:-} != ubuntu || ( ${VERSION_ID:-} != 24.04 && ${VERSION_ID:-} != 26.04 ) ]]; then
  printf 'Detected OS: %s (ID=%s, VERSION_ID=%s)\n' "${PRETTY_NAME:-unknown}" "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
  echo 'This setup script supports Ubuntu Server 24.04 or 26.04 LTS inside the race-track VM.' >&2
  echo 'Run cat /etc/os-release and share its output to diagnose this check.' >&2
  exit 1
fi
test -f compose.tunnel.yaml
test -f package-lock.json
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl openssl qemu-guest-agent
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version
systemctl enable --now docker
systemctl start qemu-guest-agent
umask 077
if [[ ! -e .env ]]; then
  printf 'RACE_PUBLISH_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
fi
chmod 600 .env
install -d -m 700 secrets
if [[ ! -s secrets/cloudflare-tunnel-token.txt ]]; then
  printf '\nPaste only the Cloudflare tunnel token (input is hidden), then press Enter.\n' > /dev/tty
  IFS= read -r -s tunnel_token < /dev/tty
  printf '\n' > /dev/tty
  if [[ ${#tunnel_token} -lt 40 || $tunnel_token =~ [[:space:]] ]]; then
    echo 'Expected a tunnel token, not the entire Docker command. Nothing saved.' >&2
    exit 1
  fi
  printf '%s' "$tunnel_token" > secrets/cloudflare-tunnel-token.txt
  unset tunnel_token
fi
# The non-root cloudflared container must read the bind-mounted secret.
# The enclosing root-owned 0700 directory protects it from other VM users.
chown root:root secrets secrets/cloudflare-tunnel-token.txt .env
chmod 700 secrets
chmod 444 secrets/cloudflare-tunnel-token.txt
docker compose -f compose.tunnel.yaml config --quiet
docker compose -f compose.tunnel.yaml up -d --build
docker compose -f compose.tunnel.yaml ps
echo
echo 'App started. Configure the Cloudflare published application route:'
echo 'race.ayxie.com -> HTTP -> race:8787'
echo 'Then open https://race.ayxie.com/health'
echo 'The ESP32 publishing key is stored in /opt/race-track/.env (not the tunnel token).'
