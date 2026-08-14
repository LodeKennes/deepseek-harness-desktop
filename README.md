# DeepSeek Harness

**Unsigned developer-preview builds.** Desktop artifacts are not code-signed or notarized. Windows SmartScreen and macOS Gatekeeper will warn; Linux packages have no signature. Treat the OS trust UI as correct. There is no auto-update.

Thin standalone packaging repository for **DeepSeek Harness** desktop installers.

## Subscription onboarding demo

The `demo/subscription-onboarding` branch is a working, intentionally small
integration with [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).
The app starts a bundled local proxy, opens the provider's real browser sign-in,
discovers the available models, and configures Harness to use them. It supports
ChatGPT/Codex, Claude, and Google Antigravity accounts.

CLIProxyAPI listens only on localhost. Its account files are kept under
`~/.dsh/desktop/cliproxyapi/auth`; they are not sent to this desktop project.
The connection screen can be reopened from
**Subscriptions → Manage subscriptions…**.

For a source checkout, run `./scripts/stage-runtime.sh`,
`./scripts/stage-cliproxyapi.sh`, and then `pnpm start`. Packaged demo builds
already contain both runtimes. See [`DESIGN.md`](DESIGN.md) for the deliberately
limited scope and remaining production questions.

This repo does **not** contain the harness source, a git submodule, or vendored packages. CI (and local development) clones a pinned revision of [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) and builds installers from that SHA. The pin lives in [`versions.json`](versions.json).

End users do not need Node.js, pnpm, Python, or a C++ toolchain for the primary installers. Installed size is ~0.5 GB.

- [Install (per OS, shared `~/.dsh`, plugins)](docs/user-install.md)
- [Signing runbook (follow-up secrets; not wired in v1)](docs/signing.md)
- [Development (fetch / build / package)](docs/development.md)

## Version pin

[`versions.json`](versions.json) is the source of truth:

| Field | Value |
| --- | --- |
| Desktop base | `0.1.0` (`ai.deepseek.harness.desktop`) |
| Harness | `0.1.0-rc.5` at `47f943859bef60e4160492346772ded9b24f765a` |
| CLIProxyAPI | `7.2.74` |

A push to `master` automatically becomes `0.1.0-N`, where `N` increments
within that base version. The successful release workflow creates the matching
`desktop-v0.1.0-N` tag, generated change history, checksums, and GitHub Release.
A base-version or harness pin bump is a deliberate commit in this repository.
This repo is not a source of truth for the harness.

## License

MIT. The upstream Harness and the bundled CLIProxyAPI binary are also MIT; their
license files are included in packaged builds.
