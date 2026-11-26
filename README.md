# Grok Bot HQ — Virtual Office & Command Center

A Cloudflare Workers + SQLite Durable Objects virtual office and real-time command center for monitoring your Grok Bots with **minimal Grok token overhead**.

## What's new in v3 ("Night shift")
- **Today home screen**: greeting, one-line summary, quick capture bar, and the **Day Rail**, a single timeline of your Google Calendar events and your agents' runs with a live "now" line. Below it: Needs you, My day, Agents at work, Up next, and a Since-yesterday digest.
- **Google Calendar** (`/api/calendar/*`): private Apps Script bridge (same zero-OAuth pattern as Google Tasks), week view, add/delete events, 5-minute background sync.
- **Inbox**: approvals, alerts, and a **Review work** tab for finished agent runs (open the deliverable, rate 👍/👎).
- **Quick capture** in the Today bar and ⌘K: `task: call Mike tomorrow`, `event: dentist fri 2pm 45m`, `@atlas research competitors`.
- **Agent types**: Grok, n8n, Webhook, Script/API. n8n and webhook agents get tasks **pushed instantly** (`task.dispatched` JSON with `reportUrl` and `doneUrl`); calling `doneUrl` checks the linked task off.
- **Daily rollups** table keeps per-day spend/runs/tasks history after raw rows are trimmed.
- 3D office now **lazy-loads** only when the Office tab opens. Phones get a bottom tab bar.
- Bridge secrets are no longer stored in browser localStorage.

### Recommended: put Cloudflare Access in front
The dashboard now holds your calendar and tasks. Add a Zero Trust Access application for the dashboard hostname, and bypass Access for `/api/ping`, `/api/report`, `/api/bot/*` and `/proxy/*` so agents can still check in.

## Key Features
- **Zero-Token xAI Proxy (`/proxy/:botId/v1/*`)**: Point custom Grok / OpenAI SDK clients here to automatically track tokens, spend, latency, and API errors with zero extra prompts or tool calls.
- **1-Line Ping Webhook (`GET /api/ping`)**: Ultra-compact status reporting (`?b=atlas&s=w&t=Task`) for hosted xAI Grok Bots.
- **Auto-Idle Durable Object Alarms**: Inactive bots automatically walk to the Coffee Lounge after the configured timeout (`autoIdleMinutes`), so Grok doesn't waste tokens reporting idle transitions.
- **Animated Virtual Office (`public/office.js`)**: High-DPI floor plan with Engineering & Operations pods, server rack LEDs, glass boardroom with holo-table, espresso bar steam particles, corridor waypoint pathfinding, idle lounge roaming, and collaboration energy beams.
- **Goals, Objectives & Budget Guardrails**: Track team OKRs, daily task targets, token caps, and spend caps—with automatic budget alert cards when thresholds are crossed.
- **Pending Needs & Approvals Queue**: Approve/reject/note single or batch requests, plus a tiny `GET /api/bot/:botId/status` poll endpoint.
- **Security Hardened**: HMAC-SHA256 signed `HttpOnly` session cookies, SHA-256 constant-time secret verification, strict CSP/security headers, `run_worker_first: true` asset protection, and SSRF validation on webhook callbacks.

## Local Development & Tests
```bash
npm install
npm run typecheck
npm run dev
# In another terminal:
npm test
```

## Deploy to Cloudflare
1. Authenticate Wrangler:
   ```bash
   npx wrangler login
   ```
2. Set secrets:
   ```bash
   npx wrangler secret put REPORT_SECRET
   # Recommended: protect the dashboard UI (or use Cloudflare Access in Zero Trust)
   npx wrangler secret put OFFICE_PASSWORD
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```
