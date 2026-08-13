import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSidecarEnv } from './env.js'

const harnessRoot = join('/opt', 'harness')

test('drops ELECTRON_* and NODE_OPTIONS even when present on the source env', () => {
  const env = buildSidecarEnv({
    harnessRoot,
    source: {
      HOME: '/home/user',
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ASAR: '1',
      NODE_OPTIONS: '--require ./evil.js',
      DSH_HOME: '/custom/dsh',
      DEEPSEEK_API_KEY: 'sk-ds',
      OPENAI_API_KEY: 'sk-test',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
      XDG_RUNTIME_DIR: '/run/user/1000',
    },
  })

  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.ELECTRON_NO_ASAR, undefined)
  assert.equal(env.NODE_OPTIONS, undefined)
  assert.equal(Object.hasOwn(env, 'ELECTRON_RUN_AS_NODE'), false)
  assert.equal(Object.hasOwn(env, 'ELECTRON_NO_ASAR'), false)
  assert.equal(Object.hasOwn(env, 'NODE_OPTIONS'), false)

  assert.equal(env.HOME, '/home/user')
  assert.equal(env.DSH_HOME, '/custom/dsh')
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-ds')
  assert.equal(env.OPENAI_API_KEY, 'sk-test')
  assert.equal(env.LANG, 'en_US.UTF-8')
  assert.equal(env.LC_ALL, 'C')
  assert.equal(env.XDG_RUNTIME_DIR, '/run/user/1000')
})

test('does not spread process.env (ELECTRON_* and NODE_OPTIONS stay dropped)', () => {
  const prevElectron = process.env.ELECTRON_RUN_AS_NODE
  const prevNodeOptions = process.env.NODE_OPTIONS
  process.env.ELECTRON_RUN_AS_NODE = '1'
  process.env.NODE_OPTIONS = '--inspect'
  try {
    const env = buildSidecarEnv({ harnessRoot })
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(env.NODE_OPTIONS, undefined)
    assert.equal(Object.hasOwn(env, 'ELECTRON_RUN_AS_NODE'), false)
    assert.equal(Object.hasOwn(env, 'NODE_OPTIONS'), false)
  } finally {
    if (prevElectron === undefined) delete process.env.ELECTRON_RUN_AS_NODE
    else process.env.ELECTRON_RUN_AS_NODE = prevElectron
    if (prevNodeOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = prevNodeOptions
  }
})

test('rebuilds PATH as harness node + harness bin + inherited PATH', () => {
  const env = buildSidecarEnv({
    harnessRoot,
    source: { PATH: '/usr/bin' },
  })
  const nodeDir =
    process.platform === 'win32' ? join(harnessRoot, 'node') : join(harnessRoot, 'node', 'bin')
  const harnessBin = join(harnessRoot, 'bin')
  const sep = process.platform === 'win32' ? ';' : ':'
  assert.equal(env.PATH, [nodeDir, harnessBin, '/usr/bin'].join(sep))
})

test('sets DSH_NODE_PTY_SPAWN_HELPER only when a helper path is provided', () => {
  const without = buildSidecarEnv({ harnessRoot, source: {} })
  assert.equal(without.DSH_NODE_PTY_SPAWN_HELPER, undefined)

  const helper = join(harnessRoot, 'node', 'bin', 'node-spawn-helper')
  const withHelper = buildSidecarEnv({ harnessRoot, spawnHelperPath: helper, source: {} })
  assert.equal(withHelper.DSH_NODE_PTY_SPAWN_HELPER, helper)
})
