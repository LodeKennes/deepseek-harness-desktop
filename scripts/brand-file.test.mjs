import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { COLOR_TOKEN_NAMES, loadStyling, resolveAssetPaths } from './lib/styling.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SITE_TOKEN_PAIRS = new Set([
  '#111613/#E2E9E4',
  '#E8EDE6/#1C1F1A',
  '#D7DFD5/#10150F',
  '#BF352E/#E55A4E',
  '#BF352E/#EF453C',
  '#35685F/#699C92',
])

test('repo styling.json is a non-DeepSeek brand loaded through the shipped parser', () => {
  const styling = loadStyling(repoRoot)
  assert.equal(/DeepSeek/i.test(styling.productName), false)
  assert.equal(/\s/.test(styling.productNameSafe), false)
  assert.match(styling.desktopName, /^[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.equal(styling.appId, 'ai.deepseek.harness.desktop')
  assert.ok(styling.welcome, 'welcome copy is required')
  assert.match(styling.welcome.en.title, new RegExp(styling.productName))
  assert.match(styling.welcome.en.body, new RegExp(styling.productName))
  assert.match(styling.welcome.zh.title, new RegExp(styling.productName))
  assert.match(styling.welcome.zh.body, new RegExp(styling.productName))

  const assets = resolveAssetPaths(repoRoot, styling)
  for (const [key, path] of Object.entries(assets)) {
    assert.equal(existsSync(path), true, `assets.${key} missing at ${path}`)
  }

  const mapped = Object.values(COLOR_TOKEN_NAMES).map((cssVar) => {
    const pair = styling.tokens[cssVar]
    assert.ok(pair, `missing token ${cssVar}`)
    return `${pair.light.toUpperCase()}/${pair.dark.toUpperCase()}`
  })
  for (const pair of mapped) {
    assert.equal(SITE_TOKEN_PAIRS.has(pair), true, `color pair ${pair} is not a public-website token`)
  }
})

test('packaged smokes look up binaries from styling.json, not DeepSeek names', () => {
  const packaged = readFileSync(join(repoRoot, 'scripts/smoke-packaged.sh'), 'utf8')
  const windows = readFileSync(join(repoRoot, 'scripts/smoke-windows.sh'), 'utf8')
  assert.match(packaged, /jq -r \.productName styling\.json/)
  assert.match(packaged, /Contents\/MacOS\/\$product_name/)
  assert.match(packaged, /launch_dir\/\$desktop_name/)
  assert.doesNotMatch(packaged, /DeepSeek Harness/)
  assert.doesNotMatch(packaged, /name deepseek-harness/)
  assert.match(windows, /jq -r \.productName styling\.json/)
  assert.match(windows, /\$\{product_name\}\.exe/)
  assert.match(windows, /\$\{product_name_safe\}-\*-win-/)
  assert.doesNotMatch(windows, /DeepSeek Harness/)
})

test('desktop workflow uploads artifacts using styling.json productNameSafe', () => {
  const yml = readFileSync(join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')
  assert.match(yml, /prefix=\$\(jq -r \.productNameSafe styling\.json\)/)
  assert.match(yml, /steps\.ver\.outputs\.prefix/)
  assert.doesNotMatch(yml, /DeepSeek-Harness-/)
})
