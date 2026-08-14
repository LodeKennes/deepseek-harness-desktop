#!/usr/bin/env bash
# Generate styling artifacts and apply them to .cache/harness.
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

need_cmd node
exec node "$script_dir/apply-styling.mjs" apply
