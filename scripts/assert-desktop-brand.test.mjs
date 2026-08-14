import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'assert-desktop-brand.mjs')

test('resolves a staged desktop-brand package from the stage directory', () => {
  const stage = mkdtempSync(join(tmpdir(), 'desktop-brand-'))
  mkdirSync(join(stage, 'node_modules', 'desktop-brand', 'lib'), { recursive: true })
  writeFileSync(join(stage, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    type: 'module',
    dependencies: { 'desktop-brand': '0.0.0' },
  }))
  writeFileSync(join(stage, 'node_modules', 'desktop-brand', 'package.json'), JSON.stringify({
    name: 'desktop-brand',
    type: 'module',
    main: 'lib/index.js',
  }))
  writeFileSync(join(stage, 'node_modules', 'desktop-brand', 'lib', 'index.js'), 'export function apply() {}\n')

  const result = spawnSync(process.execPath, [script, stage], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /assert-desktop-brand:/)
  assert.match(result.stdout, /desktop-brand/)
})

test('fails when the staged package is absent', () => {
  const stage = mkdtempSync(join(tmpdir(), 'desktop-brand-missing-'))
  writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh' }))
  const result = spawnSync(process.execPath, [script, stage], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /desktop-brand missing/)
})
