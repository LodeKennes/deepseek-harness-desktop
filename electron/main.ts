import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, shell } from 'electron'
import {
  beginCLIProxyOAuth,
  disconnectCLIProxyProvider,
  listCLIProxyConnections,
  startCLIProxy,
  waitForCLIProxyOAuth,
  writeHarnessProxyPatch,
  type CLIProxyConnection,
  type CLIProxyHandle,
} from './cliproxy.js'
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
  setSubscriptionProviderState,
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
import { loadDesktopStyling } from './brand.js'
import { ensureDefaultWorkspace, resolveDefaultWorkspace } from './workspace.js'

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarHandle | null = null
let cliProxy: CLIProxyHandle | null = null
let cliProxyConnections: readonly CLIProxyConnection[] = []
let quitting = false
let starting = false
let subscriptionDemoVisible = false
let subscriptionDemoState: SubscriptionDemoState = createSubscriptionDemoState()
const expectedExits = new WeakSet<ChildProcess>()

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.setName(loadDesktopStyling().productName)
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
    void (async () => {
      try {
        if (sidecar) await stopSidecar(sidecar)
        else await stopActiveSidecar()
        if (cliProxy) await cliProxy.stop()
      } catch (err) {
        appendLog('main.log', formatLogLine(`shutdown failed: ${stringifyError(err)}`))
      } finally {
        sidecar = null
        cliProxy = null
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
  }, loadDesktopStyling().productName)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  showStatusPage(mainWindow, 'Starting local subscription connector…', 'Loading CLIProxyAPI.')
  void startSubscriptionConnector()
}

async function startSubscriptionConnector(): Promise<void> {
  try {
    cliProxy = await startCLIProxy()
    cliProxy.child.once('exit', (code, signal) => {
      if (quitting) return
      cliProxy = null
      showErrorPageIfOpen(
        'Local subscription connector stopped',
        `CLIProxyAPI exited (code ${code ?? 'null'}, signal ${signal ?? 'null'}).`,
      )
    })
    await refreshSubscriptionConnections()
    if (process.env.DSH_DESKTOP_SKIP_ONBOARDING === '1') await continueToHarness()
    else presentSubscriptionDemo()
  } catch (err) {
    showErrorPageIfOpen('Local subscription connector failed to start', stringifyError(err))
  }
}

function presentSubscriptionDemo(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  subscriptionDemoVisible = true
  showSubscriptionDemo(mainWindow, subscriptionDemoState, loadDesktopStyling().productName)
}

function handleSubscriptionDemoAction(action: SubscriptionDemoAction): void {
  if (action.type === 'continue') {
    subscriptionDemoVisible = false
    void continueToHarness()
    return
  }
  void (action.type === 'connect'
    ? connectSubscription(action.provider)
    : disconnectSubscription(action.provider))
}

async function connectSubscription(provider: SubscriptionProviderId): Promise<void> {
  if (!cliProxy || subscriptionDemoState.statuses[provider] === 'connecting') return
  subscriptionDemoState = setSubscriptionStatus(subscriptionDemoState, provider, 'connecting')
  presentSubscriptionDemo()
  try {
    const session = await beginCLIProxyOAuth(cliProxy, provider)
    await shell.openExternal(session.url)
    await waitForCLIProxyOAuth(cliProxy, session.state)
    await refreshSubscriptionConnections()
  } catch (err) {
    subscriptionDemoState = setSubscriptionProviderState(subscriptionDemoState, provider, {
      status: 'error',
      error: stringifyError(err),
    })
  }
  if (subscriptionDemoVisible) presentSubscriptionDemo()
}

async function disconnectSubscription(provider: SubscriptionProviderId): Promise<void> {
  if (!cliProxy) return
  const connection = cliProxyConnections.find((entry) => entry.provider === provider)
  if (!connection) return
  try {
    await disconnectCLIProxyProvider(cliProxy, connection)
    await refreshSubscriptionConnections()
  } catch (err) {
    subscriptionDemoState = setSubscriptionProviderState(subscriptionDemoState, provider, {
      status: 'error',
      error: stringifyError(err),
    })
  }
  if (subscriptionDemoVisible) presentSubscriptionDemo()
}

async function refreshSubscriptionConnections(): Promise<void> {
  if (!cliProxy) return
  cliProxyConnections = await listCLIProxyConnections(cliProxy)
  let next = createSubscriptionDemoState()
  for (const connection of cliProxyConnections) {
    next = setSubscriptionProviderState(next, connection.provider, {
      status: 'connected',
      account: connection.account,
      models: connection.models.map((model) => model.name ?? model.id),
    })
  }
  subscriptionDemoState = next
}

async function continueToHarness(): Promise<void> {
  if (quitting || starting || !mainWindow || mainWindow.isDestroyed()) return

  starting = true
  try {
    const launchOptions = await harnessLaunchOptions()
    if (sidecar) {
      const previous = sidecar
      sidecar = null
      await stopSidecar(previous)
    }
    await startSession(launchOptions)
  } catch (err) {
    presentError(err)
  } finally {
    starting = false
  }
}

async function harnessLaunchOptions(): Promise<{
  readonly patchPaths: readonly string[]
  readonly cliProxyApiKey?: string
}> {
  const patchPaths = [...resolveBrandPatchPaths()]
  if (!cliProxy) return { patchPaths }
  const cliproxyPatch = await writeHarnessProxyPatch(cliProxy, cliProxyConnections)
  if (cliproxyPatch) patchPaths.push(cliproxyPatch)
  return {
    patchPaths,
    cliProxyApiKey: cliProxy.apiKey,
  }
}

function resolveBrandPatchPaths(): string[] {
  const packaged = join(process.resourcesPath, 'brand.cordis.yml')
  const unpackaged = join(fileURLToPath(new URL('..', import.meta.url)), '.cache', 'styling', 'brand.generated.cordis.yml')
  const candidate = app.isPackaged ? packaged : unpackaged
  return existsSync(candidate) ? [candidate] : []
}

async function startSession(options: {
  readonly patchPaths?: readonly string[]
  readonly cliProxyApiKey?: string
} = {}): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const productName = loadDesktopStyling().productName
  showStatusPage(mainWindow, `Starting ${productName}…`, 'Waiting for the local web server.')

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
    patchPaths: options.patchPaths,
    additionalEnv: options.cliProxyApiKey
      ? { CLIPROXY_API_KEY: options.cliProxyApiKey }
      : undefined,
  })
  sidecar = handle
  handle.child.once('exit', (code, signal) => {
    appendLog('main.log', formatLogLine(`sidecar exit code=${code} signal=${signal}`))
    if (quitting || expectedExits.has(handle.child)) return
    const tail = handle.stderrTail.slice()
    if (sidecar === handle) sidecar = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      showErrorPage(mainWindow, {
        title: `${loadDesktopStyling().productName} stopped`,
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
    await startSession(await harnessLaunchOptions())
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
      title: `${loadDesktopStyling().productName} failed to start`,
      detail,
      stderr,
    })
  }
}

function showErrorPageIfOpen(title: string, detail: string): void {
  appendLog('main.log', formatLogLine(`error ${detail}`))
  if (mainWindow && !mainWindow.isDestroyed()) showErrorPage(mainWindow, { title, detail })
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
