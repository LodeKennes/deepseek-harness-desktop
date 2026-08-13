#!/usr/bin/env bash
# Replace every symlink under $STAGE/node_modules with copied bytes.
# Strip package-manager .bin link farms. Fail if any symlink remains.
# Port of SingleExeBuild.materializeStagedLinks() from the harness.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

stage=${1:-${STAGE:-$repo_root/dist/runtime}}
case "$stage" in
  /*) ;;
  *) stage="$repo_root/$stage" ;;
esac

node_modules="$stage/node_modules"
if [ ! -d "$node_modules" ]; then
  echo "error: $node_modules does not exist" >&2
  exit 1
fi

is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) return 0 ;;
  esac
  return 1
}

win_arg() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

from_win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s' "$1"
  fi
}

# Symlinks, plus Windows junctions / reparse points that find -type l misses.
list_links() {
  local dir=$1
  if is_windows; then
    local arg
    arg=$(win_arg "$dir")
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
            from_win_path "$line"
          done
      return
    fi
  fi
  find "$dir" -type l -print || true
}

first_link() {
  list_links "$1" | awk 'NR==1 { print; exit }'
}

is_link() {
  local p=$1
  [ -L "$p" ] && return 0
  if is_windows && command -v node >/dev/null 2>&1; then
    node -e 'try { process.exit(require("fs").lstatSync(process.argv[1]).isSymbolicLink() ? 0 : 1) } catch { process.exit(1) }' "$(win_arg "$p")"
    return
  fi
  return 1
}

# Node rmSync unlinks junctions; MSYS rm -rf can walk into the target.
remove_tree() {
  local p=$1
  if is_windows && command -v node >/dev/null 2>&1; then
    node -e 'require("fs").rmSync(process.argv[1], { recursive: true, force: true })' "$(win_arg "$p")"
    return
  fi
  rm -rf "$p"
}

resolve_link() {
  if is_windows && command -v node >/dev/null 2>&1; then
    from_win_path "$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$(win_arg "$1")")"
    return
  fi
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1"
  elif command -v readlink >/dev/null 2>&1 && readlink -f "$1" >/dev/null 2>&1; then
    readlink -f "$1"
  else
    echo "error: realpath (or readlink -f) is required to materialize $1" >&2
    exit 1
  fi
}

copy_dereferenced() {
  local source=$1 dest=$2
  mkdir -p "$(dirname "$dest")"
  if [ -d "$source" ]; then
    cp -RL "$source" "$dest"
    remove_tree "$dest/node_modules"
  else
    cp -L "$source" "$dest"
  fi
}

bin_farm_root() {
  local remaining=$1
  local rel=${remaining#"$node_modules"/}
  case "/$rel/" in
    */.bin/*) ;;
    *) return 1 ;;
  esac
  local p=$remaining
  while [ "$(basename "$p")" != ".bin" ]; do
    p=$(dirname "$p")
    if [ "$p" = "$node_modules" ] || [ "$p" = "/" ]; then
      return 1
    fi
  done
  printf '%s' "$p"
}

replaced=0
stripped=0

while true; do
  remaining=$(first_link "$node_modules")
  if [ -z "$remaining" ]; then
    break
  fi

  bin_dir=
  bin_dir=$(bin_farm_root "$remaining") || bin_dir=
  if [ -n "$bin_dir" ]; then
    remove_tree "$bin_dir"
    stripped=$((stripped + 1))
    continue
  fi

  source=$(resolve_link "$remaining")
  remove_tree "$remaining"
  copy_dereferenced "$source" "$remaining"
  if is_link "$remaining"; then
    echo "error: failed to materialize symlink $remaining" >&2
    exit 1
  fi
  replaced=$((replaced + 1))
done

leftover=$(list_links "$node_modules")
leftover=$(printf '%s\n' "$leftover" | sed '/^$/d')
if [ -n "$leftover" ]; then
  echo "error: symlinks remain under $node_modules:" >&2
  printf '%s\n' "$leftover" >&2
  exit 1
fi

echo "materialize-links: replaced $replaced package link(s), stripped $stripped .bin farm(s)"
