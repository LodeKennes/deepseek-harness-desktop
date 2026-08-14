import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UI_FONT_FAMILY, uiFontFace } from './ui-font.js'

test('embeds Inter from the shipped variable file, never Archivo', () => {
  const css = uiFontFace()
  assert.match(css, /font-family:Inter/)
  assert.match(css, /data:font\/woff2;base64,/)
  assert.doesNotMatch(css, /Archivo/)
  assert.match(UI_FONT_FAMILY, /^Inter,/)
  assert.doesNotMatch(UI_FONT_FAMILY, /Archivo/)
})
