#!/usr/bin/env bash
# Download the official Node binary for the host (or NODE_OS/NODE_ARCH) into DEST.
# POSIX: DEST/bin/node    Windows: DEST/node.exe
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

if [ ! -f versions.json ]; then
  echo "error: versions.json not found in $repo_root" >&2
  exit 1
fi

version=$(jq -r .runtimes.node versions.json)
if [ -z "$version" ] || [ "$version" = "null" ]; then
  echo "error: versions.json is missing runtimes.node" >&2
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

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk 'NR==1 { print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk 'NR==1 { print $1 }'
  else
    echo "error: sha256sum or shasum is required" >&2
    exit 1
  fi
}

download() {
  local url=$1 dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    echo "error: curl or wget is required to download Node" >&2
    exit 1
  fi
}

os=$(detect_os)
arch=$(detect_arch)

case "$os" in
  linux|darwin)
    archive_name="node-v${version}-${os}-${arch}.tar.gz"
    ;;
  win)
    archive_name="node-v${version}-win-${arch}.zip"
    ;;
  *)
    echo "error: unsupported NODE_OS=$os (expected linux, darwin, or win)" >&2
    exit 1
    ;;
esac

# Absolute path with . / .. collapsed so DEST=. or DEST=.. cannot bypass rm -rf guards.
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

unsafe_rm_target() {
  local dest=$1 root=$2
  [ "$dest" = "/" ] && return 0
  [ "$dest" = "$root" ] && return 0
  case "$root" in
    "$dest"/*) return 0 ;;
  esac
  return 1
}

dest=${1:-}
if [ -z "$dest" ]; then
  dest="${STAGE:-$repo_root/dist/runtime}/node"
fi
dest=$(canonicalize "$dest")
repo_root=$(canonicalize "$repo_root")

if unsafe_rm_target "$dest" "$repo_root"; then
  echo "error: refusing to write Node into $dest" >&2
  exit 1
fi

cache_dir="$repo_root/.cache/node/v${version}"
mkdir -p "$cache_dir"

base_url="https://nodejs.org/dist/v${version}"
sums_path="$cache_dir/SHASUMS256.txt"
archive_path="$cache_dir/$archive_name"

echo "download-node: fetching SHASUMS256.txt for v${version}"
download "$base_url/SHASUMS256.txt" "$sums_path"

expected=$(awk -v f="$archive_name" '$2 == f { print $1; exit }' "$sums_path")
if [ -z "$expected" ]; then
  echo "error: $archive_name is not listed in $base_url/SHASUMS256.txt" >&2
  exit 1
fi

need_download=1
if [ -f "$archive_path" ]; then
  actual=$(sha256_file "$archive_path")
  if [ "$actual" = "$expected" ]; then
    need_download=0
    echo "download-node: using cached $archive_name"
  else
    echo "download-node: cached $archive_name checksum mismatch; re-downloading" >&2
    rm -f "$archive_path"
  fi
fi

if [ "$need_download" -eq 1 ]; then
  echo "download-node: downloading $archive_name"
  download "$base_url/$archive_name" "$archive_path.part"
  actual=$(sha256_file "$archive_path.part")
  if [ "$actual" != "$expected" ]; then
    rm -f "$archive_path.part"
    echo "error: SHA-256 mismatch for $archive_name (expected $expected, got $actual)" >&2
    exit 1
  fi
  mv "$archive_path.part" "$archive_path"
fi

actual=$(sha256_file "$archive_path")
if [ "$actual" != "$expected" ]; then
  echo "error: SHA-256 mismatch for $archive_name (expected $expected, got $actual)" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case "$os" in
  linux|darwin)
    need_cmd tar
    tar -xzf "$archive_path" -C "$work"
    src_node="$work/node-v${version}-${os}-${arch}/bin/node"
    if [ ! -f "$src_node" ]; then
      echo "error: official archive is missing bin/node: $src_node" >&2
      exit 1
    fi
    rm -rf "$dest"
    mkdir -p "$dest/bin"
    cp "$src_node" "$dest/bin/node"
    chmod 755 "$dest/bin/node"
    echo "download-node: wrote $dest/bin/node"
    ;;
  win)
    if command -v unzip >/dev/null 2>&1; then
      unzip -q "$archive_path" -d "$work"
    elif command -v tar >/dev/null 2>&1; then
      tar -xf "$archive_path" -C "$work"
    else
      echo "error: unzip or tar is required to extract the Windows Node zip" >&2
      exit 1
    fi
    src_node="$work/node-v${version}-win-${arch}/node.exe"
    if [ ! -f "$src_node" ]; then
      echo "error: official archive is missing node.exe: $src_node" >&2
      exit 1
    fi
    rm -rf "$dest"
    mkdir -p "$dest"
    cp "$src_node" "$dest/node.exe"
    echo "download-node: wrote $dest/node.exe"
    ;;
esac
