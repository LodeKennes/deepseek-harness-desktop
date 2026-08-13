import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from './workspace.js'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROTATED = 5

export function desktopLogDir(): string {
  return join(resolveDshHome(), 'desktop')
}

export function formatLogLine(message: string): string {
  return `${new Date().toISOString()} ${message}`
}

export function appendLog(name: 'main.log' | 'sidecar.log', message: string): void {
  const dir = desktopLogDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  rotateIfNeeded(path)
  const line = message.endsWith('\n') ? message : `${message}\n`
  appendFileSync(path, line)
}

function rotateIfNeeded(path: string): void {
  if (!existsSync(path)) return
  let size = 0
  try {
    size = statSync(path).size
  } catch {
    return
  }
  if (size < MAX_BYTES) return

  try {
    unlinkSync(`${path}.${MAX_ROTATED}`)
  } catch {
    // no oldest file yet
  }
  for (let i = MAX_ROTATED - 1; i >= 1; i--) {
    try {
      renameSync(`${path}.${i}`, `${path}.${i + 1}`)
    } catch {
      // gap in the rotation chain
    }
  }
  try {
    renameSync(path, `${path}.1`)
  } catch {
    // current file vanished
  }
}
