import { join, resolve } from 'node:path'

function samePath(a: string, b: string): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Pure picker so tests do not need Electron's documents folder. */
export function pickDefaultWorkspace(
  home: string,
  dshHome: string,
  documents: string | undefined,
): string {
  const lastResort = join(dshHome, 'default-workspace')
  const candidates = [
    // Some Linux XDG setups set DOCUMENTS=$HOME. Do not treat that as Documents.
    documents && !samePath(documents, home) ? join(documents, 'DeepSeek Harness') : undefined,
    join(home, 'Documents', 'DeepSeek Harness'),
    lastResort,
  ]
  for (const dir of candidates) {
    if (dir === undefined || samePath(dir, home) || samePath(dir, dshHome)) continue
    return dir
  }
  return lastResort
}
