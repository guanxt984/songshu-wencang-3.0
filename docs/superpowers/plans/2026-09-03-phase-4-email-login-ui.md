# Phase 4 Email Login UI Implementation Plan

> **For agentic workers:** Implement each task with test-driven development and verify the complete local flow in the in-app browser.

**Goal:** Add a visible email-code login gate, session restoration, and logout to the existing Squirrel Warehouse UI, with a safe localhost-only development backend.

**Architecture:** A small frontend auth controller owns the login state machine and API calls. `app.js` renders either the auth gate or the existing warehouse application. `server.mjs` injects the already-tested auth and warehouse services only on the loopback development server, using in-memory repositories and a fixed localhost test code; production remains fail-closed until PostgreSQL and mail adapters are configured.

**Tech Stack:** Node.js ESM, Fetch API, native HTML/CSS/JavaScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-25-public-beta-cloud-ai-design.md` sections 4.1 and 10; `docs/松鼠文仓-产品实现链路与公开测试版方案.md` sections 8 and 16.2.

## Global constraints

- Never expose a development verification code outside a loopback development runtime.
- Do not clear or overwrite existing local warehouse data during authentication.
- Session restoration must happen before the warehouse workspace is shown.
- Authentication failures must use the API's stable Chinese error messages.
- Existing warehouse interactions and visual language must remain intact.

### Task 1: Frontend authentication state machine

**Files:** Create `auth-flow.js`, create `auth-flow.test.mjs`.

- [x] Write failing tests for session restore, email submission, code verification, resend countdown, safe error display, and logout.
- [x] Run the focused test and observe RED.
- [x] Implement the minimal injected-fetch controller.
- [x] Run the focused test and observe GREEN.

### Task 2: Local development API composition

**Files:** Modify `server.mjs`, create `api/local-development.test.mjs`.

- [x] Write a failing integration test proving localhost can request and verify code, restore a cookie session, and access warehouse routes.
- [x] Run the focused test and observe RED.
- [x] Compose memory repositories and services behind an explicit development-only factory.
- [x] Keep non-development runtime fail-closed.
- [x] Run the focused test and observe GREEN.

### Task 3: Login gate and workspace session UI

**Files:** Modify `index.html`, `app.js`, `styles.css`, `test-ui-content.cjs`.

- [x] Add failing content tests for the login form, verification form, local test-code notice, loading/error states, and logout action.
- [x] Run the UI test and observe RED.
- [x] Render the auth gate before the existing workspace and bind accessible email/code controls.
- [x] Add a restrained account/logout control to the existing top bar.
- [x] Run UI and unit tests and observe GREEN.

### Task 4: Browser and regression verification

- [x] Run `npm run check` and `git diff --check`.
- [x] Verify unauthenticated login, wrong code, correct code, refresh session restoration, and logout in the browser.
- [x] Request independent review and resolve all Critical and Important findings.
- [x] Commit the verified increment as `feat: add email login experience`.
