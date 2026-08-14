<p align="center">
  <img src="resources/icons/512.png" width="96" alt="DeepSeek Harness">
</p>

<h1 align="center">DeepSeek Harness</h1>

<p align="center">
  Desktop installers for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> (<code>dsh</code>).<br>
  English · <a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/LodeKennes/deepseek-harness-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/LodeKennes/deepseek-harness-desktop?label=release&color=4D6BFE" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LodeKennes/deepseek-harness-desktop?color=0f1115" alt="MIT License"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/harness-0.1.0--rc.5-4176e6" alt="Pinned Harness version"></a>
  <a href="https://github.com/LodeKennes/deepseek-harness-desktop/actions/workflows/build-desktop.yml"><img src="https://img.shields.io/github/actions/workflow/status/LodeKennes/deepseek-harness-desktop/build-desktop.yml?label=build" alt="Build status"></a>
</p>

DeepSeek Harness is an open-source [agent harness](https://deepseek.com/harness) from [DeepSeek AI](https://deepseek.com). **Everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis). This repository does not contain that source. It packages a pinned revision into Windows, macOS, and Linux installers, and adds a first-run path to connect an existing subscription.

End users do not need Node.js, pnpm, or a C++ toolchain. Installed size is about **0.5 GB**.

<p align="center">
  <a href="https://github.com/LodeKennes/deepseek-harness-desktop/releases/latest"><strong>Download the latest release</strong></a>
  ·
  <a href="https://github.com/deepseek-ai/deepseek-harness">Upstream repository</a>
  ·
  <a href="https://deepseek.com/harness">deepseek.com/harness</a>
</p>

## Developer preview

DeepSeek Harness is in *developer preview* and is iterating rapidly. **There will be compatibility-breaking changes.**

These desktop builds are **unsigned**. Windows SmartScreen and macOS Gatekeeper will warn; Linux packages have no signature. There is no in-app auto-update. Treat the OS trust UI as correct. This packager is not an official DeepSeek product page.

## Install

Pick the asset for your OS and CPU from the [latest GitHub Release](https://github.com/LodeKennes/deepseek-harness-desktop/releases/latest). Details: [docs/user-install.md](docs/user-install.md).

The official CLI path remains `npx @deepseek-ai/dsh web` — see the [upstream README](https://github.com/deepseek-ai/deepseek-harness#run).

| Platform | Recommended | Also published |
| --- | --- | --- |
| **Windows** x64 / arm64 | NSIS installer (`.exe`) | Portable `.zip` |
| **macOS** Apple Silicon / Intel | `.dmg` | `.zip` of the same app |
| **Debian / Ubuntu** | `.deb` (`apt install ./…`) | |
| **Fedora / RHEL** | `.rpm` | |
| **Arch / Manjaro** | `.pkg.tar.zst` | |
| **Any Linux** | | AppImage (FUSE or `--appimage-extract-and-run`; runs `--no-sandbox`) |

macOS, after copying to Applications:

```sh
xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
```

Windows: **More info → Run anyway**. The NSIS “Add `dsh` to PATH” checkbox stays off so a global CLI install is not shadowed.

## Connect a subscription

On first launch, connect an account you already pay for. The app starts a localhost-only helper, opens the provider’s real browser sign-in, discovers models, and configures Harness.

| You have | You connect |
| --- | --- |
| ChatGPT / Codex | ChatGPT |
| Claude | Claude |
| Google Antigravity | Google |

Skip the screen to add an API key later under **Settings → Models**. Reopen it from **Subscriptions → Manage subscriptions…**.

Account files stay under `~/.dsh/desktop/cliproxyapi/auth` (or `%USERPROFILE%\.dsh\…`). They are not sent to this repository. The helper is [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

Desktop and the CLI share `~/.dsh`. **Do not run `dsh` and this app at the same time** — each boot heals `$DSH_HOME/profiles/node_modules` to its own install.

## Community and support

Use the upstream channels. This packager does not host a separate community.

- Feedback and bug reports: [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- Desktop-specific packaging issues: [this repo’s issues](https://github.com/LodeKennes/deepseek-harness-desktop/issues)
- Plugin authors: add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic
- [DeepSeek Harness Discord](https://discord.gg/Ycq5dCaS4)

## Version pin

[`versions.json`](versions.json) is the source of truth for **this** repo. It is not a source of truth for Harness.

| Field | Current |
| --- | --- |
| Desktop base | `0.1.0` · `ai.deepseek.harness.desktop` |
| Harness | `0.1.0-rc.5` at `47f943859bef60e4160492346772ded9b24f765a` |
| Node (bundled) | `24.5.0` |
| Electron | `37.2.6` |
| CLIProxyAPI | `7.2.74` |

A push to `master` publishes `desktop-v0.1.0-N`. Bumping the base version or the harness SHA is a deliberate commit here. There is no git submodule and no vendored Harness tree.

## Development

You need Git, `jq`, **Node 24**, and **pnpm 11.7.0**. The scripts do not install them.

```sh
./scripts/stage-runtime.sh      # pin → build Harness → stage sidecar + Node
./scripts/stage-cliproxyapi.sh  # pin → verify → stage CLIProxyAPI
pnpm start                      # tsc && electron .
pnpm test
./scripts/package.sh            # host OS/arch only; no cross-compile
```

Brand and desktop-only patches live in [`styling.json`](styling.json) and `resources/`. See [docs/development.md](docs/development.md).

For the agent itself, start with the upstream [development guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/development.md), [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md), and [AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md).

## License

[MIT](LICENSE). Upstream Harness and the bundled CLIProxyAPI binary are also MIT; their licenses ship in the installers.
