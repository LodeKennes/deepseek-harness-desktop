#!/usr/bin/env bash
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
need_cmd git

if [ ! -f versions.json ]; then
  echo "error: versions.json not found in $repo_root" >&2
  exit 1
fi

expected_node=$(jq -r .runtimes.node versions.json)
expected_pnpm=$(jq -r .runtimes.pnpm versions.json)

need_cmd node "expected Node ${expected_node}; this script does not install it"
need_cmd pnpm "expected pnpm ${expected_pnpm}; this script does not install it"

node_ver=$(node -p "process.versions.node")
pnpm_ver=$(pnpm --version)

node_major=${node_ver%%.*}
expected_node_major=${expected_node%%.*}
if [ "$node_major" != "$expected_node_major" ]; then
  echo "error: node $node_ver does not match pinned Node ${expected_node} (major ${expected_node_major} required)" >&2
  exit 1
fi

pnpm_major=${pnpm_ver%%.*}
expected_pnpm_major=${expected_pnpm%%.*}
if [ "$pnpm_major" != "$expected_pnpm_major" ]; then
  echo "error: pnpm $pnpm_ver does not match pinned pnpm ${expected_pnpm} (major ${expected_pnpm_major} required)" >&2
  exit 1
fi

"$script_dir/fetch-harness.sh"

dir=.cache/harness
sha=$(jq -r .harness.sha versions.json)
current=$(git -C "$dir" rev-parse HEAD)
if [ "$current" != "$sha" ]; then
  echo "error: $dir HEAD is $current, expected $sha; run scripts/fetch-harness.sh" >&2
  exit 1
fi

echo "build-harness: node $node_ver (pin ${expected_node}), pnpm $pnpm_ver (pin ${expected_pnpm})"

# The harness tree pins packageManager pnpm@11.7.0. pnpm 11.21+ then tries
# to download that exact @pnpm/exe.<platform> and verify it against the
# harness lockfile. Intel macOS is not in that lockfile, so stay on the
# already-installed major-compatible CLI.
export npm_config_manage_package_manager_versions=false
export npm_config_pm_on_fail=ignore

"$script_dir/apply-harness-overlay.sh"

cd "$dir"
pnpm install --frozen-lockfile
pnpm run build
