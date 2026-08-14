#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

mkdir -p "$workdir/scripts"
cp "$repo_root/scripts/sync-package-indexes.sh" "$workdir/scripts/"
cp "$repo_root/LICENSE" "$workdir/LICENSE"
printf '%s\n' '{"productName":"DeepSeek Harness","productNameSafe":"DeepSeek-Harness"}' >"$workdir/styling.json"

cat >"$workdir/SHA256SUMS" <<'SUMS'
aaa111  DeepSeek-Harness-1.2.3-9-mac-arm64.dmg
bbb222  DeepSeek-Harness-1.2.3-9-mac-x64.dmg
ccc333  DeepSeek-Harness-1.2.3-9-win-x64.exe
ddd444  DeepSeek-Harness-1.2.3-9-win-arm64.exe
eee555  DeepSeek-Harness-1.2.3-9-win-x64.zip
fff666  DeepSeek-Harness-1.2.3-9-win-arm64.zip
ggg777  DeepSeek-Harness-1.2.3-9-linux-x64.pkg.tar.zst
hhh888  DeepSeek-Harness-1.2.3-9-linux-aarch64.pkg.tar.zst
SUMS

REPO_ROOT=$workdir SUMS_FILE=$workdir/SHA256SUMS \
  "$workdir/scripts/sync-package-indexes.sh" desktop-v1.2.3-9

assert_file_match() {
  local file=$1 pattern=$2
  if ! grep -qE "$pattern" "$file"; then
    echo "error: $file missing /$pattern/" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_file_match "$workdir/Casks/deepseek-harness.rb" 'version "1.2.3-9"'
assert_file_match "$workdir/Casks/deepseek-harness.rb" 'desktop-v#\{version\}'
assert_file_match "$workdir/Casks/deepseek-harness.rb" 'aaa111'
assert_file_match "$workdir/Casks/deepseek-harness.rb" 'bbb222'
assert_file_match "$workdir/bucket/deepseek-harness.json" '"version": "1.2.3-9"'
assert_file_match "$workdir/bucket/deepseek-harness.json" 'eee555'
assert_file_match "$workdir/packaging/chocolatey/deepseek-harness.nuspec" '<version>1.2.3.9</version>'
assert_file_match "$workdir/packaging/chocolatey/tools/chocolateyinstall.ps1" 'ccc333'
assert_file_match "$workdir/packaging/winget/LodeKennes.DeepSeekHarness/LodeKennes.DeepSeekHarness.yaml" 'PackageVersion: 1.2.3-9'
assert_file_match "$workdir/packaging/winget/LodeKennes.DeepSeekHarness/LodeKennes.DeepSeekHarness.installer.yaml" 'CCC333'
assert_file_match "$workdir/packaging/aur/deepseek-harness-desktop-bin/PKGBUILD" 'pkgver=1.2.3.9'
assert_file_match "$workdir/packaging/aur/deepseek-harness-desktop-bin/PKGBUILD" 'ggg777'
assert_file_match "$workdir/packaging/aur/deepseek-harness-desktop-bin/.SRCINFO" 'hhh888'

echo 'ok: sync-package-indexes writes every gallery index'
