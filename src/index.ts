import { DurableObject } from "cloudflare:workers";
import {
  clampText,
  createSessionCookieValue,
  isSafeCallbackUrl,
  parseCookies,
  sanitizeHexColor,
  timingSafeEqualStrings,
  verifySessionCookieValue,
  withSecurityHeaders,
} from "./security";
import { connectionLink } from "./link";
import type {
  ActivityLog,
  BotOrders,
  BotRecord,
  BotStatus,
  GrokShape,
  LogLevel,
  NeedSeverity,
  NeedStatus,
  Objective,
  ObjectiveStatus,
  OfficeSettings,
  OfficeSnapshot,
  PendingNeed,
  QueuedTask,
  ReportPayload,
  RunStatus,
  TaskRun,
  UsageBucket,
  UsageByModel,
} from "./types";

export interface Env {
  OFFICE_HUB: DurableObjectNamespace<OfficeHub>;
  ASSETS: Fetcher;
  REPORT_SECRET?: string;
  OFFICE_PASSWORD?: string;
  AI_GATEWAY_BASE_URL?: string;
}

const DEFAULT_COLORS = [
  "#3b93f0",
  "#8b5cf6",
  "#3ecf8e",
  "#f08a24",
  "#e152b0",
  "#f0b429",
  "#2fbfa0",
  "#e8483f",
  "#f1efe9",
  "#a3a3a3",
  "#8b5e3c",
  "#1e2028",
];

const GROK_SHAPES: GrokShape[] = [
  "pebble",
  "circle",
  "squircle",
  "cloud",
  "droplet",
  "capsule",
  "hexagon",
  "triangle",
];

function normalizeGrokShape(raw: unknown, fallback: GrokShape): GrokShape {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim().toLowerCase() as GrokShape;
  return GROK_SHAPES.includes(s) ? s : fallback;
}

// Multi-provider pricing per 1M tokens (xAI Grok, Google Gemini 4, Anthropic Claude)
const MODEL_PRICING_PER_M: Record<string, { in: number; out: number }> = {
  "grok-4": { in: 3.0, out: 15.0 },
  "grok-4.20-multi-agent": { in: 5.0, out: 20.0 },
  "grok-4.7": { in: 2.5, out: 10.0 },
  "grok-4.6": { in: 3.0, out: 15.0 },
  "grok-3": { in: 3.0, out: 15.0 },
  "grok-3-mini": { in: 0.3, out: 0.5 },
  "gemini-4-hydrogen": { in: 1.5, out: 7.5 },
  "gemini-4-neon": { in: 3.0, out: 15.0 },
  "gemini-4-carbon": { in: 4.0, out: 20.0 },
  "gemini-4-argon": { in: 4.0, out: 20.0 },
  "claude-opus-5.5": { in: 4.0, out: 20.0 },
  "claude-sonnet-5.5": { in: 2.0, out: 10.0 },
  "claude-fable-5.2": { in: 6.0, out: 30.0 },
  "claude-haiku-5.5": { in: 0.8, out: 4.0 },
};

const DEFAULT_SETTINGS: OfficeSettings = {
  dailyTokenCap: 500_000,
  dailyCostCapUsd: 10.0,
  dailyTaskTarget: 30,
  autoIdleMinutes: 5,
  hardBudgetStop: false,
  alertWebhookUrl: "",
};

const DEPARTMENTS = [
  "Command & Media",
  "Executive Studio",
  "Analytics Lab",
  "Engineering Lab",
  "AI News Desk",
  "Ops & Finance",
];

function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING_PER_M[model] ?? { in: 2.0, out: 10.0 };
  return Number(
    ((tokensIn / 1_000_000) * pricing.in + (tokensOut / 1_000_000) * pricing.out).toFixed(6)
  );
}

function normalizeStatus(raw: unknown, fallback: BotStatus = "working"): BotStatus {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim().toLowerCase();
  if (s === "w" || s === "work" || s === "working" || s === "active" || s === "busy") return "working";
  if (s === "i" || s === "idle" || s === "done" || s === "break" || s === "lounge") return "idle";
  if (s === "wait" || s === "waiting" || s === "approval" || s === "need" || s === "blocked") return "waiting";
  if (s === "e" || s === "err" || s === "error" || s === "failed") return "error";
  if (s === "m" || s === "meet" || s === "meeting" || s === "collab") return "meeting";
  if (s === "nr" || s === "no_report" || s === "noreport" || s === "offline") return "no_report";
  return fallback;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function isReportAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.REPORT_SECRET) return true;
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  const bearerMatch = auth?.match(/^Bearer\s+(.+)$/i);
  const candidate =
    (bearerMatch ? bearerMatch[1].trim() : null) ??
    request.headers.get("x-report-secret")?.trim() ??
    url.searchParams.get("token")?.trim() ??
    "";
  if (!candidate) return false;
  return timingSafeEqualStrings(candidate, env.REPORT_SECRET);
}

export class OfficeHub extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
    });
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT 'Engineering Lab',
        avatar_color TEXT NOT NULL,
        avatar_shape TEXT NOT NULL DEFAULT 'pebble',
        desk_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        task TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT 'grok-4',
        tokens_total INTEGER NOT NULL DEFAULT 0,
        cost_total_usd REAL NOT NULL DEFAULT 0,
        requests_total INTEGER NOT NULL DEFAULT 0,
        tasks_completed INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        expected_interval_min INTEGER NOT NULL DEFAULT 0,
        sla_alerted INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT NOT NULL,
        collaborating_with TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_needs (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        bot_name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'approval',
        status TEXT NOT NULL DEFAULT 'open',
        callback_url TEXT,
        resolution_note TEXT,
        escalated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        is_error INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        bot_name TEXT NOT NULL,
        bot_color TEXT NOT NULL DEFAULT '#38bdf8',
        status TEXT NOT NULL DEFAULT 'working',
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        simulated INTEGER NOT NULL DEFAULT 0,
        task_done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        bot_name TEXT NOT NULL,
        model TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        output_url TEXT,
        result_summary TEXT,
        quality_rating INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_sec INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS task_queue (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS objectives (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner_bot_id TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        target_label TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS office_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_needs_status ON pending_needs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_started ON task_runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_queue_bot ON task_queue(bot_id, status, created_at);
    `);

    const botCols = this.sql
      .exec<{ name: string }>("PRAGMA table_info(bots)")
      .toArray()
      .map((c) => c.name);
    if (!botCols.includes("tasks_completed")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN tasks_completed INTEGER NOT NULL DEFAULT 0");
    }
    if (!botCols.includes("error_count")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0");
    }
    if (!botCols.includes("department")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN department TEXT NOT NULL DEFAULT 'Engineering Lab'");
    }
    if (!botCols.includes("avatar_shape")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN avatar_shape TEXT NOT NULL DEFAULT 'pebble'");
    }
    if (!botCols.includes("expected_interval_min")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN expected_interval_min INTEGER NOT NULL DEFAULT 0");
    }
    if (!botCols.includes("sla_alerted")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN sla_alerted INTEGER NOT NULL DEFAULT 0");
    }

    const needCols = this.sql
      .exec<{ name: string }>("PRAGMA table_info(pending_needs)")
      .toArray()
      .map((c) => c.name);
    if (!needCols.includes("escalated")) {
      this.sql.exec("ALTER TABLE pending_needs ADD COLUMN escalated INTEGER NOT NULL DEFAULT 0");
    }

    const usageCols = this.sql
      .exec<{ name: string }>("PRAGMA table_info(usage_events)")
      .toArray()
      .map((c) => c.name);
    if (!usageCols.includes("is_error")) {
      this.sql.exec("ALTER TABLE usage_events ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0");
    }

    const logCols = this.sql
      .exec<{ name: string }>("PRAGMA table_info(activity_logs)")
      .toArray()
      .map((c) => c.name);
    if (!logCols.includes("bot_color")) {
      this.sql.exec("ALTER TABLE activity_logs ADD COLUMN bot_color TEXT NOT NULL DEFAULT '#38bdf8'");
    }
    if (!logCols.includes("status")) {
      this.sql.exec("ALTER TABLE activity_logs ADD COLUMN status TEXT NOT NULL DEFAULT 'working'");
    }
    if (!logCols.includes("simulated")) {
      this.sql.exec("ALTER TABLE activity_logs ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0");
    }
    if (!logCols.includes("task_done")) {
      this.sql.exec("ALTER TABLE activity_logs ADD COLUMN task_done INTEGER NOT NULL DEFAULT 0");
    }

    const purgedFlag = this.sql
      .exec<{ value: string }>("SELECT value FROM office_settings WHERE key = 'purged_demo_v2'")
      .toArray()[0];
    if (!purgedFlag) {
      this.sql.exec(`
        DELETE FROM bots
        WHERE id IN (
          'audience-bot','architect-bot','mel-chief','stats-bot','vidperf-bot',
          'conclusions-bot','kyle-coo','systems-bot','accuracy-bot','jacob-news',
          'johnny-editor','ledger-ops','planner-ops','thangs-scout',
          'atlas','atlas-bot','nova','nova-bot','pulse','pulse-bot',
          'ledger','ledger-bot','echo','echo-bot','scribe','scribe-bot'
        )
        OR id IN (SELECT DISTINCT bot_id FROM activity_logs WHERE simulated = 1);
        DELETE FROM activity_logs
        WHERE simulated = 1
           OR bot_id NOT IN (SELECT id FROM bots);
        DELETE FROM pending_needs
        WHERE bot_id != 'system'
          AND bot_id NOT IN (SELECT id FROM bots);
        DELETE FROM usage_events
        WHERE bot_id NOT IN (SELECT id FROM bots);
        DELETE FROM objectives
        WHERE id IN ('obj-q4-intel', 'obj-edge-deploy', 'obj-analytics-audit');
        INSERT OR REPLACE INTO office_settings (key, value) VALUES ('purged_demo_v2', 'true');
      `);
    }

    // One-time cleanup: switch existing bots to On-demand SLA (Off) and clear false missed-check-in alerts
    const clearedSlaFlag = this.sql
      .exec<{ value: string }>("SELECT value FROM office_settings WHERE key = 'cleared_sla_v1'")
      .toArray()[0];
    if (!clearedSlaFlag) {
      const now = new Date().toISOString();
      this.sql.exec(
        `UPDATE bots
         SET expected_interval_min = 0,
             sla_alerted = 0,
             status = CASE
               WHEN status = 'error' AND task LIKE 'Missed scheduled check-in%' THEN 'idle'
               ELSE status
             END,
             task = CASE
               WHEN status = 'error' AND task LIKE 'Missed scheduled check-in%' THEN 'Standing by in Lounge'
               ELSE task
             END`
      );
      this.sql.exec(
        `UPDATE pending_needs
         SET status = 'resolved',
             resolution_note = 'Auto-cleared (SLA switched to On-demand)',
             resolved_at = ?
         WHERE status = 'open' AND (id LIKE 'sla-%' OR title LIKE 'Missed scheduled check-in%')`,
        now
      );
      this.sql.exec("INSERT OR REPLACE INTO office_settings (key, value) VALUES ('cleared_sla_v1', 'true')");
    }
  }

  async alarm(): Promise<void> {
    const settings = this.getSettings();
    const nowMs = Date.now();
    const idleCutoffMs = nowMs - Math.max(1, settings.autoIdleMinutes) * 60_000;
    const noReportCutoffMs = nowMs - 24 * 60 * 60_000;
    const slaEscalationMs = 30 * 60_000;

    const allBots = this.sql
      .exec<{
        id: string;
        name: string;
        avatar_color: string;
        status: BotStatus;
        last_seen_at: string;
        expected_interval_min: number;
        sla_alerted: number;
      }>("SELECT id, name, avatar_color, status, last_seen_at, expected_interval_min, sla_alerted FROM bots")
      .toArray();

    let changed = false;
    let needNextAlarm = false;
    const now = new Date().toISOString();

    for (const bot of allBots) {
      const lastSeen = Date.parse(bot.last_seen_at);
      if (!Number.isFinite(lastSeen)) continue;

      if ((bot.status === "working" || bot.status === "meeting") && lastSeen < idleCutoffMs) {
        this.sql.exec(
          "UPDATE bots SET status = 'idle', collaborating_with = NULL, task = 'Auto-idled in Central Lounge' WHERE id = ?",
          bot.id
        );
        this.finalizeActiveRun(bot.id, "completed", null, null, now);
        this.insertLog(
          bot.id,
          bot.name,
          bot.avatar_color,
          "idle",
          "info",
          `Walked to Lounge (auto-idle after ${settings.autoIdleMinutes}m)`,
          false,
          now,
          0
        );
        changed = true;
      } else if (bot.status === "idle" && lastSeen < noReportCutoffMs) {
        this.sql.exec(
          "UPDATE bots SET status = 'no_report', task = 'No report in 24h' WHERE id = ?",
          bot.id
        );
        changed = true;
      } else if (bot.status === "working" || bot.status === "meeting") {
        needNextAlarm = true;
      }

      // Expected Check-in Schedule (Cron Heartbeat SLA)
      if (bot.expected_interval_min > 0) {
        needNextAlarm = true;
        const slaCutoff = nowMs - bot.expected_interval_min * 60_000;
        if (lastSeen < slaCutoff && bot.sla_alerted === 0) {
          const title = `Missed scheduled check-in (${bot.expected_interval_min}m SLA)`;
          const desc = `${bot.name} has not checked in for over ${bot.expected_interval_min} minutes.`;
          this.sql.exec(
            "UPDATE bots SET status = 'error', sla_alerted = 1, task = ? WHERE id = ?",
            title,
            bot.id
          );
          this.sql.exec(
            `INSERT INTO pending_needs (id, bot_id, bot_name, title, description, severity, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'error', 'open', ?)
             ON CONFLICT(id) DO UPDATE SET status = 'open', description = excluded.description`,
            `sla-${bot.id}`,
            bot.id,
            bot.name,
            title,
            desc,
            now
          );
          this.insertLog(bot.id, bot.name, bot.avatar_color, "error", "error", title, false, now, 0);
          this.fireAlertWebhook(title, desc, "error", bot.name);
          changed = true;
        }
      }
    }

    // Approval SLA Escalation: re-alert if an open approval has waited > 30 minutes
    const staleNeeds = this.sql
      .exec<{
        id: string;
        bot_id: string;
        bot_name: string;
        title: string;
        created_at: string;
      }>("SELECT id, bot_id, bot_name, title, created_at FROM pending_needs WHERE status = 'open' AND escalated = 0")
      .toArray();

    for (const need of staleNeeds) {
      needNextAlarm = true;
      const createdMs = Date.parse(need.created_at);
      if (Number.isFinite(createdMs) && nowMs - createdMs >= slaEscalationMs) {
        this.sql.exec("UPDATE pending_needs SET escalated = 1 WHERE id = ?", need.id);
        this.insertLog(
          need.bot_id,
          need.bot_name,
          "#f59e0b",
          "waiting",
          "warn",
          `SLA reminder: "${need.title}" waiting > 30m`,
          false,
          now,
          0
        );
        this.fireAlertWebhook(
          `SLA Reminder (Waiting > 30m): ${need.title}`,
          `${need.bot_name} has been waiting for over 30 minutes.`,
          "waiting",
          need.bot_name
        );
        changed = true;
      }
    }

    if (changed) {
      this.broadcastSnapshot();
    }
    if (needNextAlarm) {
      await this.ctx.storage.setAlarm(nowMs + 60_000);
    }
  }

  private async ensureAlarmScheduled(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  private finalizeActiveRun(
    botId: string,
    nextStatus: RunStatus,
    outputUrl: string | null,
    resultSummary: string | null,
    now: string
  ): void {
    const activeRun = this.sql
      .exec<{ id: string; started_at: string }>(
        "SELECT id, started_at FROM task_runs WHERE bot_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1",
        botId
      )
      .toArray()[0];
    if (!activeRun) return;
    const startMs = Date.parse(activeRun.started_at);
    const durSec = Number.isFinite(startMs) ? Math.max(1, Math.round((Date.parse(now) - startMs) / 1000)) : 0;
    this.sql.exec(
      `UPDATE task_runs
       SET status = ?, finished_at = ?, duration_sec = ?,
           output_url = COALESCE(?, output_url),
           result_summary = COALESCE(?, result_summary)
       WHERE id = ?`,
      nextStatus,
      now,
      durSec,
      outputUrl,
      resultSummary,
      activeRun.id
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(
        JSON.stringify({
          type: "snapshot",
          data: this.getSnapshot(),
        })
      );
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      return jsonResponse(this.getSnapshot());
    }

    if (url.pathname === "/api/guardrail-check" && request.method === "GET") {
      const budget = this.getBudgetState();
      return jsonResponse({
        blocked: budget.blocked,
        hardBudgetStop: budget.hardBudgetStop,
        todayTokens: budget.todayTokens,
        todayCostUsd: budget.todayCostUsd,
        dailyTokenCap: budget.dailyTokenCap,
        dailyCostCapUsd: budget.dailyCostCapUsd,
        reason: budget.reason,
      });
    }

    if (url.pathname === "/api/ping" && (request.method === "GET" || request.method === "POST")) {
      if (!(await isReportAuthorized(request, this.env))) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const botId = clampText(url.searchParams.get("b") ?? url.searchParams.get("botId"), 64);
      if (!botId) {
        return jsonResponse({ error: "Query param ?b=<botId> is required" }, 400);
      }
      const rawOut = clampText(url.searchParams.get("out") ?? url.searchParams.get("outputUrl"), 400);
      const payload: ReportPayload = {
        botId,
        name: clampText(url.searchParams.get("n") ?? url.searchParams.get("name"), 64) || undefined,
        role: clampText(url.searchParams.get("r") ?? url.searchParams.get("role"), 64) || undefined,
        department:
          clampText(url.searchParams.get("d") ?? url.searchParams.get("department"), 48) || undefined,
        shape: (clampText(url.searchParams.get("shape"), 24) as GrokShape) || undefined,
        status: url.searchParams.get("s") ?? url.searchParams.get("status") ?? undefined,
        task: clampText(url.searchParams.get("t") ?? url.searchParams.get("task"), 200) || undefined,
        model: clampText(url.searchParams.get("m") ?? url.searchParams.get("model"), 64) || undefined,
        done: url.searchParams.get("done") === "1" || url.searchParams.get("done") === "true",
        outputUrl: rawOut || undefined,
        result: clampText(url.searchParams.get("result") ?? url.searchParams.get("summary"), 240) || undefined,
        detectLoop: true,
      };
      const tokensIn = Number(url.searchParams.get("in") ?? 0);
      const tokensOut = Number(url.searchParams.get("out_tok") ?? url.searchParams.get("tokensOut") ?? 0);
      const latencyMs = Number(url.searchParams.get("ms") ?? 0);
      if (tokensIn > 0 || tokensOut > 0) {
        payload.usage = { model: payload.model, tokensIn, tokensOut, latencyMs };
      }
      const objectiveId = clampText(
        url.searchParams.get("obj") ?? url.searchParams.get("objectiveId"),
        64
      );
      if (objectiveId) payload.objectiveId = objectiveId;
      const progRaw = url.searchParams.get("prog") ?? url.searchParams.get("progress");
      if (progRaw) {
        const prog = Number(progRaw);
        if (Number.isFinite(prog)) payload.objectiveProgress = prog;
      }
      const needTitle = clampText(url.searchParams.get("need"), 140);
      if (needTitle) {
        payload.need = {
          title: needTitle,
          severity: (url.searchParams.get("sev") as NeedSeverity) || "approval",
        };
        if (!payload.status) payload.status = "waiting";
      }

      const result = await this.handleReport(payload, { isBotCheckIn: true });
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...this.withOrders(result) });
    }

    if (url.pathname === "/api/report" && request.method === "POST") {
      if (!(await isReportAuthorized(request, this.env))) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const contentLen = Number(request.headers.get("content-length") ?? 0);
      if (contentLen > 65_536) {
        return jsonResponse({ error: "Payload too large (max 64 KB)" }, 413);
      }
      let payload: ReportPayload;
      try {
        payload = (await request.json()) as ReportPayload;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }
      const botId = clampText(payload.botId ?? payload.b, 64);
      if (!botId) {
        return jsonResponse({ error: "botId (or b) is required" }, 400);
      }
      payload.botId = botId;
      payload.detectLoop = payload.detectLoop ?? true;
      const result = await this.handleReport(payload, { isBotCheckIn: true });
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...this.withOrders(result) });
    }

    if (url.pathname === "/api/bots" && request.method === "POST") {
      let body: {
        botId?: string;
        name?: string;
        role?: string;
        avatarColor?: string;
        status?: BotStatus;
        task?: string;
        model?: string;
        expectedIntervalMinutes?: number;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const name = clampText(body.name, 40);
      if (!name) {
        return jsonResponse({ error: "Bot name is required" }, 400);
      }
      const rawSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
      const botId = clampText(body.botId, 64) || rawSlug || `grok-${crypto.randomUUID().slice(0, 6)}`;
      const status = normalizeStatus(body.status, "idle");
      const task = clampText(body.task, 200) || (status === "working" ? "Active in Workfloor" : "Standing by in Lounge");
      const result = await this.handleReport({
        botId,
        name,
        role: clampText(body.role, 48) || "Grok Agent",
        avatarColor: body.avatarColor,
        status,
        task,
        model: clampText(body.model, 64) || "grok-4",
        expectedIntervalMinutes: body.expectedIntervalMinutes,
        message: `Added ${name} (${clampText(body.role, 48) || "Grok Agent"}) to HQ`,
      });
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...result });
    }

    const botUpdateMatch = url.pathname.match(/^\/api\/bot\/([^/]+)\/update$/);
    if (botUpdateMatch && request.method === "POST") {
      if (!(await isReportAuthorized(request, this.env))) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const contentLen = Number(request.headers.get("content-length") ?? 0);
      if (contentLen > 65_536) {
        return jsonResponse({ error: "Payload too large (max 64 KB)" }, 413);
      }
      const botId = decodeURIComponent(botUpdateMatch[1]);
      let body: ReportPayload & {
        tokensIn?: number;
        tokensOut?: number;
        latencyMs?: number;
        progress?: number;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }
      const tokensIn = Number(body.usage?.tokensIn ?? body.tokensIn ?? 0);
      const tokensOut = Number(body.usage?.tokensOut ?? body.tokensOut ?? 0);
      const latencyMs = Number(body.usage?.latencyMs ?? body.latencyMs ?? 0);
      const progressRaw = body.objectiveProgress ?? body.progress;
      const result = await this.handleReport(
        {
          ...body,
          botId,
          detectLoop: body.detectLoop ?? true,
          objectiveProgress:
            progressRaw !== undefined && Number.isFinite(Number(progressRaw))
              ? Number(progressRaw)
              : undefined,
          usage:
            tokensIn > 0 || tokensOut > 0 || latencyMs > 0
              ? {
                  model: body.usage?.model ?? body.model,
                  tokensIn,
                  tokensOut,
                  latencyMs,
                  costUsd: body.usage?.costUsd,
                  error: body.usage?.error,
                }
              : body.usage,
        },
        { isBotCheckIn: true }
      );
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...this.withOrders(result) });
    }

    const botStatusMatch = url.pathname.match(/^\/api\/bot\/([^/]+)\/status$/);
    if (botStatusMatch && request.method === "GET") {
      if (!(await isReportAuthorized(request, this.env))) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const botId = decodeURIComponent(botStatusMatch[1]);
      const botRow = this.sql
        .exec<{
          status: BotStatus;
          task: string;
          role: string;
          model: string;
          name: string;
          last_seen_at: string;
          expected_interval_min: number;
        }>(
          "SELECT status, task, role, model, name, last_seen_at, expected_interval_min FROM bots WHERE id = ?",
          botId
        )
        .toArray()[0];
      const queuedRows = this.sql
        .exec<{ id: string; task: string }>(
          "SELECT id, task FROM task_queue WHERE bot_id = ? AND status = 'queued' ORDER BY created_at ASC",
          botId
        )
        .toArray();
      const shouldPop = url.searchParams.get("pop") === "1";
      let nextTask = queuedRows[0]?.task ?? null;
      if (shouldPop && queuedRows.length > 0) {
        this.sql.exec("UPDATE task_queue SET status = 'dispatched' WHERE id = ?", queuedRows[0].id);
        this.sql.exec("UPDATE bots SET task = ? WHERE id = ?", queuedRows[0].task, botId);
        nextTask = queuedRows[0].task;
        this.broadcastSnapshot();
      }
      const needs = this.listNeeds(botId, null);
      const openNeeds = needs.filter((n) => n.status === "open").length;
      const latest = needs[0];
      const settings = this.getSettings();
      const orders = this.buildOrders(botId);
      if (nextTask) orders.nextTask = nextTask;
      return jsonResponse({
        botId,
        name: botRow?.name ?? null,
        status: botRow?.status ?? null,
        assignedTask: shouldPop && nextTask ? nextTask : botRow?.task ?? null,
        nextTask: orders.nextTask,
        queuedTasks: shouldPop ? queuedRows.slice(1).map((q) => q.task) : queuedRows.map((q) => q.task),
        role: botRow?.role ?? null,
        model: botRow?.model ?? null,
        openNeeds,
        latestDecision: latest ? latest.status : null,
        note: latest?.resolutionNote ?? null,
        link: botRow
          ? connectionLink(
              botRow.last_seen_at,
              botRow.expected_interval_min ?? 0,
              settings.autoIdleMinutes,
              Date.now(),
              botRow.status
            )
          : "waiting",
        orders,
      });
    }

    const botQueueMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/queue$/);
    if (botQueueMatch && request.method === "POST") {
      const botId = decodeURIComponent(botQueueMatch[1]);
      const body = (await request.json().catch(() => ({}))) as { task?: string };
      const task = clampText(body.task, 200);
      if (!task) return jsonResponse({ error: "task is required" }, 400);
      const id = crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO task_queue (id, bot_id, task, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
        id,
        botId,
        task,
        new Date().toISOString()
      );
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, id });
    }

    const botQueueDelMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/queue\/([^/]+)$/);
    if (botQueueDelMatch && request.method === "DELETE") {
      const botId = decodeURIComponent(botQueueDelMatch[1]);
      const queueId = decodeURIComponent(botQueueDelMatch[2]);
      this.sql.exec("DELETE FROM task_queue WHERE id = ? AND bot_id = ?", queueId, botId);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    const runRateMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/rate$/);
    if (runRateMatch && request.method === "POST") {
      const runId = decodeURIComponent(runRateMatch[1]);
      const body = (await request.json().catch(() => ({}))) as { rating?: number };
      const rating = body.rating === 1 ? 1 : body.rating === -1 ? -1 : 0;
      this.sql.exec("UPDATE task_runs SET quality_rating = ? WHERE id = ?", rating, runId);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, runId, rating });
    }

    const botDeleteMatch = url.pathname.match(/^\/api\/bots\/([^/]+)$/);
    if (botDeleteMatch && request.method === "DELETE") {
      const botId = decodeURIComponent(botDeleteMatch[1]);
      this.sql.exec("DELETE FROM bots WHERE id = ?", botId);
      this.sql.exec("DELETE FROM pending_needs WHERE bot_id = ? AND status = 'open'", botId);
      this.sql.exec("DELETE FROM task_runs WHERE bot_id = ?", botId);
      this.sql.exec("DELETE FROM task_queue WHERE bot_id = ?", botId);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, deletedBotId: botId });
    }

    const botCmdMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/command$/);
    if (botCmdMatch && request.method === "POST") {
      const botId = decodeURIComponent(botCmdMatch[1]);
      let body: {
        name?: string;
        role?: string;
        model?: string;
        avatarColor?: string;
        status?: BotStatus;
        task?: string;
        enqueue?: boolean;
        deskIndex?: number;
        department?: string;
        expectedIntervalMinutes?: number;
        collaboratingWith?: string | null;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      let nextStatus = body.status;
      let nextTask = body.task;
      if (body.expectedIntervalMinutes !== undefined && Number(body.expectedIntervalMinutes) <= 0) {
        const curBot = this.sql
          .exec<{ status: BotStatus; task: string }>("SELECT status, task FROM bots WHERE id = ?", botId)
          .toArray()[0];
        this.sql.exec(
          `UPDATE pending_needs
           SET status = 'resolved',
               resolution_note = 'SLA turned off',
               resolved_at = ?
           WHERE bot_id = ? AND status = 'open' AND (id LIKE 'sla-%' OR title LIKE 'Missed scheduled check-in%')`,
          new Date().toISOString(),
          botId
        );
        if (!nextStatus && curBot?.status === "error" && curBot.task.startsWith("Missed scheduled check-in")) {
          nextStatus = "idle";
          nextTask = nextTask ?? "Standing by in Lounge";
        }
      }
      const queuedTask = body.enqueue === false ? "" : clampText(body.task, 200);
      const result = await this.handleReport({
        botId,
        name: body.name,
        role: body.role,
        model: body.model,
        avatarColor: body.avatarColor,
        status: nextStatus,
        task: nextTask,
        deskIndex: body.deskIndex,
        department: body.department,
        expectedIntervalMinutes: body.expectedIntervalMinutes,
        collaboratingWith: body.collaboratingWith,
        message: queuedTask
          ? `HQ queued command: "${clampText(queuedTask, 120)}"`
          : body.task
          ? `HQ assigned task: "${clampText(body.task, 120)}"`
          : body.expectedIntervalMinutes !== undefined
          ? `Updated heartbeat SLA → ${body.expectedIntervalMinutes > 0 ? `${body.expectedIntervalMinutes}m` : "Off (On-demand)"}`
          : body.status
          ? `Moved bot → ${body.status}`
          : "Updated bot profile from HQ",
      });
      if (queuedTask) {
        const dup = this.sql
          .exec<{ id: string }>(
            "SELECT id FROM task_queue WHERE bot_id = ? AND status = 'queued' AND lower(trim(task)) = lower(trim(?)) LIMIT 1",
            botId,
            queuedTask
          )
          .toArray()[0];
        if (!dup) {
          this.sql.exec(
            "INSERT INTO task_queue (id, bot_id, task, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
            crypto.randomUUID(),
            botId,
            queuedTask,
            new Date().toISOString()
          );
        }
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...result, queued: Boolean(queuedTask) });
    }

    if (url.pathname === "/api/needs" && request.method === "GET") {
      const botId = url.searchParams.get("botId");
      const status = url.searchParams.get("status");
      return jsonResponse({ needs: this.listNeeds(botId, status) });
    }

    if (url.pathname === "/api/needs/resolve-all" && request.method === "POST") {
      const openApprovals = this.listNeeds(null, "open").filter(
        (n) => n.severity === "approval" || n.severity === "input"
      );
      for (const need of openApprovals) {
        await this.resolveNeed(need.id, "approve", "Batch approved from HQ");
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, resolvedCount: openApprovals.length });
    }

    const resolveMatch = url.pathname.match(/^\/api\/needs\/([^/]+)\/resolve$/);
    if (resolveMatch && request.method === "POST") {
      const needId = decodeURIComponent(resolveMatch[1]);
      let body: { action?: "approve" | "reject" | "resolve"; note?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        // Optional body
      }
      const updated = await this.resolveNeed(
        needId,
        body.action ?? "approve",
        clampText(body.note, 300)
      );
      if (!updated) {
        return jsonResponse({ error: "Pending need not found" }, 404);
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, need: updated });
    }

    if (url.pathname === "/api/objectives" && request.method === "GET") {
      return jsonResponse({ objectives: this.listObjectives() });
    }

    if (url.pathname === "/api/objectives" && request.method === "POST") {
      let body: {
        id?: string;
        title?: string;
        ownerBotId?: string | null;
        progress?: number;
        targetLabel?: string;
        status?: ObjectiveStatus;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const title = clampText(body.title, 120);
      if (!title) return jsonResponse({ error: "title is required" }, 400);
      const id = clampText(body.id, 64) || crypto.randomUUID();
      const progress = Math.max(0, Math.min(100, Math.round(Number(body.progress ?? 0))));
      const status: ObjectiveStatus =
        body.status ?? (progress >= 100 ? "completed" : "active");
      const now = new Date().toISOString();

      this.sql.exec(
        `INSERT INTO objectives (id, title, owner_bot_id, progress, target_label, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           owner_bot_id = excluded.owner_bot_id,
           progress = excluded.progress,
           target_label = excluded.target_label,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        id,
        title,
        clampText(body.ownerBotId, 64) || null,
        progress,
        clampText(body.targetLabel, 80),
        status,
        now
      );
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, id });
    }

    const objMatch = url.pathname.match(/^\/api\/objectives\/([^/]+)$/);
    if (objMatch && request.method === "PATCH") {
      const id = decodeURIComponent(objMatch[1]);
      const body = (await request.json().catch(() => ({}))) as {
        progress?: number;
        status?: ObjectiveStatus;
      };
      const existing = this.sql
        .exec<{ id: string; progress: number; status: ObjectiveStatus }>(
          "SELECT id, progress, status FROM objectives WHERE id = ?",
          id
        )
        .toArray()[0];
      if (!existing) return jsonResponse({ error: "Objective not found" }, 404);
      const progress =
        body.progress !== undefined
          ? Math.max(0, Math.min(100, Math.round(Number(body.progress))))
          : existing.progress;
      const status: ObjectiveStatus =
        body.status ?? (progress >= 100 ? "completed" : "active");
      this.sql.exec(
        "UPDATE objectives SET progress = ?, status = ?, updated_at = ? WHERE id = ?",
        progress,
        status,
        new Date().toISOString(),
        id
      );
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    if (objMatch && request.method === "DELETE") {
      const id = decodeURIComponent(objMatch[1]);
      this.sql.exec("DELETE FROM objectives WHERE id = ?", id);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/settings" && request.method === "GET") {
      return jsonResponse({ settings: this.getSettings() });
    }

    if (url.pathname === "/api/settings" && request.method === "POST") {
      let body: Partial<OfficeSettings>;
      try {
        body = (await request.json()) as Partial<OfficeSettings>;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const cur = this.getSettings();
      const rawWebhook = clampText(body.alertWebhookUrl ?? cur.alertWebhookUrl, 300);
      const safeWebhook = rawWebhook && isSafeCallbackUrl(rawWebhook) ? rawWebhook : "";
      const next: OfficeSettings = {
        dailyTokenCap: Math.max(1000, Math.round(Number(body.dailyTokenCap ?? cur.dailyTokenCap))),
        dailyCostCapUsd: Math.max(0.1, Number(body.dailyCostCapUsd ?? cur.dailyCostCapUsd)),
        dailyTaskTarget: Math.max(1, Math.round(Number(body.dailyTaskTarget ?? cur.dailyTaskTarget))),
        autoIdleMinutes: Math.max(1, Math.min(120, Math.round(Number(body.autoIdleMinutes ?? cur.autoIdleMinutes)))),
        hardBudgetStop:
          body.hardBudgetStop !== undefined ? Boolean(body.hardBudgetStop) : cur.hardBudgetStop,
        alertWebhookUrl: safeWebhook,
      };
      for (const [k, v] of Object.entries(next)) {
        this.sql.exec(
          `INSERT INTO office_settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          k,
          String(v)
        );
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, settings: next });
    }

    if (url.pathname === "/api/export.csv" && request.method === "GET") {
      const rows = this.sql
        .exec<{
          created_at: string;
          bot_id: string;
          model: string;
          tokens_in: number;
          tokens_out: number;
          cost_usd: number;
          latency_ms: number;
          is_error: number;
        }>("SELECT * FROM usage_events ORDER BY created_at DESC LIMIT 1000")
        .toArray();
      const header = "timestamp,bot_id,model,tokens_in,tokens_out,cost_usd,latency_ms,is_error\n";
      const lines = rows
        .map(
          (r) =>
            `${r.created_at},${r.bot_id},${r.model},${r.tokens_in},${r.tokens_out},${r.cost_usd},${r.latency_ms},${r.is_error}`
        )
        .join("\n");
      return new Response(header + lines, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="grok-office-usage.csv"',
        },
      });
    }

    if (
      (url.pathname === "/api/office/reset" || url.pathname === "/api/demo/reset") &&
      request.method === "POST"
    ) {
      this.resetOffice();
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, snapshot: this.getSnapshot() });
    }

    return jsonResponse({ error: "Not found" }, 404);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === "string" && message === "ping") {
      ws.send(JSON.stringify({ type: "pong", time: new Date().toISOString() }));
    }
  }

  webSocketClose(_ws: WebSocket): void {
    // Handled by Hibernation runtime
  }

  private broadcastSnapshot(): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const msg = JSON.stringify({
      type: "snapshot",
      data: this.getSnapshot(),
    });
    for (const ws of sockets) {
      try {
        ws.send(msg);
      } catch {
        // Ignore broken sockets
      }
    }
  }

  private getBudgetState(): {
    blocked: boolean;
    hardBudgetStop: boolean;
    todayTokens: number;
    todayCostUsd: number;
    dailyTokenCap: number;
    dailyCostCapUsd: number;
    reason: string | null;
  } {
    const settings = this.getSettings();
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayTotals = this.sql
      .exec<{ tokens: number; cost: number }>(
        `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost
         FROM usage_events WHERE created_at >= ?`,
        `${todayPrefix}T00:00:00.000Z`
      )
      .one();
    const todayTokens = todayTotals?.tokens ?? 0;
    const todayCostUsd = Number((todayTotals?.cost ?? 0).toFixed(4));
    const overCost = settings.dailyCostCapUsd > 0 && todayCostUsd >= settings.dailyCostCapUsd;
    const overTok = settings.dailyTokenCap > 0 && todayTokens >= settings.dailyTokenCap;
    return {
      blocked: Boolean(settings.hardBudgetStop && (overCost || overTok)),
      hardBudgetStop: settings.hardBudgetStop,
      todayTokens,
      todayCostUsd,
      dailyTokenCap: settings.dailyTokenCap,
      dailyCostCapUsd: settings.dailyCostCapUsd,
      reason: overCost
        ? `Daily spend cap reached ($${todayCostUsd.toFixed(2)} / $${settings.dailyCostCapUsd.toFixed(2)})`
        : overTok
        ? `Daily token cap reached (${todayTokens.toLocaleString()} / ${settings.dailyTokenCap.toLocaleString()})`
        : null,
    };
  }

  private buildOrders(botId: string): BotOrders {
    const queued = this.sql
      .exec<{ task: string }>(
        "SELECT task FROM task_queue WHERE bot_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1",
        botId
      )
      .toArray()[0];
    const needs = this.listNeeds(botId, null);
    const latest = needs.find((n) => n.status !== "open" && n.resolvedAt);
    let decision: string | null = null;
    if (latest?.resolvedAt) {
      const age = Date.now() - Date.parse(latest.resolvedAt);
      if (age >= 0 && age < 6 * 60 * 60_000) {
        const note = latest.resolutionNote ? ` — ${latest.resolutionNote}` : "";
        decision = clampText(`${latest.status}: ${latest.title}${note}`, 180);
      }
    }
    const goal = this.listObjectives().find((o) => o.ownerBotId === botId && o.status === "active");
    return {
      nextTask: queued?.task ?? null,
      decision,
      goal: goal ? goal.title : null,
      goalId: goal ? goal.id : null,
      goalProgress: goal ? goal.progress : null,
      budgetBlocked: this.getBudgetState().blocked,
    };
  }

  private withOrders<T extends { botId: string; nextTask?: string | null }>(
    result: T
  ): T & { orders: BotOrders } {
    const orders = this.buildOrders(result.botId);
    if (result.nextTask) orders.nextTask = result.nextTask;
    return { ...result, orders };
  }

  private fireAlertWebhook(title: string, detail: string, severity: string, botName: string): void {
    const settings = this.getSettings();
    const url = settings.alertWebhookUrl;
    if (!url || !isSafeCallbackUrl(url)) return;
    const payload = {
      content: `**[Grok Bot HQ — ${severity.toUpperCase()}]** **${botName}**: ${title}${detail ? `\n> ${detail}` : ""}`,
      text: `[Grok Bot HQ — ${severity.toUpperCase()}] ${botName}: ${title}${detail ? ` — ${detail}` : ""}`,
      botName,
      severity,
      title,
      detail,
      timestamp: new Date().toISOString(),
    };
    this.ctx.waitUntil(
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {})
    );
  }

  private async handleReport(
    payload: ReportPayload,
    options: { isBotCheckIn?: boolean } = {}
  ): Promise<{ botId: string; needId?: string; nextTask?: string | null; loopDetected?: boolean }> {
    const now = new Date().toISOString();
    const botId = clampText(payload.botId ?? payload.b, 64);

    const existing = this.sql
      .exec<{
        id: string;
        name: string;
        role: string;
        department: string;
        avatar_color: string;
        avatar_shape?: string;
        desk_index: number;
        status: BotStatus;
        task: string;
        model: string;
        expected_interval_min: number;
        collaborating_with: string | null;
      }>("SELECT * FROM bots WHERE id = ?", botId)
      .toArray()[0];

    const countRow = this.sql
      .exec<{ cnt: number }>("SELECT COUNT(*) as cnt FROM bots")
      .one();

    const nextDeskIndex =
      payload.deskIndex !== undefined
        ? Math.max(0, Math.min(24, Math.floor(payload.deskIndex)))
        : existing?.desk_index ?? (countRow?.cnt ?? 0);

    const name = clampText(payload.name, 40) || existing?.name || botId;
    const role = clampText(payload.role, 48) || existing?.role || "Grok Agent";
    const department =
      clampText(payload.department ?? payload.d, 48) ||
      existing?.department ||
      DEPARTMENTS[nextDeskIndex % DEPARTMENTS.length];
    const avatarColor = sanitizeHexColor(
      payload.avatarColor,
      existing?.avatar_color ?? DEFAULT_COLORS[nextDeskIndex % DEFAULT_COLORS.length]
    );
    const avatarShape: GrokShape = normalizeGrokShape(
      payload.avatarShape ?? payload.shape,
      normalizeGrokShape(existing?.avatar_shape, GROK_SHAPES[nextDeskIndex % GROK_SHAPES.length])
    );
    let status: BotStatus = normalizeStatus(
      payload.status ?? payload.s,
      existing?.status ?? "working"
    );
    const task =
      payload.task !== undefined || payload.t !== undefined
        ? clampText(payload.task ?? payload.t, 200)
        : existing?.task ?? "";
    const model =
      clampText(payload.usage?.model ?? payload.model ?? payload.m, 64) ||
      existing?.model ||
      "grok-4";
    const expectedIntervalMin =
      payload.expectedIntervalMinutes !== undefined
        ? Math.max(0, Math.min(10080, Math.round(Number(payload.expectedIntervalMinutes))))
        : existing?.expected_interval_min ?? 0;
    const collaboratingWith =
      payload.collaboratingWith !== undefined
        ? clampText(payload.collaboratingWith, 64) || null
        : existing?.collaborating_with ?? null;

    // Loop Detection: 4+ identical active task pings within 120s triggers Repair Bay alert
    let loopDetected = false;
    if (payload.detectLoop && status === "working" && task && !payload.done) {
      const twoMinsAgo = new Date(Date.now() - 120_000).toISOString();
      const recentSame = this.sql
        .exec<{ message: string }>(
          `SELECT message FROM activity_logs
           WHERE bot_id = ? AND created_at >= ? AND status = 'working'
           ORDER BY created_at DESC LIMIT 3`,
          botId,
          twoMinsAgo
        )
        .toArray();
      if (recentSame.length >= 3 && recentSame.every((r) => r.message === task)) {
        loopDetected = true;
        status = "error";
        payload.need = payload.need ?? {
          id: `loop-${botId}`,
          title: `Possible agent loop detected`,
          description: `${name} repeated "${task}" 4 times in under 2 minutes.`,
          severity: "error",
        };
      }
    }

    const completedIncrement =
      payload.done === true ||
      (existing &&
        (existing.status === "working" || existing.status === "meeting") &&
        status === "idle")
        ? 1
        : 0;
    const isErrorEvent = status === "error" || payload.usage?.error === true ? 1 : 0;

    let addedTokens = 0;
    let addedCost = 0;
    let addedRequests = 0;

    if (payload.usage) {
      const tokensIn = Math.max(0, Math.floor(Number(payload.usage.tokensIn ?? 0)));
      const tokensOut = Math.max(0, Math.floor(Number(payload.usage.tokensOut ?? 0)));
      const latencyMs = Math.max(0, Math.floor(Number(payload.usage.latencyMs ?? 0)));
      const costUsd =
        payload.usage.costUsd !== undefined
          ? Math.max(0, Number(payload.usage.costUsd))
          : estimateCostUsd(model, tokensIn, tokensOut);

      addedTokens = tokensIn + tokensOut;
      addedCost = costUsd;
      addedRequests = 1;

      this.sql.exec(
        `INSERT INTO usage_events (id, bot_id, model, tokens_in, tokens_out, cost_usd, latency_ms, is_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        botId,
        model,
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs,
        isErrorEvent,
        now
      );

      this.sql.exec(`
        DELETE FROM usage_events WHERE id NOT IN (
          SELECT id FROM usage_events ORDER BY created_at DESC LIMIT 5000
        )
      `);
    }

    if (existing) {
      this.sql.exec(
        `UPDATE bots SET
           name = ?, role = ?, department = ?, avatar_color = ?, avatar_shape = ?, desk_index = ?,
           status = ?, task = ?, model = ?,
           tokens_total = tokens_total + ?,
           cost_total_usd = cost_total_usd + ?,
           requests_total = requests_total + ?,
           tasks_completed = tasks_completed + ?,
           error_count = error_count + ?,
           expected_interval_min = ?,
           sla_alerted = 0,
           last_seen_at = ?,
           collaborating_with = ?
         WHERE id = ?`,
        name,
        role,
        department,
        avatarColor,
        avatarShape,
        nextDeskIndex,
        status,
        task,
        model,
        addedTokens,
        addedCost,
        addedRequests,
        completedIncrement,
        isErrorEvent,
        expectedIntervalMin,
        now,
        collaboratingWith,
        botId
      );
    } else {
      this.sql.exec(
        `INSERT INTO bots (
           id, name, role, department, avatar_color, avatar_shape, desk_index, status, task, model,
           tokens_total, cost_total_usd, requests_total, tasks_completed, error_count,
           expected_interval_min, sla_alerted, last_seen_at, collaborating_with
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        botId,
        name,
        role,
        department,
        avatarColor,
        avatarShape,
        nextDeskIndex,
        status,
        task,
        model,
        addedTokens,
        addedCost,
        addedRequests,
        completedIncrement,
        isErrorEvent,
        expectedIntervalMin,
        now,
        collaboratingWith
      );
    }

    // Auto-resolve any stale missed-check-in SLA alert when the bot reports back in cleanly
    if (status !== "error") {
      this.sql.exec(
        `UPDATE pending_needs
         SET status = 'resolved',
             resolution_note = 'Auto-resolved on bot check-in',
             resolved_at = ?
         WHERE bot_id = ? AND status = 'open' AND (id LIKE 'sla-%' OR title LIKE 'Missed scheduled check-in%')`,
        now,
        botId
      );
    }

    // Track Task Run & Deliverables (with safe https outputUrl validation)
    const rawOut = payload.outputUrl ?? payload.out;
    const safeOutUrl = rawOut && isSafeCallbackUrl(rawOut) ? rawOut : null;
    const resultSummary = clampText(payload.result, 240) || null;

    if (completedIncrement > 0) {
      const existingActive = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM task_runs WHERE bot_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1",
          botId
        )
        .toArray()[0];
      if (existingActive) {
        this.finalizeActiveRun(botId, "completed", safeOutUrl, resultSummary, now);
      } else {
        this.sql.exec(
          `INSERT INTO task_runs (id, bot_id, bot_name, model, task, status, output_url, result_summary, quality_rating, started_at, finished_at, duration_sec)
           VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, 1)`,
          crypto.randomUUID(),
          botId,
          name,
          model,
          task || "Completed task",
          safeOutUrl,
          resultSummary,
          now,
          now
        );
      }
    } else if (status === "error") {
      this.finalizeActiveRun(botId, "failed", safeOutUrl, resultSummary || task || null, now);
    } else if (status === "working" || status === "meeting") {
      const activeRun = this.sql
        .exec<{ id: string; task: string }>(
          "SELECT id, task FROM task_runs WHERE bot_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1",
          botId
        )
        .toArray()[0];
      if (!activeRun || (task && activeRun.task !== task)) {
        if (activeRun) {
          this.finalizeActiveRun(botId, "completed", safeOutUrl, resultSummary, now);
        }
        this.sql.exec(
          `INSERT INTO task_runs (id, bot_id, bot_name, model, task, status, output_url, result_summary, quality_rating, started_at)
           VALUES (?, ?, ?, ?, ?, 'running', ?, ?, 0, ?)`,
          crypto.randomUUID(),
          botId,
          name,
          model,
          task || "Working",
          safeOutUrl,
          resultSummary,
          now
        );
      } else if (safeOutUrl || resultSummary) {
        this.sql.exec(
          `UPDATE task_runs
           SET output_url = COALESCE(?, output_url),
               result_summary = COALESCE(?, result_summary)
           WHERE id = ?`,
          safeOutUrl,
          resultSummary,
          activeRun.id
        );
      }
    }

    this.sql.exec(`
      DELETE FROM task_runs WHERE id NOT IN (
        SELECT id FROM task_runs ORDER BY started_at DESC LIMIT 200
      )
    `);

    // Dispatch queued instructions cleanly on actual bot check-ins (prevents dashboard actions from stealing queue and prevents replay loops)
    let nextTask: string | null = null;
    if (options.isBotCheckIn) {
      const reportedTaskNorm = clampText(payload.task ?? payload.t, 200).trim().toLowerCase();
      if (reportedTaskNorm) {
        const frontQ = this.sql
          .exec<{ id: string; task: string }>(
            "SELECT id, task FROM task_queue WHERE bot_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1",
            botId
          )
          .toArray()[0];
        if (frontQ && frontQ.task.trim().toLowerCase() === reportedTaskNorm) {
          this.sql.exec("UPDATE task_queue SET status = 'dispatched' WHERE id = ?", frontQ.id);
        }
      }

      if (payload.done === true || status === "idle") {
        const nextQ = this.sql
          .exec<{ id: string; task: string }>(
            "SELECT id, task FROM task_queue WHERE bot_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1",
            botId
          )
          .toArray()[0];
        if (nextQ) {
          this.sql.exec("UPDATE task_queue SET status = 'dispatched' WHERE id = ?", nextQ.id);
          if (payload.done === true) {
            this.sql.exec(
              "UPDATE bots SET task = ?, status = 'working' WHERE id = ?",
              nextQ.task,
              botId
            );
          } else {
            this.sql.exec("UPDATE bots SET task = ? WHERE id = ?", nextQ.task, botId);
          }
          nextTask = nextQ.task;
          this.insertLog(
            botId,
            name,
            avatarColor,
            payload.done === true ? "working" : status,
            "info",
            `Dispatched queued command: "${clampText(nextQ.task, 120)}"`,
            payload.simulated === true,
            now,
            0
          );
        }
      }
    }

    if (payload.objectiveId && payload.objectiveProgress !== undefined) {
      const prog = Math.max(0, Math.min(100, Math.round(payload.objectiveProgress)));
      this.sql.exec(
        "UPDATE objectives SET progress = ?, status = ?, updated_at = ? WHERE id = ?",
        prog,
        prog >= 100 ? "completed" : "active",
        now,
        payload.objectiveId
      );
    }

    let createdNeedId: string | undefined;
    if (payload.need && clampText(payload.need.title, 140)) {
      createdNeedId = clampText(payload.need.id, 64) || crypto.randomUUID();
      const rawCallback = payload.need.callbackUrl;
      const safeCallback =
        rawCallback && isSafeCallbackUrl(rawCallback) ? rawCallback : null;
      const sev = payload.need.severity ?? (status === "error" ? "error" : "approval");
      const needTitle = clampText(payload.need.title, 140);
      const needDesc = clampText(payload.need.description, 400);

      this.sql.exec(
        `INSERT INTO pending_needs (
           id, bot_id, bot_name, title, description, severity, status, callback_url, escalated, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           severity = excluded.severity,
           status = 'open',
           escalated = 0`,
        createdNeedId,
        botId,
        name,
        needTitle,
        needDesc,
        sev,
        safeCallback,
        now
      );

      if (!payload.simulated) {
        this.fireAlertWebhook(needTitle, needDesc, sev, name);
      }
    } else if (status === "error" && !payload.simulated) {
      this.fireAlertWebhook(task || "Agent reported error state", "", "error", name);
    }

    if (addedTokens > 0 || addedCost > 0) {
      this.checkBudgetGuardrails(now);
    }

    const logMessage =
      clampText(payload.message, 240) ||
      (loopDetected
        ? `Loop alert: repeated "${task}" 4x in 2m`
        : payload.need
        ? `Requested ${payload.need.severity ?? "approval"}: ${clampText(payload.need.title, 120)}`
        : task || `Status → ${status}`);

    const logLevel: LogLevel =
      payload.level ??
      (status === "error"
        ? "error"
        : status === "waiting"
        ? "warn"
        : completedIncrement > 0 || addedTokens > 0
        ? "success"
        : "info");

    this.insertLog(
      botId,
      name,
      avatarColor,
      status,
      logLevel,
      logMessage,
      payload.simulated === true,
      now,
      completedIncrement
    );

    if (status === "working" || status === "meeting" || status === "waiting" || expectedIntervalMin > 0) {
      await this.ensureAlarmScheduled();
    }

    return { botId, needId: createdNeedId, nextTask, loopDetected };
  }

  private checkBudgetGuardrails(now: string): void {
    const todayPrefix = now.slice(0, 10);
    const settings = this.getSettings();
    const todayStats = this.sql
      .exec<{ tokens: number; cost: number }>(
        `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost
         FROM usage_events WHERE created_at >= ?`,
        `${todayPrefix}T00:00:00.000Z`
      )
      .one();

    const costRatio = (todayStats?.cost ?? 0) / settings.dailyCostCapUsd;
    const tokenRatio = (todayStats?.tokens ?? 0) / settings.dailyTokenCap;

    if (costRatio >= 1.0) {
      const alertId = `budget-cost-100-${todayPrefix}`;
      const title = `Daily spend cap reached ($${(todayStats?.cost ?? 0).toFixed(2)} / $${settings.dailyCostCapUsd.toFixed(2)})`;
      const desc = settings.hardBudgetStop
        ? "Hard Budget Circuit-Breaker is ACTIVE: Proxy calls are paused until tomorrow or cap is raised."
        : "Automatic office guardrail triggered. Review bot activity or raise the daily cap in Guardrails.";
      this.sql.exec(
        `INSERT OR IGNORE INTO pending_needs (
           id, bot_id, bot_name, title, description, severity, status, created_at
         ) VALUES (?, 'system', 'Office Guardrail', ?, ?, 'budget', 'open', ?)`,
        alertId,
        title,
        desc,
        now
      );
      this.fireAlertWebhook(title, desc, "budget", "Office Guardrail");
    } else if (tokenRatio >= 1.0) {
      const alertId = `budget-tok-100-${todayPrefix}`;
      const title = `Daily token cap reached (${(todayStats?.tokens ?? 0).toLocaleString()} tokens)`;
      const desc = settings.hardBudgetStop
        ? "Hard Budget Circuit-Breaker is ACTIVE: Proxy calls are paused until tomorrow or cap is raised."
        : "Automatic office guardrail triggered. Consider routing high-volume bots to grok-3-mini.";
      this.sql.exec(
        `INSERT OR IGNORE INTO pending_needs (
           id, bot_id, bot_name, title, description, severity, status, created_at
         ) VALUES (?, 'system', 'Office Guardrail', ?, ?, 'budget', 'open', ?)`,
        alertId,
        title,
        desc,
        now
      );
      this.fireAlertWebhook(title, desc, "budget", "Office Guardrail");
    }
  }

  private insertLog(
    botId: string,
    botName: string,
    botColor: string,
    status: BotStatus,
    level: LogLevel,
    message: string,
    simulated = false,
    createdAt = new Date().toISOString(),
    taskDone = 0
  ): void {
    this.sql.exec(
      `INSERT INTO activity_logs (id, bot_id, bot_name, bot_color, status, level, message, simulated, task_done, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      botId,
      botName,
      botColor,
      status,
      level,
      message,
      simulated ? 1 : 0,
      taskDone > 0 ? 1 : 0,
      createdAt
    );

    this.sql.exec(`
      DELETE FROM activity_logs
      WHERE id NOT IN (
        SELECT id FROM activity_logs ORDER BY created_at DESC LIMIT 250
      )
    `);
  }

  private getSettings(): OfficeSettings {
    const rows = this.sql
      .exec<{ key: string; value: string }>("SELECT key, value FROM office_settings")
      .toArray();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      dailyTokenCap: Number(map.get("dailyTokenCap") ?? DEFAULT_SETTINGS.dailyTokenCap),
      dailyCostCapUsd: Number(map.get("dailyCostCapUsd") ?? DEFAULT_SETTINGS.dailyCostCapUsd),
      dailyTaskTarget: Number(map.get("dailyTaskTarget") ?? DEFAULT_SETTINGS.dailyTaskTarget),
      autoIdleMinutes: Number(map.get("autoIdleMinutes") ?? DEFAULT_SETTINGS.autoIdleMinutes),
      hardBudgetStop: map.get("hardBudgetStop") === "true",
      alertWebhookUrl: map.get("alertWebhookUrl") ?? DEFAULT_SETTINGS.alertWebhookUrl,
    };
  }

  private listObjectives(): Objective[] {
    const bots = new Map(
      this.sql
        .exec<{ id: string; name: string }>("SELECT id, name FROM bots")
        .toArray()
        .map((b) => [b.id, b.name])
    );

    return this.sql
      .exec<{
        id: string;
        title: string;
        owner_bot_id: string | null;
        progress: number;
        target_label: string;
        status: ObjectiveStatus;
        updated_at: string;
      }>("SELECT * FROM objectives ORDER BY status ASC, updated_at DESC")
      .toArray()
      .map((o) => ({
        id: o.id,
        title: o.title,
        ownerBotId: o.owner_bot_id,
        ownerBotName: o.owner_bot_id ? bots.get(o.owner_bot_id) ?? o.owner_bot_id : null,
        progress: o.progress,
        targetLabel: o.target_label,
        status: o.status,
        updatedAt: o.updated_at,
      }));
  }

  private listNeeds(botId: string | null, status: string | null): PendingNeed[] {
    let query = "SELECT * FROM pending_needs WHERE 1=1";
    const params: string[] = [];
    if (botId) {
      query += " AND bot_id = ?";
      params.push(botId);
    }
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    query += " ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 100";

    return this.sql
      .exec<{
        id: string;
        bot_id: string;
        bot_name: string;
        title: string;
        description: string;
        severity: NeedSeverity;
        status: NeedStatus;
        callback_url: string | null;
        resolution_note: string | null;
        created_at: string;
        resolved_at: string | null;
      }>(query, ...params)
      .toArray()
      .map((r) => ({
        id: r.id,
        botId: r.bot_id,
        botName: r.bot_name,
        title: r.title,
        description: r.description,
        severity: r.severity,
        status: r.status,
        callbackUrl: r.callback_url,
        resolutionNote: r.resolution_note,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      }));
  }

  private async resolveNeed(
    needId: string,
    action: "approve" | "reject" | "resolve",
    note: string
  ): Promise<PendingNeed | null> {
    const existing = this.sql
      .exec<{
        id: string;
        bot_id: string;
        bot_name: string;
        title: string;
        description: string;
        severity: NeedSeverity;
        status: NeedStatus;
        callback_url: string | null;
        resolution_note: string | null;
        created_at: string;
        resolved_at: string | null;
      }>("SELECT * FROM pending_needs WHERE id = ?", needId)
      .toArray()[0];

    if (!existing) return null;

    const now = new Date().toISOString();
    const newStatus: NeedStatus =
      action === "approve"
        ? "approved"
        : action === "reject"
        ? "rejected"
        : "resolved";

    this.sql.exec(
      `UPDATE pending_needs SET status = ?, resolution_note = ?, resolved_at = ? WHERE id = ?`,
      newStatus,
      note || null,
      now,
      needId
    );

    if (existing.bot_id !== "system") {
      const remainingOpen = this.sql
        .exec<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM pending_needs WHERE bot_id = ? AND status = 'open'",
          existing.bot_id
        )
        .one();

      if ((remainingOpen?.cnt ?? 0) === 0) {
        const nextBotStatus: BotStatus = action === "reject" ? "idle" : "working";
        this.sql.exec(
          "UPDATE bots SET status = ?, sla_alerted = 0, last_seen_at = ? WHERE id = ?",
          nextBotStatus,
          now,
          existing.bot_id
        );
      }
    }

    this.insertLog(
      existing.bot_id,
      existing.bot_name,
      "#34d399",
      action === "reject" ? "idle" : "working",
      action === "reject" ? "warn" : "success",
      `Human ${newStatus} "${existing.title}"${note ? ` — "${note}"` : ""}`,
      false,
      now,
      0
    );

    if (existing.callback_url && isSafeCallbackUrl(existing.callback_url)) {
      try {
        await fetch(existing.callback_url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            needId,
            botId: existing.bot_id,
            action: newStatus,
            note,
            resolvedAt: now,
          }),
        });
      } catch {
        // Non-fatal
      }
    }

    return {
      id: existing.id,
      botId: existing.bot_id,
      botName: existing.bot_name,
      title: existing.title,
      description: existing.description,
      severity: existing.severity,
      status: newStatus,
      callbackUrl: existing.callback_url,
      resolutionNote: note || null,
      createdAt: existing.created_at,
      resolvedAt: now,
    };
  }

  private getSnapshot(): OfficeSnapshot {
    const rawRuns = this.sql
      .exec<{
        id: string;
        bot_id: string;
        bot_name: string;
        model: string;
        task: string;
        status: RunStatus;
        output_url: string | null;
        result_summary: string | null;
        quality_rating: number;
        started_at: string;
        finished_at: string | null;
        duration_sec: number;
      }>("SELECT * FROM task_runs ORDER BY started_at DESC LIMIT 100")
      .toArray();

    const recentRuns: TaskRun[] = rawRuns.slice(0, 60).map((r) => ({
      id: r.id,
      botId: r.bot_id,
      botName: r.bot_name,
      model: r.model,
      task: r.task,
      status: r.status,
      outputUrl: r.output_url,
      resultSummary: r.result_summary,
      qualityRating: r.quality_rating === 1 ? 1 : r.quality_rating === -1 ? -1 : 0,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationSec: r.duration_sec,
    }));

    const queuedAll = this.sql
      .exec<{ id: string; bot_id: string; task: string; created_at: string }>(
        "SELECT id, bot_id, task, created_at FROM task_queue WHERE status = 'queued' ORDER BY created_at ASC"
      )
      .toArray();
    const queueMap = new Map<string, QueuedTask[]>();
    for (const q of queuedAll) {
      const arr = queueMap.get(q.bot_id) ?? [];
      arr.push({ id: q.id, botId: q.bot_id, task: q.task, createdAt: q.created_at });
      queueMap.set(q.bot_id, arr);
    }

    const runStatsByBot = new Map<
      string,
      { durSum: number; durCount: number; thumbsUp: number; rated: number }
    >();
    let totalThumbsUp = 0;
    let totalRated = 0;
    for (const r of rawRuns) {
      const s = runStatsByBot.get(r.bot_id) ?? { durSum: 0, durCount: 0, thumbsUp: 0, rated: 0 };
      if (r.duration_sec > 0 && r.status !== "running") {
        s.durSum += r.duration_sec;
        s.durCount += 1;
      }
      if (r.quality_rating !== 0) {
        s.rated += 1;
        totalRated += 1;
        if (r.quality_rating === 1) {
          s.thumbsUp += 1;
          totalThumbsUp += 1;
        }
      }
      runStatsByBot.set(r.bot_id, s);
    }

    const settings = this.getSettings();
    const linkNow = Date.now();
    const bots: BotRecord[] = this.sql
      .exec<{
        id: string;
        name: string;
        role: string;
        department: string;
        avatar_color: string;
        avatar_shape?: string;
        desk_index: number;
        status: BotStatus;
        task: string;
        model: string;
        tokens_total: number;
        cost_total_usd: number;
        requests_total: number;
        tasks_completed: number;
        error_count: number;
        expected_interval_min: number;
        last_seen_at: string;
        collaborating_with: string | null;
      }>("SELECT * FROM bots ORDER BY desk_index ASC, name ASC")
      .toArray()
      .map((b, idx) => {
        const rs = runStatsByBot.get(b.id);
        return {
          id: b.id,
          name: b.name,
          role: b.role,
          department: b.department,
          avatarColor: b.avatar_color,
          avatarShape: normalizeGrokShape(b.avatar_shape, GROK_SHAPES[idx % GROK_SHAPES.length]),
          deskIndex: b.desk_index,
          status: b.status,
          task: b.task,
          model: b.model,
          tokensTotal: b.tokens_total,
          costTotalUsd: Number(b.cost_total_usd.toFixed(4)),
          requestsTotal: b.requests_total,
          tasksCompleted: b.tasks_completed,
          errorCount: b.error_count,
          expectedIntervalMinutes: b.expected_interval_min ?? 0,
          avgDurationSec: rs && rs.durCount > 0 ? Math.round(rs.durSum / rs.durCount) : 0,
          qualityScorePct: rs && rs.rated > 0 ? Math.round((rs.thumbsUp / rs.rated) * 100) : null,
          ratedCount: rs?.rated ?? 0,
          queuedTasks: queueMap.get(b.id) ?? [],
          lastSeenAt: b.last_seen_at,
          collaboratingWith: b.collaborating_with,
          link: connectionLink(
            b.last_seen_at,
            b.expected_interval_min ?? 0,
            settings.autoIdleMinutes,
            linkNow,
            b.status
          ),
        };
      });

    const pendingNeeds = this.listNeeds(null, null);
    const objectives = this.listObjectives();

    const activityLogs: ActivityLog[] = this.sql
      .exec<{
        id: string;
        bot_id: string;
        bot_name: string;
        bot_color: string;
        status: BotStatus;
        level: LogLevel;
        message: string;
        simulated: number;
        created_at: string;
      }>("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 80")
      .toArray()
      .map((l) => ({
        id: l.id,
        botId: l.bot_id,
        botName: l.bot_name,
        botColor: l.bot_color,
        status: l.status,
        level: l.level,
        message: l.message,
        simulated: l.simulated === 1,
        createdAt: l.created_at,
      }));

    const totals = this.sql
      .exec<{
        tokens_in: number;
        tokens_out: number;
        cost_usd: number;
        requests: number;
        errors: number;
        avg_latency: number;
      }>(
        `SELECT
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out,
           COALESCE(SUM(cost_usd), 0) as cost_usd,
           COUNT(*) as requests,
           COALESCE(SUM(is_error), 0) as errors,
           COALESCE(AVG(latency_ms), 0) as avg_latency
         FROM usage_events`
      )
      .one();

    // True p95 latency across recent usage events
    const latSamples = this.sql
      .exec<{ latency_ms: number }>(
        "SELECT latency_ms FROM usage_events WHERE latency_ms > 0 ORDER BY created_at DESC LIMIT 500"
      )
      .toArray()
      .map((r) => r.latency_ms)
      .sort((a, b) => a - b);
    const p95LatencyMs =
      latSamples.length > 0
        ? Math.round(latSamples[Math.min(latSamples.length - 1, Math.floor(latSamples.length * 0.95))])
        : 0;

    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayIso = `${todayPrefix}T00:00:00.000Z`;
    const todayTotals = this.sql
      .exec<{ tokens: number; cost: number }>(
        `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost
         FROM usage_events WHERE created_at >= ?`,
        todayIso
      )
      .one();

    const todayTasksRow = this.sql
      .exec<{ done_cnt: number }>(
        `SELECT COALESCE(SUM(task_done), 0) as done_cnt
         FROM activity_logs WHERE created_at >= ?`,
        todayIso
      )
      .one();

    const todayApprovalsRow = this.sql
      .exec<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM pending_needs WHERE status != 'open' AND resolved_at >= ?`,
        todayIso
      )
      .one();

    const todayFailedRunsRow = this.sql
      .exec<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM task_runs WHERE status = 'failed' AND started_at >= ?`,
        todayIso
      )
      .one();

    const totalTasksCompleted = bots.reduce((acc, b) => acc + b.tasksCompleted, 0);
    const todayTasksCompleted = todayTasksRow?.done_cnt ?? 0;
    const totalRequests = totals?.requests ?? 0;
    const errorRatePct =
      totalRequests > 0
        ? Number((((totals?.errors ?? 0) / totalRequests) * 100).toFixed(1))
        : 0;

    const todayTokens = todayTotals?.tokens ?? 0;
    const todayCostUsd = Number((todayTotals?.cost ?? 0).toFixed(4));
    const costPerCompletedTaskUsd =
      todayTasksCompleted > 0 ? Number((todayCostUsd / todayTasksCompleted).toFixed(4)) : 0;

    const tokenUsedRatio = settings.dailyTokenCap > 0 ? todayTokens / settings.dailyTokenCap : 0;
    const costUsedRatio = settings.dailyCostCapUsd > 0 ? todayCostUsd / settings.dailyCostCapUsd : 0;
    const usageRemainingPct = Math.max(
      0,
      Math.min(100, Math.round((1 - Math.max(tokenUsedRatio, costUsedRatio)) * 100))
    );
    const budgetLocked = Boolean(
      settings.hardBudgetStop && (tokenUsedRatio >= 1.0 || costUsedRatio >= 1.0)
    );

    const topBot = [...bots].sort(
      (a, b) => b.tasksCompleted - a.tasksCompleted || b.requestsTotal - a.requestsTotal
    )[0];

    const byModel: UsageByModel[] = this.sql
      .exec<{
        model: string;
        tokens_in: number;
        tokens_out: number;
        cost_usd: number;
        requests: number;
      }>(
        `SELECT
           model,
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out,
           COALESCE(SUM(cost_usd), 0) as cost_usd,
           COUNT(*) as requests
         FROM usage_events
         GROUP BY model
         ORDER BY cost_usd DESC`
      )
      .toArray()
      .map((m) => ({
        model: m.model,
        tokensIn: m.tokens_in,
        tokensOut: m.tokens_out,
        costUsd: Number(m.cost_usd.toFixed(4)),
        requests: m.requests,
      }));

    const recentEvents = this.sql
      .exec<{
        tokens_in: number;
        tokens_out: number;
        cost_usd: number;
        is_error: number;
        created_at: string;
      }>(
        `SELECT tokens_in, tokens_out, cost_usd, is_error, created_at
         FROM usage_events
         ORDER BY created_at DESC
         LIMIT 120`
      )
      .toArray()
      .reverse();

    const bucketMap = new Map<string, UsageBucket>();
    for (const ev of recentEvents) {
      const d = new Date(ev.created_at);
      const dayKey = ev.created_at.slice(5, 10);
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(Math.floor(d.getUTCMinutes() / 5) * 5).padStart(2, "0");
      const sortKey = `${dayKey} ${hh}:${mm}`;
      const label = `${hh}:${mm}`;
      const cur = bucketMap.get(sortKey) ?? {
        label,
        tokens: 0,
        costUsd: 0,
        requests: 0,
        errors: 0,
      };
      cur.tokens += ev.tokens_in + ev.tokens_out;
      cur.costUsd = Number((cur.costUsd + ev.cost_usd).toFixed(4));
      cur.requests += 1;
      cur.errors += ev.is_error ? 1 : 0;
      bucketMap.set(sortKey, cur);
    }

    const lastBotUpdateAt =
      bots.length > 0
        ? bots.reduce(
            (latest, b) => (b.lastSeenAt > latest ? b.lastSeenAt : latest),
            bots[0].lastSeenAt
          )
        : null;

    return {
      bots,
      pendingNeeds,
      activityLogs,
      recentRuns,
      objectives,
      settings,
      usageSummary: {
        totalTokens: (totals?.tokens_in ?? 0) + (totals?.tokens_out ?? 0),
        totalTokensIn: totals?.tokens_in ?? 0,
        totalTokensOut: totals?.tokens_out ?? 0,
        totalCostUsd: Number((totals?.cost_usd ?? 0).toFixed(4)),
        totalRequests,
        totalTasksCompleted,
        errorRatePct,
        avgLatencyMs: Math.round(totals?.avg_latency ?? 0),
        p95LatencyMs,
        todayTokens,
        todayCostUsd,
        todayTasksCompleted,
        costPerCompletedTaskUsd,
        approvalsResolvedToday: todayApprovalsRow?.cnt ?? 0,
        failedRunsToday: todayFailedRunsRow?.cnt ?? 0,
        fleetQualityPct: totalRated > 0 ? Math.round((totalThumbsUp / totalRated) * 100) : null,
        topBotName: topBot ? topBot.name : null,
        usageRemainingPct,
        budgetLocked,
        byModel,
        timeline: Array.from(bucketMap.values()).slice(-14),
      },
      lastBotUpdateAt,
      serverTime: new Date().toISOString(),
    };
  }

  private resetOffice(): void {
    this.sql.exec("DELETE FROM bots");
    this.sql.exec("DELETE FROM pending_needs");
    this.sql.exec("DELETE FROM usage_events");
    this.sql.exec("DELETE FROM activity_logs");
    this.sql.exec("DELETE FROM task_runs");
    this.sql.exec("DELETE FROM task_queue");
    this.sql.exec("DELETE FROM objectives");
  }
}

async function handleXaiProxy(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  botId: string,
  restPath: string
): Promise<Response> {
  const stub = env.OFFICE_HUB.get(env.OFFICE_HUB.idFromName("hq"));

  try {
    const guardResp = await stub.fetch("https://internal/api/guardrail-check");
    if (guardResp.ok) {
      const guardData = (await guardResp.json()) as { blocked?: boolean; reason?: string };
      if (guardData.blocked) {
        return withSecurityHeaders(
          jsonResponse(
            {
              error: {
                message: `Grok Bot HQ Guardrail Circuit-Breaker: ${guardData.reason || "Daily cap reached"}`,
                type: "office_budget_cap_exceeded",
                code: "daily_budget_cap_reached",
              },
            },
            429
          )
        );
      }
    }
  } catch {
    // Non-blocking if check fails
  }

  const upstreamBase = (env.AI_GATEWAY_BASE_URL ?? "https://api.x.ai/v1").replace(/\/+$/, "");
  const url = new URL(request.url);
  const upstreamUrl = `${upstreamBase}${restPath}${url.search}`;

  const startedAt = Date.now();
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete("host");
  forwardHeaders.delete("cookie");
  forwardHeaders.delete("x-report-secret");

  let requestModel = "grok-4";
  let bodyBuffer: ArrayBuffer | null = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    bodyBuffer = await request.arrayBuffer();
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bodyBuffer)) as { model?: string };
      if (parsed.model) requestModel = parsed.model;
    } catch {
      // Ignore non-JSON
    }
  }

  const upstreamResp = await fetch(upstreamUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: bodyBuffer,
  });

  const latencyMs = Date.now() - startedAt;
  const contentType = upstreamResp.headers.get("content-type") ?? "";
  const isError = upstreamResp.status >= 400;

  if (contentType.includes("application/json")) {
    const clone = upstreamResp.clone();
    ctx.waitUntil(
      (async () => {
        let tokensIn = 0;
        let tokensOut = 0;
        let model = requestModel;
        let errDetail = "";
        try {
          const data = (await clone.json()) as {
            model?: string;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              input_tokens?: number;
              output_tokens?: number;
            };
            error?: { message?: string };
          };
          if (data.model) model = data.model;
          if (data.usage) {
            tokensIn = data.usage.prompt_tokens ?? data.usage.input_tokens ?? 0;
            tokensOut = data.usage.completion_tokens ?? data.usage.output_tokens ?? 0;
          }
          if (data.error?.message) errDetail = data.error.message;
        } catch {
          // Ignore parse errors
        }

        const headers: Record<string, string> = { "content-type": "application/json" };
        if (env.REPORT_SECRET) headers["x-report-secret"] = env.REPORT_SECRET;

        await stub.fetch("https://internal/api/report", {
          method: "POST",
          headers,
          body: JSON.stringify({
            botId,
            status: isError ? "error" : "working",
            task: isError
              ? `xAI API error (${upstreamResp.status})`
              : `Auto-tracked ${model} call`,
            model,
            detectLoop: true,
            usage: { model, tokensIn, tokensOut, latencyMs, error: isError },
            need: isError
              ? {
                  title: `xAI Proxy Error (${upstreamResp.status}) for ${botId}`,
                  description: errDetail || `Upstream returned HTTP ${upstreamResp.status}`,
                  severity: "error",
                }
              : undefined,
          }),
        });
      })()
    );
  }

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: upstreamResp.headers,
  });
}

async function checkOfficePassword(request: Request, env: Env): Promise<Response | null> {
  if (!env.OFFICE_PASSWORD) return null;
  const url = new URL(request.url);
  if (
    url.pathname === "/api/report" ||
    url.pathname === "/api/ping" ||
    url.pathname.startsWith("/api/bot/") ||
    url.pathname.startsWith("/proxy/")
  ) {
    return null;
  }
  if (url.pathname === "/auth" && request.method === "POST") {
    return null;
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  if (cookies.office_session && (await verifySessionCookieValue(cookies.office_session, env.OFFICE_PASSWORD))) {
    return null;
  }

  const headerPass = request.headers.get("x-office-password");
  if (headerPass && (await timingSafeEqualStrings(headerPass, env.OFFICE_PASSWORD))) {
    return null;
  }

  return withSecurityHeaders(
    new Response(
      `<!doctype html><html><body style="font-family:system-ui;background:#0a0e18;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
        <form method="POST" action="/auth" style="background:#121826;padding:2rem;border-radius:14px;border:1px solid #24304a;width:330px;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
          <h2 style="margin:0 0 0.4rem">Grok Bot Office</h2>
          <p style="margin:0 0 1.2rem;color:#8b9bb4;font-size:0.9rem">Enter your office password to unlock HQ.</p>
          <input type="password" name="password" placeholder="Office password" required autofocus style="width:100%;box-sizing:border-box;padding:0.7rem;border-radius:8px;border:1px solid #334155;background:#0a0e18;color:#fff;margin-bottom:1rem" />
          <button type="submit" style="width:100%;padding:0.7rem;border-radius:8px;border:none;background:#f59e0b;color:#1c1917;font-weight:700;cursor:pointer">Enter Office</button>
        </form>
      </body></html>`,
      { status: 401, headers: { "content-type": "text/html; charset=utf-8" } }
    )
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const proxyMatch = url.pathname.match(/^\/proxy\/([^/]+)(\/v1\/.*)$/);
    if (proxyMatch) {
      if (env.REPORT_SECRET) {
        const candidate =
          request.headers.get("x-report-secret")?.trim() ??
          url.searchParams.get("token")?.trim() ??
          "";
        if (!candidate || !(await timingSafeEqualStrings(candidate, env.REPORT_SECRET))) {
          return withSecurityHeaders(jsonResponse({ error: "Unauthorized proxy access" }, 401));
        }
      }
      return handleXaiProxy(
        request,
        env,
        ctx,
        decodeURIComponent(proxyMatch[1]),
        proxyMatch[2]
      );
    }

    if (url.pathname === "/auth" && request.method === "POST" && env.OFFICE_PASSWORD) {
      const form = await request.formData();
      const pass = String(form.get("password") ?? "");
      if (await timingSafeEqualStrings(pass, env.OFFICE_PASSWORD)) {
        const cookieVal = await createSessionCookieValue(env.OFFICE_PASSWORD);
        const secureAttr = url.protocol === "https:" ? "; Secure" : "";
        return withSecurityHeaders(
          new Response(null, {
            status: 302,
            headers: {
              location: "/",
              "set-cookie": `office_session=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secureAttr}`,
            },
          })
        );
      }
      return withSecurityHeaders(new Response("Invalid password", { status: 403 }));
    }

    const authGate = await checkOfficePassword(request, env);
    if (authGate) return authGate;

    if (url.pathname === "/ws" || url.pathname.startsWith("/api/")) {
      const id = env.OFFICE_HUB.idFromName("hq");
      const stub = env.OFFICE_HUB.get(id);
      const resp = await stub.fetch(request);
      if (resp.status === 101) return resp;
      return withSecurityHeaders(resp);
    }

    const assetResp = await env.ASSETS.fetch(request);
    return withSecurityHeaders(assetResp);
  },
} satisfies ExportedHandler<Env>;
