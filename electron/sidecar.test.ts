import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sidecarArgv } from './sidecar-argv.js'

test('emits repeated --patch flags in order', () => {
  assert.deepEqual(
    sidecarArgv('/tmp/sidecar-entry.mjs', {
      port: 13800,
      patchPaths: ['/tmp/brand.yml', '/tmp/cliproxy.yml'],
    }),
    [
      '/tmp/sidecar-entry.mjs',
      'web',
      '--patch',
      '/tmp/brand.yml',
      '--patch',
      '/tmp/cliproxy.yml',
      '--host',
      '127.0.0.1',
      '--port',
      '13800',
    ],
  )
})

test('keeps a single patchPath for back-compat', () => {
  assert.deepEqual(
    sidecarArgv('/tmp/sidecar-entry.mjs', { port: 9, patchPath: '/tmp/one.yml' }),
    ['/tmp/sidecar-entry.mjs', 'web', '--patch', '/tmp/one.yml', '--host', '127.0.0.1', '--port', '9'],
  )
})
