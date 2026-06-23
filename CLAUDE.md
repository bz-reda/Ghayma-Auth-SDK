# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@ghayma/auth` — a zero-dependency client-side authentication SDK for Ghayma Auth. Works in browsers, Node.js 18+, Deno, Bun, and React Native (requires native `fetch`).

## Commands

- **Build:** `npm run build` (uses tsup, outputs ESM + CJS to `dist/`)
- **Dev/watch:** `npm run dev`
- **Type check:** `npm run typecheck`

No test framework is configured yet.

## Architecture

Four source files in `src/`, single entry point:

- **`index.ts`** — `GhaymaAuth` class (the public API; `EspaceAuth` is exported as a deprecated back-compat alias). Orchestrates auth flows (register, login, logout, OAuth, password reset, user profile) and manages auto-refresh scheduling and auth state event listeners.
- **`client.ts`** — `HttpClient` class. Internal HTTP layer using native `fetch`. All requests go to `{baseUrl}/v1/{appSlug}{path}`. Handles auth headers, timeouts (15s default), and maps errors to `AuthError`.
- **`token.ts`** — `TokenManager` class. Stores access/refresh tokens with expiry tracking. Supports `"memory"` or `"localStorage"` strategies. localStorage key: `espace_auth_session` (kept unchanged across the Ghayma rebrand so existing users stay signed in — do not rename).
- **`types.ts`** — All TypeScript interfaces, param types, event types, and the `AuthError` class.

## Key Patterns

- **Token auto-refresh:** Schedules a `setTimeout` 60s before token expiry. `ensureToken()` is called before authenticated requests and triggers refresh if expired (30s buffer).
- **Auth events:** Listeners receive `AuthEvent` (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`) + current session. Listener errors are silently caught.
- **OAuth flow:** Server redirects back with tokens in URL fragment (`#access_token=...`). `handleOAuthFragment()` parses them and cleans up the URL.
- **Dual output:** tsup builds both ESM (`.js`) and CJS (`.cjs`) with `.d.ts` declarations. Package uses conditional exports.
