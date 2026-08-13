import { contextBridge } from 'electron'

// Empty bridge: renderer gets no Node and no IPC surface in v1.
contextBridge.exposeInMainWorld('desktopShell', Object.freeze({}))
