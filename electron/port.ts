import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { resolveDshHome } from './workspace.js'

export const DEFAULT_LISTEN_PORT = 13800
export const LISTEN_PORT_RANGE_END = 13832

export function listenPortPath(): string {
  return join(resolveDshHome(), 'desktop', 'listen-port')
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((err) => resolve(err === undefined || err === null))
    })
  })
}

function parseListenPort(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(n) || n < 0 || n > 65535) return undefined
  return n
}

export async function pickListenPort(): Promise<number> {
  let preferred = DEFAULT_LISTEN_PORT
  try {
    const parsed = parseListenPort(await readFile(listenPortPath(), 'utf8'))
    if (parsed !== undefined && parsed > 0) preferred = parsed
  } catch {
    // Absent or unreadable → start at 13800.
  }

  if (await probePort(preferred)) return preferred

  for (let port = DEFAULT_LISTEN_PORT + 1; port <= LISTEN_PORT_RANGE_END; port++) {
    if (port === preferred) continue
    if (await probePort(port)) return port
  }
  return 0
}

export async function persistListenPort(port: number): Promise<void> {
  const path = listenPortPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${port}\n`, 'utf8')
}
