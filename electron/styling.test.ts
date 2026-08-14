import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDesktopStyling } from './styling.js'

test('parses required brand fields', () => {
  const styling = parseDesktopStyling({
    productName: 'Acme Harness',
    productNameSafe: 'Acme-Harness',
    desktopName: 'acme-harness',
    appId: 'ai.deepseek.harness.desktop',
    bootWordmark: 'ACME',
  })
  assert.equal(styling.productName, 'Acme Harness')
  assert.equal(styling.productNameSafe, 'Acme-Harness')
  assert.equal(styling.bootWordmark, 'ACME')
})

test('rejects a spaced productNameSafe', () => {
  assert.throws(
    () => parseDesktopStyling({
      productName: 'Acme Harness',
      productNameSafe: 'Acme Harness',
      desktopName: 'acme-harness',
      appId: 'com.acme.harness',
    }),
    /productNameSafe/,
  )
})
