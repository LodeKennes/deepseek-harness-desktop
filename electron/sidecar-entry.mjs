#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

let imported = false
let pendingShutdown = false
let shutdownEmitted = false
let parentWatch

// Snapshot once. Linux reparents to pid 1 after the parent dies; a live
// process.ppid read would then succeed forever.
const parent = process.ppid

function requestShutdown() {
  if (shutdownEmitted) return
  if (!imported) {
    pendingShutdown = true
    return
  }
  shutdownEmitted = true
  if (parentWatch !== undefined) {
    clearInterval(parentWatch)
    parentWatch = undefined
  }
  const handled = process.emit('SIGTERM')
  if (!handled) process.exit(0)
}

const binUrl = new URL('./lib/bin.js', import.meta.url)
process.argv = [process.argv[0], fileURLToPath(binUrl), ...process.argv.slice(2)]

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === 'quit') requestShutdown()
})
// stdin EOF is the primary portable orphan path (Electron pipe close).
rl.on('close', () => {
  requestShutdown()
})

if (parent > 0) {
  parentWatch = setInterval(() => {
    try {
      process.kill(parent, 0)
    } catch (err) {
      if (err && err.code === 'ESRCH') requestShutdown()
    }
  }, 1000)
  parentWatch.unref()
}

imported = true
if (pendingShutdown) requestShutdown()
await import('./lib/bin.js')
