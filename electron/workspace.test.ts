import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { pickDefaultWorkspace } from './workspace-pick.js'

test('prefers Documents/DeepSeek Harness when Documents is a real folder', () => {
  const home = '/home/user'
  const dshHome = '/home/user/.dsh'
  const documents = '/home/user/Documents'
  assert.equal(
    pickDefaultWorkspace(home, dshHome, documents),
    join(documents, 'DeepSeek Harness'),
  )
})

test('falls back to ~/Documents when Electron documents path is missing', () => {
  const home = 'C:\\Users\\runneradmin'
  const dshHome = 'C:\\tmp\\dsh'
  assert.equal(
    pickDefaultWorkspace(home, dshHome, undefined),
    join(home, 'Documents', 'DeepSeek Harness'),
  )
})

test('ignores documents when it is $HOME (Linux XDG)', () => {
  const home = '/home/user'
  const dshHome = '/home/user/.dsh'
  assert.equal(
    pickDefaultWorkspace(home, dshHome, home),
    join(home, 'Documents', 'DeepSeek Harness'),
  )
})

test('last resort when the Documents candidate is the DSH home', () => {
  const home = '/home/user'
  const dshHome = join(home, 'Documents', 'DeepSeek Harness')
  assert.equal(
    pickDefaultWorkspace(home, dshHome, undefined),
    join(dshHome, 'default-workspace'),
  )
})
