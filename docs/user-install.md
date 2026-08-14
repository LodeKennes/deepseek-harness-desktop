# Install DeepSeek Harness Desktop

**Unsigned developer-preview builds.** These artifacts are not code-signed or notarized. Windows SmartScreen and macOS Gatekeeper will warn; Linux packages have no signature. Treat the OS trust UI as correct. There is no auto-update.

Download installers from this repository's GitHub Releases when they are published (`desktop-v*` tags). End users do **not** need Node.js, pnpm, Python, or a C++ toolchain for the primary installers. Installed size is on the order of **0.5 GB** (compressed downloads ~180–260 MB).

Configure a model key in **Settings → Models** after first launch (stored in `~/.dsh/.credentials.yaml`). Then **Choose workspace** in the UI.

## Windows

Artifacts: NSIS installer (`.exe`) and a portable zip.

- **NSIS (recommended).** Per-user install by default (`%LOCALAPPDATA%\Programs\DeepSeek Harness\`). You can change the install directory. The **Add `dsh` to the user PATH** checkbox is **off** by default so an existing npm-global `dsh` is not shadowed.
- **Portable zip.** Unpack and run `DeepSeek Harness.exe`. No PATH change.

SmartScreen will flag the unsigned binary. Choose **More info → Run anyway**.

## macOS

Artifact: DMG (drag to Applications). A zip of the same `.app` may also be published.

Gatekeeper blocks unsigned / ad-hoc-signed apps. After copying the app to Applications:

```sh
xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
```

There is no `/usr/local/bin/dsh` symlink by default. Optional:

```sh
ln -s "/Applications/DeepSeek Harness.app/Contents/Resources/harness/bin/dsh" /usr/local/bin/dsh
```

## Linux

| Format | Role |
| --- | --- |
| **`.deb`** | Debian, Ubuntu, Mint, and derivatives. |
| **`.rpm`** | Fedora, RHEL, openSUSE, and other RPM-based distributions. |
| **`.pkg.tar.zst`** | Arch Linux, Manjaro, EndeavourOS, and other pacman-based distributions. |
| **AppImage** | Portable extra. **Not** zero-dep. Cannot ship a working SUID sandbox helper, so it is launched with `--no-sandbox`. The HTTP API is still bound to `127.0.0.1` only. |

### .deb

```sh
sudo apt install ./DeepSeek-Harness-*-linux-*.deb
```

`apt install ./…` pulls the package's shared-library Depends (GTK, NSS, …). `dpkg -i` alone will not.

The desktop binary is `deepseek-harness` (package name `deepseek-harness`). The bundled CLI lives inside the app tree at `resources/harness/bin/dsh`. The package does **not** install `/usr/bin/dsh` or `/usr/bin/dsh-desktop`.

### Fedora / RPM

```sh
sudo dnf install ./DeepSeek-Harness-*.rpm
```

### Arch Linux / pacman

```sh
sudo pacman -U ./DeepSeek-Harness-*.pkg.tar.zst
```

### AppImage

Ubuntu 24.04 often lacks FUSE 2 (`libfuse2`). Do not treat AppImage as a zero-dep install.

```sh
chmod +x DeepSeek-Harness-*.AppImage
./DeepSeek-Harness-*.AppImage --appimage-extract-and-run
```

Or extract once and run the unpacked binary. The AppImage does not mutate `PATH`.

Zenity or KDialog is optional: without them, the in-page browse picker is used.

## Shared home and default workspace

Desktop and CLI share the same Harness home (`~/.dsh` / `%USERPROFILE%\.dsh`, or `$DSH_HOME`). Credentials, settings, and sessions carry across.

**Do not run CLI `dsh` and the desktop app at the same time.** Each boot heals `$DSH_HOME/profiles/node_modules` junctions/symlinks to *its* install. Last boot wins. Running both concurrently can leave plugins pointing at the wrong tree.

Default sidecar working directory (sandbox default until you pick a workspace), matching `resolveDefaultWorkspace()`:

1. `$DOCUMENTS/DeepSeek Harness` when the OS Documents folder is not `$HOME`
2. `~/Documents/DeepSeek Harness` (explicit `Documents` segment) when Documents is `$HOME` (some Linux XDG setups)
3. `~/.dsh/default-workspace` only if those candidates are `$HOME` or `$DSH_HOME`

Never the install directory, never `$HOME`, never `$DSH_HOME` itself.

## Extra plugins

The shipped profile is the `web` template only. `dsh plugin` is an advanced path and needs a **system** pnpm on `PATH`. The desktop app does not bundle pnpm. Without it, plugin install exits 127.

## Updates

There is **no in-app auto-update**. Every successful push to `master` publishes
the next `desktop-vX.Y.Z-N` GitHub Release automatically; download newer builds
from the Releases page. Signing (and only then in-app auto-update) is a
follow-up; see [signing.md](signing.md).
