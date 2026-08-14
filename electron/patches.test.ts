import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { resolveDesktopPatchPaths } from './patches.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('desktop capabilities patch enables durable session content search', () => {
  const yaml = readFileSync(join(repoRoot, 'resources', 'desktop-capabilities.cordis.yml'), 'utf8')
  assert.match(yaml, /id: session-query-sqlite/)
  assert.match(yaml, /openAt: first-search/)
  assert.match(yaml, /dshHomePath\('session-query\.sqlite'\)/)
  assert.doesNotMatch(yaml, /openAt: never/)
  assert.doesNotMatch(yaml, /:memory:/)
})

test('resolveDesktopPatchPaths lists brand then capabilities when both exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'inkline-patches-'))
  mkdirSync(join(root, '.cache', 'styling'), { recursive: true })
  mkdirSync(join(root, 'resources'), { recursive: true })
  const brand = join(root, '.cache', 'styling', 'brand.generated.cordis.yml')
  const capabilities = join(root, 'resources', 'desktop-capabilities.cordis.yml')
  writeFileSync(brand, '- insert: []\n')
  writeFileSync(capabilities, '- id: session-query-sqlite\n')

  assert.deepEqual(
    resolveDesktopPatchPaths({ packaged: false, resourcesPath: '/missing', repoRoot: root }),
    [brand, capabilities],
  )
})

test('packaged resolve uses resourcesPath names', () => {
  const resources = mkdtempSync(join(tmpdir(), 'inkline-res-'))
  const brand = join(resources, 'brand.cordis.yml')
  const capabilities = join(resources, 'desktop-capabilities.cordis.yml')
  writeFileSync(brand, 'brand\n')
  writeFileSync(capabilities, 'caps\n')
  assert.deepEqual(
    resolveDesktopPatchPaths({ packaged: true, resourcesPath: resources, repoRoot: '/unused' }),
    [brand, capabilities],
  )
})
