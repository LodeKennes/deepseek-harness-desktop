import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SUBSCRIPTION_DEMO_URL,
  createSubscriptionDemoState,
  parseSubscriptionDemoAction,
  renderSubscriptionDemo,
  setSubscriptionProviderState,
  setSubscriptionStatus,
} from './subscription-demo.js'

test('parses only reserved subscription demo actions and known providers', () => {
  assert.deepEqual(
    parseSubscriptionDemoAction(`${SUBSCRIPTION_DEMO_URL}?action=connect&provider=codex`),
    { type: 'connect', provider: 'codex' },
  )
  assert.deepEqual(
    parseSubscriptionDemoAction(`${SUBSCRIPTION_DEMO_URL}?action=disconnect&provider=antigravity`),
    { type: 'disconnect', provider: 'antigravity' },
  )
  assert.deepEqual(
    parseSubscriptionDemoAction(`${SUBSCRIPTION_DEMO_URL}?action=continue`),
    { type: 'continue' },
  )
  assert.equal(
    parseSubscriptionDemoAction(`${SUBSCRIPTION_DEMO_URL}?action=connect&provider=unknown`),
    undefined,
  )
  assert.equal(
    parseSubscriptionDemoAction('https://example.com/subscriptions?action=continue'),
    undefined,
  )
  assert.equal(parseSubscriptionDemoAction('not a URL'), undefined)
})

test('updates one provider without mutating the previous state', () => {
  const initial = createSubscriptionDemoState()
  const connecting = setSubscriptionStatus(initial, 'claude', 'connecting')
  const connected = setSubscriptionStatus(connecting, 'claude', 'connected')

  assert.equal(initial.statuses.claude, 'disconnected')
  assert.equal(connecting.statuses.claude, 'connecting')
  assert.equal(connected.statuses.claude, 'connected')
  assert.equal(connected.statuses.codex, 'disconnected')
})

test('renders only connect actions, status, and continue', () => {
  const connected = setSubscriptionProviderState(createSubscriptionDemoState(), 'codex', {
    status: 'connected',
    account: 'user@example.com',
    models: ['gpt-example-one', 'gpt-example-two'],
  })
  const html = renderSubscriptionDemo(connected)

  assert.match(html, /Connect a subscription/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, />Continue</)
  assert.match(html, /Disconnect/)
  assert.match(html, /user@example\.com/)
  assert.match(html, /ChatGPT \/ Codex/)
  assert.match(html, /Claude/)
  assert.match(html, /Google Antigravity/)
  assert.match(html, /:focus-visible/)
  assert.doesNotMatch(html, /Local connector/)
  assert.doesNotMatch(html, /Bring your own subscription/)
  assert.doesNotMatch(html, /Credentials stay on this device/)
  assert.doesNotMatch(html, /CLIProxyAPI/)
  assert.doesNotMatch(html, /gpt-example-one/)
  assert.doesNotMatch(html, /brand-mark/)
  assert.doesNotMatch(html, /linear-gradient/)
  assert.doesNotMatch(html, /Skip for now/)
})

test('skip is the only continue action when nothing is connected', () => {
  const html = renderSubscriptionDemo(createSubscriptionDemoState())
  assert.match(html, />Skip</)
  assert.doesNotMatch(html, />Continue</)
})

test('subscription screen reserves space for integrated window controls', () => {
  const mac = renderSubscriptionDemo(createSubscriptionDemoState(), 'DeepSeek Harness', 'darwin')
  assert.match(mac, /padding-left: 56px/)
  assert.match(mac, /inkline-drag/)
  assert.doesNotMatch(mac, /aria-label="Window"/)

  const win = renderSubscriptionDemo(createSubscriptionDemoState(), 'DeepSeek Harness', 'win32')
  assert.match(win, /padding-right: 140px/)
  assert.doesNotMatch(win, /aria-label="Window"/)

  const linux = renderSubscriptionDemo(createSubscriptionDemoState(), 'DeepSeek Harness', 'linux')
  assert.match(linux, /aria-label="Window"/)
  assert.match(linux, /data-inkline-window="minimize"/)
  assert.match(linux, /display: flex/)
  assert.match(linux, /padding-right: 140px/)
})

test('renders a custom product name from styling', () => {
  const html = renderSubscriptionDemo(createSubscriptionDemoState(), 'Acme Harness')
  assert.match(html, />Acme Harness</)
  assert.doesNotMatch(html, />DeepSeek Harness</)
})
