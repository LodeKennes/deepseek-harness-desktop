import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DesktopStyling {
  readonly productName: string
  readonly productNameSafe: string
  readonly desktopName: string
  readonly appId: string
  readonly bootWordmark: string
}

export interface StylingPathOptions {
  readonly packaged: boolean
  readonly resourcesPath: string
  readonly repoRoot: string
}

export function parseDesktopStyling(raw: unknown): DesktopStyling {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('styling.json: root must be an object')
  }
  const obj = raw as Record<string, unknown>
  return {
    productName: requiredString(obj, 'productName'),
    productNameSafe: requiredSafeName(obj),
    desktopName: requiredString(obj, 'desktopName'),
    appId: requiredString(obj, 'appId'),
    bootWordmark: optionalString(obj, 'bootWordmark') ?? requiredString(obj, 'productName'),
  }
}

export function parseDesktopStylingJson(source: string): DesktopStyling {
  return parseDesktopStyling(JSON.parse(source) as unknown)
}

export function resolveStylingPath(opts: StylingPathOptions): string {
  return opts.packaged ? join(opts.resourcesPath, 'styling.json') : join(opts.repoRoot, 'styling.json')
}

export function loadDesktopStylingFrom(path: string): DesktopStyling {
  return parseDesktopStylingJson(readFileSync(path, 'utf8'))
}

function requiredString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`styling.json: ${key} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  if (obj[key] === undefined) return undefined
  return requiredString(obj, key)
}

function requiredSafeName(obj: Record<string, unknown>): string {
  const value = requiredString(obj, 'productNameSafe')
  if (/\s/.test(value)) {
    throw new Error('styling.json: productNameSafe must not contain spaces')
  }
  return value
}
