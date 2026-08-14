import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  APPROOT_WORDMARK_NEEDLE,
  COLOR_TOKEN_NAMES,
  INDEX_TITLE_NEEDLE,
  OVERLAY_FILE_BUDGET,
  applyOverlayToClone,
  generateBrandYaml,
  generateClientPlugin,
  generateHostPlugin,
  generateIconTsx,
  generateOnboardingCopy,
  generateTextWordmarkSvg,
  hashStylingInputs,
  parseStyling,
  parseSvgMeta,
  loadStyling,
  planFontOverlays,
  planOverlay,
  svgInnerToJsx,
} from './lib/styling.mjs'

const base = {
  productName: 'Acme Harness',
  productNameSafe: 'Acme-Harness',
  desktopName: 'acme-harness',
  appId: 'ai.deepseek.harness.desktop',
}

test('rejects a spaced productNameSafe', () => {
  assert.throws(
    () => parseStyling({ ...base, productNameSafe: 'Acme Harness' }),
    /productNameSafe must not contain spaces/,
  )
})

test('rejects unknown asset keys', () => {
  assert.throws(
    () => parseStyling({ ...base, assets: { iconsDir: 'resources/icons' } }),
    /unknown assets keys/,
  )
})

test('rejects unknown color keys and incomplete pairs', () => {
  assert.throws(
    () => parseStyling({ ...base, colors: { accent: { light: '#000', dark: '#fff' } } }),
    /unknown colors keys/,
  )
  assert.throws(
    () => parseStyling({ ...base, colors: { brandPrimary: { light: '#000' } } }),
    /light and dark/,
  )
})

test('maps friendly colors and extra tokens', () => {
  const styling = parseStyling({
    ...base,
    colors: {
      brandPrimary: { light: '#111', dark: '#eee' },
    },
    tokens: {
      '--dsw-font-family': { light: 'Inter', dark: 'Inter' },
    },
  })
  assert.equal(styling.tokens[COLOR_TOKEN_NAMES.brandPrimary].light, '#111')
  assert.equal(styling.tokens['--dsw-font-family'].dark, 'Inter')
})

test('font overlay ships Inter and not Archivo', () => {
  const files = planFontOverlays(join(dirname(fileURLToPath(import.meta.url)), '..'))
  assert.ok(files.some((file) => file.rel.endsWith('inter-latin-variable.woff2')))
  assert.ok(files.some((file) => file.rel.endsWith('inter-latin-italic-variable.woff2')))
  assert.equal(files.some((file) => /archivo/i.test(file.rel)), false)
})

test('plans at most the overlay budget and always includes brand leaves', () => {
  const files = planOverlay(parseStyling({
    ...base,
    welcome: {
      en: { title: 'Hi', body: 'Hello', continueLabel: 'Go' },
      zh: { title: '你好', body: '欢迎', continueLabel: '继续' },
    },
  }), {})
  assert.ok(files.length <= OVERLAY_FILE_BUDGET)
  assert.ok(files.some((file) => file.rel.endsWith('BrandWordmark.tsx')))
  assert.ok(files.some((file) => file.rel.endsWith('FishLogo.tsx')))
  assert.ok(files.some((file) => file.rel.endsWith('onboarding-copy.ts')))
  assert.match(files.find((file) => file.rel.endsWith('BrandWordmark.tsx')).contents, /export function BrandWordmark/)
})

test('converts SVG attributes to JSX and keeps viewBox', () => {
  const svg = '<svg viewBox="0 0 10 5"><path class="x" clip-path="url(#a)" fill-rule="evenodd"/></svg>'
  const meta = parseSvgMeta(svg)
  assert.equal(meta.width, 10)
  assert.equal(meta.height, 5)
  assert.match(svgInnerToJsx(meta.inner), /className="x"/)
  assert.match(svgInnerToJsx(meta.inner), /clipPath=/)
  assert.match(svgInnerToJsx(meta.inner), /fillRule=/)
  const tsx = generateIconTsx({
    exportName: 'BrandWordmark',
    sizeIsHeight: true,
    defaultSize: 24,
    svg: generateTextWordmarkSvg('Acme Harness'),
  })
  assert.match(tsx, /export function BrandWordmark/)
  assert.match(tsx, /viewBox="0 0 182 24"/)
  assert.match(tsx, /Acme Harness/)
})

test('host plugin fails loud on the title needle and styles body not html', () => {
  const host = generateHostPlugin(parseStyling({
    ...base,
    colors: { brandPrimary: { light: '#111', dark: '#eee' } },
  }), '@font-face{font-family:Inter}')
  assert.match(host, new RegExp(INDEX_TITLE_NEEDLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(host, /body \{/)
  assert.match(host, /body\[data-ds-dark-theme\]/)
  assert.match(host, /Inter/)
  assert.doesNotMatch(host, /html \{/)
})

test('generated host plugin carries the shipped Inter chrome, not Archivo', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const extra = readFileSync(join(repoRoot, 'styling', 'chrome.css'), 'utf8')
  const host = generateHostPlugin(loadStyling(repoRoot), extra)
  assert.match(host, /Inter/)
  assert.match(host, /inter-latin-variable\.woff2/)
  assert.match(host, /--dsw-font-family/)
  assert.doesNotMatch(host, /Archivo/)
  assert.doesNotMatch(host, /archivo-latin-static/)
})

test('host plugin integrates window chrome into existing sidebar and header', () => {
  const host = generateHostPlugin(parseStyling(base))
  assert.match(host, /data-inkline-chrome/)
  assert.match(host, /inkline-drag/)
  assert.match(host, /data-inkline-window="minimize"/)
  assert.match(host, /\[class\*="logoRow"\]/)
  assert.match(host, /\[class\*="titleRow"\]/)
  assert.match(host, /height:12px/)
  assert.doesNotMatch(host, /\[class\*="frame"\]\{padding-top/)
})

test('client plugin is factory-form ModuleLoader JS', () => {
  const client = generateClientPlugin(parseStyling({
    ...base,
    colors: { brandPrimary: { light: '#111', dark: '#eee' } },
  }))
  assert.match(client, /window\.__ModuleLoader__\.load/)
  assert.match(client, /id: "desktop-brand"/)
  assert.match(client, /overrideTokens\("desktop-brand"/)
})

test('brand YAML is a root-level insert with quoted productName', () => {
  const yaml = generateBrandYaml(parseStyling({
    ...base,
    colors: { brandPrimary: { light: '#111', dark: '#eee' } },
  }))
  assert.match(yaml, /^- insert:/)
  assert.match(yaml, /productName: "Acme Harness"/)
  assert.match(yaml, /tokens:\n {10}"--dsw-alias-brand-primary":\n {12}light: "#111"/)
  assert.doesNotMatch(yaml, /id: web-app/)
})

test('welcome overlay keeps locales import surface', () => {
  const source = generateOnboardingCopy({
    en: { title: 'Hi', body: 'Hello', continueLabel: 'Go' },
    zh: { title: '你好', body: '欢迎', continueLabel: '继续' },
  })
  assert.match(source, /export const WELCOME_NOTICE_COPY/)
  assert.match(source, /export const WELCOME_NOTICE_VERSION/)
  assert.match(source, /continueLabel: "Go"/)
})

test('applyOverlayToClone refuses a missing AppRoot needle', () => {
  const root = mkdtempSync(join(tmpdir(), 'styling-'))
  const rel = 'packages/client/web/src/AppRoot.tsx'
  mkdirSync(join(root, 'packages/client/web/src'), { recursive: true })
  writeFileSync(join(root, rel), 'export function AppRoot() { return null }\n')
  assert.throws(() => applyOverlayToClone(root, [], 'ACME'), /lost HARNESS needle/)
})

test('applyOverlayToClone patches the boot plate and copies marked files', () => {
  const root = mkdtempSync(join(tmpdir(), 'styling-'))
  const appRoot = 'packages/client/web/src/AppRoot.tsx'
  const wordmark = 'packages/client/ui-primitives/src/BrandWordmark.tsx'
  mkdirSync(join(root, 'packages/client/web/src'), { recursive: true })
  mkdirSync(join(root, 'packages/client/ui-primitives/src'), { recursive: true })
  writeFileSync(join(root, appRoot), `        ${APPROOT_WORDMARK_NEEDLE}\n`)
  writeFileSync(join(root, wordmark), 'export function BrandWordmark() { return null }\n')
  const files = [{
    rel: wordmark,
    contents: 'export function BrandWordmark() { return <svg /> }\n',
    marker: 'export function BrandWordmark',
  }]
  applyOverlayToClone(root, files, 'ACME')
  const patched = readUtf(join(root, appRoot))
  assert.match(patched, /ACME/)
  assert.doesNotMatch(patched, /HARNESS/)
  assert.match(readUtf(join(root, wordmark)), /<svg/)
})

test('hash changes when an asset changes', () => {
  const styling = parseStyling(base)
  const a = hashStylingInputs(styling, ['aaa'])
  const b = hashStylingInputs(styling, ['bbb'])
  assert.notEqual(a, b)
})

function readUtf(path) {
  return readFileSync(path, 'utf8')
}
