#!/usr/bin/env bash
# Calculate the next desktop-vX.Y.Z-N release for a commit.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

base_version=${1:-$(jq -r .desktop.version versions.json)}
target_commit=${2:-HEAD}

if ! [[ "$base_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: desktop base version must be X.Y.Z (got '$base_version')" >&2
  exit 1
fi

git rev-parse --verify "${target_commit}^{commit}" >/dev/null

tag_prefix="desktop-v${base_version}-"
existing_build=0
while IFS= read -r tag; do
  build=${tag#"$tag_prefix"}
  if [[ "$build" =~ ^[0-9]+$ ]] && [ "$build" -gt "$existing_build" ]; then
    existing_build=$build
  fi
done < <(git tag --points-at "$target_commit" --list "${tag_prefix}*")

if [ "$existing_build" -gt 0 ]; then
  build_number=$existing_build
  existing=true
else
  max_build=0
  while IFS= read -r tag; do
    build=${tag#"$tag_prefix"}
    if [[ "$build" =~ ^[0-9]+$ ]] && [ "$build" -gt "$max_build" ]; then
      max_build=$build
    fi
  done < <(git tag --list "${tag_prefix}*")
  build_number=$((max_build + 1))
  existing=false
fi

version="${base_version}-${build_number}"
tag="${tag_prefix}${build_number}"

printf 'base_version=%s\n' "$base_version"
printf 'build_number=%s\n' "$build_number"
printf 'version=%s\n' "$version"
printf 'tag=%s\n' "$tag"
printf 'existing=%s\n' "$existing"
