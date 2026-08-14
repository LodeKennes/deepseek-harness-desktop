# shellcheck shell=bash
# Drive the harness clone with a JS pnpm that matches its packageManager
# field. CI's standalone pnpm 11.21 tries to download that pin's
# @pnpm/exe.darwin-x64 and verify it against the harness lockfile; Intel
# macOS is not recorded there. --pm-on-fail=ignore skips the version switch.
#
# Requires: repo_root, jq, node, npm.

harness_pnpm_spec() {
  local spec
  if [ -f "$repo_root/.cache/harness/package.json" ]; then
    spec=$(jq -r '.packageManager // empty' "$repo_root/.cache/harness/package.json")
  fi
  if [ -z "$spec" ] || [ "$spec" = "null" ]; then
    spec="pnpm@$(jq -r .runtimes.pnpm "$repo_root/versions.json")"
  fi
  printf '%s\n' "$spec"
}

harness_pnpm() {
  local spec ver prefix bin
  spec=$(harness_pnpm_spec)
  ver=${spec#pnpm@}
  prefix="$repo_root/.cache/pnpm-js/$ver"
  bin="$prefix/node_modules/pnpm/bin/pnpm.mjs"
  if [ ! -f "$bin" ]; then
    echo "harness-pnpm: installing JS $spec (omit optional @pnpm/exe)"
    mkdir -p "$prefix"
    npm install --prefix "$prefix" --no-save --omit=optional "$spec"
  fi
  if [ ! -f "$bin" ]; then
    echo "error: JS $spec missing at $bin" >&2
    exit 1
  fi
  node "$bin" --pm-on-fail=ignore "$@"
}
