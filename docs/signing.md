# Code signing (follow-up)

v1 ships **unsigned** developer-preview artifacts. This file is the runbook for a later signing PR. Do not wire CI to these secrets until that PR.

| Platform | v1 | Later |
| --- | --- | --- |
| Windows | Unsigned NSIS / zip. SmartScreen warns; users use **More info → Run anyway**. | Authenticode with an org code-signing cert. |
| macOS | Ad-hoc (electron-builder default). Gatekeeper blocks; users run `xattr -dr com.apple.quarantine`. | Developer ID Application + notarization. Hardened runtime. |
| Linux | No signature. | Optional detached signatures on Release assets. |

User-facing workarounds live in [user-install.md](user-install.md).

## Secrets for a later PR

Store these as GitHub Actions org/repo secrets. None of them are used in v1 workflows.

| Secret | Purpose |
| --- | --- |
| `WINDOWS_CERT_PFX` | Authenticode certificate (PFX / PKCS#12), base64 or file. |
| `WINDOWS_CERT_PASSWORD` | Password for `WINDOWS_CERT_PFX`. |
| `APPLE_ID` | Apple ID used for notarytool. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID. |
| `APPLE_TEAM_ID` | Developer Team ID. |
| `CSC_LINK` | electron-builder certificate (p12 / link). Shared name with the Windows/mac CSC path. |
| `CSC_KEY_PASSWORD` | Password for `CSC_LINK`. |

electron-builder can also take `win.certificateSha1` / `csc_link` from the environment once those secrets exist. This repo must not commit certs or passwords.

## macOS sidecar and native addons

Signing Electron.app is not enough.

The product is a thin Electron shell plus a **bundled official Node 24 sidecar** and a real `harness/` tree (`extraResources`). On macOS, also sign:

- `Contents/Resources/harness/node/bin/node`
- `Contents/Resources/harness/node/bin/node-spawn-helper` (node-pty)
- `Contents/Resources/cliproxyapi/cli-proxy-api`
- every native `.node` under `Contents/Resources/harness/` (koffi, node-pty, `node-addon-require-builtin-*`, …)

The sidecar may need `com.apple.security.cs.allow-unsigned-executable-memory` (koffi / V8). That entitlement belongs on the **sidecar Node**, not on Electron. Budget time to walk the nested binaries; notarization fails if any remain unsigned.

On Windows, sign both the Electron executable/installer and the bundled
`resources\cliproxyapi\cli-proxy-api.exe` before packaging the final NSIS
installer.

## Auto-update

**Only after signing.** Unsigned auto-update is a supply-chain hole.

Later: electron-updater against GitHub Releases (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`). Start with a manual **Check for updates**, then optional background. v1 Help / Releases stays a browser link to GitHub Releases with no downloader.
