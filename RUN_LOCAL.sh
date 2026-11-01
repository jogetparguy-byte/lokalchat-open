#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
node_bin="$(command -v node || true)"
bundled_root="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if [[ -z "$node_bin" && -x "$bundled_root/node/bin/node" ]]; then
  node_bin="$bundled_root/node/bin/node"
fi
if [[ -z "$node_bin" ]]; then
  echo 'Node.js tidak ditemui. Pasang Node.js 24 LTS, kemudian jalankan semula.' >&2
  exit 1
fi
export PATH="$(dirname -- "$node_bin"):$PATH"
if ! "$node_bin" -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'; then
  echo 'Gunakan Node.js 24 atau lebih baru.' >&2
  exit 1
fi
command -v rsync >/dev/null || { echo 'rsync diperlukan untuk menjalankan salinan USB.' >&2; exit 1; }
env_file="${LOKALCHAT_ENV_FILE:-$project_dir/../lokalchat-backend/.env}"
if [[ ! -f "$env_file" && -f "$project_dir/.env" ]]; then env_file="$project_dir/.env"; fi
if [[ ! -f "$env_file" ]]; then
  echo 'Fail .env tidak ditemui. Tetapkan LOKALCHAT_ENV_FILE kepada konfigurasi peribadi anda.' >&2
  exit 1
fi
runtime_id="$(printf '%s' "$project_dir" | sha256sum)"
runtime_id="${runtime_id:0:12}"
runtime_dir="$HOME/Documents/Codex/.lokalchat-runtime-$runtime_id"
if [[ -d "$runtime_dir" && ! -f "$runtime_dir/.lokalchat-usb-runtime" ]]; then
  echo 'Folder runtime sedia ada bukan milik launcher ini; tiada fail diubah.' >&2
  exit 1
fi
mkdir -p -- "$runtime_dir"
touch "$runtime_dir/.lokalchat-usb-runtime"
# USB exFAT cannot reliably store node_modules symlinks. Only the generated
# local runtime is synchronized/deleted; USB source and original env stay intact.
rsync -rlt --delete --exclude=node_modules/ --exclude=.output/ --exclude=.tanstack/ \
  --exclude=.wrangler/ --exclude=.nitro/ --exclude=.git/ --exclude=.env \
  --exclude='.env.*' --exclude=.lokalchat-usb-runtime --exclude='*.log' \
  "$project_dir/" "$runtime_dir/"
cd -- "$runtime_dir"
if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  pnpm_bin="$(command -v pnpm || true)"
  if [[ -z "$pnpm_bin" && -x "$bundled_root/bin/fallback/pnpm" ]]; then
    pnpm_bin="$bundled_root/bin/fallback/pnpm"
  fi
  if [[ -z "$pnpm_bin" ]]; then
    echo 'pnpm tidak ditemui. Pasang pnpm, kemudian jalankan semula.' >&2
    exit 1
  fi
  "$pnpm_bin" install --frozen-lockfile --store-dir "$HOME/Documents/Codex/.lokalchat-pnpm-store"
fi
export LOKALCHAT_ENV_FILE="$env_file"
echo 'LokalChat: http://127.0.0.1:3000'
echo 'Biarkan terminal terbuka. Tekan Ctrl+C untuk berhenti.'
exec "$node_bin" scripts/dev.mjs "$@"
