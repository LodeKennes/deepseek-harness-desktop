# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-08-14
- Primary product surfaces: desktop first-run subscription setup, connection management, and the embedded DeepSeek Harness web application.
- Evidence reviewed: `README.md`, `electron/main.ts`, `electron/window.ts`, `electron/preload.ts`, `electron-builder.yml`, and the icon assets under `resources/icons/`. No prior design document, screenshots, or desktop component library exists in this repository.

## Brand
- Personality: calm, direct, privacy-conscious, and useful to developers without assuming terminal expertise.
- Trust signals: plainly state which actions are simulated, when the system browser is used, where credentials remain, and whether a local service is running.
- Avoid: “free API” claims, provider impersonation, terminal-first onboarding, hidden background services, excessive gradients, and marketing-heavy copy.

## Product goals
- Goals: demonstrate an install-and-go path from an existing AI subscription to a model that is ready in Harness; make connecting, disconnecting, and skipping obvious; keep advanced plumbing out of the primary flow.
- Non-goals: real OAuth, embedding or downloading CLIProxyAPI, storing tokens, contacting provider APIs, or finalizing the production provider architecture in this demo branch.
- Success signals: a new user can identify their provider, understand that sign-in happens in a browser, see a connected state, and continue to Harness without opening a terminal.

## Personas and jobs
- Primary personas: developers who already pay for ChatGPT/Codex, Claude, or Gemini and want to use that access in a local agent desktop application.
- User jobs: connect an existing account, verify that a usable model was found, change or remove an account, and start working.
- Key contexts of use: first launch after installation and later account management from the application menu.

## Information architecture
- Primary navigation: the subscription screen precedes Harness on first launch; a `Subscriptions` application menu entry reopens it.
- Core routes/screens: connected subscriptions; transient browser sign-in state; embedded Harness; existing shell status and error screens.
- Content hierarchy: purpose and privacy promise, provider choices, discovered model summary, then the continue/skip action.

## Design principles
- Explain the outcome before the mechanism: users choose an account provider, not a proxy implementation.
- Progressive disclosure: keep OAuth, routing, ports, and process supervision behind clear status language.
- Tradeoffs: this branch favors a dependency-free, reviewable interaction prototype over production persistence and real authentication.

## Visual language
- Color: neutral slate surfaces with a blue primary action, green success, amber progress, and system light/dark adaptation.
- Typography: native system UI fonts; compact display headings; readable 14–16 px body copy.
- Spacing/layout rhythm: 4/8 px-derived spacing, a centered 1040 px content column, and a responsive card grid.
- Shape/radius/elevation: 10–18 px radii, fine borders, and restrained shadows used only to separate the main panel.
- Motion: no required animation; progress is communicated with text and a status indicator.
- Imagery/iconography: simple letter marks and small inline status symbols; provider marks are illustrative, not official logos.

## Components
- Existing components to reuse: the secured `BrowserWindow`, data-URL shell rendering, reserved `.invalid` navigation actions, and the application menu.
- New/changed components: onboarding hero, provider connection card, status badge, discovered-model summary, privacy note, and primary/secondary actions.
- Variants and states: disconnected, connecting, connected, skipped/continue, and the existing Harness start error state.
- Token/component ownership: demo CSS variables and markup live in `electron/subscription-demo.ts`; no new design-system layer is introduced.

## Accessibility
- Target standard: WCAG 2.2 AA where applicable to the prototype.
- Keyboard/focus behavior: native anchors provide tab/Enter operation; focus rings remain clearly visible.
- Contrast/readability: text and status colors have high-contrast light/dark variants; color is always paired with text.
- Screen-reader semantics: semantic headings, lists, navigation landmarks, status text, and descriptive action labels.
- Reduced motion and sensory considerations: the flow does not depend on animation, sound, or color alone.

## Responsive behavior
- Supported breakpoints/devices: Electron desktop window at 800×560 minimum through large desktop displays.
- Layout adaptations: three provider cards collapse to one column below 760 px; footer actions wrap without obscuring content.
- Touch/hover differences: all actions have generous hit areas and visible focus; hover is supplemental.

## Interaction states
- Loading: a provider card changes to “Waiting for browser sign-in” and disables repeated connection actions.
- Empty: all providers show a concise “Connect” action; the user can continue without connecting.
- Error: production authentication errors are out of scope; existing Harness startup errors remain available after continuing.
- Success: the provider card displays “Connected,” example discovered models, and a disconnect action.
- Disabled: connecting actions expose an unavailable state and explanatory status copy.
- Offline/slow network, if applicable: the mock completes locally; a production flow must add timeout, retry, and offline copy.

## Content voice
- Tone: concise, reassuring, and technically honest.
- Terminology: “subscription,” “connect,” “browser sign-in,” “local,” and “model”; reserve “proxy” for advanced documentation.
- Microcopy rules: label simulation explicitly, never imply provider endorsement, and describe the consequence of each action.

## Implementation constraints
- Framework/styling system: TypeScript and Electron only; render static, CSP-constrained HTML with no renderer JavaScript or new dependency.
- Design-token constraints: use local CSS custom properties until the upstream Harness exposes reusable desktop tokens.
- Performance constraints: the onboarding screen must render without starting Harness or any future proxy sidecar.
- Compatibility constraints: retain context isolation, sandboxing, disabled renderer Node integration, blocked permissions, and origin-locked Harness navigation.
- Test/screenshot expectations: unit-test action parsing, state transitions, and security/accessibility markers; perform a fresh TypeScript build and test run before delivery.

## Open questions
- [ ] Decide whether CLIProxyAPI is bundled, downloaded on demand, or treated as a separately installed advanced integration / product owner / affects licensing, updates, and trust copy.
- [ ] Confirm each provider’s supported authentication and subscription terms before production implementation / product and legal / affects which connection cards can ship.
- [ ] Define encrypted credential storage and token revocation behavior per OS / engineering and security / blocks real authentication.
- [ ] Choose final brand identity and whether official provider logos may be used / product and legal / affects production visuals.
- [ ] Decide whether subscription setup is mandatory, first-run-only, or always optional / product / affects persistence and empty-state behavior.
