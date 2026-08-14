import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadStyling, resolveAssetPaths } from './lib/styling.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('repo styling.json is the stock DeepSeek Harness identity', () => {
  const styling = loadStyling(repoRoot)
  assert.equal(styling.productName, 'DeepSeek Harness')
  assert.equal(styling.productNameSafe, 'DeepSeek-Harness')
  assert.equal(styling.desktopName, 'deepseek-harness')
  assert.equal(styling.appId, 'ai.deepseek.harness.desktop')
  assert.equal(styling.bootWordmark, 'HARNESS')
  assert.equal(styling.welcome, undefined)
  assert.deepEqual(styling.tokens, {})
  assert.deepEqual(resolveAssetPaths(repoRoot, styling), {})
  assert.equal(existsSync(join(repoRoot, 'styling', 'wordmark.svg')), false)
  assert.equal(existsSync(join(repoRoot, 'styling', 'logo.svg')), false)

  const chrome = readFileSync(join(repoRoot, 'styling', 'chrome.css'), 'utf8')
  assert.doesNotMatch(chrome, /Inter/)
  assert.doesNotMatch(chrome, /Archivo/)
  assert.doesNotMatch(chrome, /#E8EDE6/)
  assert.doesNotMatch(chrome, /#BF352E/)
})

test('packaged smokes look up binaries from styling.json', () => {
  const packaged = readFileSync(join(repoRoot, 'scripts/smoke-packaged.sh'), 'utf8')
  const windows = readFileSync(join(repoRoot, 'scripts/smoke-windows.sh'), 'utf8')
  assert.match(packaged, /jq -r \.productName styling\.json/)
  assert.match(packaged, /Contents\/MacOS\/\$product_name/)
  assert.match(packaged, /launch_dir\/\$desktop_name/)
  assert.match(windows, /jq -r \.productName styling\.json/)
  assert.match(windows, /\$\{product_name\}\.exe/)
  assert.match(windows, /\$\{product_name_safe\}-\*-win-/)
})

test('packaged smoke cleanup can delete a read-only AppImage extract tree', () => {
  const smoke = readFileSync(join(repoRoot, 'scripts', 'smoke-packaged.sh'), 'utf8')
  assert.match(smoke, /chmod -R u\+w "\$workdir"/)
  assert.match(smoke, /set \+e/)
})

test('desktop capabilities patch is packaged and applied after brand', () => {
  const yml = readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8')
  assert.match(yml, /from: resources\/desktop-capabilities\.cordis.yml/)
  const main = readFileSync(join(repoRoot, 'electron', 'main.ts'), 'utf8')
  assert.match(main, /resolveDesktopPatchPaths/)
  const smoke = readFileSync(join(repoRoot, 'scripts', 'smoke-sidecar.sh'), 'utf8')
  assert.match(smoke, /desktop-capabilities\.cordis.yml/)
})

test('desktop workflow uploads artifacts using styling.json productNameSafe', () => {
  const yml = readFileSync(join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')
  assert.match(yml, /prefix=\$\(jq -r \.productNameSafe styling\.json\)/)
  assert.match(yml, /steps\.ver\.outputs\.prefix/)
})
