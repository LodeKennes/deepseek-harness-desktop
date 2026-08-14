# shellcheck shell=bash
# Put a JS pnpm (no @pnpm/exe) on PATH for the harness clone.
# CI's standalone 11.21 fails on Intel macOS: the harness lockfile has no
# @pnpm/exe.darwin-x64, and npm scripts call `pnpm` from PATH (build:web).
#
# Requires: repo_root, jq, node, npm.

# shellcheck disable=SC2154
harness_pnpm_spec() {
  local spec=""
  if [ -f "$repo_root/.cache/harness/package.json" ]; then
    spec=$(jq -r '.packageManager // empty' "$repo_root/.cache/harness/package.json")
  fi
  if [ -z "${spec}" ] || [ "$spec" = "null" ]; then
    spec="pnpm@$(jq -r .runtimes.pnpm "$repo_root/versions.json")"
  fi
  printf '%s\n' "$spec"
}

ensure_harness_pnpm() {
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
  mkdir -p "$prefix/bin"
  cat >"$prefix/bin/pnpm" <<EOF
#!/bin/sh
exec node $(printf '%q' "$bin") --pm-on-fail=ignore "\$@"
EOF
  cat >"$prefix/bin/pnpx" <<EOF
#!/bin/sh
exec node $(printf '%q' "${bin%pnpm.mjs}pnpx.mjs") --pm-on-fail=ignore "\$@"
EOF
  chmod 755 "$prefix/bin/pnpm" "$prefix/bin/pnpx"
  case ":$PATH:" in
    *":$prefix/bin:"*) ;;
    *) PATH="$prefix/bin:$PATH" ;;
  esac
  export PATH
  hash -r 2>/dev/null || true
  echo "harness-pnpm: using $(command -v pnpm) ($spec)"
}

harness_pnpm() {
  ensure_harness_pnpm
  pnpm "$@"
}
