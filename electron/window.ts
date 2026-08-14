import { BrowserWindow, nativeTheme, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import {
  parseSubscriptionDemoAction,
  renderSubscriptionDemo,
  type SubscriptionDemoAction,
  type SubscriptionDemoState,
} from './subscription-demo.js'
import { UI_FONT_FAMILY, uiFontFace } from './ui-font.js'
import {
  windowChromePageCss,
  windowControlButtonsHtml,
  windowFrameOptions,
} from './window-frame.js'

// Reserved .invalid host so Restart is a normal https navigation we intercept.
export const RESTART_URL = 'https://dsh-desktop.invalid/restart'

const origins = new WeakMap<BrowserWindow, string>()
const windowHooks = new WeakMap<BrowserWindow, MainWindowHooks>()

export interface MainWindowHooks {
  readonly onRestart: () => void
  readonly onSubscriptionDemoAction: (action: SubscriptionDemoAction) => void
}

export interface ErrorPageOptions {
  title: string
  detail: string
  stderr?: readonly string[]
}

export function createMainWindow(hooks: MainWindowHooks, productName: string): BrowserWindow {
  const preload = fileURLToPath(new URL('./preload.js', import.meta.url))
  const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const frame = windowFrameOptions(process.platform, scheme)
  const win = new BrowserWindow({
    title: productName,
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    show: false,
    ...frame,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload,
    },
  })

  windowHooks.set(win, hooks)
  attachNavigationLock(win)
  attachWindowChrome(win)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  return win
}

export function setSidecarOrigin(win: BrowserWindow, origin: string | undefined): void {
  if (origin === undefined) origins.delete(win)
  else origins.set(win, origin)
}

export function loadSidecar(win: BrowserWindow, url: URL): void {
  setSidecarOrigin(win, url.origin)
  void win.loadURL(url.href)
}

export function showStatusPage(win: BrowserWindow, title: string, detail: string): void {
  setSidecarOrigin(win, undefined)
  void win.loadURL(toDataUrl(renderShellHtml({ title, detail, restart: false })))
}

export function showErrorPage(win: BrowserWindow, opts: ErrorPageOptions): void {
  setSidecarOrigin(win, undefined)
  void win.loadURL(toDataUrl(renderShellHtml({ ...opts, restart: true })))
}

export function showSubscriptionDemo(
  win: BrowserWindow,
  state: SubscriptionDemoState,
  productName: string,
): void {
  setSidecarOrigin(win, undefined)
  void win.loadURL(toDataUrl(renderSubscriptionDemo(state, productName, process.platform)))
}

function attachWindowChrome(win: BrowserWindow): void {
  const emitState = () => {
    if (win.isDestroyed()) return
    win.webContents.send('desktop:window-state', {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
    })
  }
  win.on('maximize', emitState)
  win.on('unmaximize', emitState)
  win.on('enter-full-screen', emitState)
  win.on('leave-full-screen', emitState)
  win.webContents.on('did-finish-load', emitState)
}

function attachNavigationLock(win: BrowserWindow): void {
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalIfAllowed(url)
    return { action: 'deny' }
  })

  const onNavigate = (event: Electron.Event & { url: string }) => {
    const subscriptionAction = parseSubscriptionDemoAction(event.url)
    if (subscriptionAction) {
      event.preventDefault()
      windowHooks.get(win)?.onSubscriptionDemoAction(subscriptionAction)
      return
    }
    if (handleRestartUrl(win, event.url)) {
      event.preventDefault()
      return
    }
    if (isAllowedNavigation(event.url, origins.get(win))) return
    event.preventDefault()
    void openExternalIfAllowed(event.url)
  }

  win.webContents.on('will-navigate', onNavigate)
  win.webContents.on('will-redirect', onNavigate)
  win.webContents.on('will-frame-navigate', onNavigate)
}

function handleRestartUrl(win: BrowserWindow, url: string): boolean {
  if (url !== RESTART_URL && !url.startsWith(`${RESTART_URL}?`) && !url.startsWith(`${RESTART_URL}#`)) {
    return false
  }
  windowHooks.get(win)?.onRestart()
  return true
}

function isAllowedNavigation(url: string, sidecarOrigin: string | undefined): boolean {
  if (url.startsWith('data:text/html')) return true
  if (url === 'about:blank') return true
  if (!sidecarOrigin) return false
  try {
    return new URL(url).origin === sidecarOrigin
  } catch {
    return false
  }
}

async function openExternalIfAllowed(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
  } catch {
    return
  }
  await shell.openExternal(url)
}

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function renderShellHtml(opts: ErrorPageOptions & { restart: boolean }): string {
  const stderr = (opts.stderr ?? []).join('\n')
  const restart = opts.restart
    ? `<p><a class="restart" href="${RESTART_URL}">Restart</a></p>`
    : ''
  const log = opts.stderr && opts.stderr.length > 0
    ? `<h2>Last sidecar output</h2><pre>${escapeHtml(stderr)}</pre>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(opts.title)}</title>
  <style>
    :root { color-scheme: light dark; --ink: #111613; --paper: #E8EDE6; --pen: #BF352E; }
    @media (prefers-color-scheme: dark) {
      :root { --ink: #E2E9E4; --paper: #1C1F1A; --pen: #E55A4E; }
    }
    ${uiFontFace()}
    ${windowChromePageCss()}
    body { font-family: ${UI_FONT_FAMILY}; margin: 0; padding: 48px 32px; line-height: 1.45;
           color: var(--ink);
           background:
             repeating-linear-gradient(90deg, color-mix(in oklab, var(--ink) 6%, transparent) 0 1px, transparent 1px 48px),
             var(--paper); }
    main { max-width: 720px; margin: 0 auto; }
    h1 { font-size: 1.4rem; margin: 0 0 12px; }
    p { margin: 0 0 16px; }
    pre { white-space: pre-wrap; word-break: break-word; padding: 12px; border-radius: 2px;
          background: color-mix(in srgb, currentColor 8%, transparent); font-size: 12px; }
    a.restart { display: inline-block; padding: 8px 16px; border-radius: 2px; text-decoration: none;
                background: var(--ink); color: var(--paper); }
  </style>
</head>
<body>
  <div class="inkline-drag" aria-hidden="true"></div>
  ${process.platform === 'linux' ? windowControlButtonsHtml() : ''}
  <main>
    <h1>${escapeHtml(opts.title)}</h1>
    <p>${escapeHtml(opts.detail)}</p>
    ${restart}
    ${log}
  </main>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
