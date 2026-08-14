#!/usr/bin/env bash
# Download and verify the pinned CLIProxyAPI binary for the current build host.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

version=$(jq -r .runtimes.cliProxyApi versions.json)
case "$(uname -s)" in
  Linux*) os=linux ;;
  Darwin*) os=darwin ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) os=windows ;;
  *) echo "error: unsupported CLIProxyAPI OS: $(uname -s)" >&2; exit 1 ;;
esac

case "${RUNNER_ARCH:-$(uname -m)}" in
  X64|x64|x86_64|amd64) arch=amd64 ;;
  ARM64|arm64|aarch64) arch=aarch64 ;;
  *) echo "error: unsupported CLIProxyAPI architecture" >&2; exit 1 ;;
esac

extension=tar.gz
[ "$os" = windows ] && extension=zip
archive="CLIProxyAPI_${version}_${os}_${arch}.${extension}"
base_url="https://github.com/router-for-me/CLIProxyAPI/releases/download/v${version}"
cache="$repo_root/.cache/cliproxyapi/v${version}"
stage="$repo_root/dist/cliproxyapi"
mkdir -p "$cache"

curl -fsSL "$base_url/checksums.txt" -o "$cache/checksums.txt"
expected=$(awk -v f="$archive" '$2 == f { print $1; exit }' "$cache/checksums.txt")
if [ -z "$expected" ]; then
  echo "error: $archive is absent from the upstream checksum manifest" >&2
  exit 1
fi

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

archive_path="$cache/$archive"
if [ ! -f "$archive_path" ] || [ "$(sha256 "$archive_path")" != "$expected" ]; then
  rm -f "$archive_path"
  curl -fsSL "$base_url/$archive" -o "$archive_path.part"
  actual=$(sha256 "$archive_path.part")
  if [ "$actual" != "$expected" ]; then
    rm -f "$archive_path.part"
    echo "error: CLIProxyAPI checksum mismatch (expected $expected, got $actual)" >&2
    exit 1
  fi
  mv "$archive_path.part" "$archive_path"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if [ "$extension" = zip ]; then
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$archive_path" -d "$work"
  else
    tar -xf "$archive_path" -C "$work"
  fi
  binary=cli-proxy-api.exe
else
  tar -xzf "$archive_path" -C "$work"
  binary=cli-proxy-api
fi

if [ ! -f "$work/$binary" ]; then
  echo "error: $archive does not contain $binary" >&2
  exit 1
fi

rm -rf "$stage"
mkdir -p "$stage"
cp "$work/$binary" "$stage/$binary"
cp "$work/LICENSE" "$stage/LICENSE"
[ "$os" = windows ] || chmod 755 "$stage/$binary"
printf '%s\n' "$version" > "$stage/VERSION"
echo "stage-cliproxyapi: $os-$arch v$version -> $stage"
