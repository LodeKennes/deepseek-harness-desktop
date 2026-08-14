import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { UI_FONT_FAMILY, uiFontFace } from './ui-font.js'
import { windowChromePageCss, windowControlButtonsHtml } from './window-frame.js'

function brandMarkSvg(): string {
  try {
    const svg = readFileSync(fileURLToPath(new URL('../styling/logo.svg', import.meta.url)), 'utf8')
    return svg.trim().replace(/<svg\b/, '<svg class="brand-mark" aria-hidden="true"')
  } catch {
    return '<span class="brand-mark" aria-hidden="true">I</span>'
  }
}

export const SUBSCRIPTION_DEMO_URL = 'https://dsh-desktop.invalid/subscriptions'

export const subscriptionProviderIds = ['codex', 'claude', 'antigravity'] as const

export type SubscriptionProviderId = (typeof subscriptionProviderIds)[number]
export type SubscriptionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SubscriptionDemoState {
  readonly statuses: Readonly<Record<SubscriptionProviderId, SubscriptionStatus>>
  readonly accounts: Readonly<Partial<Record<SubscriptionProviderId, string>>>
  readonly models: Readonly<Partial<Record<SubscriptionProviderId, readonly string[]>>>
  readonly errors: Readonly<Partial<Record<SubscriptionProviderId, string>>>
}

export type SubscriptionDemoAction =
  | { readonly type: 'connect'; readonly provider: SubscriptionProviderId }
  | { readonly type: 'disconnect'; readonly provider: SubscriptionProviderId }
  | { readonly type: 'continue' }

interface ProviderDefinition {
  readonly id: SubscriptionProviderId
  readonly mark: string
  readonly name: string
  readonly account: string
  readonly description: string
}

const providers: readonly ProviderDefinition[] = [
  {
    id: 'codex',
    mark: 'O',
    name: 'ChatGPT / Codex',
    account: 'OpenAI account',
    description: 'Use models made available through your eligible ChatGPT or Codex subscription.',
  },
  {
    id: 'claude',
    mark: 'A',
    name: 'Claude',
    account: 'Anthropic account',
    description: 'Connect an eligible Claude subscription and discover its available coding models.',
  },
  {
    id: 'antigravity',
    mark: 'G',
    name: 'Google Antigravity',
    account: 'Google account',
    description: 'Connect Antigravity and use the Gemini models CLIProxyAPI discovers for your account.',
  },
]

export function createSubscriptionDemoState(): SubscriptionDemoState {
  return {
    statuses: {
      codex: 'disconnected',
      claude: 'disconnected',
      antigravity: 'disconnected',
    },
    accounts: {},
    models: {},
    errors: {},
  }
}

export function setSubscriptionStatus(
  state: SubscriptionDemoState,
  provider: SubscriptionProviderId,
  status: SubscriptionStatus,
): SubscriptionDemoState {
  return setSubscriptionProviderState(state, provider, { status })
}

export function setSubscriptionProviderState(
  state: SubscriptionDemoState,
  provider: SubscriptionProviderId,
  next: {
    readonly status: SubscriptionStatus
    readonly account?: string
    readonly models?: readonly string[]
    readonly error?: string
  },
): SubscriptionDemoState {
  const accounts = { ...state.accounts }
  const models = { ...state.models }
  const errors = { ...state.errors }
  if (next.account) accounts[provider] = next.account
  else delete accounts[provider]
  if (next.models && next.models.length > 0) models[provider] = next.models
  else delete models[provider]
  if (next.error) errors[provider] = next.error
  else delete errors[provider]
  return {
    statuses: {
      ...state.statuses,
      [provider]: next.status,
    },
    accounts,
    models,
    errors,
  }
}

export function parseSubscriptionDemoAction(url: string): SubscriptionDemoAction | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (`${parsed.origin}${parsed.pathname}` !== SUBSCRIPTION_DEMO_URL) return undefined

  const action = parsed.searchParams.get('action')
  if (action === 'continue') return { type: 'continue' }
  if (action !== 'connect' && action !== 'disconnect') return undefined

  const provider = parsed.searchParams.get('provider')
  if (!isSubscriptionProviderId(provider)) return undefined
  return { type: action, provider }
}

export function renderSubscriptionDemo(
  state: SubscriptionDemoState,
  productName = 'DeepSeek Harness',
  platform = process.platform,
): string {
  const connectedCount = subscriptionProviderIds.filter(
    (provider) => state.statuses[provider] === 'connected',
  ).length
  const primaryLabel = connectedCount > 0 ? 'Continue to Harness' : 'Continue without connecting'
  const modelSummary = connectedCount > 0
    ? `<section class="ready" aria-labelledby="ready-title">
        <div class="ready-icon" aria-hidden="true">✓</div>
        <div>
          <h2 id="ready-title">${connectedCount === 1 ? 'Subscription ready' : `${connectedCount} subscriptions ready`}</h2>
          <p>Harness will receive a local, OpenAI-compatible endpoint and the models discovered for your account.</p>
        </div>
      </section>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
  <title>Connected subscriptions</title>
  <style>
    ${uiFontFace()}
    ${windowChromePageCss(platform)}
    :root {
      color-scheme: light dark;
      --bg: #E8EDE6;
      --panel: #F3F6F2;
      --panel-muted: #D7DFD5;
      --text: #111613;
      --muted: #59635D;
      --border: color-mix(in oklab, #111613 14%, transparent);
      --border-strong: color-mix(in oklab, #111613 22%, transparent);
      --primary: #BF352E;
      --primary-hover: #9A2A24;
      --primary-soft: color-mix(in oklab, #BF352E 12%, #E8EDE6);
      --success: #35685F;
      --success-soft: color-mix(in oklab, #35685F 14%, #E8EDE6);
      --progress: #BF352E;
      --progress-soft: color-mix(in oklab, #BF352E 12%, #E8EDE6);
      --shadow: none;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1C1F1A;
        --panel: #232821;
        --panel-muted: #10150F;
        --text: #E2E9E4;
        --muted: #89938D;
        --border: color-mix(in oklab, #E2E9E4 10.5%, transparent);
        --border-strong: color-mix(in oklab, #E2E9E4 18%, transparent);
        --primary: #E55A4E;
        --primary-hover: #EF453C;
        --primary-soft: color-mix(in oklab, #E55A4E 18%, #1C1F1A);
        --success: #699C92;
        --success-soft: color-mix(in oklab, #699C92 16%, #1C1F1A);
        --progress: #E55A4E;
        --progress-soft: color-mix(in oklab, #E55A4E 16%, #1C1F1A);
        --shadow: none;
      }
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--bg); }
    body {
      min-height: 100vh;
      margin: 0;
      color: var(--text);
      background:
        repeating-linear-gradient(90deg, color-mix(in oklab, var(--text) 8%, transparent) 0 1px, transparent 1px 48px),
        var(--bg);
      font-family: ${UI_FONT_FAMILY};
      line-height: 1.5;
    }
    a { color: inherit; }
    .shell { width: min(1120px, calc(100% - 48px)); margin: 0 auto; padding: 24px 0; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; -webkit-app-region: drag; }
    .topbar a, .topbar button { -webkit-app-region: no-drag; }
    .brand { display: flex; align-items: center; gap: 11px; font-size: 14px; font-weight: 500; letter-spacing: 0.01em; }
    .brand-mark {
      display: block; width: 31px; height: 23px; border-radius: 2px; flex: 0 0 auto;
    }
    .demo-badge {
      padding: 5px 9px; border: 1px solid var(--border-strong); border-radius: 2px;
      color: var(--muted); background: color-mix(in srgb, var(--panel) 82%, transparent);
      font-size: 11px; font-weight: 550; letter-spacing: .08em; text-transform: uppercase;
    }
    main { background: var(--panel); border: 1px solid var(--border); border-radius: 2px; box-shadow: var(--shadow); overflow: hidden; }
    .intro { padding: 24px 36px 20px; border-bottom: 1px solid var(--border); }
    .eyebrow { margin: 0 0 8px; color: var(--primary); font-size: 12px; font-weight: 550; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(24px, 3vw, 32px); line-height: 1.2; letter-spacing: -0.02em; font-weight: 550; }
    .lede { max-width: 700px; margin: 9px 0 0; color: var(--muted); font-size: 15px; }
    .trust { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 16px 0 0; padding: 0; color: var(--muted); font-size: 12px; list-style: none; }
    .trust li { display: flex; align-items: center; gap: 7px; }
    .trust-mark { color: var(--success); font-weight: 800; }
    .content { padding: 20px 36px; }
    .section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; margin-bottom: 12px; }
    .section-heading h2 { margin: 0; font-size: 16px; letter-spacing: -.015em; }
    .section-heading p { margin: 0; color: var(--muted); font-size: 12px; }
    .providers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 0; padding: 0; list-style: none; }
    .provider {
      min-width: 0; height: 100%; padding: 15px; border: 1px solid var(--border);
      border-radius: 2px; background: var(--panel-muted); display: flex; flex-direction: column;
    }
    .provider.connected { border-color: color-mix(in srgb, var(--success) 42%, var(--border)); background: color-mix(in srgb, var(--success-soft) 55%, var(--panel)); }
    .provider.connecting { border-color: color-mix(in srgb, var(--progress) 40%, var(--border)); background: color-mix(in srgb, var(--progress-soft) 48%, var(--panel)); }
    .provider-head { display: flex; align-items: center; gap: 11px; }
    .provider-mark {
      display: grid; flex: 0 0 auto; place-items: center; width: 36px; height: 36px;
      border: 1px solid var(--border-strong); border-radius: 2px; background: var(--panel);
      color: var(--text); font-size: 14px; font-weight: 550;
    }
    .provider-name { min-width: 0; }
    .provider-name h3 { margin: 0; font-size: 14px; line-height: 1.25; }
    .provider-name p { margin: 2px 0 0; color: var(--muted); font-size: 11px; }
    .status {
      width: fit-content; margin: 11px 0 0; padding: 3px 8px; border-radius: 2px;
      color: var(--muted); background: color-mix(in srgb, var(--text) 7%, transparent);
      font-size: 10px; font-weight: 550; letter-spacing: .04em; text-transform: uppercase;
    }
    .connected .status { color: var(--success); background: var(--success-soft); }
    .connecting .status { color: var(--progress); background: var(--progress-soft); }
    .error .status { color: #b91c1c; background: #fef2f2; }
    .description { min-height: 56px; margin: 9px 0 11px; color: var(--muted); font-size: 12px; }
    .provider-error { margin: -4px 0 10px; color: #b91c1c; font-size: 11px; }
    .models { display: flex; flex-wrap: wrap; gap: 6px; margin: -3px 0 10px; padding: 0; list-style: none; }
    .model { padding: 3px 7px; border: 1px solid color-mix(in srgb, var(--success) 32%, var(--border)); border-radius: 2px; color: var(--success); font-size: 10px; }
    .action {
      display: block; margin-top: auto; padding: 7px 11px; border: 1px solid var(--border-strong);
      border-radius: 2px; text-align: center; text-decoration: none; background: var(--panel);
      font-size: 12px; font-weight: 500;
    }
    .action:hover { border-color: var(--primary); color: var(--primary); }
    .action:focus-visible, .primary:focus-visible, .secondary:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 38%, transparent); outline-offset: 2px; }
    .action[aria-disabled="true"] { color: var(--muted); cursor: wait; opacity: .75; }
    .ready { display: flex; align-items: flex-start; gap: 12px; margin-top: 12px; padding: 11px 13px; border: 1px solid color-mix(in srgb, var(--success) 35%, var(--border)); border-radius: 2px; background: var(--success-soft); }
    .ready-icon { display: grid; flex: 0 0 auto; place-items: center; width: 25px; height: 25px; border-radius: 2px; color: #E8EDE6; background: var(--success); font-size: 13px; font-weight: 800; }
    .ready h2 { margin: 0; font-size: 13px; }
    .ready p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
    footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 15px 36px; border-top: 1px solid var(--border); background: var(--panel-muted); }
    .footnote { max-width: 580px; margin: 0; color: var(--muted); font-size: 11px; }
    .footer-actions { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
    .secondary { color: var(--muted); font-size: 12px; text-decoration: none; }
    .secondary:hover { color: var(--text); text-decoration: underline; }
    .primary { padding: 9px 14px; border-radius: 2px; color: #E8EDE6; background: #111613; font-size: 12px; font-weight: 550; text-decoration: none; }
    .primary:hover { background: #3A3F39; }
    @media (max-width: 760px) {
      .shell { width: min(100% - 28px, 600px); padding: 24px 0; }
      .topbar { margin-bottom: 20px; }
      .intro, .content { padding-left: 22px; padding-right: 22px; }
      .providers { grid-template-columns: 1fr; }
      .description { min-height: auto; }
      footer { align-items: flex-start; flex-direction: column; padding: 18px 22px; }
      .footer-actions { width: 100%; justify-content: space-between; }
    }
  </style>
</head>
<body>
  <div class="inkline-drag" aria-hidden="true"></div>
  ${platform === 'linux' ? windowControlButtonsHtml() : ''}
  <div class="shell">
    <header class="topbar">
      <div class="brand">${brandMarkSvg()}${escapeHtml(productName)}</div>
      <span class="demo-badge">Local connector</span>
    </header>
    <main>
      <section class="intro" aria-labelledby="page-title">
        <p class="eyebrow">Bring your own subscription</p>
        <h1 id="page-title">Connected subscriptions</h1>
        <p class="lede">Connect an account you already use. Harness will discover eligible models and configure a private local connection for you.</p>
        <ul class="trust" aria-label="Connection details">
          <li><span class="trust-mark" aria-hidden="true">✓</span>Sign in with your system browser</li>
          <li><span class="trust-mark" aria-hidden="true">✓</span>Credentials stay on this device</li>
          <li><span class="trust-mark" aria-hidden="true">✓</span>No terminal setup</li>
        </ul>
      </section>
      <section class="content" aria-labelledby="providers-title">
        <div class="section-heading">
          <h2 id="providers-title">Choose a provider</h2>
          <p>Your system browser handles provider sign-in.</p>
        </div>
        <ul class="providers">
          ${providers.map((provider) => renderProvider(
            provider,
            state.statuses[provider.id],
            state.accounts[provider.id],
            state.models[provider.id] ?? [],
            state.errors[provider.id],
          )).join('')}
        </ul>
        ${modelSummary}
      </section>
      <footer>
        <p class="footnote">Powered locally by the bundled CLIProxyAPI. Provider credentials are stored in its private desktop data directory and never sent to Harness.</p>
        <nav class="footer-actions" aria-label="Setup actions">
          <a class="secondary" href="${actionUrl('continue')}">Skip for now</a>
          <a class="primary" href="${actionUrl('continue')}">${primaryLabel}</a>
        </nav>
      </footer>
    </main>
  </div>
</body>
</html>`
}

function renderProvider(
  provider: ProviderDefinition,
  status: SubscriptionStatus,
  account: string | undefined,
  discoveredModels: readonly string[],
  error: string | undefined,
): string {
  const statusLabel = status === 'connected'
    ? account ? `Connected · ${account}` : 'Connected'
    : status === 'connecting'
      ? 'Waiting for browser sign-in'
      : status === 'error'
        ? 'Connection failed'
        : 'Not connected'
  const models = status === 'connected'
    ? discoveredModels.length > 0
      ? `<ul class="models" aria-label="Discovered models">${discoveredModels.slice(0, 3).map((model) => `<li class="model">${escapeHtml(model)}</li>`).join('')}${discoveredModels.length > 3 ? `<li class="model">+${discoveredModels.length - 3} more</li>` : ''}</ul>`
      : '<p class="provider-error">Connected, but no models were discovered yet.</p>'
    : ''
  const action = status === 'connected'
    ? `<a class="action" href="${actionUrl('disconnect', provider.id)}">Disconnect ${provider.name}</a>`
    : status === 'connecting'
      ? '<span class="action" aria-disabled="true">Complete sign-in in browser…</span>'
      : `<a class="action" href="${actionUrl('connect', provider.id)}">Connect ${provider.name}</a>`
  const errorDetail = status === 'error' && error
    ? `<p class="provider-error">${escapeHtml(error)}</p>`
    : ''

  return `<li>
    <article class="provider ${status}">
      <div class="provider-head">
        <div class="provider-mark" aria-hidden="true">${provider.mark}</div>
        <div class="provider-name"><h3>${provider.name}</h3><p>${provider.account}</p></div>
      </div>
      <p class="status" role="status">${statusLabel}</p>
      <p class="description">${provider.description}</p>
      ${errorDetail}
      ${models}
      ${action}
    </article>
  </li>`
}

function actionUrl(
  action: SubscriptionDemoAction['type'],
  provider?: SubscriptionProviderId,
): string {
  const url = new URL(SUBSCRIPTION_DEMO_URL)
  url.searchParams.set('action', action)
  if (provider) url.searchParams.set('provider', provider)
  return url.href
}

function isSubscriptionProviderId(value: string | null): value is SubscriptionProviderId {
  return value !== null && subscriptionProviderIds.some((provider) => provider === value)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
