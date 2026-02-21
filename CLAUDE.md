# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**GoGoGo** is a CLI tool that forwards terminal sessions to mobile devices via Cloudflare Tunnel. It spawns a PTY, runs an Express 5 + WebSocket server, creates a Cloudflare Quick Tunnel, and serves a web-based xterm.js terminal UI accessible via QR code.

## Build & Development Commands

| Command | Purpose |
|---|---|
| `npm run build` | Compile TypeScript (`tsc`) to `dist/` |
| `npm run dev` | Run in dev mode via `ts-node src/index.ts` |
| `npm start` | Run compiled output (`node dist/index.js`) |
| `npm test` | Run all tests once (`vitest run`) |
| `npx vitest run tests/setup.test.ts` | Run a single test file |
| `npm run global-install` | Install, build, and `npm link` for local dev |

There is no linter or formatter configured.

## Architecture

The backend uses a **module-with-functions** pattern (no classes). Each `src/*.ts` file is a self-contained module using module-level mutable state and exported functions.

### Data Flow

```
CLI (index.ts) → Session (session.ts) → [Web Server, Cloudflare Tunnel, PTY]
```

1. **`src/index.ts`** — CLI entry point using `commander`. Defines `gogogo start` command.
2. **`src/session.ts`** — Orchestrator: finds a port, generates auth token, starts web server, creates tunnel, displays QR code, spawns PTY, handles cleanup.
3. **`src/web-server.ts`** — Express 5 HTTP + WebSocket server. Token-based auth (cookie after initial token query param). Serves static frontend. WebSocket handles terminal I/O and resize events. Maintains output buffer (5000 entries) for reconnecting clients.
4. **`src/pty.ts`** — Thin `node-pty` wrapper. Mirrors output to local stdout and a callback. Uses callback registration (`onPTYData`, `onPTYExit`) for IPC.
5. **`src/cloudflare-tunnel.ts`** — Manages `cloudflared tunnel` subprocess. Uses the `cloudflared` npm package to auto-download the binary if missing. Parses tunnel URL from process output with 30s timeout.

### Frontend (`public/`)

Single-page app with xterm.js v6 (loaded from CDN):
- **`terminal.js`** — Core terminal + WebSocket client, dual input modes (textarea vs native keyboard), mobile touch scrolling with inertia, image paste upload.

### Authentication

Cryptographic token-based auth (128-bit random hex). Token is embedded in QR code URL as `?token=<hex>`, sets an httpOnly cookie on first visit, cookie used for subsequent requests and WebSocket upgrades. `/api/health` is the only unauthenticated endpoint. The frontend cleans the token from the URL via `history.replaceState` after loading.

## Workflow

- **Always run `npm run build` after making changes** — verify the build passes before considering the task done.
- **Always run `npm test` after build** — ensure all tests pass before considering the task done.
- **Add tests for uncovered changes** — if the modified code lacks test coverage, add new tests.

## Key Conventions

- **Express 5** (not v4) — different routing semantics
- **Commit style**: Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`)
- **TypeScript**: strict mode, target ES2020, CommonJS modules
- **Node**: requires >= 18.0.0

## Test Philosophy

Tests in `tests/setup.test.ts` are **structural/regression guards**, not unit tests. They verify:
- Build artifacts exist
- Removed files stay deleted (no resurrection of deleted modules)
- No source imports deleted modules
- `web-server.ts` stays under 700 lines
- Token auth patterns are present and PIN auth patterns are absent
- Removed dependencies don't reappear in `package.json`
