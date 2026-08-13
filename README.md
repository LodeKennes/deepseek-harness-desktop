# DeepSeek Harness

Thin standalone packaging repository for **DeepSeek Harness** desktop installers.

This repo does **not** contain the harness source, a git submodule, or vendored packages. CI (and local development) clones a pinned revision of [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) and builds installers from that SHA. The pin lives in [`versions.json`](versions.json).

## Status

Unsigned developer-preview. Desktop installers are not published yet. Once they exist, end users will not need Node.js, pnpm, Python, or a C++ toolchain.

See [docs/development.md](docs/development.md) for how the pin is fetched and built.

## Version pin

[`versions.json`](versions.json) is the source of truth:

| Field | Value |
| --- | --- |
| Desktop | `0.1.0-beta.1` (`ai.deepseek.harness.desktop`) |
| Harness | `0.1.0-rc.5` at `47f943859bef60e4160492346772ded9b24f765a` |

A pin bump is a deliberate commit in this repository. This repo is not a source of truth for the harness.

## License

MIT. The upstream harness is also MIT (DeepSeek).
