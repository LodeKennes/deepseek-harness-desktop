#!/usr/bin/env bash
# Deploy @deepseek-ai/dsh into $STAGE, official Node, and the sidecar supervisor.
# Does not inject a workspace member after the frozen lockfile.
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
need_cmd git
need_cmd pnpm

if [ ! -f versions.json ]; then
  echo "error: versions.json not found in $repo_root" >&2
  exit 1
fi

detect_os() {
  if [ -n "${NODE_OS:-}" ]; then
    printf '%s' "$NODE_OS"
    return
  fi
  case "$(uname -s)" in
    Linux*) printf 'linux' ;;
    Darwin*) printf 'darwin' ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) printf 'win' ;;
    *)
      echo "error: unsupported os $(uname -s); set NODE_OS=linux|darwin|win" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  if [ -n "${NODE_ARCH:-}" ]; then
    printf '%s' "$NODE_ARCH"
    return
  fi
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *)
      echo "error: unsupported arch $(uname -m); set NODE_ARCH=x64|arm64" >&2
      exit 1
      ;;
  esac
}

require_builtin_name() {
  local os=$1 arch=$2
  case "$os" in
    linux) printf 'node-addon-require-builtin-linux-%s-gnu' "$arch" ;;
    darwin) printf 'node-addon-require-builtin-darwin-%s' "$arch" ;;
    win) printf 'node-addon-require-builtin-win32-%s-msvc' "$arch" ;;
    *)
      echo "error: no node-addon-require-builtin mapping for os=$os" >&2
      exit 1
      ;;
  esac
}

copy_package() {
  local source=$1 dest=$2
  mkdir -p "$(dirname "$dest")"
  if [ -d "$source" ]; then
    cp -RL "$source" "$dest"
    rm -rf "$dest/node_modules"
  else
    cp -L "$source" "$dest"
  fi
}

stage=${STAGE:-$repo_root/dist/runtime}
clone=${CLONE:-$repo_root/.cache/harness}
case "$stage" in
  /*) ;;
  *) stage="$repo_root/$stage" ;;
esac
case "$clone" in
  /*) ;;
  *) clone="$repo_root/$clone" ;;
esac

if [ -z "$stage" ] || [ "$stage" = "/" ] || [ "$stage" = "$repo_root" ] || [ "$stage" = "$clone" ]; then
  echo "error: refusing to stage into $stage" >&2
  exit 1
fi

if [ ! -f "$clone/apps/cli/lib/bin.js" ] || [ ! -d "$clone/node_modules" ]; then
  echo "stage-runtime: harness not built; running build-harness.sh"
  "$script_dir/build-harness.sh"
else
  "$script_dir/fetch-harness.sh"
fi

sha=$(jq -r .harness.sha versions.json)
current=$(git -C "$clone" rev-parse HEAD)
if [ "$current" != "$sha" ]; then
  echo "error: $clone HEAD is $current, expected $sha" >&2
  exit 1
fi

if [ ! -f "$clone/apps/cli/lib/bin.js" ]; then
  echo "error: $clone/apps/cli/lib/bin.js missing; run scripts/build-harness.sh" >&2
  exit 1
fi

echo "stage-runtime: deploying @deepseek-ai/dsh → $stage"
rm -rf "$stage"
mkdir -p "$(dirname "$stage")"

(
  cd "$clone"
  pnpm --filter @deepseek-ai/dsh deploy \
    --legacy --prod \
    --config.node-linker=hoisted \
    --config.auto-install-peers=false \
    --config.link-workspace-packages=true \
    "$stage"
)

"$script_dir/materialize-links.sh" "$stage"

# Restore direct deps that the legacy hoister left beside the deploy source.
manifest="$stage/package.json"
if [ ! -f "$manifest" ]; then
  echo "error: $manifest missing — pnpm deploy did not produce a staged package" >&2
  exit 1
fi

restored=
missing=
while IFS= read -r name; do
  [ -n "$name" ] || continue
  dest="$stage/node_modules/$name"
  if [ -e "$dest" ]; then
    continue
  fi
  source=
  if [ -e "$clone/apps/cli/node_modules/$name" ]; then
    source="$clone/apps/cli/node_modules/$name"
  elif [ -e "$clone/node_modules/$name" ]; then
    source="$clone/node_modules/$name"
  else
    missing="${missing}${missing:+ }$name"
    continue
  fi
  copy_package "$source" "$dest"
  restored="${restored}${restored:+ }$name"
done < <(jq -r '.dependencies // {} | keys[]' "$manifest")

if [ -n "$missing" ]; then
  echo "error: staged dependencies remain missing: $missing" >&2
  exit 1
fi
if [ -n "$restored" ]; then
  echo "stage-runtime: restored legacy deploy hoists: $restored"
fi

"$script_dir/download-node.sh" "$stage/node"

mkdir -p "$stage/bin"
rm -f "$stage/bin/dsh" "$stage/bin/dsh.cmd"
cat >"$stage/bin/dsh" <<'EOF'
#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$here/../node/bin/node" "$here/../lib/bin.js" "$@"
EOF
chmod 755 "$stage/bin/dsh"
cat >"$stage/bin/dsh.cmd" <<'EOF'
@echo off
"%~dp0..\node\node.exe" "%~dp0..\lib\bin.js" %*
EOF

cp "$repo_root/electron/sidecar-entry.mjs" "$stage/sidecar-entry.mjs"

if [ ! -f "$stage/lib/bin.js" ]; then
  echo "error: $stage/lib/bin.js missing — run scripts/build-harness.sh" >&2
  exit 1
fi

frontend="$stage/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html"
if [ ! -f "$frontend" ]; then
  echo "error: $frontend missing" >&2
  exit 1
fi

os=$(detect_os)
arch=$(detect_arch)
builtin=$(require_builtin_name "$os" "$arch")
if [ ! -d "$stage/node_modules/$builtin" ]; then
  echo "error: $stage/node_modules/$builtin missing" >&2
  exit 1
fi

leftover=$(find "$stage" -type l -print || true)
if [ -n "$leftover" ]; then
  echo "error: symlinks remain under $stage:" >&2
  printf '%s\n' "$leftover" >&2
  exit 1
fi

echo "stage-runtime: staged $stage"
echo "stage-runtime: host smoke: node $stage/sidecar-entry.mjs web --host 127.0.0.1 --port 13800"
