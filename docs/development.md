# Development

This repository is a thin packaging repo. It never vendors `deepseek-ai/deepseek-harness` and must not add that tree as a git submodule.

## Pin

[`versions.json`](../versions.json) is the source of truth.

- `harness.sha` is required. That is the revision that is cloned and checked out.
- `harness.repository` is the default HTTPS remote (`https://github.com/deepseek-ai/deepseek-harness.git`).
- `harness.sshRepository` is the SSH fallback (`git@github.com:deepseek-ai/deepseek-harness.git`) when HTTPS cannot be used.

HTTPS is the default. Use SSH only as a fallback.

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
# host smoke: node dist/runtime/sidecar-entry.mjs web --host 127.0.0.1 --port 13800
```

`STAGE` defaults to `dist/runtime`. The script deploys the existing `@deepseek-ai/dsh` package (no injected workspace member), materializes links, restores missing direct deps, downloads official Node, and copies `electron/sidecar-entry.mjs`.

## Package (Linux x64)

Requires a staged `dist/runtime` (`scripts/package.sh` calls `stage-runtime.sh` when it is missing), plus `pnpm install` in this repo.

```sh
./scripts/package.sh
# artifacts: dist/installers/DeepSeek-Harness-<desktop.version>-linux-x64.{deb,AppImage}
```

electron-builder always runs with `--publish never`. `.deb` is the primary installer (SUID `chrome-sandbox`, no `--no-sandbox`). AppImage is a portable extra and is launched with `--no-sandbox`. Host smoke of the staged sidecar: `./scripts/smoke-sidecar.sh`. After packaging, `./scripts/smoke-packaged.sh` extract-and-runs the AppImage (no `libfuse2`) and unpacks the `.deb`.

## Rules

- Never commit `.cache/`, `dist/`, `out/`, or `node_modules/`.
- Never treat this repo as the harness source of truth.
- Desktop versioning is independent of the harness pin.
