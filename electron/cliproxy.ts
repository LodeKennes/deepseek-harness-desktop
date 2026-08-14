import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import {
  renderCLIProxyConfig,
  renderHarnessProxyPatch,
  type CLIProxyModel,
} from './cliproxy-config.js'
import { appendLog, formatLogLine } from './logs.js'
import { pickListenPort } from './port.js'
import type { SubscriptionProviderId } from './subscription-demo.js'
import { resolveDshHome } from './workspace.js'

const READY_TIMEOUT_MS = 20_000
const OAUTH_TIMEOUT_MS = 5 * 60_000
const PROVIDER_TYPES: Readonly<Record<SubscriptionProviderId, readonly string[]>> = {
  codex: ['codex'],
  claude: ['claude', 'anthropic'],
  antigravity: ['antigravity'],
}
const AUTH_ENDPOINTS: Readonly<Record<SubscriptionProviderId, string>> = {
  codex: 'codex-auth-url',
  claude: 'anthropic-auth-url',
  antigravity: 'antigravity-auth-url',
}

export interface CLIProxyConnection {
  readonly provider: SubscriptionProviderId
  readonly account: string
  readonly files: readonly string[]
  readonly models: readonly CLIProxyModel[]
}

export interface CLIProxyHandle {
  readonly child: ChildProcess
  readonly origin: string
  readonly apiKey: string
  readonly managementKey: string
  readonly configPath: string
  stop(): Promise<void>
}

interface AuthFile {
  readonly name?: unknown
  readonly provider?: unknown
  readonly type?: unknown
  readonly email?: unknown
  readonly account?: unknown
  readonly project_id?: unknown
}

interface AuthFilesResponse {
  readonly files?: unknown
}

interface OAuthStartResponse {
  readonly url?: unknown
  readonly state?: unknown
}

interface OAuthStatusResponse {
  readonly status?: unknown
  readonly error?: unknown
}

interface ModelsResponse {
  readonly models?: unknown
}

export async function startCLIProxy(): Promise<CLIProxyHandle> {
  const binary = resolveCLIProxyBinary()
  const root = join(resolveDshHome(), 'desktop', 'cliproxyapi')
  const authDir = join(root, 'auth')
  const configPath = join(root, 'config.yaml')
  const port = await pickListenPort()
  const apiKey = `dsh-${randomBytes(18).toString('hex')}`
  const managementKey = randomBytes(24).toString('hex')

  await mkdir(authDir, { recursive: true, mode: 0o700 })
  await writeFile(configPath, renderCLIProxyConfig({ port, authDir, apiKey, managementKey }), {
    encoding: 'utf8',
    mode: 0o600,
  })
  await chmod(configPath, 0o600)

  const args = ['-config', configPath, '-local-model']
  appendLog('main.log', formatLogLine(`spawn CLIProxyAPI ${binary} ${args.join(' ')}`))
  const child = spawn(binary, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  pipeLog(child.stdout, 'stdout')
  pipeLog(child.stderr, 'stderr')

  const handle: CLIProxyHandle = {
    child,
    origin: `http://127.0.0.1:${port}`,
    apiKey,
    managementKey,
    configPath,
    stop: () => stopChild(child),
  }

  try {
    await waitUntilReady(handle)
    return handle
  } catch (err) {
    await handle.stop()
    throw err
  }
}

export async function beginCLIProxyOAuth(
  handle: CLIProxyHandle,
  provider: SubscriptionProviderId,
): Promise<{ readonly url: string; readonly state: string }> {
  const response = await managementRequest<OAuthStartResponse>(
    handle,
    `/${AUTH_ENDPOINTS[provider]}?is_webui=true`,
  )
  if (typeof response.url !== 'string' || typeof response.state !== 'string') {
    throw new Error('CLIProxyAPI returned an invalid OAuth session')
  }
  return { url: response.url, state: response.state }
}

export async function waitForCLIProxyOAuth(handle: CLIProxyHandle, state: string): Promise<void> {
  const deadline = Date.now() + OAUTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(1000)
    const response = await managementRequest<OAuthStatusResponse>(
      handle,
      `/get-auth-status?state=${encodeURIComponent(state)}`,
    )
    if (response.status === 'ok') return
    if (response.status === 'error') {
      throw new Error(typeof response.error === 'string' ? response.error : 'Authentication failed')
    }
  }
  throw new Error('Authentication timed out')
}

export async function listCLIProxyConnections(
  handle: CLIProxyHandle,
): Promise<readonly CLIProxyConnection[]> {
  const response = await managementRequest<AuthFilesResponse>(handle, '/auth-files')
  const files = Array.isArray(response.files) ? response.files as AuthFile[] : []
  const results: CLIProxyConnection[] = []

  for (const provider of Object.keys(PROVIDER_TYPES) as SubscriptionProviderId[]) {
    const matches = files.filter((file) => {
      const type = stringValue(file.provider) || stringValue(file.type)
      return PROVIDER_TYPES[provider].includes(type.toLowerCase())
    })
    if (matches.length === 0) continue

    const names = matches.map((file) => stringValue(file.name)).filter(Boolean)
    const models = await modelsForFiles(handle, names)
    const first = matches[0]
    const account = stringValue(first.email)
      || stringValue(first.account)
      || stringValue(first.project_id)
      || `${matches.length} connected account${matches.length === 1 ? '' : 's'}`
    results.push({ provider, account, files: names, models })
  }
  return results
}

export async function disconnectCLIProxyProvider(
  handle: CLIProxyHandle,
  connection: CLIProxyConnection,
): Promise<void> {
  for (const name of connection.files) {
    await managementRequest(handle, `/auth-files?name=${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
  }
}

export async function writeHarnessProxyPatch(
  handle: CLIProxyHandle,
  connections: readonly CLIProxyConnection[],
): Promise<string | undefined> {
  const models = uniqueModels(connections.flatMap((connection) => connection.models))
  if (models.length === 0) return undefined
  const path = join(resolveDshHome(), 'desktop', 'cliproxyapi.cordis.yml')
  await writeFile(path, renderHarnessProxyPatch(`${handle.origin}/v1`, models), 'utf8')
  return path
}

function resolveCLIProxyBinary(): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'cliproxyapi')
    : join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'cliproxyapi')
  return join(root, process.platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api')
}

async function modelsForFiles(
  handle: CLIProxyHandle,
  names: readonly string[],
): Promise<readonly CLIProxyModel[]> {
  const models: CLIProxyModel[] = []
  for (const name of names) {
    const response = await managementRequest<ModelsResponse>(
      handle,
      `/auth-files/models?name=${encodeURIComponent(name)}`,
    )
    if (!Array.isArray(response.models)) continue
    for (const raw of response.models) {
      const value = raw as { id?: unknown; display_name?: unknown }
      const id = stringValue(value.id)
      if (!id) continue
      const displayName = stringValue(value.display_name)
      models.push({ id, ...(displayName ? { name: displayName } : {}) })
    }
  }
  return uniqueModels(models)
}

function uniqueModels(models: readonly CLIProxyModel[]): CLIProxyModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

async function managementRequest<T = unknown>(
  handle: CLIProxyHandle,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${handle.origin}/v0/management${path}`, {
    ...init,
    headers: { 'X-Management-Key': handle.managementKey, ...init.headers },
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.text()
  if (!response.ok) {
    let message = body
    try {
      const parsed = JSON.parse(body) as { error?: unknown }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      // Keep the response text.
    }
    throw new Error(`CLIProxyAPI ${response.status}: ${message || response.statusText}`)
  }
  return (body ? JSON.parse(body) : {}) as T
}

async function waitUntilReady(handle: CLIProxyHandle): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) throw new Error('CLIProxyAPI exited before becoming ready')
    try {
      await managementRequest(handle, '/config')
      return
    } catch {
      await delay(250)
    }
  }
  throw new Error('CLIProxyAPI did not become ready')
}

function pipeLog(stream: NodeJS.ReadableStream | null, source: string): void {
  stream?.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      if (line) appendLog('main.log', formatLogLine(`cliproxy ${source}: ${line}`))
    }
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(5000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') child.kill()
        else child.kill('SIGKILL')
      }
    }),
  ])
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
