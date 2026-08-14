import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface DesktopPatchPathOptions {
  readonly packaged: boolean
  readonly resourcesPath: string
  readonly repoRoot: string
}

/** Brand overlay first, then desktop capability overrides. Missing files are skipped. */
export function resolveDesktopPatchPaths(opts: DesktopPatchPathOptions): string[] {
  const brand = opts.packaged
    ? join(opts.resourcesPath, 'brand.cordis.yml')
    : join(opts.repoRoot, '.cache', 'styling', 'brand.generated.cordis.yml')
  const capabilities = opts.packaged
    ? join(opts.resourcesPath, 'desktop-capabilities.cordis.yml')
    : join(opts.repoRoot, 'resources', 'desktop-capabilities.cordis.yml')
  return [brand, capabilities].filter((path) => existsSync(path))
}
