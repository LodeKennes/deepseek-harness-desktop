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

test('renders connector, security, keyboard, and connected-state cues', () => {
  const connected = setSubscriptionProviderState(createSubscriptionDemoState(), 'codex', {
    status: 'connected',
    account: 'user@example.com',
    models: ['gpt-example-one', 'gpt-example-two'],
  })
  const html = renderSubscriptionDemo(connected)

  assert.match(html, /Local connector/)
  assert.match(html, /system browser handles provider sign-in/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /Credentials stay on this device/)
  assert.match(html, /Continue to Harness/)
  assert.match(html, /DeepSeek Harness/)
  assert.match(html, /Disconnect ChatGPT \/ Codex/)
  assert.match(html, /user@example\.com/)
  assert.match(html, /gpt-example-one/)
  assert.match(html, /:focus-visible/)
  assert.match(html, /#E8EDE6/)
  assert.match(html, /#BF352E/)
  assert.match(html, /Archivo/)
  assert.doesNotMatch(html, /#2563eb/)
})

test('renders a custom product name from styling', () => {
  const html = renderSubscriptionDemo(createSubscriptionDemoState(), 'Acme Harness')
  assert.match(html, />Acme Harness</)
  assert.doesNotMatch(html, />DeepSeek Harness</)
})
