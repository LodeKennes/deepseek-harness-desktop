#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)

# shellcheck source=lib/harness-pnpm.sh
. "$script_dir/lib/harness-pnpm.sh"
ensure_harness_pnpm

got=$(command -v pnpm)
case "$got" in
  "$repo_root/.cache/pnpm-js/"*) ;;
  *)
    echo "error: expected wrapper under .cache/pnpm-js, got $got" >&2
    exit 1
    ;;
esac

ver=$(pnpm --version)
echo "ok: harness pnpm $ver at $got"
