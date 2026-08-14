import type { ChildProcess } from 'node:child_process'
import { app, BrowserWindow, Menu } from 'electron'
import { appendLog, formatLogLine } from './logs.js'
import {
  SidecarError,
  resolveHarnessRoot,
  resolveReadyTimeoutMs,
  startSidecar,
  stopActiveSidecar,
  type SidecarHandle,
} from './sidecar.js'
import { pickListenPort } from './port.js'
import {
  createSubscriptionDemoState,
  setSubscriptionStatus,
  type SubscriptionDemoAction,
  type SubscriptionDemoState,
  type SubscriptionProviderId,
} from './subscription-demo.js'
import {
  createMainWindow,
  loadSidecar,
  showErrorPage,
  showStatusPage,
  showSubscriptionDemo,
} from './window.js'
import { ensureDefaultWorkspace, resolveDefaultWorkspace } from './workspace.js'

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarHandle | null = null
let quitting = false
let starting = false
let subscriptionDemoVisible = false
let subscriptionDemoState: SubscriptionDemoState = createSubscriptionDemoState()
const expectedExits = new WeakSet<ChildProcess>()
const connectionTimers = new Map<SubscriptionProviderId, ReturnType<typeof setTimeout>>()

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.setName('DeepSeek Harness')
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(() => {
    installMenu()
    launch()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    for (const timer of connectionTimers.values()) clearTimeout(timer)
    connectionTimers.clear()
    void (async () => {
      try {
        if (sidecar) await stopSidecar(sidecar)
        else await stopActiveSidecar()
      } catch (err) {
        appendLog('main.log', formatLogLine(`sidecar stop failed: ${stringifyError(err)}`))
      } finally {
        sidecar = null
        app.quit()
      }
    })()
  })
}

function installMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Subscriptions',
      submenu: [
        {
          label: 'Manage subscriptions…',
          accelerator: 'CmdOrCtrl+,',
          click: () => presentSubscriptionDemo(),
        },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function stopSidecar(handle: SidecarHandle): Promise<void> {
  expectedExits.add(handle.child)
  await handle.stop()
}

function launch(): void {
  mainWindow = createMainWindow({
    onRestart: () => void restart(),
    onSubscriptionDemoAction: handleSubscriptionDemoAction,
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  presentSubscriptionDemo()
}

function presentSubscriptionDemo(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  subscriptionDemoVisible = true
  showSubscriptionDemo(mainWindow, subscriptionDemoState)
}

function handleSubscriptionDemoAction(action: SubscriptionDemoAction): void {
  if (action.type === 'continue') {
    subscriptionDemoVisible = false
    void continueToHarness()
    return
  }

  const existingTimer = connectionTimers.get(action.provider)
  if (existingTimer) {
    clearTimeout(existingTimer)
    connectionTimers.delete(action.provider)
  }

  if (action.type === 'disconnect') {
    subscriptionDemoState = setSubscriptionStatus(
      subscriptionDemoState,
      action.provider,
      'disconnected',
    )
    presentSubscriptionDemo()
    return
  }

  subscriptionDemoState = setSubscriptionStatus(subscriptionDemoState, action.provider, 'connecting')
  presentSubscriptionDemo()
  const timer = setTimeout(() => {
    connectionTimers.delete(action.provider)
    subscriptionDemoState = setSubscriptionStatus(
      subscriptionDemoState,
      action.provider,
      'connected',
    )
    if (subscriptionDemoVisible) presentSubscriptionDemo()
  }, 1100)
  connectionTimers.set(action.provider, timer)
}

async function continueToHarness(): Promise<void> {
  if (quitting || starting || !mainWindow || mainWindow.isDestroyed()) return
  if (sidecar) {
    loadSidecar(mainWindow, sidecar.url)
    return
  }

  starting = true
  try {
    await startSession()
  } catch (err) {
    presentError(err)
  } finally {
    starting = false
  }
}

async function startSession(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  showStatusPage(mainWindow, 'Starting DeepSeek Harness…', 'Waiting for the local web server.')

  const workspaceDir = await ensureDefaultWorkspace(resolveDefaultWorkspace())
  const port = await pickListenPort()
  const harnessRoot = resolveHarnessRoot()
  const readyTimeoutMs = resolveReadyTimeoutMs()
  appendLog(
    'main.log',
    formatLogLine(
      `start workspace=${workspaceDir} harness=${harnessRoot} port=${port} timeout=${readyTimeoutMs}ms`,
    ),
  )

  const handle = await startSidecar({
    harnessRoot,
    workspaceDir,
    port,
    readyTimeoutMs,
  })
  sidecar = handle
  handle.child.once('exit', (code, signal) => {
    appendLog('main.log', formatLogLine(`sidecar exit code=${code} signal=${signal}`))
    if (quitting || expectedExits.has(handle.child)) return
    const tail = handle.stderrTail.slice()
    if (sidecar === handle) sidecar = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      showErrorPage(mainWindow, {
        title: 'DeepSeek Harness stopped',
        detail: `The sidecar exited (code ${code ?? 'null'}, signal ${signal ?? 'null'}).`,
        stderr: tail,
      })
    }
  })

  if (!mainWindow || mainWindow.isDestroyed()) {
    await stopSidecar(handle)
    return
  }
  loadSidecar(mainWindow, handle.url)
}

async function restart(): Promise<void> {
  if (quitting || starting) return
  starting = true
  try {
    if (sidecar) {
      const previous = sidecar
      sidecar = null
      await stopSidecar(previous)
    } else {
      await stopActiveSidecar()
    }
    await startSession()
  } catch (err) {
    presentError(err)
  } finally {
    starting = false
  }
}

function presentError(err: unknown): void {
  const detail = stringifyError(err)
  const stderr = err instanceof SidecarError ? err.stderrTail : []
  appendLog('main.log', formatLogLine(`error ${detail}`))
  if (mainWindow && !mainWindow.isDestroyed()) {
    showErrorPage(mainWindow, {
      title: 'DeepSeek Harness failed to start',
      detail,
      stderr,
    })
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
