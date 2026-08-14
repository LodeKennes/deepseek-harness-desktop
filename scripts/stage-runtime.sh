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
  local real item
  mkdir -p "$(dirname "$dest")"
  if [ -d "$source" ]; then
    # pwd -P resolves one package dir. Do not -L the tree: vendor
    # node_modules contain cyclic pnpm links.
    real=$(cd "$source" && pwd -P)
    mkdir -p "$dest"
    for item in "$real"/* "$real"/.[!.]*; do
      [ -e "$item" ] || continue
      [ "$(basename "$item")" = node_modules ] && continue
      cp -R "$item" "$dest/"
    done
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
  local src="$clone/native/landlock-run/packages/entry/src/main.c"
  if [ ! -f "$built" ] && command -v musl-gcc >/dev/null 2>&1; then
    echo "stage-runtime: building landlock-run with musl-gcc"
    mkdir -p "$(dirname "$built")"
    # Direct musl-gcc: `pnpm --filter … build:native` re-enters the harness
    # root and runs postinstall (lefthook), which is not in this deploy.
    musl-gcc -std=c11 -Os -Wall -Wextra -Werror -static -s -o "$built" "$src"
    chmod 755 "$built"
  fi

  if [ -f "$built" ]; then
    local dest target
    for dest in "${dests[@]}"; do
      mkdir -p "$dest/bin"
      target="$dest/bin/landlock-run"
      # pnpm deploy can hardlink the staged platform package back to the
      # workspace package. Avoid failing `cp` when both paths are one inode.
      if [ ! -e "$target" ] || ! [ "$built" -ef "$target" ]; then
        cp "$built" "$target"
      fi
      chmod 755 "$target"
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
need_cmd npm

# shellcheck source=lib/harness-pnpm.sh
. "$script_dir/lib/harness-pnpm.sh"

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

need_cmd node
node "$script_dir/apply-styling.mjs" generate
styling_hash=$(tr -d '[:space:]' <"$repo_root/.cache/styling/hash")
stamp="$clone/.desktop-overlay-stamp"
applied_hash=
if [ -f "$stamp" ]; then
  applied_hash=$(jq -r .stylingHash "$stamp")
  applied_hash=${applied_hash//$'\r'/}
fi
if [ "$styling_hash" != "$applied_hash" ]; then
  echo "stage-runtime: styling overlay changed; rebuilding harness"
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
printf 'pm-on-fail=ignore\n' >"$clone/.npmrc"

(
  cd "$clone"
  harness_pnpm --filter @deepseek-ai/dsh deploy \
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

# Workspace package roots (no node_modules cycles). Built once with Node.
# Keep the dependency walks on named temp files: Windows ARM64 Git Bash can
# stop after a process-substitution loop while still reporting status 0.
# Windows jq.exe + MSYS path conversion writes D:\... into the map, and
# Git Bash [ -e ] treats backslashes as escapes, so vendor/cordis vanished.
workspace_map=$(mktemp)
direct_deps=$(mktemp)
manifest_list=$(mktemp)
dep_names=$(mktemp)
trap 'rm -f "$workspace_map" "$direct_deps" "$manifest_list" "$dep_names"' EXIT
clone_for_node=$clone
map_for_node=$workspace_map
if command -v cygpath >/dev/null 2>&1; then
  clone_for_node=$(cygpath -w "$clone")
  map_for_node=$(cygpath -w "$workspace_map")
fi
CLONE_FOR_NODE="$clone_for_node" MAP_OUT="$map_for_node" node --input-type=module <<'JS'
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const clone = process.env.CLONE_FOR_NODE
const out = process.env.MAP_OUT
const lines = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue
    const p = join(dir, ent.name)
    if (ent.isFile() && ent.name === 'package.json') {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf8'))
        if (pkg && typeof pkg.name === 'string' && pkg.name) {
          lines.push(`${pkg.name}\t${dirname(p)}`)
        }
      } catch {
        // ignore unreadable / invalid manifests
      }
      continue
    }
    if (ent.isDirectory()) walk(p)
  }
}

for (const rel of ['packages', 'apps', 'vendor', 'native']) {
  const root = join(clone, rel)
  if (existsSync(root)) walk(root)
}

writeFileSync(out, lines.length ? `${lines.join('\n')}\n` : '', 'utf8')
JS
echo "stage-runtime: workspace map $(wc -l <"$workspace_map") packages"

to_posix_path() {
  local p=$1
  p=${p//$'\r'/}
  [ -n "$p" ] || return 1
  if command -v cygpath >/dev/null 2>&1; then
    case "$p" in
      [A-Za-z]:[\\/]*|\\\\*) p=$(cygpath -u "$p") ;;
    esac
  fi
  printf '%s\n' "$p"
}

# Direct deps first (legacy hoist), then walk every staged manifest's
# dependencies + peerDependencies until the closure is closed. Peers like
# @deepseek-ai/cordis-plugin-group are required at runtime but not listed
# on @deepseek-ai/dsh itself.
find_dep_source() {
  local name=$1
  name=${name//$'\r'/}
  local path posix vendor vendor_name store_id store_dir
  path=$(awk -F '\t' -v n="$name" '$1 == n { print $2; exit }' "$workspace_map")
  posix=$(to_posix_path "$path" || true)
  if [ -n "$posix" ] && [ -e "$posix" ]; then
    printf '%s\n' "$posix"
    return 0
  fi
  # vendor/* dir names are unscoped (cordis); package.json name is scoped.
  for vendor in "$clone"/vendor/*; do
    [ -f "$vendor/package.json" ] || continue
    vendor_name=$(jq -r .name "$vendor/package.json")
    vendor_name=${vendor_name//$'\r'/}
    if [ "$vendor_name" = "$name" ]; then
      printf '%s\n' "$vendor"
      return 0
    fi
  done
  if [ -e "$clone/apps/cli/node_modules/$name" ]; then
    printf '%s\n' "$clone/apps/cli/node_modules/$name"
    return 0
  fi
  if [ -e "$clone/node_modules/$name" ]; then
    printf '%s\n' "$clone/node_modules/$name"
    return 0
  fi
  store_id=${name//\//+}
  # find, not a bash glob: Git Bash mishandles @scope+name@ver dirs.
  # No -type d: Windows pnpm store entries are often junctions.
  if [ -d "$clone/node_modules/.pnpm" ]; then
    store_dir=$(find "$clone/node_modules/.pnpm" -maxdepth 1 -name "${store_id}@*" | head -n 1)
    store_dir=${store_dir//$'\r'/}
    if [ -n "$store_dir" ] && [ -e "$store_dir/node_modules/$name" ]; then
      printf '%s\n' "$store_dir/node_modules/$name"
      return 0
    fi
  fi
}

restored=
missing=
jq -r '.dependencies // {} | keys[]' "$manifest" >"$direct_deps"
while IFS= read -r name; do
  name=${name//$'\r'/}
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
done <"$direct_deps"

pass=0
while [ "$pass" -lt 20 ]; do
  pass=$((pass + 1))
  added=
  find "$stage" \( -path "$stage/node_modules/.bin" -o -path "$stage/node_modules/.pnpm" \) \
    -prune -o -name package.json -print >"$manifest_list"
  while IFS= read -r mf; do
    mf=${mf//$'\r'/}
    [ -f "$mf" ] || continue
    jq -r '(.dependencies // {}), (.peerDependencies // {}) | keys[]' "$mf" >"$dep_names"
    while IFS= read -r name; do
      name=${name//$'\r'/}
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
        # Optional LLM SDKs (e.g. @anthropic-ai/sdk) are not required for dsh web.
        case "$name" in
          @deepseek-ai/*) missing="${missing}${missing:+ }$name" ;;
          *) echo "stage-runtime: skip unrestorable $name" ;;
        esac
        continue
      fi
      copy_package "$source" "$dest"
      restored="${restored}${restored:+ }$name"
      added=1
    done <"$dep_names"
  done <"$manifest_list"
  [ -n "$added" ] || break
done

if [ -n "$missing" ]; then
  missing=$(printf '%s\n' $missing | sort -u | tr '\n' ' ')
  echo "error: staged dependencies remain missing: $missing" >&2
  echo "stage-runtime: workspace map entries:" >&2
  grep -E '@deepseek-ai/cordis' "$workspace_map" >&2 || true
  echo "stage-runtime: vendor/:" >&2
  ls -la "$clone/vendor" >&2 || true
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

plugin="$repo_root/.cache/styling/desktop-brand"
if [ ! -f "$plugin/package.json" ] || [ ! -f "$plugin/lib/index.js" ]; then
  echo "error: desktop-brand plugin missing at $plugin; run scripts/apply-styling.mjs generate" >&2
  exit 1
fi
if jq -e '.. | strings | select(startswith("workspace:"))' "$plugin/package.json" >/dev/null; then
  echo "error: staged desktop-brand package.json still contains workspace: protocol" >&2
  exit 1
fi
rm -rf "$stage/node_modules/desktop-brand"
mkdir -p "$stage/node_modules"
cp -R "$plugin" "$stage/node_modules/desktop-brand"
if [ ! -f "$stage/node_modules/desktop-brand/package.json" ] || [ ! -f "$stage/node_modules/desktop-brand/lib/index.js" ]; then
  echo "error: desktop-brand copy failed at $stage/node_modules/desktop-brand" >&2
  exit 1
fi
tmp=$(mktemp)
jq '.dependencies = ((.dependencies // {}) + {"desktop-brand": "0.0.0"})' "$stage/package.json" >"$tmp"
mv "$tmp" "$stage/package.json"
# Windows Git Bash: Node cannot resolve modules from /d/... paths. Pass a
# drive-letter path so createRequire looks in the real node_modules tree.
stage_for_node=$stage
if command -v cygpath >/dev/null 2>&1; then
  stage_for_node=$(cygpath -m "$stage")
fi
node "$script_dir/assert-desktop-brand.mjs" "$stage_for_node"
echo "stage-runtime: staged desktop-brand"

echo "stage-runtime: staged $stage"
echo "stage-runtime: host smoke: node $stage/sidecar-entry.mjs web --host 127.0.0.1 --port 13800"
