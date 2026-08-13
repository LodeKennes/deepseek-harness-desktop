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

first_symlink() {
  local dir=$1
  local found
  found=$(find "$dir" -type l -print -quit 2>/dev/null) || true
  if [ -n "$found" ]; then
    printf '%s' "$found"
    return 0
  fi
  found=$(find "$dir" -type l | awk 'NR==1 { print; exit }') || true
  printf '%s' "$found"
}

resolve_link() {
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
    rm -rf "$dest/node_modules"
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
  remaining=$(first_symlink "$node_modules")
  if [ -z "$remaining" ]; then
    break
  fi

  bin_dir=
  bin_dir=$(bin_farm_root "$remaining") || bin_dir=
  if [ -n "$bin_dir" ]; then
    rm -rf "$bin_dir"
    stripped=$((stripped + 1))
    continue
  fi

  source=$(resolve_link "$remaining")
  rm -rf "$remaining"
  copy_dereferenced "$source" "$remaining"
  if [ -L "$remaining" ]; then
    echo "error: failed to materialize symlink $remaining" >&2
    exit 1
  fi
  replaced=$((replaced + 1))
done

leftover=$(find "$node_modules" -type l -print || true)
if [ -n "$leftover" ]; then
  echo "error: symlinks remain under $node_modules:" >&2
  printf '%s\n' "$leftover" >&2
  exit 1
fi

echo "materialize-links: replaced $replaced package link(s), stripped $stripped .bin farm(s)"
