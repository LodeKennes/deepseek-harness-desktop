# Package indexes

GitHub Releases remain the source of truth. This directory (plus the
Homebrew `Casks/` and Scoop `bucket/` trees at the repo root) republishes
those assets into OS package managers. `scripts/sync-package-indexes.sh`
rewrites every manifest from a release `SHA256SUMS` after each successful
`desktop-v*` release.

Unsigned developer-preview builds. Galleries will warn; some will take days
to moderate a first submission.

| Channel | Install | First publish |
| --- | --- | --- |
| **GitHub Releases** | download the asset | already automated |
| **Homebrew Cask** | `brew tap LodeKennes/deepseek-harness-desktop https://github.com/LodeKennes/deepseek-harness-desktop && brew install --cask deepseek-harness` | live as soon as `Casks/` is on `master` |
| **Scoop** | `scoop bucket add deepseek-harness https://github.com/LodeKennes/deepseek-harness-desktop && scoop install deepseek-harness` | live as soon as `bucket/` is on `master` |
| **WinGet** | `winget install LodeKennes.DeepSeekHarness` | manual PR to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) from `packaging/winget/` (auto-submit is off) |
| **Chocolatey** | `choco install deepseek-harness` | create a [community account](https://community.chocolatey.org), then `choco push` (auto-push is off) |
| **AUR** | `yay -S deepseek-harness-desktop-bin` | create an AUR account and push `packaging/aur/deepseek-harness-desktop-bin` |
| **apt / dnf / pacman** | install the Release `.deb` / `.rpm` / `.pkg.tar.zst` | no Launchpad / COPR / official-repo project yet |

Do **not** submit this app to the Mac App Store or Microsoft Store until
code signing exists. See [docs/signing.md](../docs/signing.md).

## Gallery submit is off

The release workflow only refreshes the in-repo indexes. It does **not**
push to WinGet, Chocolatey, or AUR (job-level `secrets.*` `if` is invalid
in this workflow file). First-time gallery listings stay manual.

## Manual first-time publishes

### WinGet

```sh
./scripts/sync-package-indexes.sh desktop-v0.1.0-rc.7-build-9
# copy packaging/winget/LodeKennes.DeepSeekHarness/*
# to manifests/l/LodeKennes/DeepSeekHarness/0.1.0-rc.7-build-9/ in a winget-pkgs fork
```

Or, with [wingetcreate](https://github.com/microsoft/winget-create) on Windows:

```powershell
wingetcreate new https://github.com/LodeKennes/deepseek-harness-desktop/releases/download/desktop-v0.1.0-rc.7-build-9/DeepSeek-Harness-0.1.0-rc.7-build-9-win-x64.exe
```

### Chocolatey

```sh
cd packaging/chocolatey
choco pack
choco push deepseek-harness.1.2.3.9.nupkg --source https://push.chocolatey.org/
```

The Chocolatey and AUR versions map `0.1.0-rc.7-build-9` → `0.1.0.rc.7.build.9` because their package versions cannot contain hyphens.

### AUR

```sh
git clone ssh://aur@aur.archlinux.org/deepseek-harness-desktop-bin.git
cp packaging/aur/deepseek-harness-desktop-bin/{PKGBUILD,.SRCINFO} deepseek-harness-desktop-bin/
cd deepseek-harness-desktop-bin && git add PKGBUILD .SRCINFO && git commit -m "0.1.0.6" && git push
```

The name is `deepseek-harness-desktop-bin` so it does not collide with the
upstream CLI AUR package `deepseek-harness-git`.

## What this does not do

- Host an apt or yum repository. Use the Release `.deb` / `.rpm`.
- Notarize macOS or Authenticode-sign Windows.
- Publish a Flatpak or Snap (would need a separate runtime bundle).
