import { join } from 'node:path'

const EXACT_KEYS = new Set([
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'TZ',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'DBUS_SESSION_BUS_ADDRESS',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'SSH_AUTH_SOCK',
])

export interface BuildSidecarEnvOptions {
  harnessRoot: string
  spawnHelperPath?: string
  source?: NodeJS.ProcessEnv
}

function isAllowedKey(key: string): boolean {
  // Deny first so ELECTRON_* / NODE_OPTIONS never ride in on a later pattern.
  if (key === 'NODE_OPTIONS' || key.startsWith('ELECTRON_')) return false
  if (EXACT_KEYS.has(key)) return true
  if (key.startsWith('LC_') || key.startsWith('XDG_')) return true
  if (key.startsWith('DSH_') || key.startsWith('DEEPSEEK_')) return true
  if (key.endsWith('_API_KEY')) return true
  return false
}

export function buildSidecarEnv(opts: BuildSidecarEnvOptions): NodeJS.ProcessEnv {
  const source = opts.source ?? process.env
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (isAllowedKey(key)) env[key] = value
  }

  const nodeDir =
    process.platform === 'win32'
      ? join(opts.harnessRoot, 'node')
      : join(opts.harnessRoot, 'node', 'bin')
  const harnessBin = join(opts.harnessRoot, 'bin')
  const inherited = source.PATH ?? source.Path ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  env.PATH = [nodeDir, harnessBin, inherited].filter((part) => part.length > 0).join(sep)

  if (opts.spawnHelperPath) {
    env.DSH_NODE_PTY_SPAWN_HELPER = opts.spawnHelperPath
  }

  return env
}
