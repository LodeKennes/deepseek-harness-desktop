import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderCLIProxyConfig, renderHarnessProxyPatch } from './cliproxy-config.js'

test('renders a loopback-only CLIProxyAPI config with private keys', () => {
  const config = renderCLIProxyConfig({
    port: 14321,
    authDir: '/home/user/.dsh/desktop/cliproxyapi/auth',
    apiKey: 'local-api-key',
    managementKey: 'local-management-key',
  })

  assert.match(config, /host: "127\.0\.0\.1"/)
  assert.match(config, /port: 14321/)
  assert.match(config, /allow-remote: false/)
  assert.match(config, /disable-control-panel: true/)
  assert.match(config, /local-api-key/)
  assert.match(config, /local-management-key/)
})

test('renders one Harness route from discovered models and selects its first model', () => {
  const patch = renderHarnessProxyPatch('http://127.0.0.1:14321/v1', [
    { id: 'gpt-example', name: 'GPT Example' },
    { id: 'claude-example' },
    { id: 'gpt-example', name: 'duplicate ignored' },
  ])

  assert.match(patch, /apiKeyEnv: CLIPROXY_API_KEY/)
  assert.match(patch, /api: openai-responses/)
  assert.match(patch, /baseURL: "http:\/\/127\.0\.0\.1:14321\/v1"/)
  assert.equal((patch.match(/id: "gpt-example"/g) ?? []).length, 1)
  assert.match(patch, /provider: connected-subscriptions/)
  assert.match(patch, /model: "gpt-example"/)
})
