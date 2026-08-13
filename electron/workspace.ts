import { access, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'

const DSH_HOME_DIR_NAME = '.dsh'
const DSH_HOME_ENV = 'DSH_HOME'

const WORKSPACE_README = `This folder is the default workspace for DeepSeek Harness Desktop.
The agent uses it as the sandbox default until you choose a workspace in the UI.
`

export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** Same rules as @deepseek-ai/dsh-home-paths (no harness import). */
export function resolveDshHome(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env[DSH_HOME_ENV]
  const selected =
    configured ??
    (fromEnv !== undefined && fromEnv.trim().length > 0
      ? fromEnv
      : join(homedir(), DSH_HOME_DIR_NAME))
  return resolve(expandHomePath(selected))
}

function samePath(a: string, b: string): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export function resolveDefaultWorkspace(): string {
  const home = homedir()
  const dshHome = resolveDshHome()
  const documents = app.getPath('documents')
  const lastResort = join(dshHome, 'default-workspace')
  const candidates = [
    // Some Linux XDG setups set DOCUMENTS=$HOME. Do not treat that as Documents.
    samePath(documents, home) ? undefined : join(documents, 'DeepSeek Harness'),
    join(home, 'Documents', 'DeepSeek Harness'),
    lastResort,
  ]
  for (const dir of candidates) {
    if (dir === undefined || samePath(dir, home) || samePath(dir, dshHome)) continue
    return dir
  }
  return lastResort
}

export async function ensureDefaultWorkspace(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const readme = join(dir, 'README.txt')
  try {
    await access(readme)
  } catch {
    await writeFile(readme, WORKSPACE_README, 'utf8')
  }
  return dir
}
