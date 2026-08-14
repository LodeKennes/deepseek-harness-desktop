import { existsSync } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { loadDesktopStyling } from './brand.js'
import { pickDefaultWorkspace } from './workspace-pick.js'

export { pickDefaultWorkspace } from './workspace-pick.js'

const DSH_HOME_DIR_NAME = '.dsh'
const DSH_HOME_ENV = 'DSH_HOME'

function workspaceReadme(productName: string): string {
  return `This folder is the default workspace for ${productName} Desktop.
The agent uses it as the sandbox default until you choose a workspace in the UI.
`
}

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

function readDocumentsPath(): string | undefined {
  try {
    return app.getPath('documents')
  } catch {
    // GHA Windows (and some redirected profiles) throw
    // "Failed to get 'documents' path". Do not fail desktop startup.
    return undefined
  }
}

export function resolveDefaultWorkspace(): string {
  return pickDefaultWorkspace(homedir(), resolveDshHome(), readDocumentsPath(), {
    productName: loadDesktopStyling().productName,
    exists: existsSync,
  })
}

export async function ensureDefaultWorkspace(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const readme = join(dir, 'README.txt')
  try {
    await access(readme)
  } catch {
    await writeFile(readme, workspaceReadme(loadDesktopStyling().productName), 'utf8')
  }
  return dir
}
