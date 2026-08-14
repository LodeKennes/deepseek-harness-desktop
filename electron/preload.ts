/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron'

const windowActions = new Set(['minimize', 'maximize', 'close'])

window.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest('[data-inkline-window]')
  if (!(button instanceof HTMLElement)) return
  const action = button.dataset.inklineWindow
  if (!action || !windowActions.has(action)) return
  event.preventDefault()
  ipcRenderer.send('desktop:window', action)
})

function currentTheme(): 'light' | 'dark' {
  if (document.documentElement.hasAttribute('data-inkline-chrome')) {
    return document.body?.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function reportTheme(): void {
  ipcRenderer.send('desktop:theme', currentTheme())
}

window.addEventListener('DOMContentLoaded', () => {
  reportTheme()
  const observer = new MutationObserver(reportTheme)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-inkline-chrome', 'data-ds-dark-theme'],
  })
  if (document.body) {
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportTheme)
})

ipcRenderer.on('desktop:window-state', (_event, state: { maximized?: boolean; fullscreen?: boolean }) => {
  const root = document.documentElement
  root.toggleAttribute('data-inkline-maximized', Boolean(state?.maximized))
  root.toggleAttribute('data-inkline-fullscreen', Boolean(state?.fullscreen))
})

contextBridge.exposeInMainWorld('desktopShell', Object.freeze({
  platform: process.platform,
  window: Object.freeze({
    minimize: () => ipcRenderer.send('desktop:window', 'minimize'),
    maximize: () => ipcRenderer.send('desktop:window', 'maximize'),
    close: () => ipcRenderer.send('desktop:window', 'close'),
  }),
}))
