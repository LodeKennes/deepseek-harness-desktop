# shellcheck shell=bash
# JS pnpm CLI without optional @pnpm/exe. Sourced by build-harness.sh and
# stage-runtime.sh. Intel macOS CI's standalone pnpm 11.21 verifies
# @pnpm/exe.darwin-x64 against the harness lockfile and fails because that
# optional is not recorded there.
#
# Requires: repo_root, jq, node, npm.

harness_pnpm() {
  local ver prefix bin
  ver=$(jq -r .runtimes.pnpm "$repo_root/versions.json")
  prefix="$repo_root/.cache/pnpm-js/$ver"
  bin="$prefix/node_modules/pnpm/bin/pnpm.mjs"
  if [ ! -f "$bin" ]; then
    echo "harness-pnpm: installing JS pnpm $ver (omit optional @pnpm/exe)"
    mkdir -p "$prefix"
    npm install --prefix "$prefix" --no-save --omit=optional "pnpm@$ver"
  fi
  if [ ! -f "$bin" ]; then
    echo "error: JS pnpm $ver missing at $bin" >&2
    exit 1
  fi
  node "$bin" "$@"
}
