export const TITLEBAR_HEIGHT = 38
export const TRAFFIC_LIGHT_OFFSET = { x: 16, y: 18 } as const
export const OVERLAY_BUTTONS_WIDTH = 140

export const CHROME_PAPER = { light: '#E8EDE6', dark: '#1C1F1A' } as const
export const CHROME_INK = { light: '#111613', dark: '#E2E9E4' } as const

export type ChromeScheme = 'light' | 'dark'

export interface WindowFrameOptions {
  readonly titleBarStyle: 'hidden' | 'hiddenInset'
  readonly trafficLightPosition?: { readonly x: number; readonly y: number }
  readonly titleBarOverlay?: {
    readonly color: string
    readonly symbolColor: string
    readonly height: number
  }
  readonly frame?: boolean
  readonly autoHideMenuBar: boolean
  readonly backgroundColor: string
}

export function titleBarOverlayColors(scheme: ChromeScheme = 'light') {
  return {
    color: CHROME_PAPER[scheme],
    symbolColor: CHROME_INK[scheme],
    height: TITLEBAR_HEIGHT,
  }
}

/** ChatGPT / t3-style chrome: native controls sit in the page, not a separate bar. */
export function windowFrameOptions(
  platform = process.platform,
  scheme: ChromeScheme = 'light',
): WindowFrameOptions {
  const backgroundColor = CHROME_PAPER[scheme]
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { ...TRAFFIC_LIGHT_OFFSET },
      autoHideMenuBar: false,
      backgroundColor,
    }
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarOverlayColors(scheme),
      autoHideMenuBar: true,
      backgroundColor,
    }
  }
  return {
    titleBarStyle: 'hidden',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor,
  }
}

export function windowControlButtonsHtml(): string {
  return `<div class="inkline-win-btns" role="toolbar" aria-label="Window">
  <button type="button" data-inkline-window="minimize" aria-label="Minimize"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>
  <button type="button" data-inkline-window="maximize" aria-label="Maximize"><svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>
  <button type="button" data-inkline-window="close" aria-label="Close"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>
</div>`
}

/** CSS for Electron-rendered pages (subscription, status, error). */
export function windowChromePageCss(platform = process.platform): string {
  const buttons = platform === 'linux'
    ? '.inkline-win-btns { display: flex; }'
    : '.inkline-win-btns { display: none; }'
  const macPad = platform === 'darwin'
    ? '.topbar { padding-left: 76px; }'
    : ''
  const captionPad = platform === 'win32' || platform === 'linux'
    ? `.topbar { padding-right: ${OVERLAY_BUTTONS_WIDTH}px; }`
    : ''
  const dragRight = platform === 'win32' || platform === 'linux'
    ? `${OVERLAY_BUTTONS_WIDTH}px`
    : '0'
  return `
    body { -webkit-app-region: drag; }
    a, button, input, textarea, select, [role="button"] { -webkit-app-region: no-drag; }
    .inkline-drag { position: fixed; top: 0; left: 0; right: ${dragRight}; height: 12px; -webkit-app-region: drag; z-index: 2147483000; }
    .inkline-win-btns { position: fixed; top: 0; right: 0; height: ${TITLEBAR_HEIGHT}px; z-index: 2147483001; -webkit-app-region: no-drag; display: none; align-items: stretch; margin: 0; padding: 0; }
    .inkline-win-btns button { width: 46px; border: 0; background: transparent; color: inherit; display: grid; place-items: center; -webkit-app-region: no-drag; }
    .inkline-win-btns svg { width: 10px; height: 10px; display: block; }
    .inkline-win-btns button:hover { background: color-mix(in oklab, currentColor 10%, transparent); }
    .inkline-win-btns button[data-inkline-window="close"]:hover { background: #BF352E; color: #E8EDE6; }
    html[data-inkline-fullscreen] .inkline-win-btns,
    html[data-inkline-fullscreen] .inkline-drag { display: none !important; }
    ${buttons}
    ${macPad}
    ${captionPad}
  `
}
