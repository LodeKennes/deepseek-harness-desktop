#!/usr/bin/env bash
# Package the Electron shell + staged harness (Linux x64 .deb + AppImage).
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required but not found on PATH${2:+ ($2)}" >&2
    exit 1
  fi
}

need_cmd jq
need_cmd pnpm

if [ ! -f versions.json ]; then
  echo "error: versions.json not found in $repo_root" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux*) ;;
  *)
    echo "error: scripts/package.sh only supports Linux x64 in this PR" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ;;
  *)
    echo "error: scripts/package.sh only supports Linux x64 in this PR (got $(uname -m))" >&2
    exit 1
    ;;
esac

stage=${STAGE:-$repo_root/dist/runtime}
case "$stage" in
  /*) ;;
  *) stage="$repo_root/$stage" ;;
esac

posix_node="$stage/node/bin/node"
if [ ! -f "$stage/sidecar-entry.mjs" ] || [ ! -f "$stage/lib/bin.js" ] || [ ! -x "$posix_node" ]; then
  echo "package: staged runtime missing at $stage; running stage-runtime.sh"
  STAGE="$stage" "$script_dir/stage-runtime.sh"
fi

if [ ! -f "$stage/sidecar-entry.mjs" ] || [ ! -f "$stage/lib/bin.js" ] || [ ! -x "$posix_node" ]; then
  echo "error: staged runtime incomplete at $stage; run scripts/stage-runtime.sh" >&2
  exit 1
fi

if [ ! -x node_modules/.bin/electron-builder ]; then
  echo "error: electron-builder not installed; run pnpm install" >&2
  exit 1
fi

echo "package: compiling Electron shell"
pnpm exec tsc

# Never publish from this wrapper (unsigned v1).
export CSC_IDENTITY_AUTO_DISCOVERY=false

echo "package: electron-builder linux x64 deb + AppImage --publish never"
pnpm exec electron-builder --linux deb AppImage --x64 --publish never

version=$(jq -r .desktop.version versions.json)
echo "package: artifacts in $repo_root/dist/installers (DeepSeek-Harness-${version}-linux-x64.*)"
