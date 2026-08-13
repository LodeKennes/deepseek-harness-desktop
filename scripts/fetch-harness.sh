#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required but not found on PATH" >&2
    exit 1
  fi
}

need_cmd jq
need_cmd git

if [ ! -f versions.json ]; then
  echo "error: versions.json not found in $repo_root" >&2
  exit 1
fi

sha=$(jq -r .harness.sha versions.json)
url=$(jq -r .harness.repository versions.json)
ssh_url=$(jq -r .harness.sshRepository versions.json)
dir=.cache/harness

if [ -z "$sha" ] || [ "$sha" = "null" ]; then
  echo "error: versions.json is missing harness.sha" >&2
  exit 1
fi
if [ -z "$url" ] || [ "$url" = "null" ]; then
  echo "error: versions.json is missing harness.repository" >&2
  exit 1
fi

if [ "${HARNESS_CLONE_SSH:-}" = "1" ]; then
  if [ -z "$ssh_url" ] || [ "$ssh_url" = "null" ]; then
    echo "error: HARNESS_CLONE_SSH=1 but versions.json is missing harness.sshRepository" >&2
    exit 1
  fi
fi

# Prefer HTTPS. HARNESS_CLONE_SSH=1 forces SSH; a failed HTTPS clone retries SSH.
clone_into() {
  local dest=$1
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"

  if [ "${HARNESS_CLONE_SSH:-}" = "1" ]; then
    git clone --filter=blob:none "$ssh_url" "$dest"
    return
  fi

  if git clone --filter=blob:none "$url" "$dest"; then
    return
  fi

  if [ -z "$ssh_url" ] || [ "$ssh_url" = "null" ]; then
    echo "error: HTTPS clone failed and harness.sshRepository is not set" >&2
    exit 1
  fi

  echo "HTTPS clone failed; retrying via SSH" >&2
  rm -rf "$dest"
  git clone --filter=blob:none "$ssh_url" "$dest"
}

if [ ! -d "$dir/.git" ]; then
  # git clone refuses a non-empty dest; wipe a stale non-repo cache first.
  clone_into "$dir"
fi

current=$(git -C "$dir" rev-parse HEAD)
if [ "$current" = "$sha" ]; then
  echo "fetch-harness: $dir already at $sha"
  exit 0
fi

# Existing cache, wrong SHA: update in place. Do not git clone into a non-empty dest.
if ! git -C "$dir" fetch --depth=1 origin "$sha"; then
  clone_into "$dir"
  git -C "$dir" fetch --depth=1 origin "$sha"
fi
git -C "$dir" checkout --detach "$sha"

actual=$(git -C "$dir" rev-parse HEAD)
if [ "$actual" != "$sha" ]; then
  echo "error: $dir HEAD is $actual, expected pin $sha" >&2
  exit 1
fi

echo "fetch-harness: $dir is $sha"
