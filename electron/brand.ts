import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { loadDesktopStylingFrom, resolveStylingPath, type DesktopStyling } from './styling.js'

export function loadDesktopStyling(): DesktopStyling {
  return loadDesktopStylingFrom(resolveStylingPath({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot: fileURLToPath(new URL('..', import.meta.url)),
  }))
}
