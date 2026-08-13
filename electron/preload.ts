import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('desktopShell', Object.freeze({}))
