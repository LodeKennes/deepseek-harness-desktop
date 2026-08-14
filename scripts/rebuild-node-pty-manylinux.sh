#!/usr/bin/env bash
# Rebuild Linux node-pty in manylinux 2.28 so the shipped addon does not
# require a newer GLIBC than the runtime claims. Skip on non-Linux.
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

case "$(uname -s)" in
  Linux*) ;;
  *)
    echo "rebuild-node-pty-manylinux: skip (not Linux)"
    exit 0
    ;;
esac

clone=${1:-${CLONE:-$repo_root/.cache/harness}}
stage=${2:-${STAGE:-}}

case "$clone" in
  /*) ;;
  *) clone="$repo_root/$clone" ;;
esac
if [ ! -d "$clone" ]; then
  echo "error: harness clone not found at $clone; run scripts/build-harness.sh" >&2
  exit 1
fi
if command -v realpath >/dev/null 2>&1; then
  clone=$(realpath "$clone")
fi

if [ -n "$stage" ]; then
  case "$stage" in
    /*) ;;
    *) stage="$repo_root/$stage" ;;
  esac
  if command -v realpath >/dev/null 2>&1 && [ -e "$stage" ]; then
    stage=$(realpath "$stage")
  fi
fi

if [ -n "${RUNNER_ARCH:-}" ]; then
  case "$RUNNER_ARCH" in
    X64|x64|amd64) image=quay.io/pypa/manylinux_2_28_x86_64 ;;
    ARM64|arm64|aarch64) image=quay.io/pypa/manylinux_2_28_aarch64 ;;
    *)
      echo "error: unsupported Linux runner architecture $RUNNER_ARCH" >&2
      exit 1
      ;;
  esac
else
  case "$(uname -m)" in
    x86_64|amd64) image=quay.io/pypa/manylinux_2_28_x86_64 ;;
    aarch64|arm64) image=quay.io/pypa/manylinux_2_28_aarch64 ;;
    *)
      echo "error: unsupported Linux architecture $(uname -m)" >&2
      exit 1
      ;;
  esac
fi

if command -v docker >/dev/null 2>&1; then
  engine=docker
elif command -v podman >/dev/null 2>&1; then
  engine=podman
else
  echo "error: docker or podman is required to rebuild node-pty against manylinux 2.28" >&2
  exit 1
fi

need_cmd readelf "binutils is required to assert node-pty GLIBC <= 2.28"

addon_dir="$clone/packages/subprocess/subprocess-local/node_modules/node-pty"
if command -v realpath >/dev/null 2>&1 && [ -d "$addon_dir" ]; then
  addon_dir=$(realpath "$addon_dir")
fi
addon="$addon_dir/build/Release/pty.node"

if [ ! -f "$addon_dir/binding.gyp" ]; then
  echo "error: node-pty missing at $addon_dir (no binding.gyp); run scripts/build-harness.sh" >&2
  exit 1
fi

# linux-arm64 CI: pnpm may skip node-pty's install script and leave a
# Makefile that includes ../../../node-addon-api@7.1.1/.../*.target.mk
# from another tree. Reusing that Makefile makes `make` exit 2.
# Configure on the host (needs this machine's node-gyp + headers);
# compile inside manylinux so the .node stays GLIBC <= 2.28.
echo "rebuild-node-pty-manylinux: regenerating node-gyp Makefile in $addon_dir"
rm -rf "$addon_dir/build"
if pnpm -C "$clone" exec node-gyp --version >/dev/null 2>&1; then
  pnpm -C "$clone" exec node-gyp --directory "$addon_dir" configure
else
  need_cmd npx
  (
    cd "$addon_dir"
    npx --yes node-gyp@12 configure
  )
fi

if [ ! -f "$addon_dir/build/Makefile" ]; then
  echo "error: node-gyp configure did not write $addon_dir/build/Makefile" >&2
  exit 1
fi

echo "rebuild-node-pty-manylinux: $engine $image → $addon_dir"

run_args=(
  run --rm
  --user "$(id -u):$(id -g)"
  -v "$clone:$clone"
)
if [ -d "${HOME:-}/.cache/node-gyp" ]; then
  run_args+=(-v "$HOME/.cache/node-gyp:$HOME/.cache/node-gyp:ro")
fi
# The npx fallback writes absolute paths such as ~/.npm/_npx/.../addon.gypi
# into build/Makefile. The compiler container must see that package tree at
# the identical path, not only the separately cached Node headers above.
if [ -d "${HOME:-}/.npm" ]; then
  run_args+=(-v "$HOME/.npm:$HOME/.npm:ro")
fi
# GitHub Actions pnpm/node prefix; local builds usually do not have this.
if [ -d "${HOME:-}/setup-pnpm" ]; then
  run_args+=(-v "$HOME/setup-pnpm:$HOME/setup-pnpm:ro")
fi
run_args+=(
  -w "$addon_dir"
  "$image"
  bash -euxo pipefail -c
  'rm -rf build/Release && make -C build -j2 BUILDTYPE=Release'
)

"$engine" "${run_args[@]}"

if [ ! -f "$addon" ]; then
  echo "error: $addon missing after manylinux rebuild" >&2
  exit 1
fi

maximum=$(readelf --version-info "$addon" | tee /dev/stderr | sed -n 's/.*Name: GLIBC_\([0-9.]*\).*/\1/p' | sort -V | tail -1)
if [ -z "$maximum" ]; then
  echo "error: no GLIBC requirements found in $addon" >&2
  exit 1
fi

glibc_ok=0
if command -v dpkg >/dev/null 2>&1; then
  if dpkg --compare-versions "$maximum" le 2.28; then
    glibc_ok=1
  fi
elif [ "$(printf '%s\n' "$maximum" "2.28" | sort -V | tail -1)" = "2.28" ]; then
  glibc_ok=1
fi
if [ "$glibc_ok" -ne 1 ]; then
  echo "error: node-pty addon requires GLIBC_$maximum but the rebuild claims manylinux_2_28" >&2
  exit 1
fi

echo "rebuild-node-pty-manylinux: $addon max GLIBC_$maximum (<= 2.28)"

if [ -z "$stage" ]; then
  exit 0
fi

# Legacy pnpm deploy omits the node-gyp side-effect dir; copy the rebuilt addon
# to every hoisted/nested node-pty in the staged tree.
if [ ! -d "$stage/node_modules" ]; then
  echo "error: $stage/node_modules does not exist; stage before copying pty.node" >&2
  exit 1
fi

copied=0
while IFS= read -r pkg_json; do
  [ -n "$pkg_json" ] || continue
  staged_pty=$(dirname -- "$pkg_json")
  dest="$staged_pty/build/Release/pty.node"
  rm -rf "$staged_pty/build"
  mkdir -p "$(dirname -- "$dest")"
  cp "$addon" "$dest"
  echo "rebuild-node-pty-manylinux: copied pty.node → $dest"
  copied=1
done < <(find "$stage/node_modules" -path '*/node-pty/package.json' -print)

if [ "$copied" -eq 0 ]; then
  echo "error: node-pty not found under $stage/node_modules; cannot stage pty.node" >&2
  exit 1
fi
