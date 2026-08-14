#!/usr/bin/env bash
# Deploy @deepseek-ai/dsh into $STAGE, official Node, and the sidecar supervisor.
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
  # Prefer GHA RUNNER_ARCH: Git Bash on windows-11-arm can report x86_64.
  if [ -n "${RUNNER_ARCH:-}" ]; then
    case "$RUNNER_ARCH" in
      X64|x64|amd64) printf 'x64' ;;
      ARM64|arm64|aarch64) printf 'arm64' ;;
      *)
        echo "error: unsupported RUNNER_ARCH=$RUNNER_ARCH; set NODE_ARCH=x64|arm64" >&2
        exit 1
        ;;
    esac
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

# Workspace checkout has no launcher (packages/*/bin/ is gitignored). Build
# with musl-gcc when present, else reuse a prebuilt; then copy into STAGE.
stage_landlock_launcher() {
  local clone=$1 stage=$2 arch=$3
  local landlock_pkg="@deepseek-ai/node-addon-landlock-run-linux-${arch}"
  local dests=()
  if [ -d "$stage/node_modules/$landlock_pkg" ]; then
    dests+=("$stage/node_modules/$landlock_pkg")
  fi
  if [ -d "$stage/node_modules/@deepseek-ai/node-addon-landlock-run/node_modules/$landlock_pkg" ]; then
    dests+=("$stage/node_modules/@deepseek-ai/node-addon-landlock-run/node_modules/$landlock_pkg")
  fi
  if [ "${#dests[@]}" -eq 0 ]; then
    echo "error: $landlock_pkg missing under $stage/node_modules" >&2
    exit 1
  fi

  local built="$clone/native/landlock-run/packages/linux-${arch}/bin/landlock-run"
  if [ ! -f "$built" ] && command -v musl-gcc >/dev/null 2>&1; then
    echo "stage-runtime: building landlock-run with musl-gcc"
    (
      cd "$clone"
      pnpm --filter @deepseek-ai/node-addon-landlock-run-workspace build:native
    )
  fi

  if [ -f "$built" ]; then
    local dest
    for dest in "${dests[@]}"; do
      mkdir -p "$dest/bin"
      cp "$built" "$dest/bin/landlock-run"
      chmod 755 "$dest/bin/landlock-run"
    done
  fi

  local dest landlock_bin found=
  for dest in "${dests[@]}"; do
    landlock_bin="$dest/bin/landlock-run"
    if [ -f "$landlock_bin" ] && [ -x "$landlock_bin" ]; then
      echo "stage-runtime: landlock launcher $landlock_bin"
      found=1
    fi
  done
  if [ -n "$found" ]; then
    return 0
  fi

  echo "error: $landlock_pkg has no bin/landlock-run; need musl-tools (musl-gcc) or a prebuilt platform package" >&2
  exit 1
}

# node-pty's patched lookup prefers DSH_NODE_PTY_SPAWN_HELPER, then
# process.execPath + '-spawn-helper'. Stage as node/bin/node-spawn-helper.
stage_spawn_helper() {
  local clone=$1 stage=$2 arch=$3
  local dest="$stage/node/bin/node-spawn-helper"
  local source=
  local candidates=(
    "$stage/node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper"
    "$stage/node_modules/@deepseek-ai/dsh-subprocess-local/node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper"
    "$clone/packages/subprocess/subprocess-local/node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper"
    "$clone/node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper"
    "$stage/node_modules/node-pty/build/Release/spawn-helper"
    "$clone/packages/subprocess/subprocess-local/node_modules/node-pty/build/Release/spawn-helper"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      source=$candidate
      break
    fi
  done

  if [ -z "$source" ]; then
    local roots=()
    [ -d "$stage/node_modules" ] && roots+=("$stage/node_modules")
    [ -d "$clone/packages/subprocess/subprocess-local/node_modules" ] &&
      roots+=("$clone/packages/subprocess/subprocess-local/node_modules")
    [ -d "$clone/node_modules" ] && roots+=("$clone/node_modules")
    if [ "${#roots[@]}" -gt 0 ]; then
      # BSD find (macOS) has no -quit; take the first printed path.
      source=$(
        set +o pipefail
        find "${roots[@]}" \
          \( -path "*/node-pty/prebuilds/darwin-${arch}/spawn-helper" \
          -o -path "*/node-pty/build/Release/spawn-helper" \) \
          -type f -print 2>/dev/null | head -n 1
      )
    fi
  fi

  if [ -z "$source" ] || [ ! -f "$source" ]; then
    echo "error: node-pty spawn-helper missing for darwin-${arch} (looked in staged and clone node_modules)" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$dest")"
  cp "$source" "$dest"
  chmod 0755 "$dest"
  if [ ! -x "$dest" ]; then
    echo "error: $dest is not executable after chmod 0755" >&2
    exit 1
  fi
  echo "stage-runtime: spawn-helper $source -> $dest"
}

# Absolute path with . / .. collapsed so STAGE=. or STAGE=.. cannot bypass rm -rf guards.
canonicalize() {
  local p=$1
  case "$p" in
    /*) ;;
    *) p="$repo_root/$p" ;;
  esac
  if command -v realpath >/dev/null 2>&1 && realpath -m / >/dev/null 2>&1; then
    realpath -m "$p"
    return
  fi
  local suffix=
  local probe=$p
  while [ ! -d "$probe" ]; do
    if [ "$probe" = "/" ]; then
      break
    fi
    if [ -n "$suffix" ]; then
      suffix="$(basename -- "$probe")/$suffix"
    else
      suffix=$(basename -- "$probe")
    fi
    probe=$(dirname -- "$probe")
  done
  local prefix
  prefix=$(CDPATH='' cd -- "$probe" && pwd -P)
  local IFS=/
  local part
  for part in $suffix; do
    [ -z "$part" ] && continue
    case "$part" in
      .) ;;
      ..)
        if [ "$prefix" != "/" ]; then
          prefix=$(dirname -- "$prefix")
        fi
        ;;
      *) prefix="$prefix/$part" ;;
    esac
  done
  printf '%s\n' "$prefix"
}

# True if dest is / or would delete root (dest equals root or is an ancestor).
unsafe_rm_target() {
  local dest=$1 root=$2
  [ "$dest" = "/" ] && return 0
  [ "$dest" = "$root" ] && return 0
  case "$root" in
    "$dest"/*) return 0 ;;
  esac
  return 1
}

is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) return 0 ;;
  esac
  return 1
}

# Symlinks, plus Windows junctions / reparse points that find -type l misses.
list_links() {
  local dir=$1
  if is_windows; then
    local arg=$dir
    if command -v cygpath >/dev/null 2>&1; then
      arg=$(cygpath -w "$dir")
    fi
    if command -v node >/dev/null 2>&1; then
      local out
      out=$(LINK_ROOT="$arg" node --input-type=module <<'JS'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
const root = process.env.LINK_ROOT
async function walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const p = join(dir, ent.name)
    let st
    try {
      st = await lstat(p)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) {
      process.stdout.write(`${p}\n`)
      continue
    }
    if (st.isDirectory()) await walk(p)
  }
}
await walk(root)
JS
      ) || true
      if [ -n "$out" ] && command -v cygpath >/dev/null 2>&1; then
        while IFS= read -r line; do
          [ -n "$line" ] && cygpath -u "$line"
        done <<< "$out"
      else
        printf '%s\n' "$out"
      fi
      return
    fi
    if command -v powershell.exe >/dev/null 2>&1; then
      powershell.exe -NoProfile -Command \
        "Get-ChildItem -LiteralPath '$arg' -Force -Recurse -ErrorAction SilentlyContinue | Where-Object { \$_.LinkType -eq 'Junction' -or \$_.LinkType -eq 'SymbolicLink' } | ForEach-Object { \$_.FullName }" \
        | while IFS= read -r line; do
            [ -n "$line" ] || continue
            if command -v cygpath >/dev/null 2>&1; then
              cygpath -u "$line"
            else
              printf '%s\n' "$line"
            fi
          done
      return
    fi
  fi
  find "$dir" -type l -print || true
}

stage=${STAGE:-$repo_root/dist/runtime}
clone=${CLONE:-$repo_root/.cache/harness}
stage=$(canonicalize "$stage")
clone=$(canonicalize "$clone")
repo_root=$(canonicalize "$repo_root")

if [ -z "$stage" ] || unsafe_rm_target "$stage" "$repo_root" || unsafe_rm_target "$stage" "$clone"; then
  echo "error: refusing to stage into $stage" >&2
  exit 1
fi

need_cmd jq
need_cmd git
need_cmd pnpm

prev_sha=
if [ -d "$clone/.git" ]; then
  prev_sha=$(git -C "$clone" rev-parse HEAD)
fi

"$script_dir/fetch-harness.sh"

sha=$(jq -r .harness.sha versions.json)
current=$(git -C "$clone" rev-parse HEAD)
if [ "$current" != "$sha" ]; then
  echo "error: $clone HEAD is $current, expected $sha" >&2
  exit 1
fi

need_build=0
if [ ! -f "$clone/apps/cli/lib/bin.js" ] || [ ! -d "$clone/node_modules" ]; then
  need_build=1
elif [ -n "$prev_sha" ] && [ "$prev_sha" != "$current" ]; then
  need_build=1
fi

if [ "$need_build" -eq 1 ]; then
  echo "stage-runtime: building harness at $sha"
  "$script_dir/build-harness.sh"
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

# Direct deps first (legacy hoist), then walk every staged manifest's
# dependencies + peerDependencies until the closure is closed. Peers like
# @deepseek-ai/cordis-plugin-group are required at runtime but not listed
# on @deepseek-ai/dsh itself.
find_dep_source() {
  local name=$1
  local path vendor
  if [ -e "$clone/apps/cli/node_modules/$name" ]; then
    printf '%s\n' "$clone/apps/cli/node_modules/$name"
    return 0
  fi
  if [ -e "$clone/node_modules/$name" ]; then
    printf '%s\n' "$clone/node_modules/$name"
    return 0
  fi
  for vendor in "$clone"/vendor/*; do
    if [ -f "$vendor/package.json" ] && [ "$(jq -r .name "$vendor/package.json")" = "$name" ]; then
      printf '%s\n' "$vendor"
      return 0
    fi
  done
  local store_id=${name//\//+}
  shopt -s nullglob
  for path in "$clone/node_modules/.pnpm/${store_id}@"*/node_modules/"$name"; do
    if [ -e "$path" ]; then
      printf '%s\n' "$path"
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob
}

restored=
missing=
while IFS= read -r name; do
  [ -n "$name" ] || continue
  dest="$stage/node_modules/$name"
  if [ -e "$dest" ]; then
    continue
  fi
  source=$(find_dep_source "$name" || true)
  if [ -z "$source" ]; then
    missing="${missing}${missing:+ }$name"
    continue
  fi
  copy_package "$source" "$dest"
  restored="${restored}${restored:+ }$name"
done < <(jq -r '.dependencies // {} | keys[]' "$manifest")

pass=0
while [ "$pass" -lt 20 ]; do
  pass=$((pass + 1))
  added=
  while IFS= read -r mf; do
    [ -f "$mf" ] || continue
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      dest="$stage/node_modules/$name"
      if [ -e "$dest" ]; then
        continue
      fi
      source=$(find_dep_source "$name" || true)
      if [ -z "$source" ]; then
        if jq -e --arg n "$name" '.peerDependenciesMeta[$n].optional == true' "$mf" >/dev/null 2>&1; then
          continue
        fi
        missing="${missing}${missing:+ }$name"
        continue
      fi
      copy_package "$source" "$dest"
      restored="${restored}${restored:+ }$name"
      added=1
    done < <(jq -r '(.dependencies // {}), (.peerDependencies // {}) | keys[]' "$mf")
  done < <(find "$stage" \( -path "$stage/node_modules/.bin" -o -path "$stage/node_modules/.pnpm" \) -prune -o -name package.json -print)
  [ -n "$added" ] || break
done

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
# Follow $0 so `ln -s …/harness/bin/dsh /usr/local/bin/dsh` still finds ../node.
if command -v realpath >/dev/null 2>&1; then
  here=$(dirname -- "$(realpath "$0")")
else
  target=$0
  case $target in
    /*) ;;
    */*) target=$(CDPATH='' cd -- "$(dirname -- "$target")" && pwd)/$(basename -- "$target") ;;
    *)
      found=$(command -v -- "$target" 2>/dev/null || true)
      if [ -n "$found" ]; then
        target=$found
      else
        target=$(CDPATH='' cd -- "$(dirname -- "$target")" && pwd)/$(basename -- "$target")
      fi
      ;;
  esac
  while [ -L "$target" ]; do
    dest=$(readlink "$target")
    case $dest in
      /*) target=$dest ;;
      *) target=$(CDPATH='' cd -- "$(dirname -- "$target")" && pwd)/$dest ;;
    esac
  done
  here=$(CDPATH='' cd -- "$(dirname -- "$target")" && pwd)
fi
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

# manylinux pty.node + landlock launcher; skip on non-Linux hosts.
# macOS: copy node-pty spawn-helper next to bundled node (node-pty patch).
case "$(uname -s)" in
  Linux*)
    "$script_dir/rebuild-node-pty-manylinux.sh" "$clone" "$stage"
    stage_landlock_launcher "$clone" "$stage" "$arch"
    ;;
  Darwin*)
    stage_spawn_helper "$clone" "$stage" "$arch"
    ;;
esac

leftover=$(list_links "$stage")
leftover=$(printf '%s\n' "$leftover" | sed '/^$/d')
if [ -n "$leftover" ]; then
  echo "error: symlinks remain under $stage:" >&2
  printf '%s\n' "$leftover" >&2
  exit 1
fi

echo "stage-runtime: staged $stage"
echo "stage-runtime: host smoke: node $stage/sidecar-entry.mjs web --host 127.0.0.1 --port 13800"
