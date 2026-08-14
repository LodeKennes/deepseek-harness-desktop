---
name: harness-pin-bump
description: >
  Re-apply this desktop repo's styling.json overlay after a DeepSeek Harness
  release. Use when bumping harness.sha, a new DeepSeek Harness version ships,
  BrandWordmark/FishLogo/AppRoot overlay fails, desktop-brand boot fails, or
  the user runs /harness-pin-bump.
---

# Harness pin bump

The desktop repo is a packager. Upstream source of truth is the SHA in `versions.json`. Brand lives only in `styling.json`. Never vendor the harness or add a submodule.

## 1. Move the pin

1. Set `harness.sha` (and `harness.version` if tagged) in `versions.json`.
2. Run `./scripts/fetch-harness.sh`. Confirm `.cache/harness` `git rev-parse HEAD` equals the pin.
3. Run `node scripts/apply-styling.mjs apply`. **Stop if this exits non-zero** — do not fuzz-apply, do not `patch --forward`.

## 2. Read the failure, fix the generator — not the clone

| Failure | Meaning | Fix |
| --- | --- | --- |
| `upstream missing <path>` | File moved or renamed | Update `OVERLAY_TARGETS` in `scripts/lib/styling.mjs` to the new path. Keep the overlay budget at 8 files under `overlay/harness`. |
| `lost expected marker` | Export/name changed | Read the new upstream file. Update the marker string. If `IconProps` or `export function BrandWordmark` / `FishLogo` changed, update `generateIconTsx`. |
| `AppRoot lost HARNESS needle` | Boot plate text moved | Open `packages/client/web/src/AppRoot.tsx`. Update `APPROOT_WORDMARK_NEEDLE` to the new exact JSX. Still a one-line replace — **never whole-file overlay AppRoot** (it owns fail-loud boot UX). |
| `desktop-brand: dist index missing title needle` | `<title>DeepSeek Harness</title>` gone from `dsh-web-frontend/dist/index.html` | Update `INDEX_TITLE_NEEDLE` in `scripts/lib/styling.mjs` **and** the generated host plugin. Validate in host `apply()`, not only inside `tapIndex` (a tap throw is HTTP 400 after the sidecar is already "ready"). |
| `catalog token missing` | `--dsw-alias-brand-primary` or `--dsw-specific-sidebar-fill` renamed | Update `COLOR_TOKEN_NAMES`. Specifics like `--dsw-specific-bubble` are **not** a fail-loud catalog check — screenshot the chat bubble. |
| `window.__ModuleLoader__.load` / client graph fail | Factory banner or `dsh.client` contract changed | Diff a shipped `packages/client/*/lib/client.js`. `generateClientPlugin` must keep `load({ id, factory })`. Do not emit a `tsc` ESM `export function apply` as `lib/client.js`. |
| `staged dependencies remain missing: desktop-brand` | Plugin copied **before** the restore loop | Copy `desktop-brand` **after** leftover-symlink check, then `jq` it onto staged `@deepseek-ai/dsh` `dependencies`. Staged plugin `package.json` must have **no** `workspace:` protocol. |
| Linux `.deb` will not start / sandbox path | `productNameSafe` has a space | `styling.json` `productNameSafe` is the `/opt` prefix. Display `productName` may contain spaces. |

## 3. Rebuild and smoke

```sh
./scripts/build-harness.sh
./scripts/stage-runtime.sh
node dist/runtime/sidecar-entry.mjs web --dump-config \
  --patch .cache/styling/brand.generated.cordis.yml \
  --patch resources/desktop-capabilities.cordis.yml
# must list id: desktop-brand and session-query-sqlite openAt: first-search
./scripts/smoke-sidecar.sh
pnpm test
```

Smoke `GET /` must be HTTP 200 with `<title>` equal to `styling.json` `productName`.

## 4. Visual check (required)

Boot the staged app (`pnpm start` after `tsc`). Confirm:

- Boot plate shows `bootWordmark` (`HARNESS` for stock DeepSeek)
- Expanded sidebar shows the upstream whale unless `assets.wordmark` is set
- Welcome copy is upstream unless `styling.json` `welcome` is set
- `--patch resources/desktop-capabilities.cordis.yml` is still applied after brand (sidebar session search)

## Hard rules

- Do not rewrite hashed `index-*.js` / `index-*.css`.
- Do not inject Electron preload JS into the sidecar origin.
- Do not replace `ui-sidebar` / `SidebarRoot` to swap the logo. Overlay `BrandWordmark.tsx` and `FishLogo.tsx` only.
- Do not relabel model names (`DeepSeek-V4-Flash`).
- Do not rename `~/.dsh`. Keep `appId` unless product accepts a new OS identity.
- Crossing 8 files in the generated overlay is an explicit fork decision, not a silent expansion.
- Prefer proposing a `sidebar.brand` slot upstream over growing the overlay.

Schema and field meanings: `styling.json` + `docs/development.md` (`styling.json` section). Do not invent a second brand file.
