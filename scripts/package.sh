#!/usr/bin/env bash
# Package the Electron shell + staged harness for the host OS/arch.
# Linux: deb + AppImage. macOS: dmg + zip (per-arch, not lipo). Windows: nsis + zip.
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

# Prefer GHA RUNNER_ARCH: Git Bash on windows-11-arm can report x86_64 under emulation.
detect_pack_arch() {
  if [ -n "${RUNNER_ARCH:-}" ]; then
    case "$RUNNER_ARCH" in
      X64|x64|amd64) printf 'x64' ;;
      ARM64|arm64|aarch64) printf 'arm64' ;;
      *)
        echo "error: unsupported RUNNER_ARCH=$RUNNER_ARCH (expected X64 or ARM64)" >&2
        exit 1
        ;;
    esac
    return
  fi
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *)
      echo "error: unsupported architecture $(uname -m) (expected x64 or arm64)" >&2
      exit 1
      ;;
  esac
}

pack_os=
pack_arch=
builder_args=()
artifact_glob=

pack_arch=$(detect_pack_arch)

case "$(uname -s)" in
  Linux*)
    pack_os=linux
    builder_args=(--linux deb AppImage --"$pack_arch")
    artifact_glob="DeepSeek-Harness-*-linux-${pack_arch}.*"
    ;;
  Darwin*)
    pack_os=mac
    builder_args=(--mac dmg zip --"$pack_arch")
    artifact_glob="DeepSeek-Harness-*-mac-${pack_arch}.*"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    pack_os=win
    builder_args=(--win nsis zip --"$pack_arch")
    artifact_glob="DeepSeek-Harness-*-win-${pack_arch}.*"
    ;;
  *)
    echo "error: scripts/package.sh supports Linux, macOS, and Windows only (got $(uname -s))" >&2
    exit 1
    ;;
esac

# extraResources.from is hardcoded to dist/runtime. A custom STAGE would
# stage one tree and pack another.
stage="$repo_root/dist/runtime"
if [ -n "${STAGE:-}" ]; then
  given=$STAGE
  case "$given" in
    /*) ;;
    *) given="$repo_root/$given" ;;
  esac
  expected=$stage
  if command -v realpath >/dev/null 2>&1 && realpath -m / >/dev/null 2>&1; then
    given=$(realpath -m "$given")
    expected=$(realpath -m "$expected")
  fi
  if [ "$given" != "$expected" ]; then
    echo "error: package.sh packs extraResources from dist/runtime only; unset STAGE or set STAGE=dist/runtime (got $STAGE)" >&2
    exit 1
  fi
fi

posix_node="$stage/node/bin/node"
spawn_helper="$stage/node/bin/node-spawn-helper"
need_helper=0
if [ "$pack_os" = mac ]; then
  need_helper=1
fi

runtime_node_ok() {
  if [ "$pack_os" = win ]; then
    [ -f "$stage/node/node.exe" ]
  else
    [ -x "$posix_node" ]
  fi
}

staged_ok=1
if [ ! -f "$stage/sidecar-entry.mjs" ] || [ ! -f "$stage/lib/bin.js" ] || ! runtime_node_ok; then
  staged_ok=0
fi
if [ "$need_helper" -eq 1 ] && [ ! -x "$spawn_helper" ]; then
  staged_ok=0
fi

if [ "$staged_ok" -eq 0 ]; then
  echo "package: staged runtime missing at $stage; running stage-runtime.sh"
  STAGE="$stage" "$script_dir/stage-runtime.sh"
fi

if [ ! -f "$stage/sidecar-entry.mjs" ] || [ ! -f "$stage/lib/bin.js" ] || ! runtime_node_ok; then
  echo "error: staged runtime incomplete at $stage; run scripts/stage-runtime.sh" >&2
  exit 1
fi
if [ "$need_helper" -eq 1 ] && [ ! -x "$spawn_helper" ]; then
  echo "error: staged node-spawn-helper missing at $spawn_helper; run scripts/stage-runtime.sh on Darwin" >&2
  exit 1
fi

if [ ! -e node_modules/.bin/electron-builder ] && [ ! -e node_modules/.bin/electron-builder.cmd ]; then
  echo "error: electron-builder not installed; run pnpm install" >&2
  exit 1
fi

echo "package: compiling Electron shell"
pnpm exec tsc

# Never publish from this wrapper (unsigned v1).
export CSC_IDENTITY_AUTO_DISCOVERY=false

echo "package: electron-builder ${builder_args[*]} --publish never"
pnpm exec electron-builder "${builder_args[@]}" --publish never

version=$(jq -r .desktop.version versions.json)
echo "package: artifacts in $repo_root/dist/installers ($artifact_glob version=${version} ${pack_os}-${pack_arch})"
