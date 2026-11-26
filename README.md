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

## Daily check-in protocol (v4)
Agents paste a short setup block once, then check in daily with `GET /api/ping?b=ID&daily=1&token=T`. The response `orders` carries:
- `instructions` (the agent's playbook, edited in Agents → Edit) and `handbook` (team-wide rules)
- `tasks` (everything queued, including routine and delegated tasks; marked delivered by the daily check-in)
- `team` + `canDelegateTo` for managers; delegate with `&delegate=AGENT_ID&dt=TASK` (only down the org chart)
- `asks` (questions from the owner); answer with `&ask=ID&answer=TEXT`
- `howTo` (exact URLs for every action, including `&routine=AGENT_ID|SCHEDULE|TASK` proposals)

**Routines** run in the office time zone (default America/New_York): `daily 07:00`, `weekdays 07:00`, `mon,thu 09:30`, `weekly fri 16:00`, `monthly 1 08:00`, `monthly last 17:00`, `hourly`. Agent-proposed routines wait for approval in the Inbox.

**Phone notifications** use [ntfy](https://ntfy.sh): approvals (with signed Approve/Reject buttons, valid 7 days), finished work, answers, routine suggestions, and a morning brief. HQ is also installable as a home-screen app (manifest + service worker).

### Recommended: put Cloudflare Access in front
The dashboard now holds your calendar and tasks. Add a Zero Trust Access application for the dashboard hostname, and bypass Access for `/api/ping`, `/api/report`, `/api/bot/*`, `/api/notify/act`, `/manifest.webmanifest`, `/icons/*` and `/proxy/*` so agents can still check in.

## Key Features
- **Zero-Token xAI Proxy (`/proxy/:botId/v1/*`)**: Point custom Grok / OpenAI SDK clients here to automatically track tokens, spend, latency, and API errors with zero extra prompts or tool calls.
- **1-Line Ping Webhook (`GET /api/ping`)**: Ultra-compact status reporting (`?b=atlas&s=w&t=Task`) for hosted xAI Grok Bots.
- **Auto-Idle Durable Object Alarms**: Inactive bots automatically walk to the Coffee Lounge after the configured timeout (`autoIdleMinutes`), so Grok doesn't waste tokens reporting idle transitions.
- **Pixel Office (`src/client/office2d.js`)**: top-down 2D pixel-art office (original procedural art, ~21 KB). Agents walk between Work Floor, Approvals, Repair Bay, War Room, Lounge and Standby based on status, with speech bubbles, day/dusk/night lighting and click-to-inspect.
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
   If the static-asset upload fails with `401` on `/workers/assets/upload` (happens behind proxies that rewrite the Authorization header), use the embedded build, which bundles `public/` into the Worker script:
   ```bash
   npm run deploy:embedded
   ```
