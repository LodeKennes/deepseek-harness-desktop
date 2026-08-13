# Development

This repository is a thin packaging repo. It never vendors `deepseek-ai/deepseek-harness` and must not add that tree as a git submodule. Fetch and build scripts land in a later change; this page is the intended flow only.

## Pin

[`versions.json`](../versions.json) is the source of truth.

- `harness.sha` is required. That is the revision that is cloned and checked out.
- `harness.repository` is the default HTTPS remote (`https://github.com/deepseek-ai/deepseek-harness.git`).
- `harness.sshRepository` is the SSH fallback (`git@github.com:deepseek-ai/deepseek-harness.git`) when HTTPS cannot be used.

HTTPS is the default. Use SSH only as a fallback.

## Intended fetch and build

1. Read the pin from `versions.json`.
2. Clone the harness into `.cache/harness` (gitignored) at `harness.sha`. Do not add a submodule. Do not commit the clone.
3. In that clone, run `pnpm install --frozen-lockfile`.
4. Then run `pnpm run build`.

If `.cache/harness` already exists and `HEAD` matches the pin, the fetch is a no-op. If the SHA differs, update in place (fetch + detached checkout). On fetch failure, wipe the cache and clone again.

## Rules

- Never commit `.cache/`, `dist/`, `out/`, or `node_modules/`.
- Never treat this repo as the harness source of truth.
- Desktop versioning is independent of the harness pin.
