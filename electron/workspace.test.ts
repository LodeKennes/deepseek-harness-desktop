import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_WORKSPACE_FOLDER, pickDefaultWorkspace } from './workspace-pick.js'

const product = { productName: LEGACY_WORKSPACE_FOLDER }

test('prefers Documents/DeepSeek Harness when Documents is a real folder', () => {
  const home = '/home/user'
  const dshHome = '/home/user/.dsh'
  const documents = '/home/user/Documents'
  assert.equal(
    pickDefaultWorkspace(home, dshHome, documents, product),
    join(documents, LEGACY_WORKSPACE_FOLDER),
  )
})

test('falls back to ~/Documents when Electron documents path is missing', () => {
  const home = 'C:\\Users\\runneradmin'
  const dshHome = 'C:\\tmp\\dsh'
  assert.equal(
    pickDefaultWorkspace(home, dshHome, undefined, product),
    join(home, 'Documents', LEGACY_WORKSPACE_FOLDER),
  )
})

test('ignores documents when it is $HOME (Linux XDG)', () => {
  const home = '/home/user'
  const dshHome = '/home/user/.dsh'
  assert.equal(
    pickDefaultWorkspace(home, dshHome, home, product),
    join(home, 'Documents', LEGACY_WORKSPACE_FOLDER),
  )
})

test('last resort when the Documents candidate is the DSH home', () => {
  const home = '/home/user'
  const dshHome = join(home, 'Documents', LEGACY_WORKSPACE_FOLDER)
  assert.equal(
    pickDefaultWorkspace(home, dshHome, undefined, product),
    join(dshHome, 'default-workspace'),
  )
})

test('keeps an existing legacy folder after a product rename', () => {
  const home = '/home/user'
  const dshHome = '/home/user/.dsh'
  const documents = '/home/user/Documents'
  const legacy = join(documents, LEGACY_WORKSPACE_FOLDER)
  assert.equal(
    pickDefaultWorkspace(home, dshHome, documents, {
      productName: 'Acme Harness',
      exists: (path) => path === legacy,
    }),
    legacy,
  )
})

test('uses the new product folder for new installs', () => {
  const home = '/home/user'
  const dshHome = '/home/user/.dsh'
  const documents = '/home/user/Documents'
  assert.equal(
    pickDefaultWorkspace(home, dshHome, documents, {
      productName: 'Acme Harness',
      exists: () => false,
    }),
    join(documents, 'Acme Harness'),
  )
})
