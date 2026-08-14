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
    :root {
      color-scheme: light dark;
      --bg: #f9fafb;
      --panel: #ffffff;
      --text: #0f1115;
      --muted: #61666b;
      --line: rgba(0, 0, 0, 0.08);
      --hover: rgba(0, 0, 0, 0.05);
      --accent: #4176e6;
      --ok: #15803d;
      --err: #dc2626;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #151517;
        --panel: #1b1b1c;
        --text: #f9fafb;
        --muted: #979da6;
        --line: rgba(255, 255, 255, 0.08);
        --hover: rgba(255, 255, 255, 0.06);
        --accent: #679efe;
        --ok: #4ed17e;
        --err: #f25a5a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 64px 24px 32px;
      font: 14px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    main { max-width: 400px; margin: 0 auto; }
    h1 { font-size: 16px; font-weight: 500; line-height: 24px; margin: 0 0 4px; }
    .lede { margin: 0 0 16px; color: var(--muted); }
    ul {
      list-style: none; margin: 0; padding: 4px 0;
      background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    }
    li {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 12px 14px;
    }
    li + li { border-top: 1px solid var(--line); }
    .name { font-weight: 500; }
    .meta { margin: 2px 0 0; font-size: 12px; line-height: 18px; color: var(--muted); }
    .ok { color: var(--ok); }
    .error { color: var(--err); }
    .action {
      flex: 0 0 auto; padding: 5px 12px; border: 1px solid var(--line); border-radius: 12px;
      color: var(--text); background: var(--panel); text-decoration: none; font-size: 13px; font-weight: 500;
    }
    .action:hover { background: var(--hover); }
    .action:focus-visible, .continue:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .wait { flex: 0 0 auto; font-size: 13px; color: var(--muted); }
    .continue {
      display: inline-block; margin-top: 16px; padding: 8px 16px; border-radius: 12px;
      color: var(--bg); background: var(--text); text-decoration: none; font-weight: 500;
    }
    .continue:hover { opacity: .88; }
    .continue.skip { color: var(--muted); background: transparent; padding-left: 0; }
    .continue.skip:hover { color: var(--text); opacity: 1; }
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
    <a class="continue${connected ? '' : ' skip'}" href="${actionUrl('continue')}">${continueLabel}</a>
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
    ? `<a class="action" href="${actionUrl('disconnect', provider.id)}">Disconnect</a>`
    : status === 'connecting'
      ? '<span class="wait">Waiting…</span>'
      : `<a class="action" href="${actionUrl('connect', provider.id)}">Connect</a>`
  const tone = status === 'connected' ? ' ok' : status === 'error' ? ' error' : ''

  return `<li>
    <div>
      <div class="name">${provider.name}</div>
      ${detail ? `<p class="meta${tone}" role="status">${detail}</p>` : ''}
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
