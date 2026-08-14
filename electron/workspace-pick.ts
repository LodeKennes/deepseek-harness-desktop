import { join, resolve } from 'node:path'

export const LEGACY_WORKSPACE_FOLDER = 'DeepSeek Harness'

function samePath(a: string, b: string): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export interface WorkspacePickOptions {
  readonly productName: string
  readonly exists?: (path: string) => boolean
}

/** Pure picker so tests do not need Electron's documents folder. */
export function pickDefaultWorkspace(
  home: string,
  dshHome: string,
  documents: string | undefined,
  options: WorkspacePickOptions,
): string {
  const lastResort = join(dshHome, 'default-workspace')
  const exists = options.exists ?? (() => false)
  const documentRoots: string[] = []
  if (documents && !samePath(documents, home)) documentRoots.push(documents)
  documentRoots.push(join(home, 'Documents'))

  const legacy: string[] = []
  const next: string[] = []
  for (const root of documentRoots) {
    legacy.push(join(root, LEGACY_WORKSPACE_FOLDER))
    if (options.productName !== LEGACY_WORKSPACE_FOLDER) {
      next.push(join(root, options.productName))
    }
  }

  for (const dir of legacy) {
    if (samePath(dir, home) || samePath(dir, dshHome)) continue
    if (exists(dir)) return dir
  }
  for (const dir of next) {
    if (samePath(dir, home) || samePath(dir, dshHome)) continue
    return dir
  }
  if (options.productName === LEGACY_WORKSPACE_FOLDER) {
    for (const dir of legacy) {
      if (samePath(dir, home) || samePath(dir, dshHome)) continue
      return dir
    }
  }
  return lastResort
}
