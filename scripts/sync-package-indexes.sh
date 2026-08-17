#!/usr/bin/env bash
# Fill Homebrew / Scoop / winget / Chocolatey / AUR indexes from a GitHub
# Release's SHA256SUMS. Does not push to third-party galleries.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "${REPO_ROOT:-$script_dir/..}" && pwd)
cd "$repo_root"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required${2:+ ($2)}" >&2
    exit 1
  fi
}

need_cmd jq

repo=${GITHUB_REPOSITORY:-LodeKennes/deepseek-harness-desktop}
tag=${1:-${RELEASE_TAG:-}}
sums_file=${SUMS_FILE:-}

if [ -z "$tag" ]; then
  need_cmd gh
  tag=$(gh release view --repo "$repo" --json tagName --jq .tagName)
fi

if [[ ! "$tag" =~ ^desktop-v([0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+-build-[0-9]+)$ ]]; then
  echo "error: tag must look like desktop-vX.Y.Z-rc.N-build-M (got '$tag')" >&2
  exit 1
fi
version=${BASH_REMATCH[1]}
# Chocolatey / AUR reject a hyphen in the package version.
compat_version=${version//-/.}
base_url="https://github.com/${repo}/releases/download/${tag}"
prefix=$(jq -r .productNameSafe styling.json)
product_name=$(jq -r .productName styling.json)
desc="Desktop installers for DeepSeek Harness. Everything is a plugin."

asset() {
  printf '%s-%s-%s' "$prefix" "$version" "$1"
}

sum_of() {
  local name=$1 line
  line=$(awk -v f="$name" '$2 == f { print $1; exit }' "$sums_file")
  if [ -z "$line" ]; then
    echo "error: $name missing from $sums_file" >&2
    exit 1
  fi
  printf '%s' "$line"
}

if [ -z "$sums_file" ]; then
  need_cmd gh
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  gh release download "$tag" --repo "$repo" --pattern SHA256SUMS --output "$tmp"
  sums_file=$tmp
fi

mac_arm_dmg=$(asset mac-arm64.dmg)
mac_intel_dmg=$(asset mac-x64.dmg)
win_x64_exe=$(asset win-x64.exe)
win_arm_exe=$(asset win-arm64.exe)
win_x64_zip=$(asset win-x64.zip)
win_arm_zip=$(asset win-arm64.zip)
linux_x64_pkg=$(asset linux-x64.pkg.tar.zst)
linux_arm_pkg=$(asset linux-aarch64.pkg.tar.zst)

sha_mac_arm=$(sum_of "$mac_arm_dmg")
sha_mac_intel=$(sum_of "$mac_intel_dmg")
sha_win_x64_exe=$(sum_of "$win_x64_exe")
sha_win_arm_exe=$(sum_of "$win_arm_exe")
sha_win_x64_zip=$(sum_of "$win_x64_zip")
sha_win_arm_zip=$(sum_of "$win_arm_zip")
sha_linux_x64_pkg=$(sum_of "$linux_x64_pkg")
sha_linux_arm_pkg=$(sum_of "$linux_arm_pkg")

mkdir -p \
  "$repo_root/Casks" \
  "$repo_root/bucket" \
  "$repo_root/packaging/chocolatey/tools" \
  "$repo_root/packaging/winget/LodeKennes.DeepSeekHarness" \
  "$repo_root/packaging/aur/deepseek-harness-desktop-bin"

cat >"$repo_root/Casks/deepseek-harness.rb" <<RUBY
cask "deepseek-harness" do
  arch arm: "arm64", intel: "x64"

  version "$version"
  sha256 arm:   "$sha_mac_arm",
         intel: "$sha_mac_intel"

  url "https://github.com/${repo}/releases/download/desktop-v#{version}/${prefix}-#{version}-mac-#{arch}.dmg",
      verified: "github.com/${repo}/"
  name "$product_name"
  desc "$desc"
  homepage "https://github.com/${repo}"

  livecheck do
    url :homepage
    regex(/desktop-v?(\\d+(?:\\.\\d+)+-rc\\.\\d+-build-\\d+)/i)
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "$product_name.app"

  caveats <<~EOS
    This build is unsigned. After installing:

      xattr -dr com.apple.quarantine "/Applications/$product_name.app"
  EOS

  zap trash: [
    "~/Library/Application Support/$product_name",
    "~/Library/Logs/$product_name",
    "~/Library/Preferences/ai.deepseek.harness.desktop.plist",
    "~/Library/Saved Application State/ai.deepseek.harness.desktop.savedState",
  ]
end
RUBY

cat >"$repo_root/bucket/deepseek-harness.json" <<JSON
{
  "version": "$version",
  "description": "$desc",
  "homepage": "https://github.com/${repo}",
  "license": "MIT",
  "notes": "Unsigned developer-preview build. SmartScreen will warn.",
  "architecture": {
    "64bit": {
      "url": "$base_url/$win_x64_zip",
      "hash": "$sha_win_x64_zip"
    },
    "arm64": {
      "url": "$base_url/$win_arm_zip",
      "hash": "$sha_win_arm_zip"
    }
  },
  "shortcuts": [
    [
      "$product_name.exe",
      "$product_name"
    ]
  ],
  "checkver": {
    "url": "https://github.com/${repo}/releases/latest",
    "regex": "desktop-v([\\\\d.]+-rc\\\\.\\\\d+-build-\\\\d+)"
  },
  "autoupdate": {
    "architecture": {
      "64bit": {
        "url": "https://github.com/${repo}/releases/download/desktop-v\$version/${prefix}-\$version-win-x64.zip"
      },
      "arm64": {
        "url": "https://github.com/${repo}/releases/download/desktop-v\$version/${prefix}-\$version-win-arm64.zip"
      }
    },
    "hash": {
      "url": "\$baseurl/SHA256SUMS"
    }
  }
}
JSON

cat >"$repo_root/packaging/chocolatey/deepseek-harness.nuspec" <<XML
<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>deepseek-harness</id>
    <version>$compat_version</version>
    <title>$product_name</title>
    <authors>Lode Kennes</authors>
    <owners>Lode Kennes</owners>
    <projectUrl>https://github.com/${repo}</projectUrl>
    <projectSourceUrl>https://github.com/${repo}</projectSourceUrl>
    <packageSourceUrl>https://github.com/${repo}/tree/master/packaging/chocolatey</packageSourceUrl>
    <docsUrl>https://github.com/${repo}/blob/master/docs/user-install.md</docsUrl>
    <bugTrackerUrl>https://github.com/${repo}/issues</bugTrackerUrl>
    <licenseUrl>https://github.com/${repo}/blob/master/LICENSE</licenseUrl>
    <iconUrl>https://raw.githubusercontent.com/${repo}/master/resources/icons/128x128.png</iconUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <summary>$desc</summary>
    <description>$desc Unsigned developer-preview NSIS installer from GitHub Releases. SmartScreen will warn. Do not add \`dsh\` to PATH if you already have the official CLI.</description>
    <tags>deepseek harness dsh electron desktop agent preview</tags>
    <releaseNotes>https://github.com/${repo}/releases/tag/${tag}</releaseNotes>
  </metadata>
  <files>
    <file src="tools\\**" target="tools" />
  </files>
</package>
XML

cat >"$repo_root/packaging/chocolatey/tools/chocolateyinstall.ps1" <<PS1
\$ErrorActionPreference = 'Stop'
\$packageArgs = @{
  packageName    = 'deepseek-harness'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
  url64bit       = '$base_url/$win_x64_exe'
  checksum64     = '$sha_win_x64_exe'
  checksumType64 = 'sha256'
}
Install-ChocolateyPackage @packageArgs
PS1

cat >"$repo_root/packaging/chocolatey/tools/chocolateyuninstall.ps1" <<'PS1'
$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = 'deepseek-harness'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
}
[array]$key = Get-UninstallRegistryKey -SoftwareName 'DeepSeek Harness*'
if ($key.Count -eq 1) {
  $packageArgs['file'] = $key[0].UninstallString
  Uninstall-ChocolateyPackage @packageArgs
} elseif ($key.Count -gt 1) {
  throw 'More than one DeepSeek Harness uninstall registry key was found.'
}
PS1

cat >"$repo_root/packaging/chocolatey/tools/VERIFICATION.txt" <<TXT
VERIFICATION
The installer is the official GitHub Release asset. Do not vendor the exe.

1. Open $base_url
2. Download $win_x64_exe and SHA256SUMS
3. Confirm the SHA-256 of the exe is:

   $sha_win_x64_exe
TXT

cp "$repo_root/LICENSE" "$repo_root/packaging/chocolatey/tools/LICENSE.txt"

winget_dir="$repo_root/packaging/winget/LodeKennes.DeepSeekHarness"
cat >"$winget_dir/LodeKennes.DeepSeekHarness.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.version.1.9.0.schema.json
PackageIdentifier: LodeKennes.DeepSeekHarness
PackageVersion: $version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.9.0
YAML

cat >"$winget_dir/LodeKennes.DeepSeekHarness.installer.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.installer.1.9.0.schema.json
PackageIdentifier: LodeKennes.DeepSeekHarness
PackageVersion: $version
InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
InstallerSwitches:
  Silent: /S
  SilentWithProgress: /S
UpgradeBehavior: install
ReleaseDate: $(date -u +%Y-%m-%d)
Installers:
  - Architecture: x64
    InstallerUrl: $base_url/$win_x64_exe
    InstallerSha256: ${sha_win_x64_exe^^}
    AppsAndFeaturesEntries:
      - DisplayName: $product_name
        Publisher: Lode Kennes
  - Architecture: arm64
    InstallerUrl: $base_url/$win_arm_exe
    InstallerSha256: ${sha_win_arm_exe^^}
    AppsAndFeaturesEntries:
      - DisplayName: $product_name
        Publisher: Lode Kennes
ManifestType: installer
ManifestVersion: 1.9.0
YAML

cat >"$winget_dir/LodeKennes.DeepSeekHarness.locale.en-US.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.defaultLocale.1.9.0.schema.json
PackageIdentifier: LodeKennes.DeepSeekHarness
PackageVersion: $version
PackageLocale: en-US
Publisher: Lode Kennes
PublisherUrl: https://github.com/LodeKennes
PublisherSupportUrl: https://github.com/${repo}/issues
Author: Lode Kennes
PackageName: $product_name
PackageUrl: https://github.com/${repo}
License: MIT
LicenseUrl: https://github.com/${repo}/blob/master/LICENSE
Copyright: Copyright (c) 2026 Lode Kennes
ShortDescription: $desc
Description: Desktop installers for DeepSeek Harness (dsh), the open-source agent harness from DeepSeek AI. Everything is a plugin. This package is an unsigned developer-preview build. Windows SmartScreen will warn.
Moniker: deepseek-harness
Tags:
  - deepseek
  - dsh
  - electron
  - agent
  - desktop
ReleaseNotesUrl: https://github.com/${repo}/releases/tag/${tag}
ManifestType: defaultLocale
ManifestVersion: 1.9.0
YAML

aur_dir="$repo_root/packaging/aur/deepseek-harness-desktop-bin"
cat >"$aur_dir/PKGBUILD" <<PKG
# Maintainer: Lode Kennes <lode@lodekennes.com>
pkgname=deepseek-harness-desktop-bin
pkgver=$compat_version
pkgrel=1
pkgdesc="$desc"
arch=('x86_64' 'aarch64')
url="https://github.com/${repo}"
license=('MIT')
depends=('gtk3' 'libnotify' 'nss' 'libxss' 'libxtst' 'xdg-utils' 'at-spi2-core' 'libsecret')
provides=('deepseek-harness-desktop')
conflicts=('deepseek-harness-desktop')
options=('!strip')
source_x86_64=("$linux_x64_pkg::$base_url/$linux_x64_pkg")
source_aarch64=("$linux_arm_pkg::$base_url/$linux_arm_pkg")
sha256sums_x86_64=('$sha_linux_x64_pkg')
sha256sums_aarch64=('$sha_linux_arm_pkg')

package() {
  cp -a "\$srcdir/opt" "\$pkgdir/"
  if [ -d "\$srcdir/usr" ]; then
    cp -a "\$srcdir/usr" "\$pkgdir/"
  fi
}
PKG

cat >"$aur_dir/.SRCINFO" <<SRC
pkgbase = deepseek-harness-desktop-bin
	pkgdesc = $desc
	pkgver = $compat_version
	pkgrel = 1
	url = https://github.com/${repo}
	arch = x86_64
	arch = aarch64
	license = MIT
	depends = gtk3
	depends = libnotify
	depends = nss
	depends = libxss
	depends = libxtst
	depends = xdg-utils
	depends = at-spi2-core
	depends = libsecret
	provides = deepseek-harness-desktop
	conflicts = deepseek-harness-desktop
	options = !strip
	source_x86_64 = $linux_x64_pkg::$base_url/$linux_x64_pkg
	sha256sums_x86_64 = $sha_linux_x64_pkg
	source_aarch64 = $linux_arm_pkg::$base_url/$linux_arm_pkg
	sha256sums_aarch64 = $sha_linux_arm_pkg

pkgname = deepseek-harness-desktop-bin
SRC

echo "sync-package-indexes: wrote indexes for $tag ($version)"
