import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UI_FONT_FAMILY, uiFontFace } from './ui-font.js'

test('shell pages use the system UI face, not a branded webfont', () => {
  assert.match(UI_FONT_FAMILY, /system-ui/)
  assert.doesNotMatch(UI_FONT_FAMILY, /Inter|Archivo/)
  assert.equal(uiFontFace(), '')
})
