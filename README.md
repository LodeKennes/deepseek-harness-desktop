<p align="center">
  <img src="resources/icons/512.png" width="112" alt="DeepSeek Harness whale">
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>The DeepSeek Harness coding agent, as a desktop app.</strong><br>
  Installers for Windows, macOS, and Linux.<br>
  No Node, no pnpm, no terminal required.
</p>

<p align="center">
  <a href="https://github.com/LodeKennes/deepseek-harness-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/LodeKennes/deepseek-harness-desktop?label=release&color=4D6BFE" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LodeKennes/deepseek-harness-desktop?color=0f1115" alt="MIT License"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/harness-0.1.0--rc.5-4176e6" alt="Pinned Harness version"></a>
  <img src="https://img.shields.io/badge/windows%20%7C%20macOS%20%7C%20linux-111827" alt="Windows, macOS, and Linux">
  <a href="https://github.com/LodeKennes/deepseek-harness-desktop/actions/workflows/build-desktop.yml"><img src="https://img.shields.io/github/actions/workflow/status/LodeKennes/deepseek-harness-desktop/build-desktop.yml?label=build" alt="Build status"></a>
</p>

<p align="center">
  <a href="https://github.com/LodeKennes/deepseek-harness-desktop/releases/latest"><strong>Download the latest release</strong></a>
  ·
  <a href="https://github.com/deepseek-ai/deepseek-harness">Upstream Harness</a>
  ·
  <a href="https://deepseek.com/harness">deepseek.com/harness</a>
</p>

---

DeepSeek Harness is a local coding agent: the model thinks on your machine, tools run in your workspace, and every capability is a plugin. This repository does not rewrite that product. It **packages** a pinned revision of [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) into signed-later, install-and-go desktop builds — plus a first-run path that connects an existing ChatGPT, Claude, or Google Antigravity subscription.

End users do not need a toolchain. Installed size is about **0.5 GB**.

> **Developer preview.** Builds are unsigned. Windows SmartScreen and macOS Gatekeeper will warn; Linux packages have no signature. There is no in-app auto-update. Treat the OS trust UI as correct.

## Install

Grab the asset that matches your OS and CPU from the [latest GitHub Release](https://github.com/LodeKennes/deepseek-harness-desktop/releases/latest). Per-platform notes live in [docs/user-install.md](docs/user-install.md).

| Platform | Recommended | Also published |
| --- | --- | --- |
| **Windows** x64 / arm64 | NSIS installer (`.exe`) | Portable `.zip` |
| **macOS** Apple Silicon / Intel | `.dmg` | `.zip` of the same app |
| **Debian / Ubuntu** | `.deb` (`apt install ./…`) | |
| **Fedora / RHEL** | `.rpm` | |
| **Arch / Manjaro** | `.pkg.tar.zst` | |
| **Any Linux** | | AppImage (needs FUSE or `--appimage-extract-and-run`; runs `--no-sandbox`) |

macOS Gatekeeper will block the unsigned app. After dragging it to Applications:

```sh
xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
```

On Windows, choose **More info → Run anyway**. The NSIS “Add `dsh` to PATH” checkbox stays off so a global CLI install is not shadowed.

## Connect a subscription

On first launch, pick the account you already pay for. The app starts a **localhost-only** helper, opens the provider’s real browser sign-in, discovers usable models, and points Harness at them.

| You have | You connect |
| --- | --- |
| ChatGPT / Codex | ChatGPT |
| Claude | Claude |
| Google Antigravity | Google |

You can skip this screen and add a regular API key later under **Settings → Models**. Reopen it any time from **Subscriptions → Manage subscriptions…**.

Account files stay on disk under `~/.dsh/desktop/cliproxyapi/auth` (or `%USERPROFILE%\.dsh\…` on Windows). They are never sent to this repository. The helper is [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI); you choose a subscription, not a proxy.

Desktop and CLI share `~/.dsh`. **Do not run `dsh` and the desktop app at the same time** — each boot heals `$DSH_HOME/profiles/node_modules` to its own install.

## What this repo is

A thin Electron packager. CI clones the pin in [`versions.json`](versions.json), overlays [`styling.json`](styling.json), stages official Node plus the sidecar, and publishes installers. There is **no** harness source tree, **no** git submodule, and **no** vendored `node_modules` of DeepSeek Harness.

```
you  →  installer  →  Electron shell
                         ├─ first-run subscription screen
                         └─ bundled Node sidecar
                              └─ pinned DeepSeek Harness (web profile)
```

Brand, window chrome, and desktop-only defaults (session full-text search) are applied as fail-loud patches. Changing the product name or colors is an edit to `styling.json`, not a fork of Harness. See [Development](docs/development.md).

This is not an official DeepSeek product page. The agent itself is [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

## Version pin

[`versions.json`](versions.json) is the source of truth. This repo is not a source of truth for Harness.

| Field | Current |
| --- | --- |
| Desktop base | `0.1.0` · `ai.deepseek.harness.desktop` |
| Harness | `0.1.0-rc.5` at `47f943859bef60e4160492346772ded9b24f765a` |
| Node (bundled) | `24.5.0` |
| Electron | `37.2.6` |
| CLIProxyAPI | `7.2.74` |

A push to `master` becomes `0.1.0-N`. The release workflow cuts `desktop-v0.1.0-N`, writes checksums, and publishes the GitHub Release. Bumping the base version or the harness SHA is a deliberate commit here.

## Build from source

You need Git, `jq`, **Node 24**, and **pnpm 11.7.0** on `PATH`. The scripts do not install them.

```sh
./scripts/stage-runtime.sh      # pin → build Harness → stage sidecar + Node
./scripts/stage-cliproxyapi.sh  # pin → verify → stage CLIProxyAPI
pnpm start                      # tsc && electron .
```

Package the host OS/arch only (no cross-compile):

```sh
./scripts/package.sh
```

| Doc | Contents |
| --- | --- |
| [Install](docs/user-install.md) | Per-OS install, shared `~/.dsh`, plugins |
| [Development](docs/development.md) | Fetch, overlay, stage, package |
| [Signing](docs/signing.md) | Follow-up secrets; not wired in v1 |

```sh
pnpm test
```

## License

MIT. Upstream Harness and the bundled CLIProxyAPI binary are also MIT; their license files ship inside the installers.
