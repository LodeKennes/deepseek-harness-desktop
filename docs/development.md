# Development

This repository is a thin packaging repo. It never vendors `deepseek-ai/deepseek-harness` and must not add that tree as a git submodule.

## Pin

[`versions.json`](../versions.json) is the source of truth.

- `harness.sha` is required. That is the revision that is cloned and checked out.
- `harness.repository` is the default HTTPS remote (`https://github.com/deepseek-ai/deepseek-harness.git`).
- `harness.sshRepository` is the SSH fallback (`git@github.com:deepseek-ai/deepseek-harness.git`) when HTTPS cannot be used.
- `runtimes.cliProxyApi` is the CLIProxyAPI release bundled with the desktop app.

HTTPS is the default. Use SSH only as a fallback.

## `styling.json`

[`styling.json`](../styling.json) is the product brand file. It is **not** the harness pin — that stays in `versions.json`.

| Field | Role |
| --- | --- |
| `productName` | Window title, menus, welcome, web `<title>` |
| `productNameSafe` | Linux install prefix and artifact names. **No spaces** (`chrome-sandbox` execvp-splits `/opt/Foo Bar`) |
| `desktopName` | Linux executable / StartupWMClass |
| `appId` | OS application identity. Changing it orphans existing installs |
| `bootWordmark` | Text on the kernel boot plate (replaces `HARNESS`) |
| `assets.wordmark` / `assets.logo` / `assets.favicon` | Optional SVG paths. Omitted → generated text/letter marks. Installer icons stay in `resources/icons/` |
| `colors.*` | Friendly `{ light, dark }` pairs mapped to `--dsw-*` tokens |
| `tokens` | Extra `--dsw-*` pairs (backgrounds, DeepSeek-blue replacements, font) |
| `styling/chrome.css` | Optional extra CSS injected into the sidecar index. Stock DeepSeek ships none. |
| `styling/fonts/*.woff2` | Optional webfonts copied to `apps/web/public/fonts/` |
| `welcome.en` / `welcome.zh` | Optional overlay of `onboarding-copy.ts` only |

`scripts/apply-styling.mjs generate` writes `.cache/styling/` (overlay, `desktop-brand` plugin, `brand.generated.cordis.yml`). `apply` (from `build-harness.sh`) hard-resets `.cache/harness`, copies overlay files, and patches the `AppRoot` `HARNESS` needle. Missing markers fail the build.

`resources/desktop-capabilities.cordis.yml` is a second `--patch` (after brand). It turns on durable session full-text search (`session-query-sqlite` `openAt: first-search`) so the sidebar search matches conversation content, not only titles.

Do not overlay `AppRoot.tsx` as a whole file. Do not rewrite hashed Vite `index-*.js`. Do not inject Electron preload JS into the sidecar.

## Fetch and build

From the repository root. Requires `git` and `jq`. Building also requires Node 24 and pnpm 11.7.0 on `PATH` (see `runtimes` in `versions.json`). The scripts do not install Node or pnpm.

```sh
./scripts/fetch-harness.sh    # clone or update .cache/harness to the pin
./scripts/build-harness.sh    # fetch, then pnpm install --frozen-lockfile && pnpm run build
```

`fetch-harness.sh` reads `versions.json` and clones `harness.repository` into `.cache/harness` at `harness.sha`. If that directory already exists and `HEAD` matches the pin, it exits 0 without fetching.

If `HEAD` differs, it fetches the pin SHA in place (`git fetch --depth=1 origin <sha>`) and checks it out detached. On fetch failure it wipes `.cache/harness` and clones again. After checkout it verifies `git rev-parse HEAD` equals the pin.

`build-harness.sh` runs `fetch-harness.sh` first so the cache is at the pin, then runs `pnpm install --frozen-lockfile` and `pnpm run build` inside `.cache/harness`. It does not inject workspace members. Re-run it after a pin bump.

### Clone URL

HTTPS (`harness.repository`) is the default.

- Set `HARNESS_CLONE_SSH=1` to clone `harness.sshRepository` instead.
- If an HTTPS clone fails, the script retries with `harness.sshRepository`.

```sh
HARNESS_CLONE_SSH=1 ./scripts/fetch-harness.sh
```

## Stage

```sh
./scripts/stage-runtime.sh
./scripts/stage-cliproxyapi.sh
# host smoke: node dist/runtime/sidecar-entry.mjs web --host 127.0.0.1 --port 13800
```

`STAGE` defaults to `dist/runtime`. The script deploys the existing `@deepseek-ai/dsh` package (no injected workspace member), materializes links, restores missing direct deps, downloads official Node, and copies `electron/sidecar-entry.mjs`.

`stage-cliproxyapi.sh` downloads the host OS/architecture asset for the pinned
CLIProxyAPI release, verifies it against the upstream checksum manifest, and
stages its binary and license under `dist/cliproxyapi`.

## Package (Linux / macOS)

Requires a staged `dist/runtime` (`scripts/package.sh` calls `stage-runtime.sh` when it is missing), plus `pnpm install` in this repo. Packaging stages the pinned CLIProxyAPI binary automatically. `STAGE` is not supported here: electron-builder `extraResources` is always `dist/runtime`. Unset `STAGE` or set it to that path. The host OS/arch must match the target (no cross-compile; two macOS DMGs, not `lipo`).

```sh
./scripts/package.sh
# Linux x64 / arm64: AppImage, deb, rpm, and pkg.tar.zst
# macOS arm64 / x64: dist/installers/DeepSeek-Harness-<desktop.version>-mac-<arch>.{dmg,zip}
```

electron-builder always runs with `--publish never`. Linux: `.deb`, `.rpm`, and
`.pkg.tar.zst` are native packages with the SUID `chrome-sandbox`; AppImage is
a portable extra launched with `--no-sandbox`. macOS: DMG + zip;
`stage-runtime.sh` copies `node-pty`'s `spawn-helper` next to the bundled Node as
`node/bin/node-spawn-helper`. Host smoke of the staged sidecar:
`./scripts/smoke-sidecar.sh`. After packaging, `./scripts/smoke-packaged.sh`
validates all four Linux formats, launches the AppImage and unpacked `.deb`, or
unzips the macOS zip, asserts the helper, and orphan-kills the `.app`.

## Package (Windows)

Same `package.sh` on a Windows host (Git Bash). Official Node is staged at `dist/runtime/node/node.exe` (not `node/bin/node`). Artifacts are a per-user NSIS installer (`oneClick: false`, install-dir page, PATH checkbox **unchecked** by default) and a portable zip.

```sh
./scripts/package.sh
# artifacts: dist/installers/DeepSeek-Harness-<desktop.version>-win-<arch>.{exe,zip}
# arch is x64 or arm64 (host-native)
```

Host smoke of the staged sidecar (quit pipe): `./scripts/smoke-sidecar.sh`. After packaging, `./scripts/smoke-windows.sh` unzips the portable build, launches it, then kills Electron (not `/T`) and asserts `node.exe` is gone.

## Rules

- Never commit `.cache/`, `dist/`, `out/`, or `node_modules/`.
- Never treat this repo as the harness source of truth.
- Desktop versioning is independent of the harness pin.

## Automatic releases

`versions.json` and `package.json` contain the `X.Y.Z` desktop base version.
Every push to `master` runs `.github/workflows/release.yml` serially. The
workflow finds the highest existing `desktop-vX.Y.Z-N` tag, selects `N + 1`,
passes `X.Y.Z-N` into the complete build matrix, and creates the tag only after
all packages and smoke tests pass. Rerunning a released commit reuses its
existing version instead of consuming a new build number.

The resulting GitHub Release contains automatically generated change history,
all platform artifacts, and `SHA256SUMS`. Pull requests run CI and unpublished
desktop validation builds but cannot publish releases.
