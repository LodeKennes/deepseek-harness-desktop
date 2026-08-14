import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const UI_FONT_FAMILY = 'Inter, system-ui, sans-serif'

export function uiFontFace(): string {
  try {
    const font = readFileSync(fileURLToPath(new URL('../styling/fonts/inter-latin-variable.woff2', import.meta.url)))
    return `@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2')}`
  } catch {
    return ''
  }
}
