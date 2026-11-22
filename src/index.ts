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
import type {
  ActivityLog,
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
  ReportPayload,
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

// Official Grok Bot 12-color palette
const DEFAULT_COLORS = [
  "#3b93f0", // Blue
  "#8b5cf6", // Purple
  "#3ecf8e", // Green
  "#f08a24", // Orange
  "#e152b0", // Pink
  "#f0b429", // Amber
  "#2fbfa0", // Turquoise
  "#e8483f", // Red
  "#f1efe9", // Cream
  "#a3a3a3", // Grey
  "#8b5e3c", // Brown
  "#1e2028", // Ink
];

// Official Grok Bot 8 silhouette shapes
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

const MODEL_PRICING_PER_M: Record<string, { in: number; out: number }> = {
  "grok-4": { in: 3.0, out: 15.0 },
  "grok-4.20-multi-agent": { in: 5.0, out: 20.0 },
  "grok-4.7": { in: 2.5, out: 10.0 },
  "grok-3": { in: 3.0, out: 15.0 },
  "grok-3-mini": { in: 0.3, out: 0.5 },
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
  }

  async alarm(): Promise<void> {
    const settings = this.getSettings();
    const idleCutoffMs = Date.now() - Math.max(1, settings.autoIdleMinutes) * 60_000;
    const noReportCutoffMs = Date.now() - 24 * 60 * 60_000;

    const allBots = this.sql
      .exec<{
        id: string;
        name: string;
        avatar_color: string;
        status: BotStatus;
        last_seen_at: string;
      }>("SELECT id, name, avatar_color, status, last_seen_at FROM bots")
      .toArray();

    let changed = false;
    let stillActive = 0;
    const now = new Date().toISOString();

    for (const bot of allBots) {
      const lastSeen = Date.parse(bot.last_seen_at);
      if (!Number.isFinite(lastSeen)) continue;

      if ((bot.status === "working" || bot.status === "meeting") && lastSeen < idleCutoffMs) {
        this.sql.exec(
          "UPDATE bots SET status = 'idle', collaborating_with = NULL, task = 'Auto-idled in Central Lounge' WHERE id = ?",
          bot.id
        );
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
        stillActive++;
      }
    }

    if (changed) {
      this.broadcastSnapshot();
    }
    if (stillActive > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  private async ensureAlarmScheduled(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
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
      const blocked = Boolean(settings.hardBudgetStop && (overCost || overTok));
      return jsonResponse({
        blocked,
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
      const payload: ReportPayload = {
        botId,
        name: clampText(url.searchParams.get("n") ?? url.searchParams.get("name"), 64) || undefined,
        role: clampText(url.searchParams.get("r") ?? url.searchParams.get("role"), 64) || undefined,
        department:
          clampText(url.searchParams.get("d") ?? url.searchParams.get("department"), 48) || undefined,
        shape:
          (clampText(url.searchParams.get("shape"), 24) as GrokShape) || undefined,
        status: url.searchParams.get("s") ?? url.searchParams.get("status") ?? undefined,
        task: clampText(url.searchParams.get("t") ?? url.searchParams.get("task"), 200) || undefined,
        model: clampText(url.searchParams.get("m") ?? url.searchParams.get("model"), 64) || undefined,
        done: url.searchParams.get("done") === "1" || url.searchParams.get("done") === "true",
      };
      const tokensIn = Number(url.searchParams.get("in") ?? 0);
      const tokensOut = Number(url.searchParams.get("out") ?? 0);
      const latencyMs = Number(url.searchParams.get("ms") ?? 0);
      if (tokensIn > 0 || tokensOut > 0) {
        payload.usage = { model: payload.model, tokensIn, tokensOut, latencyMs };
      }
      const needTitle = clampText(url.searchParams.get("need"), 140);
      if (needTitle) {
        payload.need = {
          title: needTitle,
          severity: (url.searchParams.get("sev") as NeedSeverity) || "approval",
        };
        if (!payload.status) payload.status = "waiting";
      }

      const result = await this.handleReport(payload);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...result });
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
      const result = await this.handleReport(payload);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...result });
    }

    const botStatusMatch = url.pathname.match(/^\/api\/bot\/([^/]+)\/status$/);
    if (botStatusMatch && request.method === "GET") {
      if (!(await isReportAuthorized(request, this.env))) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const botId = decodeURIComponent(botStatusMatch[1]);
      const botRow = this.sql
        .exec<{ status: BotStatus; task: string; role: string }>(
          "SELECT status, task, role FROM bots WHERE id = ?",
          botId
        )
        .toArray()[0];
      const needs = this.listNeeds(botId, null);
      const openNeeds = needs.filter((n) => n.status === "open").length;
      const latest = needs[0];
      return jsonResponse({
        botId,
        status: botRow?.status ?? null,
        assignedTask: botRow?.task ?? null,
        role: botRow?.role ?? null,
        openNeeds,
        latestDecision: latest ? latest.status : null,
        note: latest?.resolutionNote ?? null,
      });
    }

    const botDeleteMatch = url.pathname.match(/^\/api\/bots\/([^/]+)$/);
    if (botDeleteMatch && request.method === "DELETE") {
      const botId = decodeURIComponent(botDeleteMatch[1]);
      this.sql.exec("DELETE FROM bots WHERE id = ?", botId);
      this.sql.exec("DELETE FROM pending_needs WHERE bot_id = ? AND status = 'open'", botId);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, deletedBotId: botId });
    }

    const botCmdMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/command$/);
    if (botCmdMatch && request.method === "POST") {
      const botId = decodeURIComponent(botCmdMatch[1]);
      let body: {
        name?: string;
        role?: string;
        avatarColor?: string;
        status?: BotStatus;
        task?: string;
        deskIndex?: number;
        department?: string;
        collaboratingWith?: string | null;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const result = await this.handleReport({
        botId,
        name: body.name,
        role: body.role,
        avatarColor: body.avatarColor,
        status: body.status,
        task: body.task,
        deskIndex: body.deskIndex,
        department: body.department,
        collaboratingWith: body.collaboratingWith,
        message: body.task
          ? `HQ assigned task: "${clampText(body.task, 120)}"`
          : body.status
          ? `Moved bot → ${body.status}`
          : "Updated bot profile from HQ",
      });
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...result });
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

    if (url.pathname === "/api/demo/seed" && request.method === "POST") {
      await this.seedDemoOffice();
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, snapshot: this.getSnapshot() });
    }

    if (url.pathname === "/api/demo/tick" && request.method === "POST") {
      await this.simulateTick();
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, snapshot: this.getSnapshot() });
    }

    if (url.pathname === "/api/demo/reset" && request.method === "POST") {
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

  private async handleReport(payload: ReportPayload): Promise<{ botId: string; needId?: string }> {
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
    const status: BotStatus = normalizeStatus(
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
    const collaboratingWith =
      payload.collaboratingWith !== undefined
        ? clampText(payload.collaboratingWith, 64) || null
        : existing?.collaborating_with ?? null;

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
        now,
        collaboratingWith,
        botId
      );
    } else {
      this.sql.exec(
        `INSERT INTO bots (
           id, name, role, department, avatar_color, avatar_shape, desk_index, status, task, model,
           tokens_total, cost_total_usd, requests_total, tasks_completed, error_count, last_seen_at, collaborating_with
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now,
        collaboratingWith
      );
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
           id, bot_id, bot_name, title, description, severity, status, callback_url, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           severity = excluded.severity,
           status = 'open'`,
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
      (payload.need
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

    if (status === "working" || status === "meeting") {
      await this.ensureAlarmScheduled();
    }

    return { botId, needId: createdNeedId };
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
          "UPDATE bots SET status = ?, last_seen_at = ? WHERE id = ?",
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
        last_seen_at: string;
        collaborating_with: string | null;
      }>("SELECT * FROM bots ORDER BY desk_index ASC, name ASC")
      .toArray()
      .map((b, idx) => ({
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
        lastSeenAt: b.last_seen_at,
        collaboratingWith: b.collaborating_with,
      }));

    const pendingNeeds = this.listNeeds(null, null);
    const objectives = this.listObjectives();
    const settings = this.getSettings();

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

    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayTotals = this.sql
      .exec<{ tokens: number; cost: number }>(
        `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost
         FROM usage_events WHERE created_at >= ?`,
        `${todayPrefix}T00:00:00.000Z`
      )
      .one();

    const todayTasksRow = this.sql
      .exec<{ done_cnt: number }>(
        `SELECT COALESCE(SUM(task_done), 0) as done_cnt
         FROM activity_logs WHERE created_at >= ?`,
        `${todayPrefix}T00:00:00.000Z`
      )
      .one();

    const totalTasksCompleted = bots.reduce((acc, b) => acc + b.tasksCompleted, 0);
    const todayTasksCompleted = todayTasksRow?.done_cnt ?? totalTasksCompleted;
    const totalRequests = totals?.requests ?? 0;
    const errorRatePct =
      totalRequests > 0
        ? Number((((totals?.errors ?? 0) / totalRequests) * 100).toFixed(1))
        : 0;

    const todayTokens = todayTotals?.tokens ?? 0;
    const todayCostUsd = Number((todayTotals?.cost ?? 0).toFixed(4));
    const tokenUsedRatio = settings.dailyTokenCap > 0 ? todayTokens / settings.dailyTokenCap : 0;
    const costUsedRatio = settings.dailyCostCapUsd > 0 ? todayCostUsd / settings.dailyCostCapUsd : 0;
    const usageRemainingPct = Math.max(
      0,
      Math.min(100, Math.round((1 - Math.max(tokenUsedRatio, costUsedRatio)) * 100))
    );
    const budgetLocked = Boolean(
      settings.hardBudgetStop && (tokenUsedRatio >= 1.0 || costUsedRatio >= 1.0)
    );

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

    // Strictly chronological buckets keyed by YYYY-MM-DDTHH:M5
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
        todayTokens,
        todayCostUsd,
        todayTasksCompleted,
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
    this.sql.exec("DELETE FROM objectives");
  }

  private async seedDemoOffice(): Promise<void> {
    this.resetOffice();
    const now = new Date().toISOString();

    const demoReports: ReportPayload[] = [
      // Command & Media (Crimson Room)
      {
        botId: "audience-bot",
        name: "Audience",
        role: "Audience Researcher",
        department: "Command & Media",
        avatarColor: "#ec4899",
        deskIndex: 0,
        status: "working",
        task: "Reviewing retention curves & viewer feedback",
        model: "grok-4",
        done: true,
        simulated: true,
        usage: { model: "grok-4", tokensIn: 11200, tokensOut: 3400, latencyMs: 1180 },
      },
      {
        botId: "architect-bot",
        name: "Architect",
        role: "Content Strategist",
        department: "Command & Media",
        avatarColor: "#eab308",
        deskIndex: 1,
        status: "working",
        task: "Packaging weekly launch brief",
        model: "grok-4.7",
        done: true,
        simulated: true,
        usage: { model: "grok-4.7", tokensIn: 9400, tokensOut: 2800, latencyMs: 920 },
      },
      // Executive Studio (Plum Room)
      {
        botId: "mel-chief",
        name: "Mel",
        role: "Chief of Staff",
        department: "Executive Studio",
        avatarColor: "#f97316",
        deskIndex: 2,
        status: "working",
        task: "Coordinating morning priorities across 6 teams",
        model: "grok-4.20-multi-agent",
        done: true,
        simulated: true,
        usage: { model: "grok-4.20-multi-agent", tokensIn: 14800, tokensOut: 4100, latencyMs: 1650 },
      },
      // Analytics Lab (Teal Room)
      {
        botId: "stats-bot",
        name: "Stats",
        role: "Metrics Analyst",
        department: "Analytics Lab",
        avatarColor: "#22c55e",
        deskIndex: 3,
        status: "working",
        task: "Auditing funnel conversion & latency trends",
        model: "grok-4",
        done: true,
        simulated: true,
        usage: { model: "grok-4", tokensIn: 8900, tokensOut: 2200, latencyMs: 1050 },
      },
      {
        botId: "vidperf-bot",
        name: "VidPerf",
        role: "Performance Tracker",
        department: "Analytics Lab",
        avatarColor: "#38bdf8",
        deskIndex: 4,
        status: "working",
        task: "Comparing CTR across 4 thumbnail variants",
        model: "grok-3-mini",
        done: true,
        simulated: true,
        usage: { model: "grok-3-mini", tokensIn: 6200, tokensOut: 1700, latencyMs: 420 },
      },
      {
        botId: "conclusions-bot",
        name: "Conclusions",
        role: "Synthesis Agent",
        department: "Analytics Lab",
        avatarColor: "#94a3b8",
        deskIndex: 5,
        status: "idle",
        task: "Relaxing in central lounge",
        model: "grok-3-mini",
        done: true,
        simulated: true,
        usage: { model: "grok-3-mini", tokensIn: 3100, tokensOut: 900, latencyMs: 390 },
      },
      // Engineering Lab (Purple Rooms)
      {
        botId: "kyle-coo",
        name: "Kyle",
        role: "Engineering Lead",
        department: "Engineering Lab",
        avatarColor: "#10b981",
        deskIndex: 6,
        status: "waiting",
        task: "PR #142 ready — waiting for deploy sign-off",
        model: "grok-4.20-multi-agent",
        done: true,
        simulated: true,
        usage: { model: "grok-4.20-multi-agent", tokensIn: 16500, tokensOut: 4900, latencyMs: 1840 },
        need: {
          title: "Approve production Worker deploy (PR #142)",
          description: "All 47 unit tests passed. Ready to roll out edge rate-limiter.",
          severity: "approval",
        },
      },
      {
        botId: "systems-bot",
        name: "Systems",
        role: "Systems Analyst",
        department: "Engineering Lab",
        avatarColor: "#a855f7",
        deskIndex: 7,
        status: "working",
        task: "Profiling Durable Object SQLite query speed",
        model: "grok-4",
        done: true,
        simulated: true,
        usage: { model: "grok-4", tokensIn: 7600, tokensOut: 2100, latencyMs: 980 },
      },
      {
        botId: "accuracy-bot",
        name: "Accuracy",
        role: "QA & Verification",
        department: "Engineering Lab",
        avatarColor: "#60a5fa",
        deskIndex: 8,
        status: "meeting",
        collaboratingWith: "architect-bot",
        task: "Syncing with Architect on test coverage",
        model: "grok-4.7",
        done: true,
        simulated: true,
        usage: { model: "grok-4.7", tokensIn: 5400, tokensOut: 1500, latencyMs: 740 },
      },
      // AI News Desk (Gold Room)
      {
        botId: "jacob-news",
        name: "Jacob",
        role: "AI News Scout",
        department: "AI News Desk",
        avatarColor: "#06b6d4",
        deskIndex: 9,
        status: "working",
        task: "Scanning live X threads & AI announcements",
        model: "grok-4.7",
        done: true,
        simulated: true,
        usage: { model: "grok-4.7", tokensIn: 8200, tokensOut: 2500, latencyMs: 810 },
      },
      {
        botId: "johnny-editor",
        name: "Johnny",
        role: "Topic Curator",
        department: "AI News Desk",
        avatarColor: "#818cf8",
        deskIndex: 10,
        status: "working",
        task: "Sorting daily briefing topics by relevance",
        model: "grok-3-mini",
        done: true,
        simulated: true,
        usage: { model: "grok-3-mini", tokensIn: 4800, tokensOut: 1400, latencyMs: 460 },
      },
      // Ops & Finance
      {
        botId: "ledger-ops",
        name: "Ledger",
        role: "Finance & Billing",
        department: "Ops & Finance",
        avatarColor: "#fbbf24",
        deskIndex: 11,
        status: "error",
        task: "Stripe webhook secret expired on invoice sync",
        model: "grok-4",
        simulated: true,
        usage: { model: "grok-4", tokensIn: 3200, tokensOut: 600, latencyMs: 1120, error: true },
        need: {
          title: "Update Stripe webhook secret",
          description: "Received HTTP 400 on /webhooks/stripe. Rotate STRIPE_WHSEC in Secrets.",
          severity: "error",
        },
      },
      {
        botId: "planner-ops",
        name: "Planner",
        role: "Notion & Sprints",
        department: "Ops & Finance",
        avatarColor: "#f43f5e",
        deskIndex: 12,
        status: "idle",
        task: "Taking a coffee break in central lounge",
        model: "grok-3-mini",
        done: true,
        simulated: true,
        usage: { model: "grok-3-mini", tokensIn: 2400, tokensOut: 800, latencyMs: 370 },
      },
      {
        botId: "thangs-scout",
        name: "Thangs",
        role: "Asset Monitor",
        department: "Ops & Finance",
        avatarColor: "#e879f9",
        deskIndex: 13,
        status: "no_report",
        task: "Docked in Standby — scheduled nightly cron",
        model: "grok-3-mini",
        done: true,
        simulated: true,
        usage: { model: "grok-3-mini", tokensIn: 1900, tokensOut: 550, latencyMs: 340 },
      },
    ];

    for (const r of demoReports) {
      await this.handleReport(r);
    }

    const demoObjectives = [
      {
        id: "obj-q4-intel",
        title: "Daily AI News & Competitor Brief",
        owner: "jacob-news",
        progress: 80,
        target: "20 signals curated",
        status: "active",
      },
      {
        id: "obj-edge-deploy",
        title: "Ship Edge Rate-Limiter Middleware (PR #142)",
        owner: "kyle-coo",
        progress: 90,
        target: "Awaiting deploy sign-off",
        status: "active",
      },
      {
        id: "obj-analytics-audit",
        title: "Q4 Retention & Funnel Optimization",
        owner: "stats-bot",
        progress: 65,
        target: "4 experiments live",
        status: "active",
      },
    ];

    for (const o of demoObjectives) {
      this.sql.exec(
        `INSERT INTO objectives (id, title, owner_bot_id, progress, target_label, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        o.id,
        o.title,
        o.owner,
        o.progress,
        o.target,
        o.status,
        now
      );
    }
  }

  private async simulateTick(): Promise<void> {
    const bots = this.sql
      .exec<{ id: string; name: string; status: BotStatus; model: string }>(
        "SELECT id, name, status, model FROM bots"
      )
      .toArray();

    if (bots.length === 0) {
      await this.seedDemoOffice();
      return;
    }

    const pick = bots[Math.floor(Math.random() * bots.length)];
    const statuses: BotStatus[] = ["working", "working", "working", "idle", "meeting", "waiting"];
    const nextStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const otherBots = bots.filter((b) => b.id !== pick.id);
    const partner =
      nextStatus === "meeting" && otherBots.length > 0
        ? otherBots[Math.floor(Math.random() * otherBots.length)].id
        : null;

    const sampleTasks: Record<BotStatus, string[]> = {
      working: [
        "Scanning AI news & live X trends",
        "Comparing two build benchmarks",
        "Packaging a weekly executive brief",
        "Scouting new growth opportunities",
        "Drafting customer onboarding replies",
      ],
      idle: [
        "Grabbing espresso in central lounge",
        "Waiting for next scheduled trigger",
      ],
      meeting: [
        "Reviewing sprint handoff in conference room",
        "Coordinating campaign priorities with team",
      ],
      waiting: ["Waiting for human sign-off on external publish"],
      error: ["API rate limit exceeded — retrying"],
      no_report: ["No report received"],
    };

    const tasks = sampleTasks[nextStatus];
    const task = tasks[Math.floor(Math.random() * tasks.length)];

    await this.handleReport({
      botId: pick.id,
      status: nextStatus,
      task,
      collaboratingWith: partner,
      done: nextStatus === "idle",
      simulated: true,
      usage: {
        model: pick.model,
        tokensIn: 600 + Math.floor(Math.random() * 2600),
        tokensOut: 200 + Math.floor(Math.random() * 900),
        latencyMs: 380 + Math.floor(Math.random() * 1100),
      },
      need:
        nextStatus === "waiting"
          ? {
              title: `Approve action from ${pick.name}`,
              description: `${pick.name} is ready to publish an external update and requests confirmation.`,
              severity: "approval",
            }
          : undefined,
    });
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

  // Check Hard Budget Circuit-Breaker before forwarding to xAI
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
