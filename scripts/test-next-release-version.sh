#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
calculator="$script_dir/next-release-version.sh"
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

repo="$workdir/repo"
mkdir -p "$repo/scripts"
cp "$calculator" "$repo/scripts/next-release-version.sh"
cat > "$repo/versions.json" <<'JSON'
{"desktop":{"version":"1.2.3-rc.4"}}
JSON

git -C "$repo" init -q
git -C "$repo" config user.name test
git -C "$repo" config user.email test@example.invalid
git -C "$repo" add .
git -C "$repo" commit -qm initial

assert_output() {
  local expected=$1 pattern=$2 output
  shift 2
  output=$(cd "$repo" && ./scripts/next-release-version.sh "$@")
  if ! grep -qx "$pattern" <<<"$output"; then
    echo "error: expected '$pattern' in output:" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
  printf 'ok: %s\n' "$expected"
}

assert_output "first aligned build" 'version=1.2.3-rc.4-build-1'

git -C "$repo" tag desktop-v1.2.3-1
git -C "$repo" tag desktop-v1.2.3-3
git -C "$repo" tag desktop-v1.2.3-not-a-number
git -C "$repo" tag desktop-vjunk-build-99
printf 'next\n' >> "$repo/versions.json"
git -C "$repo" add versions.json
git -C "$repo" commit -qm next

assert_output "continue legacy build counter" 'version=1.2.3-rc.4-build-4' 1.2.3-rc.4 HEAD
git -C "$repo" tag desktop-v1.2.3-rc.4-build-4
assert_output "reuse current commit tag" 'existing=true' 1.2.3-rc.4 HEAD
assert_output "continue counter for new upstream base" 'version=2.0.0-rc.1-build-5' 2.0.0-rc.1 HEAD

if (cd "$repo" && ./scripts/next-release-version.sh 1.2.3 HEAD >/dev/null 2>&1); then
  echo "error: invalid base version was accepted" >&2
  exit 1
fi
echo "ok: reject invalid base version"
