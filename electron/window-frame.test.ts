import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  titleBarOverlayColors,
  windowChromePageCss,
  windowControlButtonsHtml,
  windowFrameOptions,
} from './window-frame.js'

test('macOS uses inset traffic lights over the page', () => {
  const opts = windowFrameOptions('darwin')
  assert.equal(opts.titleBarStyle, 'hiddenInset')
  assert.deepEqual(opts.trafficLightPosition, { x: 16, y: 18 })
  assert.equal(opts.titleBarOverlay, undefined)
  assert.equal(opts.frame, undefined)
})

test('Windows uses a hidden bar with native overlay caption buttons', () => {
  const opts = windowFrameOptions('win32')
  assert.equal(opts.titleBarStyle, 'hidden')
  assert.equal(opts.titleBarOverlay?.height, 38)
  assert.equal(opts.titleBarOverlay?.color, '#f9fafb')
  assert.equal(opts.titleBarOverlay?.symbolColor, '#0f1115')
  assert.equal(opts.autoHideMenuBar, true)
})

test('Windows overlay colors follow the page scheme', () => {
  const dark = titleBarOverlayColors('dark')
  assert.equal(dark.color, '#1b1b1c')
  assert.equal(dark.symbolColor, '#f9fafb')
  assert.equal(windowFrameOptions('win32', 'dark').titleBarOverlay?.color, '#1b1b1c')
})

test('Linux hides the server bar and ships custom caption buttons', () => {
  const opts = windowFrameOptions('linux')
  assert.equal(opts.titleBarStyle, 'hidden')
  assert.equal(opts.frame, false)
  assert.equal(opts.titleBarOverlay, undefined)
  assert.match(windowControlButtonsHtml(), /data-inkline-window="minimize"/)
  assert.match(windowControlButtonsHtml(), /<svg /)
  assert.match(windowChromePageCss('linux'), /inkline-win-btns \{ display: flex/)
  assert.match(windowChromePageCss('linux'), /padding-right: 140px/)
  assert.match(windowChromePageCss('darwin'), /padding-left: 56px/)
  assert.match(windowChromePageCss('win32'), /right: 140px/)
  assert.doesNotMatch(windowChromePageCss('linux'), /height: 38px; -webkit-app-region: drag/)
})
