import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SUBSCRIPTION_DEMO_URL,
  createSubscriptionDemoState,
  parseSubscriptionDemoAction,
  renderSubscriptionDemo,
  setSubscriptionStatus,
} from './subscription-demo.js'

test('parses only reserved subscription demo actions and known providers', () => {
  assert.deepEqual(
    parseSubscriptionDemoAction(`${SUBSCRIPTION_DEMO_URL}?action=connect&provider=codex`),
    { type: 'connect', provider: 'codex' },
  )
  assert.deepEqual(
    parseSubscriptionDemoAction(`${SUBSCRIPTION_DEMO_URL}?action=disconnect&provider=gemini`),
    { type: 'disconnect', provider: 'gemini' },
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

test('renders explicit demo, security, keyboard, and connected-state cues', () => {
  const connected = setSubscriptionStatus(createSubscriptionDemoState(), 'codex', 'connected')
  const html = renderSubscriptionDemo(connected)

  assert.match(html, /Interaction demo/)
  assert.match(html, /Connections are simulated in this demo/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /Credentials stay on this device/)
  assert.match(html, /Continue to Harness/)
  assert.match(html, /Disconnect ChatGPT \/ Codex/)
  assert.match(html, /:focus-visible/)
})
