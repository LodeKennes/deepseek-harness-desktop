import { app, BrowserWindow, Menu, shell } from 'electron'
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
import { createMainWindow, loadSidecar, showErrorPage, showStatusPage } from './window.js'
import { ensureDefaultWorkspace, resolveDefaultWorkspace } from './workspace.js'

const RELEASES_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases'

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarHandle | null = null
let quitting = false
let starting = false

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
    void launch()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (async () => {
      try {
        if (sidecar) await sidecar.stop()
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
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Releases…',
          click: () => {
            void shell.openExternal(RELEASES_URL)
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function launch(): Promise<void> {
  mainWindow = createMainWindow({ onRestart: () => void restart() })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  try {
    await startSession()
  } catch (err) {
    presentError(err)
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
    if (quitting) return
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
    await handle.stop()
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
      await previous.stop()
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
