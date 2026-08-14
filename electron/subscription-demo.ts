import { windowChromePageCss, windowControlButtonsHtml } from './window-frame.js'

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
  readonly name: string
}

const providers: readonly ProviderDefinition[] = [
  { id: 'codex', name: 'ChatGPT / Codex' },
  { id: 'claude', name: 'Claude' },
  { id: 'antigravity', name: 'Google Antigravity' },
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
  const connected = subscriptionProviderIds.some((provider) => state.statuses[provider] === 'connected')
  const continueLabel = connected ? 'Continue' : 'Skip'

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>${escapeHtml(productName)}</title>
  <style>
    ${windowChromePageCss(platform)}
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 56px 24px 32px;
      font: 15px/1.45 system-ui, sans-serif;
      color: CanvasText;
      background: Canvas;
    }
    main { max-width: 28rem; margin: 0 auto; }
    h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 6px; }
    .lede { margin: 0 0 20px; color: color-mix(in srgb, CanvasText 62%, Canvas); }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 10px 0; border-top: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
    li:last-of-type { border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
    .name { font-weight: 550; }
    .meta { margin: 2px 0 0; font-size: 13px; color: color-mix(in srgb, CanvasText 62%, Canvas); }
    .error { color: #b91c1c; }
    a, .wait { flex: 0 0 auto; font-size: 14px; }
    a { color: LinkText; }
    a:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    .wait { color: color-mix(in srgb, CanvasText 55%, Canvas); }
    .continue { display: inline-block; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="inkline-drag" aria-hidden="true"></div>
  ${platform === 'linux' ? windowControlButtonsHtml() : ''}
  <main>
    <h1>Connect a subscription</h1>
    <p class="lede">Optional. Sign-in opens in your browser.</p>
    <ul>
      ${providers.map((provider) => renderProvider(
        provider,
        state.statuses[provider.id],
        state.accounts[provider.id],
        state.errors[provider.id],
      )).join('')}
    </ul>
    <a class="continue" href="${actionUrl('continue')}">${continueLabel}</a>
  </main>
</body>
</html>`
}

function renderProvider(
  provider: ProviderDefinition,
  status: SubscriptionStatus,
  account: string | undefined,
  error: string | undefined,
): string {
  const detail = status === 'connected'
    ? account ? `Connected · ${escapeHtml(account)}` : 'Connected'
    : status === 'connecting'
      ? 'Waiting for browser…'
      : status === 'error'
        ? (error ? escapeHtml(error) : 'Connection failed')
        : ''
  const action = status === 'connected'
    ? `<a href="${actionUrl('disconnect', provider.id)}">Disconnect</a>`
    : status === 'connecting'
      ? '<span class="wait">Waiting…</span>'
      : `<a href="${actionUrl('connect', provider.id)}">Connect</a>`

  return `<li>
    <div>
      <div class="name">${provider.name}</div>
      ${detail ? `<p class="meta${status === 'error' ? ' error' : ''}" role="status">${detail}</p>` : ''}
    </div>
    ${action}
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
