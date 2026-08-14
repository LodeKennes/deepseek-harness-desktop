#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyOverlayToClone,
  generatedPaths,
  hashStylingInputs,
  loadStyling,
  planOverlay,
  renderOverlayStamp,
  resolveAssetPaths,
  writeDesktopBrandPlugin,
  writeGeneratedOverlay,
  generateBrandYaml,
  planFontOverlays,
} from './lib/styling.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2] ?? 'generate'

const styling = loadStyling(repoRoot)
const assets = resolveAssetPaths(repoRoot, styling)
const svgs = {
  wordmark: assets.wordmark ? readFileSync(assets.wordmark, 'utf8') : undefined,
  logo: assets.logo ? readFileSync(assets.logo, 'utf8') : undefined,
  favicon: assets.favicon ? readFileSync(assets.favicon, 'utf8') : undefined,
}
const files = [...planOverlay(styling, svgs), ...planFontOverlays(repoRoot)]
const paths = generatedPaths(repoRoot, styling)
const chromePath = join(repoRoot, 'styling', 'chrome.css')
const extraCss = existsSync(chromePath) ? readFileSync(chromePath, 'utf8') : ''
const fontPath = join(repoRoot, 'styling', 'fonts', 'archivo-latin-static.woff2')
const assetContents = [
  ...Object.values(assets).map((path) => readFileSync(path)),
  extraCss,
  ...(existsSync(fontPath) ? [readFileSync(fontPath)] : []),
]
const stylingHash = hashStylingInputs(styling, assetContents)

if (command === 'validate') {
  console.log(`apply-styling: ${styling.productName} ok (${files.length} overlay files)`)
  process.exit(0)
}

if (command !== 'generate' && command !== 'apply') {
  console.error('usage: apply-styling.mjs [validate|generate|apply]')
  process.exit(2)
}

mkdirSync(paths.root, { recursive: true })
writeGeneratedOverlay(paths.overlay, files)
writeDesktopBrandPlugin(paths.plugin, styling, extraCss)
writeFileSync(paths.brandYaml, generateBrandYaml(styling))
writeFileSync(join(paths.root, 'hash'), `${stylingHash}\n`)
console.log(`apply-styling: generated ${files.length} overlay files + desktop-brand → ${paths.root}`)

if (command === 'generate') process.exit(0)

const clone = join(repoRoot, '.cache', 'harness')
if (!existsSync(join(clone, '.git'))) {
  console.error('error: .cache/harness is not a git checkout; run scripts/fetch-harness.sh')
  process.exit(1)
}

const sha = jsonField(join(repoRoot, 'versions.json'), 'harness.sha')
execFileSync('git', ['-C', clone, 'reset', '--hard', sha], { stdio: 'inherit' })
execFileSync('git', ['-C', clone, 'clean', '-fd', '-e', '.desktop-overlay-stamp'], { stdio: 'inherit' })
applyOverlayToClone(clone, files, styling.bootWordmark)
writeFileSync(paths.stamp, renderOverlayStamp({
  sha,
  stylingHash,
  files: files.map((file) => file.rel).concat(['packages/client/web/src/AppRoot.tsx']),
}))
console.log(`apply-styling: applied overlay to ${clone} @ ${sha}`)

function jsonField(path, dotted) {
  const value = dotted.split('.').reduce((acc, key) => acc?.[key], JSON.parse(readFileSync(path, 'utf8')))
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} missing ${dotted}`)
  }
  return value
}
