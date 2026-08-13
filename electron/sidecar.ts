import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { buildSidecarEnv } from './env.js'
import { appendLog, formatLogLine } from './logs.js'
import { persistListenPort } from './port.js'
import { resolveDshHome } from './workspace.js'

const READY_RE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/
export const DEFAULT_READY_TIMEOUT_MS = 60_000
export const FIRST_HEAL_READY_TIMEOUT_MS = 180_000
const STOP_TIMEOUT_MS = 6_000
const STDERR_TAIL = 80

export interface SidecarHandle {
  url: URL
  port: number
  child: ChildProcess
  readonly stderrTail: readonly string[]
  stop(timeoutMs?: number): Promise<void>
}

export class SidecarError extends Error {
  readonly stderrTail: readonly string[]

  constructor(message: string, stderrTail: readonly string[] = []) {
    super(message)
    this.name = 'SidecarError'
    this.stderrTail = stderrTail
  }
}

let activeStop: ((timeoutMs?: number) => Promise<void>) | null = null

export function resolveHarnessRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'harness')
  return join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'runtime')
}

export function resolveSpawnHelperPath(harnessRoot: string): string | undefined {
  const candidates = [
    join(harnessRoot, 'node', 'bin', 'node-spawn-helper'),
    join(harnessRoot, 'node', 'node-spawn-helper'),
  ]
  return candidates.find((path) => existsSync(path))
}

export function resolveReadyTimeoutMs(dshHome = resolveDshHome()): number {
  const dir = join(dshHome, 'profiles', 'node_modules')
  try {
    if (readdirSync(dir).length === 0) return FIRST_HEAL_READY_TIMEOUT_MS
    return DEFAULT_READY_TIMEOUT_MS
  } catch {
    return FIRST_HEAL_READY_TIMEOUT_MS
  }
}

export async function stopActiveSidecar(timeoutMs?: number): Promise<void> {
  if (activeStop) await activeStop(timeoutMs)
}

export async function startSidecar(opts: {
  harnessRoot: string
  workspaceDir: string
  port: number
  readyTimeoutMs?: number
}): Promise<SidecarHandle> {
  const node =
    process.platform === 'win32'
      ? join(opts.harnessRoot, 'node', 'node.exe')
      : join(opts.harnessRoot, 'node', 'bin', 'node')
  const entry = join(opts.harnessRoot, 'sidecar-entry.mjs')
  if (!existsSync(node) || !existsSync(entry)) {
    throw new SidecarError(
      `Staged harness not found at ${opts.harnessRoot} (missing node or sidecar-entry.mjs). Run ./scripts/stage-runtime.sh`,
    )
  }

  const spawnHelperPath = resolveSpawnHelperPath(opts.harnessRoot)
  const env = buildSidecarEnv({ harnessRoot: opts.harnessRoot, spawnHelperPath })
  const argv = [entry, 'web', '--host', '127.0.0.1', '--port', String(opts.port)]
  appendLog(
    'main.log',
    formatLogLine(`spawn ${node} ${argv.join(' ')} cwd=${opts.workspaceDir} port=${opts.port}`),
  )

  const spawnedAt = Date.now()
  const child = spawn(node, argv, {
    cwd: opts.workspaceDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const stderrTail: string[] = []
  const stop = createStopper(child)
  activeStop = stop

  try {
    const url = await waitForReady(child, stderrTail, opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    const port = Number(url.port)
    try {
      await persistListenPort(port)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendLog('main.log', formatLogLine(`persist listen-port failed: ${message}`))
    }
    const elapsed = Date.now() - spawnedAt
    appendLog('main.log', formatLogLine(`heal elapsed ${elapsed}ms url=${url.href} port=${port}`))
    return { url, port, child, stderrTail, stop }
  } catch (err) {
    await stop()
    throw err
  }
}

function createStopper(child: ChildProcess): (timeoutMs?: number) => Promise<void> {
  let stopping: Promise<void> | undefined
  return (timeoutMs = STOP_TIMEOUT_MS) => {
    if (!stopping) stopping = quitChild(child, timeoutMs)
    return stopping
  }
}

async function quitChild(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (activeStop) activeStop = null
    return
  }

  try {
    child.stdin?.write('quit\n')
  } catch {
    child.kill()
  }

  const exited = await waitForExit(child, timeoutMs)
  if (!exited) {
    child.kill()
    await waitForExit(child, 1000)
  }
  if (activeStop) activeStop = null
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, ms)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function waitForReady(
  child: ChildProcess,
  stderrTail: string[],
  timeoutMs: number,
): Promise<URL> {
  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() =>
        reject(new SidecarError(`sidecar ready timeout after ${timeoutMs}ms`, stderrTail.slice())),
      )
    }, timeoutMs)

    const onError = (err: Error) => {
      finish(() => reject(new SidecarError(`sidecar spawn failed: ${err.message}`, stderrTail.slice())))
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() =>
        reject(
          new SidecarError(
            `sidecar exited before ready (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
            stderrTail.slice(),
          ),
        ),
      )
    }

    child.once('error', onError)
    child.once('exit', onExit)

    onLines(child.stdout, (line) => {
      appendLog('sidecar.log', formatLogLine(line))
      const match = READY_RE.exec(line)
      if (!match) return
      finish(() => resolve(new URL(match[1])))
    })
    onLines(child.stderr, (line) => {
      stderrTail.push(line)
      if (stderrTail.length > STDERR_TAIL) stderrTail.splice(0, stderrTail.length - STDERR_TAIL)
      appendLog('sidecar.log', formatLogLine(line))
    })
  })
}

function onLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return
  let buf = ''
  stream.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let idx = buf.indexOf('\n')
    while (idx !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      onLine(line)
      idx = buf.indexOf('\n')
    }
  })
  stream.on('end', () => {
    if (buf.length === 0) return
    onLine(buf.replace(/\r$/, ''))
    buf = ''
  })
}
