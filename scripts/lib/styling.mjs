import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export const LEGACY_WORKSPACE_FOLDER = 'DeepSeek Harness'
export const OVERLAY_FILE_BUDGET = 8
export const APPROOT_WORDMARK_NEEDLE = "div(css.wordmark, 'HARNESS')"
export const INDEX_TITLE_NEEDLE = '<title>DeepSeek Harness</title>'

export const COLOR_TOKEN_NAMES = {
  brandPrimary: '--dsw-alias-brand-primary',
  sidebarFill: '--dsw-specific-sidebar-fill',
  bubble: '--dsw-specific-bubble',
  sidebarActiveAccent: '--dsw-specific-sidebar-nav-item-active-accent',
}

export const CATALOG_TOKEN_KEYS = ['brandPrimary', 'sidebarFill']

export const OVERLAY_TARGETS = {
  wordmark: 'packages/client/ui-primitives/src/BrandWordmark.tsx',
  logo: 'packages/client/ui-primitives/src/FishLogo.tsx',
  favicon: 'apps/web/public/favicon.svg',
  manifest: 'apps/web/public/manifest.webmanifest',
  welcome: 'packages/client/ui-settings-models/src/onboarding-copy.ts',
  appRoot: 'packages/client/web/src/boot-page.ts',
}

const OVERLAY_MARKERS = {
  [OVERLAY_TARGETS.wordmark]: 'export function BrandWordmark',
  [OVERLAY_TARGETS.logo]: 'export function FishLogo',
  [OVERLAY_TARGETS.welcome]: 'WELCOME_NOTICE_COPY',
  [OVERLAY_TARGETS.appRoot]: APPROOT_WORDMARK_NEEDLE,
}

/**
 * @param {unknown} raw
 * @returns {DesktopStyling}
 */
export function parseStyling(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('styling.json: root must be an object')
  }
  const obj = /** @type {Record<string, unknown>} */ (raw)
  const productName = requiredString(obj, 'productName')
  const productNameSafe = requiredString(obj, 'productNameSafe')
  if (/\s/.test(productNameSafe)) {
    throw new Error('styling.json: productNameSafe must not contain spaces (Linux /opt + chrome-sandbox)')
  }
  const desktopName = requiredString(obj, 'desktopName')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(desktopName)) {
    throw new Error('styling.json: desktopName must be lowercase hyphenated (e.g. acme-harness)')
  }
  const appId = requiredString(obj, 'appId')
  const bootWordmark = optionalString(obj, 'bootWordmark') ?? productName
  if (bootWordmark.includes('<') || bootWordmark.includes('>')) {
    throw new Error('styling.json: bootWordmark must not contain < or >')
  }

  /** @type {Record<string, { light: string, dark: string }>} */
  const tokens = {}
  if (obj.colors !== undefined) {
    if (!obj.colors || typeof obj.colors !== 'object' || Array.isArray(obj.colors)) {
      throw new Error('styling.json: colors must be an object')
    }
    const colors = /** @type {Record<string, unknown>} */ (obj.colors)
    for (const [key, cssVar] of Object.entries(COLOR_TOKEN_NAMES)) {
      if (colors[key] === undefined) continue
      tokens[cssVar] = parsePair(colors[key], `colors.${key}`)
    }
    const unknown = Object.keys(colors).filter((key) => !(key in COLOR_TOKEN_NAMES))
    if (unknown.length > 0) {
      throw new Error(`styling.json: unknown colors keys: ${unknown.join(', ')}`)
    }
  }
  if (obj.tokens !== undefined) {
    if (!obj.tokens || typeof obj.tokens !== 'object' || Array.isArray(obj.tokens)) {
      throw new Error('styling.json: tokens must be an object')
    }
    const extra = /** @type {Record<string, unknown>} */ (obj.tokens)
    for (const [name, pair] of Object.entries(extra)) {
      if (!name.startsWith('--dsw-')) {
        throw new Error(`styling.json: tokens.${name} must start with --dsw-`)
      }
      tokens[name] = parsePair(pair, `tokens.${name}`)
    }
  }

  /** @type {DesktopStyling['assets']} */
  const assets = {}
  if (obj.assets !== undefined) {
    if (!obj.assets || typeof obj.assets !== 'object' || Array.isArray(obj.assets)) {
      throw new Error('styling.json: assets must be an object')
    }
    const rawAssets = /** @type {Record<string, unknown>} */ (obj.assets)
    const allowed = ['wordmark', 'logo', 'favicon']
    const unknown = Object.keys(rawAssets).filter((key) => !allowed.includes(key))
    if (unknown.length > 0) {
      throw new Error(`styling.json: unknown assets keys: ${unknown.join(', ')} (installer icons stay in resources/icons)`)
    }
    for (const key of allowed) {
      if (rawAssets[key] === undefined) continue
      if (typeof rawAssets[key] !== 'string' || rawAssets[key].trim() === '') {
        throw new Error(`styling.json: assets.${key} must be a non-empty string path`)
      }
      assets[/** @type {'wordmark' | 'logo' | 'favicon'} */ (key)] = rawAssets[key].trim()
    }
  }

  let welcome
  if (obj.welcome !== undefined) {
    welcome = parseWelcome(obj.welcome)
  }

  return {
    productName,
    productNameSafe,
    desktopName,
    appId,
    bootWordmark,
    assets,
    tokens,
    welcome,
  }
}

/**
 * @param {string} repoRoot
 * @param {string} [fileName]
 */
export function loadStyling(repoRoot, fileName = 'styling.json') {
  const path = join(repoRoot, fileName)
  if (!existsSync(path)) throw new Error(`styling.json not found at ${path}`)
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`styling.json: invalid JSON: ${message}`)
  }
  return parseStyling(raw)
}

/**
 * @param {string} repoRoot
 * @param {DesktopStyling} styling
 */
export function resolveAssetPaths(repoRoot, styling) {
  /** @type {Record<string, string>} */
  const resolved = {}
  for (const [key, rel] of Object.entries(styling.assets)) {
    const abs = join(repoRoot, rel)
    if (!existsSync(abs)) {
      throw new Error(`styling.json: assets.${key} not found: ${rel}`)
    }
    resolved[key] = abs
  }
  return resolved
}

/**
 * @param {DesktopStyling} styling
 * @param {{ wordmark?: string, logo?: string, favicon?: string }} svgs
 */
export function planFontOverlays(repoRoot) {
  const dir = join(repoRoot, 'styling', 'fonts')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.woff2'))
    .sort()
    .map((name) => ({
      rel: `apps/web/public/fonts/${name}`,
      contents: readFileSync(join(dir, name)),
    }))
}

export function planOverlay(styling, svgs) {
  /** @type {Array<{ rel: string, contents: string, marker?: string }>} */
  const files = []
  if (svgs.wordmark) {
    files.push({
      rel: OVERLAY_TARGETS.wordmark,
      contents: generateIconTsx({
        exportName: 'BrandWordmark',
        sizeIsHeight: true,
        defaultSize: 24,
        svg: svgs.wordmark,
      }),
      marker: OVERLAY_MARKERS[OVERLAY_TARGETS.wordmark],
    })
  }
  if (svgs.logo) {
    files.push({
      rel: OVERLAY_TARGETS.logo,
      contents: generateIconTsx({
        exportName: 'FishLogo',
        sizeIsHeight: false,
        defaultSize: 24,
        svg: svgs.logo,
      }),
      marker: OVERLAY_MARKERS[OVERLAY_TARGETS.logo],
    })
  }
  if (svgs.favicon) {
    files.push({
      rel: OVERLAY_TARGETS.favicon,
      contents: svgs.favicon,
    })
  }
  if (svgs.wordmark || svgs.logo || svgs.favicon) {
    files.push({
      rel: OVERLAY_TARGETS.manifest,
      contents: `${JSON.stringify({
        id: '/',
        name: styling.productName,
        short_name: styling.productNameSafe,
        start_url: '/',
        scope: '/',
        display: 'fullscreen',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      }, null, 2)}\n`,
    })
  }
  if (styling.welcome) {
    files.push({
      rel: OVERLAY_TARGETS.welcome,
      contents: generateOnboardingCopy(styling.welcome),
      marker: OVERLAY_MARKERS[OVERLAY_TARGETS.welcome],
    })
  }
  if (files.length > OVERLAY_FILE_BUDGET) {
    throw new Error(`styling overlay would write ${files.length} files; budget is ${OVERLAY_FILE_BUDGET}`)
  }
  return files
}

/**
 * @param {string} destRoot
 * @param {ReturnType<typeof planOverlay>} files
 */
export function writeGeneratedOverlay(destRoot, files) {
  rmSync(destRoot, { recursive: true, force: true })
  for (const file of files) {
    const dest = join(destRoot, file.rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, file.contents)
  }
}

/**
 * @param {string} cloneRoot
 * @param {ReturnType<typeof planOverlay>} files
 * @param {string} bootWordmark
 */
export function applyOverlayToClone(cloneRoot, files, bootWordmark) {
  for (const file of files) {
    const dest = join(cloneRoot, file.rel)
    if (existsSync(dest)) {
      if (file.marker) {
        const current = readFileSync(dest, 'utf8')
        if (!current.includes(file.marker)) {
          throw new Error(`overlay: ${file.rel} lost expected marker ${JSON.stringify(file.marker)}`)
        }
      }
    } else if (file.marker) {
      throw new Error(`overlay: upstream missing ${file.rel}`)
    } else {
      mkdirSync(dirname(dest), { recursive: true })
    }
    writeFileSync(dest, file.contents)
  }
  patchAppRoot(cloneRoot, bootWordmark)
}

/**
 * @param {string} cloneRoot
 * @param {string} bootWordmark
 */
export function patchAppRoot(cloneRoot, bootWordmark) {
  const dest = join(cloneRoot, OVERLAY_TARGETS.appRoot)
  if (!existsSync(dest)) throw new Error(`overlay: upstream missing ${OVERLAY_TARGETS.appRoot}`)
  const current = readFileSync(dest, 'utf8')
  if (!current.includes(APPROOT_WORDMARK_NEEDLE)) {
    throw new Error(`overlay: AppRoot lost HARNESS needle; pin moved? (${OVERLAY_TARGETS.appRoot})`)
  }
  const next = current.replace(
    APPROOT_WORDMARK_NEEDLE,
    `div(css.wordmark, '${bootWordmark}')`,
  )
  writeFileSync(dest, next)
}

/**
 * @param {DesktopStyling} styling
 */
export function generateBrandYaml(styling) {
  const tokenLines = Object.entries(styling.tokens).flatMap(([name, pair]) => [
    `          ${yamlQuote(name)}:`,
    `            light: ${yamlQuote(pair.light)}`,
    `            dark: ${yamlQuote(pair.dark)}`,
  ])
  return [
    '- insert:',
    '    - id: desktop-brand',
    '      name: desktop-brand',
    '      config:',
    `        productName: ${yamlQuote(styling.productName)}`,
    ...(tokenLines.length > 0 ? ['        tokens:', ...tokenLines] : []),
    '',
  ].join('\n')
}

/**
 * @param {DesktopStyling} styling
 */
export function generateHostPlugin(styling, extraCss = '') {
  const tokensJson = JSON.stringify(styling.tokens, null, 2)
  return `import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const NEEDLE = ${JSON.stringify(INDEX_TITLE_NEEDLE)}
const PRODUCT_NAME = ${JSON.stringify(styling.productName)}
const TOKENS = ${tokensJson}
const EXTRA_CSS = ${JSON.stringify(extraCss)}

function bootTokenStyle() {
  const light = []
  const dark = []
  for (const [name, pair] of Object.entries(TOKENS)) {
    light.push(name + ': ' + pair.light)
    dark.push(name + ': ' + pair.dark)
  }
  const extra = EXTRA_CSS ? EXTRA_CSS : ''
  if (light.length === 0 && !extra) return ''
  const lightRule = light.length > 0 ? 'body { ' + light.join('; ') + '; }' : ''
  const darkRule = dark.length > 0 ? 'body[data-ds-dark-theme] { ' + dark.join('; ') + '; }' : ''
  return '<style>' + extra + lightRule + darkRule + '</style>'
}

export function apply(ctx, config = {}) {
  const productName = String(config.productName ?? PRODUCT_NAME).trim()
  if (!productName) throw new Error('desktop-brand: config.productName missing')
  const require = createRequire(import.meta.url)
  const indexPath = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  if (!readFileSync(indexPath, 'utf8').includes(NEEDLE)) {
    throw new Error('desktop-brand: dist index missing title needle (' + indexPath + ')')
  }
  const style = bootTokenStyle()
  ctx.inject(['webServer'], (http) => {
    http.effect(() => http.webServer.tapIndex((html) => {
      if (!html.includes(NEEDLE)) throw new Error('desktop-brand: request tap needle missing')
      let next = html.replace(NEEDLE, '<title>' + escapeHtml(productName) + '</title>')
      if (style) next = next.replace('</head>', style + windowChromeCss() + '</head>')
      else next = next.replace('</head>', windowChromeCss() + '</head>')
      next = next.replace(/<html\\b/, '<html data-inkline-chrome="' + process.platform + '"')
      const linuxBtns = process.platform === 'linux' ? LINUX_WINDOW_BUTTONS : ''
      next = next.replace(/<body[^>]*>/, (open) => open + '<div class="inkline-drag" aria-hidden="true"></div>' + linuxBtns)
      return next
    }), 'desktop-brand: title+boot-tokens')
  })
}

const LINUX_WINDOW_BUTTONS = '<div class="inkline-win-btns" role="toolbar" aria-label="Window"><button type="button" data-inkline-window="minimize" aria-label="Minimize"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button><button type="button" data-inkline-window="maximize" aria-label="Maximize"><svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button><button type="button" data-inkline-window="close" aria-label="Close"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button></div>'

function windowChromeCss() {
  const mac = process.platform === 'darwin'
    ? '[class*="logoRow"]{padding-left:80px!important;}[data-sidebar-collapsed] [class*="logoRow"]{padding-left:0!important;}[data-sidebar-collapsed] [class*="sidebarCol"]{padding-top:38px!important;}'
    : ''
  const caption = process.platform === 'win32' || process.platform === 'linux'
    ? '.inkline-drag{right:140px;}[class*="titleRow"]{padding-right:140px;}'
    : ''
  const linux = process.platform === 'linux'
    ? '.inkline-win-btns{display:flex;}'
    : '.inkline-win-btns{display:none;}'
  return '<style>'
    + '.inkline-drag{position:fixed;top:0;left:0;right:0;height:12px;-webkit-app-region:drag;z-index:2147483000;}'
    + '[class*="logoRow"],[class*="titleRow"]{-webkit-app-region:drag;}'
    + '[class*="logoRow"] button,[class*="logoRow"] a,[class*="titleRow"] button,[class*="titleRow"] a,[class*="headerActions"],[class*="headerUtilities"]{-webkit-app-region:no-drag;}'
    + '.inkline-win-btns{position:fixed;top:0;right:0;height:38px;z-index:2147483001;-webkit-app-region:no-drag;display:none;align-items:stretch;margin:0;padding:0;}'
    + '.inkline-win-btns button{width:46px;border:0;background:transparent;color:inherit;display:grid;place-items:center;-webkit-app-region:no-drag;}'
    + '.inkline-win-btns svg{width:10px;height:10px;display:block;}'
    + '.inkline-win-btns button:hover{background:color-mix(in oklab,currentColor 10%,transparent);}'
    + '.inkline-win-btns button[data-inkline-window="close"]:hover{background:#c42b1c;color:#fff;}'
    + 'html[data-inkline-fullscreen] .inkline-win-btns,html[data-inkline-fullscreen] .inkline-drag{display:none!important;}'
    + linux + mac + caption
    + '</style>'
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
`
}

/**
 * @param {DesktopStyling} styling
 */
export function generateClientPlugin(styling) {
  const catalog = CATALOG_TOKEN_KEYS
    .map((key) => COLOR_TOKEN_NAMES[key])
    .filter((name) => name in styling.tokens)
  return `window.__ModuleLoader__.load({
	id: "desktop-brand",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const TOKENS = ${JSON.stringify(styling.tokens)};
		const CATALOG = ${JSON.stringify(catalog)};
		exports.inject = ["theme"];
		exports.apply = function apply(ctx) {
			if (CATALOG.length > 0) {
				const names = new Set(ctx.theme.exportInspectTokens().map((token) => token.name));
				for (const name of CATALOG) {
					if (!names.has(name)) throw new Error("desktop-brand: catalog token missing: " + name);
				}
			}
			if (Object.keys(TOKENS).length === 0) return;
			ctx.effect(() => ctx.theme.overrideTokens("desktop-brand", TOKENS), "desktop-brand: tokens");
		};
		return module.exports;
	}
});
`
}

/**
 * @param {DesktopStyling} styling
 */
export function generatePluginPackageJson(styling) {
  const hasClient = Object.keys(styling.tokens).length > 0
  /** @type {Record<string, unknown>} */
  const pkg = {
    name: 'desktop-brand',
    version: '0.0.0',
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './package.json': './package.json',
    },
  }
  if (hasClient) {
    pkg.dsh = {
      client: {
        platform: 'web',
        immediately: true,
        inject: ['@deepseek-ai/dsh-client-ui-theme'],
      },
    }
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}

/**
 * @param {string} outDir
 * @param {DesktopStyling} styling
 */
export function writeDesktopBrandPlugin(outDir, styling, extraCss = '') {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'lib'), { recursive: true })
  writeFileSync(join(outDir, 'package.json'), generatePluginPackageJson(styling))
  writeFileSync(join(outDir, 'lib/index.js'), generateHostPlugin(styling, extraCss))
  if (Object.keys(styling.tokens).length > 0) {
    writeFileSync(join(outDir, 'lib/client.js'), generateClientPlugin(styling))
  }
}

/**
 * @param {object} opts
 * @param {string} opts.sha
 * @param {string} opts.stylingHash
 * @param {string[]} opts.files
 */
export function renderOverlayStamp(opts) {
  return `${JSON.stringify({
    sha: opts.sha,
    stylingHash: opts.stylingHash,
    files: opts.files,
    budget: OVERLAY_FILE_BUDGET,
  }, null, 2)}\n`
}

/**
 * @param {DesktopStyling} styling
 * @param {string[]} assetContents
 */
export function hashStylingInputs(styling, assetContents) {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(styling))
  for (const chunk of assetContents) {
    hash.update('\0')
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * @param {{ exportName: string, sizeIsHeight: boolean, defaultSize: number, svg: string }} opts
 */
export function generateIconTsx(opts) {
  const meta = parseSvgMeta(opts.svg)
  const inner = svgInnerToJsx(meta.inner)
  const sizeLines = opts.sizeIsHeight
    ? `      width={(size * ${meta.width}) / ${meta.height}}\n      height={size}`
    : `      width={size}\n      height={(size * ${meta.height}) / ${meta.width}}`
  return `import type { IconProps } from './icons/props.ts'

export function ${opts.exportName}({ size = ${opts.defaultSize}, className }: IconProps) {
  return (
    <svg
${sizeLines}
      className={className}
      viewBox="${meta.viewBox}"
      fill="none"
      aria-hidden="true"
    >
${indent(inner, 6)}
    </svg>
  )
}
`
}

/**
 * @param {string} svg
 */
export function parseSvgMeta(svg) {
  const viewBox = svg.match(/viewBox=["']([^"']+)["']/)?.[1] ?? '0 0 24 24'
  const parts = viewBox.trim().split(/[\s,]+/).map(Number)
  const width = parts[2]
  const height = parts[3]
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid SVG viewBox: ${viewBox}`)
  }
  const inner = svg.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '')
  return { viewBox, width, height, inner }
}

/**
 * @param {string} inner
 */
export function svgInnerToJsx(inner) {
  return inner
    .replace(/\sclass=/g, ' className=')
    .replace(/\sclip-path=/g, ' clipPath=')
    .replace(/\sclip-rule=/g, ' clipRule=')
    .replace(/\sfill-rule=/g, ' fillRule=')
    .replace(/\sstroke-width=/g, ' strokeWidth=')
    .replace(/\sstroke-linecap=/g, ' strokeLinecap=')
    .replace(/\sstroke-linejoin=/g, ' strokeLinejoin=')
    .replace(/\sstroke-miterlimit=/g, ' strokeMiterlimit=')
    .replace(/\sfont-size=/g, ' fontSize=')
    .replace(/\sfont-family=/g, ' fontFamily=')
    .replace(/\sfont-weight=/g, ' fontWeight=')
    .replace(/\stext-anchor=/g, ' textAnchor=')
    .replace(/\sxml:space=/g, ' xmlSpace=')
}

/**
 * @param {string} productName
 */
export function generateTextWordmarkSvg(productName) {
  const label = escapeXml(productName)
  return `<svg viewBox="0 0 182 24" xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="18" fontSize="16" fontFamily="system-ui, sans-serif" fontWeight="650" fill="currentColor">${label}</text>
</svg>
`
}

/**
 * @param {string} productName
 */
export function generateLetterLogoSvg(productName) {
  const letter = escapeXml((productName.trim()[0] || 'D').toUpperCase())
  return `<svg viewBox="0 0 23.16 17.04" xmlns="http://www.w3.org/2000/svg">
  <text x="11.58" y="13.2" textAnchor="middle" fontSize="12" fontFamily="system-ui, sans-serif" fontWeight="700" fill="currentColor">${letter}</text>
</svg>
`
}

/**
 * @param {string} productName
 */
export function generateFaviconSvg(productName) {
  const letter = escapeXml((productName.trim()[0] || 'D').toUpperCase())
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#2563eb"/>
  <text x="16" y="22" text-anchor="middle" font-size="16" font-family="system-ui,sans-serif" font-weight="700" fill="#fff">${letter}</text>
</svg>
`
}

/**
 * @param {NonNullable<DesktopStyling['welcome']>} welcome
 */
export function generateOnboardingCopy(welcome) {
  const version = welcome.version
    ?? createHash('sha256').update(JSON.stringify({
      en: welcome.en,
      zh: welcome.zh,
    })).digest('hex').slice(0, 12)
  return `/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = ${JSON.stringify(version)}

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: ${JSON.stringify(welcome.zh.title)},
    body: ${JSON.stringify(welcome.zh.body)},
    continueLabel: ${JSON.stringify(welcome.zh.continueLabel)},
  },
  en: {
    title: ${JSON.stringify(welcome.en.title)},
    body: ${JSON.stringify(welcome.en.body)},
    continueLabel: ${JSON.stringify(welcome.en.continueLabel)},
  },
} as const
`
}

/**
 * @param {string} repoRoot
 * @param {DesktopStyling} styling
 */
export function generatedPaths(repoRoot, styling) {
  const root = join(repoRoot, '.cache', 'styling')
  return {
    root,
    overlay: join(root, 'overlay', 'harness'),
    plugin: join(root, 'desktop-brand'),
    brandYaml: join(root, 'brand.generated.cordis.yml'),
    stamp: join(repoRoot, '.cache', 'harness', '.desktop-overlay-stamp'),
    productName: styling.productName,
  }
}

/**
 * @param {string} from
 * @param {string} to
 */
export function relPosix(from, to) {
  return relative(from, to).split('\\').join('/')
}

function requiredString(obj, key) {
  const value = obj[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`styling.json: ${key} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(obj, key) {
  if (obj[key] === undefined) return undefined
  if (typeof obj[key] !== 'string' || obj[key].trim() === '') {
    throw new Error(`styling.json: ${key} must be a non-empty string when set`)
  }
  return obj[key].trim()
}

function parsePair(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`styling.json: ${path} must be { light, dark }`)
  }
  const pair = /** @type {Record<string, unknown>} */ (value)
  const light = pair.light
  const dark = pair.dark
  if (typeof light !== 'string' || light.trim() === '' || typeof dark !== 'string' || dark.trim() === '') {
    throw new Error(`styling.json: ${path} must include non-empty light and dark`)
  }
  return { light: light.trim(), dark: dark.trim() }
}

function parseWelcome(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('styling.json: welcome must be an object')
  }
  const obj = /** @type {Record<string, unknown>} */ (raw)
  return {
    version: optionalString(obj, 'version'),
    en: parseLocaleCopy(obj.en, 'welcome.en'),
    zh: parseLocaleCopy(obj.zh, 'welcome.zh'),
  }
}

function parseLocaleCopy(raw, path) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`styling.json: ${path} must be an object`)
  }
  const obj = /** @type {Record<string, unknown>} */ (raw)
  return {
    title: requiredString(obj, 'title'),
    body: requiredString(obj, 'body'),
    continueLabel: requiredString(obj, 'continueLabel'),
  }
}

function yamlQuote(value) {
  return JSON.stringify(value)
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n')
}

/**
 * @typedef {object} DesktopStyling
 * @property {string} productName
 * @property {string} productNameSafe
 * @property {string} desktopName
 * @property {string} appId
 * @property {string} bootWordmark
 * @property {{ wordmark?: string, logo?: string, favicon?: string }} assets
 * @property {Record<string, { light: string, dark: string }>} tokens
 * @property {{ version?: string, en: { title: string, body: string, continueLabel: string }, zh: { title: string, body: string, continueLabel: string } } | undefined} welcome
 */
