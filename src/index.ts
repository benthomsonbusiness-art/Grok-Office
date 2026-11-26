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
import {
  UNAUTHORIZED_REPORT_BODY,
  UNAUTHORIZED_REPORT_STATUS,
  decideReportAccess,
  readReportBotId,
} from "./reportAuth";
import { renderOfficePasswordPage } from "./passwordGate";
import { runProxyGuard } from "./proxyGuard";
import { CEO_BOT_ID, allowWake, buildCeoWakePayload, wakeAuthHeader } from "./ceoWake";
import { redactAlertWebhook } from "./settingsRedact";
import {
  type CalendarEvent,
  type CalendarSyncState,
  isValidAppsScriptUrl,
  normalizeBridgeEvent,
  parseNewEvent,
} from "./calendar";
import { feedLabel, normalizeFeedUrl, parseIcs } from "./ics";
import { describeSchedule, isValidTimeZone, nextRunAfter, parseSchedule, scheduleToText, localParts } from "./routines";
import { actionUrl, clip, isValidTopic, normalizeServer, randomTopic, verifyAction, type NtfyMessage } from "./notify";
import {
  type AgentKind,
  buildDispatchPayload,
  maskDispatchUrl,
  normalizeAgentKind,
  supportsPush,
} from "./agentKinds";
import type {
  ActivityLog,
  BotOrders,
  BotRecord,
  BotStatus,
  GoogleTaskItem,
  GoogleTaskList,
  GoogleTaskStatus,
  GoogleTasksSyncState,
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

export interface Env extends Cloudflare.Env {
  REPORT_SECRET?: string;
  OFFICE_PASSWORD?: string;
  AI_GATEWAY_BASE_URL?: string;
  GOOGLE_TASKS_BRIDGE_URL?: string;
  GOOGLE_TASKS_BRIDGE_SECRET?: string;
  /** Jared's routine webhook (hq-order-router). Only the CEO is ever woken through it. */
  HQ_WEBHOOK_URL?: string;
  HQ_WEBHOOK_KEY?: string;
}

function isValidGoogleTasksBridgeUrl(rawUrl: string): boolean {
  if (!isSafeCallbackUrl(rawUrl)) return false;
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase() === "script.google.com" && u.pathname.startsWith("/macros/");
  } catch {
    return false;
  }
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
  alertWebhookConfigured: false,
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

function reportAuthInput(
  request: Request,
  env: Env,
  botId: string | null,
  ownedCheckinToken: string | null
) {
  const url = new URL(request.url);
  return {
    reportSecret: env.REPORT_SECRET,
    authorizationHeader: request.headers.get("authorization"),
    reportSecretHeader: request.headers.get("x-report-secret"),
    tokenQuery: url.searchParams.get("token"),
    pathname: url.pathname,
    botId,
    ownedCheckinToken,
  };
}

export class OfficeHub extends DurableObject<Env> {
  private sql: SqlStorage;
  private lastBroadcastAt = 0;
  private wakeHistory: number[] = [];
  private broadcastPending = false;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private publicOrigin = "";

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

      CREATE TABLE IF NOT EXISTS google_task_lists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS google_tasks (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        due TEXT,
        status TEXT NOT NULL DEFAULT 'needsAction',
        completed_at TEXT,
        position TEXT NOT NULL DEFAULT '',
        assigned_bot_id TEXT,
        source TEXT NOT NULL DEFAULT 'local',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        calendar_name TEXT NOT NULL DEFAULT 'Calendar',
        title TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        location TEXT NOT NULL DEFAULT '',
        html_link TEXT,
        color TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_rollups (
        day TEXT PRIMARY KEY,
        tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        runs_completed INTEGER NOT NULL DEFAULT 0,
        runs_failed INTEGER NOT NULL DEFAULT 0,
        tasks_done INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        title TEXT NOT NULL,
        schedule TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL DEFAULT 'owner',
        proposed_by TEXT,
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_asks (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        answer TEXT,
        delivered_at TEXT,
        answered_at TEXT,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_at);
      CREATE INDEX IF NOT EXISTS idx_routines_next ON routines(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_needs_status ON pending_needs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_started ON task_runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_queue_bot ON task_queue(bot_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_gtasks_list ON google_tasks(list_id, status, updated_at);
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
    if (!botCols.includes("checkin_token")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN checkin_token TEXT NOT NULL DEFAULT ''");
    }
    if (!botCols.includes("agent_kind")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN agent_kind TEXT NOT NULL DEFAULT 'grok'");
    }
    if (!botCols.includes("dispatch_url")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN dispatch_url TEXT NOT NULL DEFAULT ''");
    }
    if (!botCols.includes("reports_to")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN reports_to TEXT");
    }
    if (!botCols.includes("org_title")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN org_title TEXT NOT NULL DEFAULT ''");
    }
    if (!botCols.includes("archived")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
    }
    if (!botCols.includes("instructions")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
    }
    if (!botCols.includes("instructions_updated_at")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN instructions_updated_at TEXT");
    }
    const queueCols = this.sql
      .exec<{ name: string }>("PRAGMA table_info(task_queue)")
      .toArray()
      .map((c) => c.name);
    if (!queueCols.includes("from_bot_id")) {
      this.sql.exec("ALTER TABLE task_queue ADD COLUMN from_bot_id TEXT");
    }
    if (!queueCols.includes("source")) {
      this.sql.exec("ALTER TABLE task_queue ADD COLUMN source TEXT NOT NULL DEFAULT 'owner'");
    }
    if (!queueCols.includes("parent_id")) {
      this.sql.exec("ALTER TABLE task_queue ADD COLUMN parent_id TEXT");
    }
    if (!queueCols.includes("result")) {
      this.sql.exec("ALTER TABLE task_queue ADD COLUMN result TEXT");
    }
    if (!queueCols.includes("output_url")) {
      this.sql.exec("ALTER TABLE task_queue ADD COLUMN output_url TEXT");
    }
    if (!queueCols.includes("updated_at")) {
      this.sql.exec("ALTER TABLE task_queue ADD COLUMN updated_at TEXT");
    }
    if (!botCols.includes("placeholder")) {
      this.sql.exec("ALTER TABLE bots ADD COLUMN placeholder INTEGER NOT NULL DEFAULT 0");
    }
    const gtCols = this.sql
      .exec<{ name: string }>("PRAGMA table_info(google_tasks)")
      .toArray()
      .map((c) => c.name);
    if (!gtCols.includes("sync_pending")) {
      this.sql.exec("ALTER TABLE google_tasks ADD COLUMN sync_pending INTEGER NOT NULL DEFAULT 0");
    }
    this.applyOrgChartV1();
    // Order matters: restore "primary" as CEO before the daily-check-in setup looks for Jared.
    this.applyCeoPrimaryV1();
    this.applyDailyCheckinV1();
    this.repointDuplicateJaredV1();
    // Pushes cannot be in flight after a restart; return them to the queue.
    this.sql.exec("UPDATE task_queue SET status = 'queued' WHERE status = 'pushing'");
    const missingTokens = this.sql
      .exec<{ id: string }>("SELECT id FROM bots WHERE checkin_token IS NULL OR trim(checkin_token) = ''")
      .toArray();
    for (const row of missingTokens) {
      this.sql.exec("UPDATE bots SET checkin_token = ? WHERE id = ?", crypto.randomUUID(), row.id);
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
    try {
      await this.runAlarm();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Office alarm failed";
      console.log(JSON.stringify({ event: "office_alarm_error", message }));
      throw err;
    }
  }

  private async runAlarm(): Promise<void> {
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
      }>("SELECT id, name, avatar_color, status, last_seen_at, expected_interval_min, sla_alerted FROM bots WHERE archived = 0")
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
        const graceUntil = Date.parse(this.getSettingValue("sla_grace_until") || "") || 0;
        if (lastSeen < slaCutoff && bot.sla_alerted === 0 && nowMs > graceUntil) {
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

    // Periodic Google Tasks two-way background sync (every 2 minutes when connected)
    const gtCfg = this.getGoogleTasksConfig();
    if (gtCfg.bridgeUrl) {
      needNextAlarm = true;
      const lastSyncMs = gtCfg.lastSyncAt ? Date.parse(gtCfg.lastSyncAt) : 0;
      await this.retryPendingTaskPushes();
      if (!Number.isFinite(lastSyncMs) || nowMs - lastSyncMs >= 120_000) {
        const synced = await this.syncGoogleTasks();
        if (synced.ok) changed = true;
      }
    }

    // Google Calendar background refresh (every 5 minutes when connected)
    const calCfg = this.getCalendarConfig();
    if (calCfg.bridgeUrl || this.getCalendarFeeds().length > 0) {
      needNextAlarm = true;
      const lastCalMs = calCfg.lastSyncAt ? Date.parse(calCfg.lastSyncAt) : 0;
      if (!Number.isFinite(lastCalMs) || nowMs - lastCalMs >= 300_000) {
        const calSynced = await this.syncCalendar();
        if (calSynced.ok) changed = true;
      }
    }

    if (this.runDueRoutines(nowMs)) changed = true;
    const hasRoutines = (this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM routines WHERE status = 'active'").one()?.c ?? 0) > 0;
    if (hasRoutines) needNextAlarm = true;
    if (this.getSettingValue("notify_enabled") === "1") {
      needNextAlarm = true;
      try {
        await this.flushNotifications();
        await this.maybeSendMorningBrief(nowMs);
      } catch (err) {
        console.log(JSON.stringify({ event: "notify_error", message: err instanceof Error ? err.message : String(err) }));
      }
    }

    this.updateDailyRollup();

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
    if (url.hostname !== "internal" && (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      if (this.publicOrigin !== url.origin && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        this.saveSettingKey("public_origin", url.origin);
      }
      this.publicOrigin = url.origin;
    }

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
      const botId = clampText(readReportBotId(url.searchParams), 64);
      const ownedCheckinToken = botId ? this.getBotCheckinToken(botId) : null;
      if (!(await decideReportAccess(reportAuthInput(request, this.env, botId || null, ownedCheckinToken)))) {
        console.log(JSON.stringify({ event: "unauthorized_ping", botId: botId || null }));
        return jsonResponse(UNAUTHORIZED_REPORT_BODY, UNAUTHORIZED_REPORT_STATUS);
      }
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
      // Usage: in/out_tok (exact), or tok (total estimate, split 75/25), plus optional cost in USD.
      const num = (k: string) => {
        const v = Number(url.searchParams.get(k) ?? 0);
        return Number.isFinite(v) && v > 0 ? v : 0;
      };
      let tokensIn = Math.min(num("in"), 50_000_000);
      let tokensOut = Math.min(num("out_tok") || num("tokensOut"), 50_000_000);
      const totalTok = Math.min(num("tok"), 50_000_000);
      if (!tokensIn && !tokensOut && totalTok) {
        tokensIn = Math.round(totalTok * 0.75);
        tokensOut = totalTok - tokensIn;
      }
      const latencyMs = Math.min(num("ms"), 3_600_000);
      const reportedCost = Math.min(num("cost"), 10_000);
      if (tokensIn > 0 || tokensOut > 0 || reportedCost > 0) {
        payload.usage = {
          model: payload.model,
          tokensIn,
          tokensOut,
          latencyMs,
          ...(reportedCost > 0 ? { costUsd: reportedCost } : {}),
        };
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
      const hq = this.handleAgentExtras(botId, url.searchParams);
      const base = this.withOrders(result);
      const orders = { ...base.orders, ...this.extendedOrders(botId) } as Record<string, unknown>;
      // A task popped by this same check-in is already "current"; keep it in the daily list.
      const popped = typeof base.orders.nextTask === "string" ? base.orders.nextTask : null;
      const taskList = (orders.tasks as Array<{ id: string; task: string; from: string }>) || [];
      if (popped && !taskList.some((t) => t.task === popped)) {
        const row = this.sql
          .exec<{ id: string; source: string }>(
            "SELECT id, source FROM task_queue WHERE bot_id = ? AND task = ? ORDER BY created_at DESC LIMIT 1",
            botId,
            popped
          )
          .toArray()[0];
        orders.tasks = [{ id: row?.id ?? "current", task: popped, from: row?.source ?? "queue" }, ...taskList];
      }
      const isDaily = url.searchParams.get("daily") === "1";
      if (isDaily) this.markDailyDelivered(botId, orders);
      this.ctx.waitUntil(this.flushNotifications().catch(() => {}));
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, ...base, orders, ...(Object.keys(hq).length ? { hq } : {}) });
    }

    if (url.pathname === "/api/report" && request.method === "POST") {
      if (!(await decideReportAccess(reportAuthInput(request, this.env, null, null)))) {
        return jsonResponse(UNAUTHORIZED_REPORT_BODY, UNAUTHORIZED_REPORT_STATUS);
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
        agentKind?: string;
        dispatchUrl?: string;
        reportsTo?: string | null;
        orgTitle?: string;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const dispatchUrlIn = clampText(body.dispatchUrl, 500);
      if (dispatchUrlIn && !isSafeCallbackUrl(dispatchUrlIn)) {
        return jsonResponse({ error: "Webhook URL must be a public https:// URL" }, 400);
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
      const task = clampText(body.task, 200) || (status === "working" ? "Active in Work" : "Standing by in Lounge");
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
      this.sql.exec(
        "UPDATE bots SET agent_kind = ?, dispatch_url = ?, reports_to = ?, org_title = ?, archived = 0 WHERE id = ?",
        normalizeAgentKind(body.agentKind),
        dispatchUrlIn,
        clampText(body.reportsTo, 64) && clampText(body.reportsTo, 64) !== result.botId ? clampText(body.reportsTo, 64) : null,
        clampText(body.orgTitle, 40),
        result.botId
      );
      this.broadcastSnapshot();
      const checkinToken = this.getBotCheckinToken(result.botId) ?? "";
      return jsonResponse({ ok: true, ...result, checkinToken });
    }

    const botUpdateMatch = url.pathname.match(/^\/api\/bot\/([^/]+)\/update$/);
    if (botUpdateMatch && request.method === "POST") {
      if (!(await decideReportAccess(reportAuthInput(request, this.env, decodeURIComponent(botUpdateMatch[1]), null)))) {
        return jsonResponse(UNAUTHORIZED_REPORT_BODY, UNAUTHORIZED_REPORT_STATUS);
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
      if (!(await decideReportAccess(reportAuthInput(request, this.env, decodeURIComponent(botStatusMatch[1]), null)))) {
        return jsonResponse(UNAUTHORIZED_REPORT_BODY, UNAUTHORIZED_REPORT_STATUS);
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
        this.sql.exec("UPDATE task_queue SET status = 'dispatched', updated_at = ? WHERE id = ?", new Date().toISOString(), queuedRows[0].id);
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
        nextTaskId: shouldPop && queuedRows.length > 0 ? queuedRows[0].id : queuedRows[0]?.id ?? null,
        queuedTaskIds: shouldPop ? queuedRows.slice(1).map((q) => q.id) : queuedRows.map((q) => q.id),
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
      this.wakeCeo(id, botId, task, "api-queue");
      this.pushPendingDispatch(botId);
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
      const exists = this.sql
        .exec<{ id: string }>("SELECT id FROM bots WHERE id = ?", botId)
        .toArray()[0];
      if (!exists) {
        return jsonResponse({ error: "Bot not found" }, 404);
      }
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
        agentKind?: string;
        dispatchUrl?: string;
        reportsTo?: string | null;
        orgTitle?: string;
        archived?: boolean;
        instructions?: string;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      if (body.reportsTo !== undefined) {
        const boss = clampText(body.reportsTo, 64) || null;
        if (boss) {
          if (boss === botId) return jsonResponse({ error: "An agent cannot report to itself" }, 400);
          // Walk up from the new manager; if we reach this bot, it would form a loop.
          let cur: string | null = boss;
          for (let i = 0; cur && i < 50; i++) {
            if (cur === botId) return jsonResponse({ error: "That would create a reporting loop" }, 400);
            const r: { reports_to: string | null } | undefined = this.sql
              .exec<{ reports_to: string | null }>("SELECT reports_to FROM bots WHERE id = ?", cur)
              .toArray()[0];
            if (!r && i === 0) return jsonResponse({ error: "Manager not found" }, 404);
            cur = r?.reports_to ?? null;
          }
        }
        this.sql.exec("UPDATE bots SET reports_to = ? WHERE id = ?", boss, botId);
      }
      if (body.instructions !== undefined) {
        this.sql.exec(
          "UPDATE bots SET instructions = ?, instructions_updated_at = ? WHERE id = ?",
          clampText(body.instructions, 6000),
          new Date().toISOString(),
          botId
        );
      }
      if (body.orgTitle !== undefined) {
        this.sql.exec("UPDATE bots SET org_title = ? WHERE id = ?", clampText(body.orgTitle, 40), botId);
      }
      if (body.archived !== undefined) {
        this.sql.exec("UPDATE bots SET archived = ? WHERE id = ?", body.archived ? 1 : 0, botId);
        if (body.archived) {
          // Direct reports move up to this agent's manager.
          const me = this.sql.exec<{ reports_to: string | null }>("SELECT reports_to FROM bots WHERE id = ?", botId).toArray()[0];
          this.sql.exec("UPDATE bots SET reports_to = ? WHERE reports_to = ?", me?.reports_to ?? null, botId);
        }
        this.broadcastSnapshot();
        return jsonResponse({ ok: true, archived: Boolean(body.archived) });
      }
      if (body.agentKind !== undefined) {
        this.sql.exec("UPDATE bots SET agent_kind = ? WHERE id = ?", normalizeAgentKind(body.agentKind), botId);
      }
      if (body.dispatchUrl !== undefined) {
        const du = clampText(body.dispatchUrl, 500);
        if (du && !isSafeCallbackUrl(du)) {
          return jsonResponse({ error: "Webhook URL must be a public https:// URL" }, 400);
        }
        this.sql.exec("UPDATE bots SET dispatch_url = ? WHERE id = ?", du, botId);
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
          const qid = crypto.randomUUID();
          this.sql.exec(
            "INSERT INTO task_queue (id, bot_id, task, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
            qid,
            botId,
            queuedTask,
            new Date().toISOString()
          );
          this.wakeCeo(qid, botId, queuedTask, "bot-command");
        }
      }
      if (queuedTask) this.pushPendingDispatch(botId);
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
      return jsonResponse({ settings: redactAlertWebhook(this.getSettings()) });
    }

    if (url.pathname === "/api/settings" && request.method === "POST") {
      let body: Partial<OfficeSettings> & { clearAlertWebhook?: boolean };
      try {
        body = (await request.json()) as Partial<OfficeSettings> & { clearAlertWebhook?: boolean };
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const cur = this.getSettings();
      const rawWebhook = clampText(body.alertWebhookUrl, 300);
      let safeWebhook = cur.alertWebhookUrl;
      if (rawWebhook) {
        safeWebhook = isSafeCallbackUrl(rawWebhook) ? rawWebhook : "";
      } else if (body.clearAlertWebhook === true) {
        safeWebhook = "";
      }
      const next: OfficeSettings = {
        dailyTokenCap: Math.max(1000, Math.round(Number(body.dailyTokenCap ?? cur.dailyTokenCap))),
        dailyCostCapUsd: Math.max(0.1, Number(body.dailyCostCapUsd ?? cur.dailyCostCapUsd)),
        dailyTaskTarget: Math.max(1, Math.round(Number(body.dailyTaskTarget ?? cur.dailyTaskTarget))),
        autoIdleMinutes: Math.max(1, Math.min(120, Math.round(Number(body.autoIdleMinutes ?? cur.autoIdleMinutes)))),
        hardBudgetStop:
          body.hardBudgetStop !== undefined ? Boolean(body.hardBudgetStop) : cur.hardBudgetStop,
        alertWebhookUrl: safeWebhook,
        alertWebhookConfigured: Boolean(safeWebhook),
      };
      for (const [k, v] of Object.entries(next)) {
        if (k === "alertWebhookConfigured") continue;
        this.sql.exec(
          `INSERT INTO office_settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          k,
          String(v)
        );
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, settings: redactAlertWebhook(next) });
    }

    if (url.pathname === "/api/calendar/config" && request.method === "POST") {
      let body: { bridgeUrl?: string; secret?: string; disconnect?: boolean };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      if (body.disconnect) {
        for (const k of ["calendar_url", "calendar_secret", "calendar_error", "calendar_last_sync"]) this.saveSettingKey(k, "");
        this.sql.exec("DELETE FROM calendar_events");
        this.broadcastSnapshot();
        return jsonResponse({ ok: true, connected: false });
      }
      const bridgeUrl = clampText(body.bridgeUrl, 400);
      if (!bridgeUrl || !isValidAppsScriptUrl(bridgeUrl)) {
        return jsonResponse({ error: "Bridge URL must be a https://script.google.com/macros/s/.../exec URL" }, 400);
      }
      const secret = clampText(body.secret, 160) || this.getCalendarConfig().secret;
      if (!secret) return jsonResponse({ error: "A shared secret is required" }, 400);
      // Verify before saving, so a bad URL never replaces a working one.
      const probe = await this.callCalendarBridge("list", {
        from: new Date().toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      }, { bridgeUrl, secret });
      if (!probe.ok) {
        return jsonResponse({ ok: false, error: probe.error || "Could not reach the Calendar bridge" }, 502);
      }
      this.saveSettingKey("calendar_url", bridgeUrl);
      this.saveSettingKey("calendar_secret", secret);
      const synced = await this.syncCalendar();
      await this.ensureAlarmScheduled();
      this.broadcastSnapshot();
      return jsonResponse({ ok: synced.ok, connected: true, syncedCount: synced.count, error: synced.error });
    }

    // ---- Today bar: send a request to Jared (the CEO agent) ----
    if (url.pathname === "/api/requests" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { text?: string };
      const text = clampText(body.text, 1000);
      if (!text) return jsonResponse({ error: "Type what you need" }, 400);
      const ceo = this.getCeoId();
      if (!ceo) return jsonResponse({ error: "No CEO agent yet. Set one on the Agents page." }, 409);
      const id = this.enqueueTaskForBot(ceo, text, { source: "request", maxLen: 1000 });
      const me = this.sql.exec<{ name: string; avatar_color: string; status: BotStatus }>("SELECT name, avatar_color, status FROM bots WHERE id = ?", ceo).toArray()[0];
      if (me) this.insertLog(ceo, me.name, me.avatar_color, me.status, "info", `New request from you: "${clampText(text, 100)}"`);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, id, to: ceo, wakeConfigured: Boolean(this.env.HQ_WEBHOOK_URL && this.env.HQ_WEBHOOK_KEY) });
    }

    // ---- Routines ----
    if (url.pathname === "/api/routines" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { botId?: string; title?: string; schedule?: string };
      const bot = this.findBotRef(clampText(body.botId, 64));
      const title = clampText(body.title, 200);
      const sched = parseSchedule(clampText(body.schedule, 80));
      if (!bot) return jsonResponse({ error: "Pick an agent" }, 400);
      if (!title) return jsonResponse({ error: "Describe the task" }, 400);
      if (!sched) return jsonResponse({ error: "Schedule not understood. Try: weekdays 07:00, mon,thu 09:30, monthly 1 08:00" }, 400);
      const id = `rt-${crypto.randomUUID().slice(0, 8)}`;
      const text = scheduleToText(sched);
      this.sql.exec(
        "INSERT INTO routines (id, bot_id, title, schedule, status, source, created_at, next_run_at) VALUES (?, ?, ?, ?, 'active', 'owner', ?, ?)",
        id,
        bot.id,
        title,
        text,
        new Date().toISOString(),
        this.computeNextRun(text, Date.now())
      );
      await this.ensureAlarmScheduled();
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, id, schedule: describeSchedule(sched) });
    }

    if (url.pathname === "/api/routines/approve-all" && request.method === "POST") {
      const rows = this.sql.exec<{ id: string; schedule: string }>("SELECT id, schedule FROM routines WHERE status = 'proposed'").toArray();
      for (const r of rows) {
        this.sql.exec("UPDATE routines SET status = 'active', next_run_at = ? WHERE id = ?", this.computeNextRun(r.schedule, Date.now()), r.id);
      }
      await this.ensureAlarmScheduled();
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, approved: rows.length });
    }

    const routineMatch = url.pathname.match(/^\/api\/routines\/([^/]+)(\/run)?$/);
    if (routineMatch) {
      const id = decodeURIComponent(routineMatch[1]);
      const r = this.sql
        .exec<{ id: string; bot_id: string; title: string; schedule: string; status: string }>("SELECT id, bot_id, title, schedule, status FROM routines WHERE id = ?", id)
        .toArray()[0];
      if (!r) return jsonResponse({ error: "Routine not found" }, 404);
      if (routineMatch[2] && request.method === "POST") {
        this.enqueueTaskForBot(r.bot_id, r.title, { source: "routine" });
        this.sql.exec("UPDATE routines SET last_run_at = ? WHERE id = ?", new Date().toISOString(), id);
        this.broadcastSnapshot();
        return jsonResponse({ ok: true });
      }
      if (request.method === "DELETE") {
        this.sql.exec("DELETE FROM routines WHERE id = ?", id);
        this.broadcastSnapshot();
        return jsonResponse({ ok: true });
      }
      if (request.method === "PATCH") {
        const body = (await request.json().catch(() => ({}))) as { status?: string; title?: string; schedule?: string; botId?: string };
        let schedule = r.schedule;
        if (body.schedule !== undefined) {
          const sched = parseSchedule(clampText(body.schedule, 80));
          if (!sched) return jsonResponse({ error: "Schedule not understood" }, 400);
          schedule = scheduleToText(sched);
        }
        const status = body.status && ["active", "paused", "rejected"].includes(body.status) ? body.status : r.status;
        let botId = r.bot_id;
        if (body.botId) {
          const b = this.findBotRef(body.botId);
          if (!b) return jsonResponse({ error: "Agent not found" }, 404);
          botId = b.id;
        }
        const title = body.title !== undefined ? clampText(body.title, 200) || r.title : r.title;
        if (status === "rejected") {
          this.sql.exec("DELETE FROM routines WHERE id = ?", id);
        } else {
          this.sql.exec(
            "UPDATE routines SET status = ?, schedule = ?, title = ?, bot_id = ?, next_run_at = ? WHERE id = ?",
            status,
            schedule,
            title,
            botId,
            status === "active" ? this.computeNextRun(schedule, Date.now()) : null,
            id
          );
        }
        await this.ensureAlarmScheduled();
        this.broadcastSnapshot();
        return jsonResponse({ ok: true });
      }
    }

    // ---- Ask an agent ----
    if (url.pathname === "/api/asks" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { botId?: string; question?: string };
      const bot = this.findBotRef(clampText(body.botId, 64));
      const question = clampText(body.question, 600);
      if (!bot) return jsonResponse({ error: "Pick an agent" }, 400);
      if (!question) return jsonResponse({ error: "Type a question" }, 400);
      const id = `ask-${crypto.randomUUID().slice(0, 8)}`;
      this.sql.exec("INSERT INTO agent_asks (id, bot_id, question, status, created_at) VALUES (?, ?, ?, 'open', ?)", id, bot.id, question, new Date().toISOString());
      this.pushPendingDispatch(bot.id);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, id });
    }
    const askMatch = url.pathname.match(/^\/api\/asks\/([^/]+)(\/ack)?$/);
    if (askMatch) {
      const id = decodeURIComponent(askMatch[1]);
      if (askMatch[2] && request.method === "POST") {
        this.sql.exec("UPDATE agent_asks SET acknowledged = 1 WHERE id = ?", id);
      } else if (request.method === "DELETE") {
        this.sql.exec("DELETE FROM agent_asks WHERE id = ?", id);
      } else {
        return jsonResponse({ error: "Not found" }, 404);
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    // ---- Team handbook + time zone ----
    if (url.pathname === "/api/handbook" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { text?: string; timeZone?: string };
      if (body.text !== undefined) this.saveSettingKey("handbook", clampText(body.text, 4000));
      if (body.timeZone !== undefined) {
        if (!isValidTimeZone(body.timeZone)) return jsonResponse({ error: "Unknown time zone" }, 400);
        this.saveSettingKey("office_timezone", body.timeZone);
        const rows = this.sql.exec<{ id: string; schedule: string }>("SELECT id, schedule FROM routines WHERE status = 'active'").toArray();
        for (const r of rows) this.sql.exec("UPDATE routines SET next_run_at = ? WHERE id = ?", this.computeNextRun(r.schedule, Date.now()), r.id);
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    // ---- Phone notifications ----
    if (url.pathname === "/api/notify/config" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        enabled?: boolean;
        server?: string;
        topic?: string;
        finished?: boolean;
        briefTime?: string;
        newTopic?: boolean;
      };
      if (body.server !== undefined) {
        const server = normalizeServer(body.server);
        if (!server) return jsonResponse({ error: "Server must be an https:// address" }, 400);
        this.saveSettingKey("notify_server", server);
      }
      if (body.newTopic || (body.enabled && !this.getSettingValue("notify_topic"))) this.saveSettingKey("notify_topic", randomTopic());
      if (body.topic !== undefined) {
        if (!isValidTopic(body.topic)) return jsonResponse({ error: "Topic must be 12-64 letters, numbers, - or _" }, 400);
        this.saveSettingKey("notify_topic", body.topic);
      }
      if (body.finished !== undefined) this.saveSettingKey("notify_finished", body.finished ? "1" : "0");
      if (body.briefTime !== undefined) {
        if (body.briefTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.briefTime)) return jsonResponse({ error: "Brief time must be HH:MM" }, 400);
        this.saveSettingKey("notify_brief_time", body.briefTime);
      }
      if (body.enabled !== undefined) {
        const was = this.getSettingValue("notify_enabled") === "1";
        this.saveSettingKey("notify_enabled", body.enabled ? "1" : "0");
        if (body.enabled && !was) {
          // Start fresh: only things that happen from now on are sent.
          const now = new Date().toISOString();
          for (const k of ["notify_wm_need", "notify_wm_run", "notify_wm_ask", "notify_wm_routine"]) this.saveSettingKey(k, now);
          const tzLocal = localParts(Date.now(), this.officeTimeZone());
          this.saveSettingKey("notify_last_brief", `${tzLocal.y}-${String(tzLocal.mo).padStart(2, "0")}-${String(tzLocal.d).padStart(2, "0")}`);
          await this.ensureAlarmScheduled();
        }
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, notify: this.notifySnapshot() });
    }

    if (url.pathname === "/api/notify/test" && request.method === "POST") {
      const cfg = this.getNotifyConfig();
      const origin = this.knownOrigin();
      const res = await this.sendNtfy({
        title: "Grok Bot HQ is connected",
        message: "Approvals, finished work, answers and your morning brief will arrive here.",
        priority: 4,
        tags: ["tada"],
        click: origin ? `${origin}/#today` : undefined,
      });
      if (!res.ok) return jsonResponse({ error: res.error || "Could not reach ntfy" }, 502);
      return jsonResponse({ ok: true, topic: cfg.topic });
    }

    if (url.pathname === "/api/notify/brief" && request.method === "POST") {
      this.saveSettingKey("notify_last_brief", "");
      const enabled = this.getSettingValue("notify_enabled") === "1";
      if (!enabled) return jsonResponse({ error: "Turn on notifications first" }, 400);
      const sent = await this.maybeSendMorningBrief(Date.now(), true);
      return jsonResponse({ ok: true, sent });
    }

    if (url.pathname === "/api/notify/act") {
      const n = clampText(url.searchParams.get("n"), 80);
      const a = clampText(url.searchParams.get("a"), 10);
      const exp = Number(url.searchParams.get("exp"));
      const sig = clampText(url.searchParams.get("sig"), 100);
      const valid = await verifyAction(this.getNotifyConfig().secret, n, a, exp, sig);
      const page = (title: string, msg: string, form = "") =>
        new Response(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;background:#0a0b0f;color:#ece9e2;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:360px;padding:24px;text-align:center"><h1 style="font-size:1.3rem">${title}</h1><p style="color:#a5a39d">${msg}</p>${form}</main></body>`,
          { status: valid ? 200 : 403, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
      if (!valid) return page("Link expired", "This approval link is invalid or older than 7 days. Open the HQ Inbox instead.");
      const need = this.listNeeds(null, null).find((x) => x.id === n);
      if (!need) return page("Not found", "That request no longer exists.");
      if (request.method === "GET") {
        return page(
          `${a === "approve" ? "Approve" : "Reject"}?`,
          `${esc(need.botName)}: ${esc(need.title)}`,
          `<form method="post"><button style="font:inherit;padding:12px 22px;border-radius:10px;border:0;background:#ffb547;color:#1a1206;font-weight:600">${a === "approve" ? "Approve" : "Reject"}</button></form>`
        );
      }
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      if (need.status !== "open") return page("Already handled", `This was already ${esc(need.status)}.`);
      await this.resolveNeed(n, a === "approve" ? "approve" : "reject", "From phone notification");
      this.broadcastSnapshot();
      return page(a === "approve" ? "Approved" : "Rejected", `${esc(need.botName)} will get your decision on its next check-in.`);
    }

    if (url.pathname === "/api/calendar/feeds" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { url?: string; name?: string };
      const feedUrl = normalizeFeedUrl(clampText(body.url, 1000));
      if (!feedUrl) return jsonResponse({ error: "Paste the full https:// calendar link (it ends in .ics)" }, 400);
      const feeds = this.getCalendarFeeds();
      if (feeds.some((f) => f.url === feedUrl)) return jsonResponse({ error: "That calendar is already connected" }, 409);
      if (feeds.length >= 12) return jsonResponse({ error: "Up to 12 calendars can be connected" }, 400);
      const probe = await this.fetchFeed(feedUrl);
      if (!probe.ok || !probe.text) return jsonResponse({ error: probe.error || "Could not read that calendar" }, 400);
      const nameFromFeed = probe.text.match(/^X-WR-CALNAME:(.*)$/m)?.[1]?.trim();
      const palette = ["#9b8cff", "#4fd1b5", "#ffb547", "#ff8a7a", "#6cb8ff", "#e78bd8"];
      const feed = {
        id: `ics-${crypto.randomUUID().slice(0, 8)}`,
        url: feedUrl,
        name: clampText(body.name, 60) || clampText(nameFromFeed, 60) || feedLabel(feedUrl),
        color: palette[feeds.length % palette.length],
      };
      this.saveCalendarFeeds([...feeds, feed]);
      const synced = await this.syncCalendar();
      await this.ensureAlarmScheduled();
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, feed: { id: feed.id, name: feed.name }, syncedCount: synced.count });
    }

    const feedDelMatch = url.pathname.match(/^\/api\/calendar\/feeds\/([^/]+)$/);
    if (feedDelMatch && request.method === "DELETE") {
      const id = decodeURIComponent(feedDelMatch[1]);
      const feeds = this.getCalendarFeeds();
      if (!feeds.some((f) => f.id === id)) return jsonResponse({ error: "Calendar not found" }, 404);
      this.saveCalendarFeeds(feeds.filter((f) => f.id !== id));
      this.sql.exec("DELETE FROM calendar_events WHERE calendar_id = ?", id);
      if (this.getCalendarFeeds().length === 0 && !this.getCalendarConfig().bridgeUrl) {
        this.saveSettingKey("calendar_error", "");
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/calendar/sync" && request.method === "POST") {
      if (!this.getCalendarConfig().bridgeUrl && this.getCalendarFeeds().length === 0) {
        return jsonResponse({ error: "Google Calendar is not connected yet" }, 400);
      }
      const synced = await this.syncCalendar();
      await this.ensureAlarmScheduled();
      this.broadcastSnapshot();
      if (!synced.ok) return jsonResponse({ ok: false, error: synced.error || "Sync failed" }, 502);
      return jsonResponse({ ok: true, syncedCount: synced.count });
    }

    if (url.pathname === "/api/calendar/events" && request.method === "POST") {
      const parsed = parseNewEvent(await request.json().catch(() => null));
      if ("error" in parsed) return jsonResponse({ error: parsed.error }, 400);
      if (!this.getCalendarConfig().bridgeUrl) {
        return jsonResponse({ error: "Connect Google Calendar first" }, 400);
      }
      const res = await this.callCalendarBridge("create", { ...parsed });
      if (!res.ok) return jsonResponse({ error: res.error || "Could not create event" }, 502);
      const created = normalizeBridgeEvent(res.data?.event);
      if (created) {
        this.sql.exec(
          `INSERT OR REPLACE INTO calendar_events (id, calendar_id, calendar_name, title, start_at, end_at, all_day, location, html_link, color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          created.id,
          created.calendarId,
          created.calendarName,
          created.title,
          created.start,
          created.end,
          created.allDay ? 1 : 0,
          created.location,
          created.htmlLink,
          created.color
        );
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, event: created });
    }

    const calEventMatch = url.pathname.match(/^\/api\/calendar\/events\/([^/]+)$/);
    if (calEventMatch && request.method === "DELETE") {
      const eventId = decodeURIComponent(calEventMatch[1]);
      const row = this.sql
        .exec<{ id: string; calendar_id: string }>("SELECT id, calendar_id FROM calendar_events WHERE id = ?", eventId)
        .toArray()[0];
      if (!row) return jsonResponse({ error: "Event not found" }, 404);
      const res = await this.callCalendarBridge("delete", { eventId: row.id, calendarId: row.calendar_id });
      if (!res.ok) return jsonResponse({ error: res.error || "Could not delete event" }, 502);
      this.sql.exec("DELETE FROM calendar_events WHERE id = ?", eventId);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/tasks/config" && request.method === "POST") {
      let body: { bridgeUrl?: string; secret?: string; disconnect?: boolean };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      if (body.disconnect) {
        this.saveSettingKey("google_tasks_url", "");
        this.saveSettingKey("google_tasks_secret", "");
        this.saveSettingKey("google_tasks_error", "");
        this.sql.exec("DELETE FROM google_tasks WHERE source = 'google'");
        this.sql.exec("DELETE FROM google_task_lists WHERE id != 'local'");
        this.broadcastSnapshot();
        return jsonResponse({ ok: true, connected: false });
      }
      const bridgeUrl = clampText(body.bridgeUrl, 400);
      const secret = clampText(body.secret, 160);
      if (!bridgeUrl || !isValidGoogleTasksBridgeUrl(bridgeUrl)) {
        return jsonResponse(
          { error: "Bridge URL must be a valid https://script.google.com/macros/s/.../exec URL" },
          400
        );
      }
      this.saveSettingKey("google_tasks_url", bridgeUrl);
      if (secret) {
        this.saveSettingKey("google_tasks_secret", secret);
      }
      const synced = await this.syncGoogleTasks();
      await this.ensureAlarmScheduled();
      this.broadcastSnapshot();
      if (!synced.ok) {
        return jsonResponse({ ok: false, error: synced.error || "Could not connect to Google Tasks bridge" }, 502);
      }
      return jsonResponse({ ok: true, connected: true, syncedCount: synced.count });
    }

    if (url.pathname === "/api/tasks/sync" && request.method === "POST") {
      const cfg = this.getGoogleTasksConfig();
      if (!cfg.bridgeUrl) {
        return jsonResponse({ error: "Google Tasks is not connected yet" }, 400);
      }
      await this.retryPendingTaskPushes();
      const synced = await this.syncGoogleTasks();
      await this.ensureAlarmScheduled();
      this.broadcastSnapshot();
      if (!synced.ok) {
        return jsonResponse({ ok: false, error: synced.error || "Sync failed" }, 502);
      }
      return jsonResponse({ ok: true, syncedCount: synced.count });
    }

    if (url.pathname === "/api/tasks" && request.method === "POST") {
      let body: {
        listId?: string;
        title?: string;
        notes?: string;
        due?: string | null;
        assignedBotId?: string | null;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const title = clampText(body.title, 200);
      if (!title) return jsonResponse({ error: "title is required" }, 400);
      const notes = clampText(body.notes, 1000);
      const due = body.due ? clampText(body.due, 40) : null;
      const assignedBotId = clampText(body.assignedBotId, 64) || null;
      const now = new Date().toISOString();
      const cfg = this.getGoogleTasksConfig();
      const lists = this.listGoogleTaskLists();
      const listId = clampText(body.listId, 120) || lists[0]?.id || "local";

      let taskId = `local-${crypto.randomUUID()}`;
      let source: "google" | "local" = "local";
      let resolvedListId = listId;
      let resolvedDue = due;

      if (cfg.bridgeUrl && listId !== "local") {
        const res = await this.callGoogleTasksBridge("create", {
          listId,
          title,
          notes,
          due: due || undefined,
        });
        if (!res.ok) {
          return jsonResponse({ error: res.error || "Google Tasks create failed" }, 502);
        }
        const created = res.task;
        if (created?.id) {
          taskId = String(created.id);
          source = "google";
          resolvedListId = created.listId ? String(created.listId) : listId;
          resolvedDue = created.due ? String(created.due) : due;
        }
      } else {
        this.sql.exec(
          `INSERT OR IGNORE INTO google_task_lists (id, title, updated_at) VALUES ('local', 'My Tasks', ?)`,
          now
        );
        resolvedListId = "local";
      }

      this.sql.exec(
        `INSERT INTO google_tasks (id, list_id, title, notes, due, status, completed_at, position, assigned_bot_id, source, updated_at)
         VALUES (?, ?, ?, ?, ?, 'needsAction', NULL, '', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           list_id = excluded.list_id,
           title = excluded.title,
           notes = excluded.notes,
           due = excluded.due,
           assigned_bot_id = excluded.assigned_bot_id,
           source = excluded.source,
           updated_at = excluded.updated_at`,
        taskId,
        resolvedListId,
        title,
        notes,
        resolvedDue,
        assignedBotId,
        source,
        now
      );

      if (assignedBotId) {
        this.enqueueTaskForBot(assignedBotId, title);
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true, id: taskId, source });
    }

    const taskAssignMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/assign$/);
    if (taskAssignMatch && request.method === "POST") {
      const taskId = decodeURIComponent(taskAssignMatch[1]);
      let body: { botId?: string | null };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      const row = this.sql
        .exec<{ id: string; title: string; notes: string }>(
          "SELECT id, title, notes FROM google_tasks WHERE id = ?",
          taskId
        )
        .toArray()[0];
      if (!row) return jsonResponse({ error: "Task not found" }, 404);
      const botId = clampText(body.botId, 64) || null;
      if (botId) {
        const botExists = this.sql
          .exec<{ id: string }>("SELECT id FROM bots WHERE id = ?", botId)
          .toArray()[0];
        if (!botExists) return jsonResponse({ error: "Bot not found" }, 404);
      }
      this.sql.exec(
        "UPDATE google_tasks SET assigned_bot_id = ?, updated_at = ? WHERE id = ?",
        botId,
        new Date().toISOString(),
        taskId
      );
      if (botId) {
        const cmdText = row.notes ? `${row.title} — ${clampText(row.notes, 100)}` : row.title;
        this.enqueueTaskForBot(botId, clampText(cmdText, 200));
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    const taskItemMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskItemMatch && request.method === "PATCH") {
      const taskId = decodeURIComponent(taskItemMatch[1]);
      const existing = this.sql
        .exec<{
          id: string;
          list_id: string;
          title: string;
          notes: string;
          due: string | null;
          status: GoogleTaskStatus;
          completed_at: string | null;
          assigned_bot_id: string | null;
          source: "google" | "local";
        }>("SELECT * FROM google_tasks WHERE id = ?", taskId)
        .toArray()[0];
      if (!existing) return jsonResponse({ error: "Task not found" }, 404);

      let body: {
        title?: string;
        notes?: string;
        due?: string | null;
        status?: GoogleTaskStatus;
        assignedBotId?: string | null;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }

      const nextTitle = body.title !== undefined ? clampText(body.title, 200) || existing.title : existing.title;
      const nextNotes = body.notes !== undefined ? clampText(body.notes, 1000) : existing.notes;
      const nextDue = body.due !== undefined ? (body.due ? clampText(body.due, 40) : null) : existing.due;
      const nextStatus: GoogleTaskStatus =
        body.status === "completed" || body.status === "needsAction" ? body.status : existing.status;
      const now = new Date().toISOString();
      const nextCompletedAt =
        nextStatus === "completed" ? existing.completed_at ?? now : null;
      const nextAssignedBotId =
        body.assignedBotId !== undefined
          ? clampText(body.assignedBotId, 64) || null
          : existing.assigned_bot_id;

      // Save locally first so the UI never waits on Google, then push in the background.
      // sync_pending protects this edit from being overwritten by a sync until Google has it.
      const cfg = this.getGoogleTasksConfig();
      const needsPush = Boolean(cfg.bridgeUrl && existing.source === "google");
      this.sql.exec(
        `UPDATE google_tasks
         SET title = ?, notes = ?, due = ?, status = ?, completed_at = ?, assigned_bot_id = ?, updated_at = ?, sync_pending = ?
         WHERE id = ?`,
        nextTitle,
        nextNotes,
        nextDue,
        nextStatus,
        nextCompletedAt,
        nextAssignedBotId,
        now,
        needsPush ? 1 : 0,
        taskId
      );
      if (needsPush) this.ctx.waitUntil(this.pushPendingTask(taskId));

      if (nextAssignedBotId && nextAssignedBotId !== existing.assigned_bot_id) {
        this.enqueueTaskForBot(nextAssignedBotId, nextTitle);
      }
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
    }

    if (taskItemMatch && request.method === "DELETE") {
      const taskId = decodeURIComponent(taskItemMatch[1]);
      const existing = this.sql
        .exec<{ id: string; list_id: string; source: "google" | "local" }>(
          "SELECT id, list_id, source FROM google_tasks WHERE id = ?",
          taskId
        )
        .toArray()[0];
      if (!existing) return jsonResponse({ error: "Task not found" }, 404);

      const cfg = this.getGoogleTasksConfig();
      if (cfg.bridgeUrl && existing.source === "google") {
        const res = await this.callGoogleTasksBridge("delete", {
          listId: existing.list_id,
          taskId: existing.id,
        });
        if (!res.ok) {
          return jsonResponse({ error: res.error || "Google Tasks delete failed" }, 502);
        }
      }
      this.sql.exec("DELETE FROM google_tasks WHERE id = ?", taskId);
      this.broadcastSnapshot();
      return jsonResponse({ ok: true });
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
      // Standing rule: HQ history is never wiped from the dashboard or API.
      return jsonResponse({ error: "Reset is disabled. HQ history is kept." }, 405);
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

  private flushBroadcastSnapshot(): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    this.lastBroadcastAt = Date.now();
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

  private broadcastSnapshot(): void {
    if (this.ctx.getWebSockets().length === 0) return;
    const now = Date.now();
    const elapsed = now - this.lastBroadcastAt;
    if (elapsed >= 80) {
      if (this.broadcastTimer) {
        clearTimeout(this.broadcastTimer);
        this.broadcastTimer = null;
      }
      this.broadcastPending = false;
      this.flushBroadcastSnapshot();
      return;
    }
    this.broadcastPending = true;
    if (!this.broadcastTimer) {
      const waitMs = Math.max(10, 80 - elapsed);
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        if (this.broadcastPending) {
          this.broadcastPending = false;
          this.flushBroadcastSnapshot();
        }
      }, waitMs);
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
        checkin_token?: string;
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
    const checkinToken = existing?.checkin_token?.trim() || crypto.randomUUID();

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
           collaborating_with = ?,
           checkin_token = ?
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
        checkinToken,
        botId
      );
    } else {
      this.sql.exec(
        `INSERT INTO bots (
           id, name, role, department, avatar_color, avatar_shape, desk_index, status, task, model,
           tokens_total, cost_total_usd, requests_total, tasks_completed, error_count,
           expected_interval_min, sla_alerted, last_seen_at, collaborating_with, checkin_token
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
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
        collaboratingWith,
        checkinToken
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
      this.sql.exec("UPDATE bots SET placeholder = 0 WHERE id = ? AND placeholder = 1", botId);
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
        if (payload.done === true) {
          const matchedGTask = this.sql
            .exec<{ id: string; list_id: string; title: string; notes: string; due: string | null; source: "google" | "local" }>(
              "SELECT id, list_id, title, notes, due, source FROM google_tasks WHERE assigned_bot_id = ? AND status = 'needsAction' AND lower(trim(title)) = ? LIMIT 1",
              botId,
              reportedTaskNorm
            )
            .toArray()[0];
          if (matchedGTask) {
            const push = matchedGTask.source === "google" && Boolean(this.getGoogleTasksConfig().bridgeUrl);
            this.sql.exec(
              "UPDATE google_tasks SET status = 'completed', completed_at = ?, updated_at = ?, sync_pending = ? WHERE id = ?",
              now,
              now,
              push ? 1 : 0,
              matchedGTask.id
            );
            if (push) this.ctx.waitUntil(this.pushPendingTask(matchedGTask.id).catch(() => false));
          }
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
          this.sql.exec(`
            DELETE FROM task_queue
            WHERE status != 'queued' AND id NOT IN (
              SELECT id FROM task_queue WHERE status != 'queued' ORDER BY created_at DESC LIMIT 100
            )
          `);
        }
      }
    }

    this.sql.exec(`
      DELETE FROM pending_needs
      WHERE status != 'open' AND id NOT IN (
        SELECT id FROM pending_needs WHERE status != 'open' ORDER BY COALESCE(resolved_at, created_at) DESC LIMIT 150
      )
    `);

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
      alertWebhookConfigured: Boolean((map.get("alertWebhookUrl") ?? "").trim()),
    };
  }

  private getBotCheckinToken(botId: string): string | null {
    const row = this.sql
      .exec<{ checkin_token: string | null }>("SELECT checkin_token FROM bots WHERE id = ?", botId)
      .toArray()[0];
    const token = row?.checkin_token?.trim() ?? "";
    return token || null;
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
        checkin_token?: string;
        agent_kind?: string;
        dispatch_url?: string;
        reports_to?: string | null;
        org_title?: string;
        placeholder?: number;
        instructions?: string;
        instructions_updated_at?: string | null;
      }>("SELECT * FROM bots WHERE archived = 0 ORDER BY desk_index ASC, name ASC")
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
          checkinToken: b.checkin_token?.trim() || "",
          agentKind: normalizeAgentKind(b.agent_kind),
          dispatchConfigured: Boolean(b.dispatch_url),
          dispatchHost: maskDispatchUrl(b.dispatch_url ?? ""),
          reportsTo: b.reports_to ?? null,
          orgTitle: b.org_title ?? "",
          placeholder: b.placeholder === 1,
          instructions: b.instructions ?? "",
          instructionsUpdatedAt: b.instructions_updated_at ?? null,
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

    const gtCfg = this.getGoogleTasksConfig();
    let bridgeHost: string | null = null;
    if (gtCfg.bridgeUrl) {
      try {
        bridgeHost = new URL(gtCfg.bridgeUrl).hostname;
      } catch {
        bridgeHost = null;
      }
    }
    const googleTasksSync: GoogleTasksSyncState = {
      connected: Boolean(gtCfg.bridgeUrl),
      lastSyncAt: gtCfg.lastSyncAt,
      error: gtCfg.error,
      bridgeHost,
    };

    return {
      bots,
      pendingNeeds,
      activityLogs,
      recentRuns,
      objectives,
      taskLists: this.listGoogleTaskLists(),
      tasks: this.listGoogleTasks(bots),
      googleTasksSync,
      calendar: this.getCalendarSnapshot(),
      routines: this.listRoutines(),
      requests: this.listRequests(),
      ceoId: this.getCeoId(),
      asks: this.sql
        .exec<{ id: string; bot_id: string; question: string; status: string; answer: string | null; delivered_at: string | null; answered_at: string | null; acknowledged: number; created_at: string }>(
          "SELECT * FROM agent_asks ORDER BY created_at DESC LIMIT 40"
        )
        .toArray()
        .map((a) => ({
          id: a.id,
          botId: a.bot_id,
          question: a.question,
          status: a.status,
          answer: a.answer,
          deliveredAt: a.delivered_at,
          answeredAt: a.answered_at,
          acknowledged: a.acknowledged === 1,
          createdAt: a.created_at,
        })),
      notify: this.notifySnapshot(),
      handbook: this.getSettingValue("handbook"),
      timeZone: this.officeTimeZone(),
      usageTodayByBot: Object.fromEntries(
        this.sql
          .exec<{ bot_id: string; tokens: number; cost: number; reqs: number }>(
            `SELECT bot_id, COALESCE(SUM(tokens_in + tokens_out), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as reqs
             FROM usage_events WHERE created_at >= ? GROUP BY bot_id`,
            `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
          )
          .toArray()
          .map((r) => [r.bot_id, { tokens: r.tokens, costUsd: Number(r.cost.toFixed(4)), requests: r.reqs }])
      ),
      archivedBots: this.sql
        .exec<{ id: string; name: string; role: string; avatar_color: string; last_seen_at: string }>(
          "SELECT id, name, role, avatar_color, last_seen_at FROM bots WHERE archived = 1 ORDER BY name ASC"
        )
        .toArray()
        .map((b) => ({ id: b.id, name: b.name, role: b.role, avatarColor: b.avatar_color, lastSeenAt: b.last_seen_at })),
      dailyRollups: this.listDailyRollups(30),
      settings: redactAlertWebhook(settings),
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

  private saveSettingKey(key: string, value: string): void {
    this.sql.exec(
      `INSERT INTO office_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value
    );
  }

  private getGoogleTasksConfig(): {
    bridgeUrl: string;
    secret: string;
    lastSyncAt: string | null;
    error: string | null;
  } {
    const rows = this.sql
      .exec<{ key: string; value: string }>(
        "SELECT key, value FROM office_settings WHERE key IN ('google_tasks_url', 'google_tasks_secret', 'google_tasks_last_sync', 'google_tasks_error')"
      )
      .toArray();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const envUrl = clampText(this.env.GOOGLE_TASKS_BRIDGE_URL, 400);
    const dbUrl = clampText(map.get("google_tasks_url"), 400);
    const bridgeUrl = envUrl && isValidGoogleTasksBridgeUrl(envUrl) ? envUrl : dbUrl;
    const secret = clampText(this.env.GOOGLE_TASKS_BRIDGE_SECRET, 160) || clampText(map.get("google_tasks_secret"), 160);
    return {
      bridgeUrl,
      secret,
      lastSyncAt: map.get("google_tasks_last_sync") || null,
      error: map.get("google_tasks_error") || null,
    };
  }

  private enqueueTaskForBot(
    botId: string,
    taskText: string,
    opts: {
      source?: "owner" | "routine" | "delegation" | "task" | "request";
      fromBotId?: string | null;
      parentId?: string | null;
      maxLen?: number;
    } = {}
  ): string | null {
    const clean = clampText(taskText, opts.maxLen ?? 200);
    if (!clean) return null;
    const dup = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM task_queue WHERE bot_id = ? AND status = 'queued' AND lower(trim(task)) = lower(trim(?)) LIMIT 1",
        botId,
        clean
      )
      .toArray()[0];
    let qid: string | null = dup?.id ?? null;
    if (!dup) {
      qid = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      this.sql.exec(
        "INSERT INTO task_queue (id, bot_id, task, status, created_at, source, from_bot_id, parent_id, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)",
        qid,
        botId,
        clean,
        nowIso,
        opts.source ?? "owner",
        opts.fromBotId ?? null,
        opts.parentId ?? null,
        nowIso
      );
      this.wakeCeo(
        qid,
        botId,
        clean,
        opts.source === "routine"
          ? "routine"
          : opts.source === "delegation"
          ? "delegation"
          : opts.source === "request"
          ? "today-bar"
          : "task-assign",
        opts.source === "delegation" ? opts.fromBotId ?? "unknown-agent" : null
      );
    }
    this.pushPendingDispatch(botId);
    return qid;
  }

  /** The agent that receives Today-bar requests: "primary" if present, else the org chart's top manager. */
  private getCeoId(): string | null {
    const primary = this.sql.exec<{ id: string }>("SELECT id FROM bots WHERE id = ? AND archived = 0", CEO_BOT_ID).toArray()[0];
    if (primary) return primary.id;
    const titled = this.sql
      .exec<{ id: string }>("SELECT id FROM bots WHERE archived = 0 AND lower(org_title) = 'ceo' ORDER BY desk_index LIMIT 1")
      .toArray()[0];
    if (titled) return titled.id;
    const root = this.sql
      .exec<{ id: string }>(
        "SELECT b.id FROM bots b WHERE b.archived = 0 AND b.reports_to IS NULL AND EXISTS (SELECT 1 FROM bots c WHERE c.reports_to = b.id AND c.archived = 0) ORDER BY b.desk_index LIMIT 1"
      )
      .toArray()[0];
    return root?.id ?? null;
  }

  /** Recent Today-bar requests with what happened to them. */
  private listRequests(): Array<Record<string, unknown>> {
    const names = new Map(this.sql.exec<{ id: string; name: string }>("SELECT id, name FROM bots").toArray().map((b) => [b.id, b.name]));
    const rows = this.sql
      .exec<{ id: string; bot_id: string; task: string; status: string; created_at: string; updated_at: string | null; result: string | null; output_url: string | null }>(
        "SELECT id, bot_id, task, status, created_at, updated_at, result, output_url FROM task_queue WHERE source = 'request' ORDER BY created_at DESC LIMIT 12"
      )
      .toArray();
    return rows.map((r) => {
      const children = this.sql
        .exec<{ id: string; bot_id: string; task: string; status: string; result: string | null; output_url: string | null }>(
          "SELECT id, bot_id, task, status, result, output_url FROM task_queue WHERE parent_id = ? ORDER BY created_at ASC LIMIT 10",
          r.id
        )
        .toArray()
        .map((c) => ({
          id: c.id,
          botId: c.bot_id,
          botName: names.get(c.bot_id) ?? c.bot_id,
          task: c.task,
          status: c.status,
          result: c.result,
          outputUrl: c.output_url && /^https:\/\//.test(c.output_url) ? c.output_url : null,
        }));
      return {
        id: r.id,
        botId: r.bot_id,
        botName: names.get(r.bot_id) ?? r.bot_id,
        text: r.task,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        result: r.result,
        outputUrl: r.output_url && /^https:\/\//.test(r.output_url) ? r.output_url : null,
        handoffs: children,
      };
    });
  }

  /**
   * v19 CEO wake: POST the new request to Jared's routine webhook (HQ_WEBHOOK_URL), and nowhere else.
   * Capped at 20 wakes per rolling hour (RULE 0); over the cap the request just waits in the queue,
   * where Jared still pulls it from GET /api/bot/<id>/status. Never throws.
   */
  private wakeCeo(queueId: string, targetBotId: string, task: string, source: string, fromBotId: string | null = null): void {
    try {
      const target = (this.env.HQ_WEBHOOK_URL ?? "").trim();
      const rawKey = (this.env.HQ_WEBHOOK_KEY ?? "").trim();
      if (!target || !rawKey || !isSafeCallbackUrl(target)) return;
      const gate = allowWake(this.wakeHistory, Date.now());
      this.wakeHistory = gate.history;
      if (!gate.allowed) {
        console.log(JSON.stringify({ event: "ceo_wake_capped", queueId }));
        return;
      }
      const payload = buildCeoWakePayload(queueId, targetBotId, task, source, new Date().toISOString(), fromBotId);
      const [hName, hValue] = wakeAuthHeader(rawKey);
      this.ctx.waitUntil(
        (async () => {
          let last = "error";
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const res = await fetch(target, {
                method: "POST",
                headers: { "content-type": "application/json", "user-agent": "GrokBotHQ-CeoWake/1.0", [hName]: hValue },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10_000),
              });
              last = String(res.status);
              if (res.ok) break;
            } catch (err) {
              last = err instanceof Error ? err.name : "error";
            }
          }
          console.log(JSON.stringify({ event: "ceo_wake", ceo: CEO_BOT_ID, queueId, targetBotId, result: last }));
        })()
      );
    } catch {
      // A failed wake never blocks the request; it stays queued for Jared's pull.
    }
  }

  /**
   * Webhook-style agents (n8n, custom) get queued orders pushed immediately instead of
   * waiting for their next check-in. Grok bots keep the pull model.
   */
  private pushPendingDispatch(botId: string): void {
    const bot = this.sql
      .exec<{ name: string; avatar_color: string; status: BotStatus; agent_kind: string; dispatch_url: string; checkin_token: string }>(
        "SELECT name, avatar_color, status, agent_kind, dispatch_url, checkin_token FROM bots WHERE id = ?",
        botId
      )
      .toArray()[0];
    if (!bot) return;
    const kind: AgentKind = normalizeAgentKind(bot.agent_kind);
    const target = bot.dispatch_url?.trim() ?? "";
    if (!supportsPush(kind) || !target || !isSafeCallbackUrl(target)) return;
    const origin = this.publicOrigin;
    if (!origin) return;
    const queued = this.sql
      .exec<{ id: string; task: string }>(
        "SELECT id, task FROM task_queue WHERE bot_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 5",
        botId
      )
      .toArray();
    for (const q of queued) {
      this.sql.exec("UPDATE task_queue SET status = 'pushing' WHERE id = ?", q.id);
      const payload = buildDispatchPayload(origin, botId, bot.checkin_token, q.task, q.id, new Date().toISOString());
      this.ctx.waitUntil(
        (async () => {
          let ok = false;
          let detail = "";
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10_000);
            const res = await fetch(target, {
              method: "POST",
              headers: { "content-type": "application/json", "user-agent": "GrokBotHQ-Dispatch/1.0" },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            clearTimeout(timer);
            ok = res.ok;
            detail = ok ? "" : `HTTP ${res.status}`;
          } catch (err) {
            detail = err instanceof Error ? err.message : "network error";
          }
          if (ok) {
            this.sql.exec("UPDATE task_queue SET status = 'dispatched' WHERE id = ?", q.id);
            this.sql.exec("UPDATE bots SET task = ?, status = 'working' WHERE id = ?", q.task, botId);
            this.insertLog(botId, bot.name, bot.avatar_color, "working", "info", `Pushed order to ${kind}: "${clampText(q.task, 100)}"`);
          } else {
            this.sql.exec("UPDATE task_queue SET status = 'queued' WHERE id = ?", q.id);
            this.insertLog(
              botId,
              bot.name,
              bot.avatar_color,
              bot.status,
              "warn",
              `Push to ${kind} failed (${clampText(detail, 60)}). Order stays queued for next check-in.`
            );
          }
          this.broadcastSnapshot();
        })()
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Google Calendar bridge
  // ---------------------------------------------------------------------------
  private getCalendarConfig(): { bridgeUrl: string; secret: string; lastSyncAt: string | null; error: string | null } {
    const rows = this.sql
      .exec<{ key: string; value: string }>(
        "SELECT key, value FROM office_settings WHERE key IN ('calendar_url', 'calendar_secret', 'calendar_last_sync', 'calendar_error')"
      )
      .toArray();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const bridgeUrl = clampText(map.get("calendar_url"), 400);
    return {
      bridgeUrl: bridgeUrl && isValidAppsScriptUrl(bridgeUrl) ? bridgeUrl : "",
      secret: clampText(map.get("calendar_secret"), 160),
      lastSyncAt: map.get("calendar_last_sync") || null,
      error: map.get("calendar_error") || null,
    };
  }

  private async callCalendarBridge(
    action: "list" | "create" | "delete",
    payload: Record<string, unknown>,
    override?: { bridgeUrl: string; secret: string }
  ): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
    const cfg = override ?? this.getCalendarConfig();
    if (!cfg.bridgeUrl || !isValidAppsScriptUrl(cfg.bridgeUrl)) {
      return { ok: false, error: "Google Calendar bridge URL is not configured" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const resp = await fetch(cfg.bridgeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "follow",
        signal: controller.signal,
        body: JSON.stringify({ secret: cfg.secret, action, ...payload }),
      });
      const text = await resp.text();
      if (!resp.ok) return { ok: false, error: `Bridge returned HTTP ${resp.status}` };
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "Bridge returned HTML instead of JSON. Set the web app access to 'Anyone'." };
      }
      if (parsed.ok === false || parsed.error) {
        return { ok: false, error: clampText(parsed.error, 200) || "Bridge rejected request" };
      }
      return { ok: true, data: parsed };
    } catch (err) {
      return { ok: false, error: clampText(err instanceof Error ? err.message : "Network error", 180) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One-time org chart requested by the owner (Nov 2026):
   *   Jared (CEO)
   *   ├─ Bruce (Business Manager) → Randy, Sammy (placeholder)
   *   └─ Bernard (Executive Assistant, personal) → Wyatt, Andy, Chad, Cornelius
   * Every other bot is archived (hidden, restorable), never deleted.
   */
  /**
   * v19 one-time fix: org_chart_v1 archived "primary" (Jared's real check-in id) and kept the old paused
   * "jared" duplicate as CEO. Restore primary as CEO, re-point its reports, and archive (never delete) the duplicate.
   */
  /**
   * daily_checkin_v1 ran in production while the duplicate "jared" was still the active CEO, so its
   * routines question, queued tasks and any routines went to the duplicate. Move open items to "primary".
   */
  private repointDuplicateJaredV1(): void {
    if (this.getSettingValue("repoint_jared_v1")) return;
    const primary = this.sql.exec<{ id: string }>("SELECT id FROM bots WHERE id = ? AND archived = 0", CEO_BOT_ID).toArray()[0];
    const dup = this.sql.exec<{ id: string }>("SELECT id FROM bots WHERE id = 'jared' AND archived = 1").toArray()[0];
    if (primary && dup) {
      this.sql.exec("UPDATE agent_asks SET bot_id = ? WHERE bot_id = 'jared' AND status = 'open'", CEO_BOT_ID);
      this.sql.exec("UPDATE task_queue SET bot_id = ? WHERE bot_id = 'jared' AND status = 'queued'", CEO_BOT_ID);
      this.sql.exec("UPDATE routines SET bot_id = ? WHERE bot_id = 'jared'", CEO_BOT_ID);
      this.sql.exec("UPDATE routines SET proposed_by = ? WHERE proposed_by = 'jared'", CEO_BOT_ID);
    }
    const anyBot = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM bots").one()?.c ?? 0;
    if (anyBot > 0) this.saveSettingKey("repoint_jared_v1", primary && dup ? "applied" : "skipped");
  }

  private applyCeoPrimaryV1(): void {
    const done = this.sql
      .exec<{ value: string }>("SELECT value FROM office_settings WHERE key = 'ceo_primary_v1'")
      .toArray()[0];
    if (done) return;
    const primary = this.sql.exec<{ id: string }>("SELECT id FROM bots WHERE id = ?", CEO_BOT_ID).toArray()[0];
    if (!primary) {
      // Empty office (first boot): try again next start instead of giving up for good.
      const anyBot = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM bots").one()?.c ?? 0;
      if (anyBot > 0) this.saveSettingKey("ceo_primary_v1", "skipped");
      return;
    }
    this.sql.exec(
      "UPDATE bots SET archived = 0, reports_to = NULL, org_title = 'CEO', name = 'Jared' WHERE id = ?",
      CEO_BOT_ID
    );
    const dup = this.sql
      .exec<{ id: string; task: string }>("SELECT id, task FROM bots WHERE id = 'jared'")
      .toArray()[0];
    if (dup) {
      this.sql.exec("UPDATE bots SET reports_to = ? WHERE reports_to = 'jared'", CEO_BOT_ID);
      this.sql.exec("UPDATE bots SET archived = 1 WHERE id = 'jared'");
    }
    this.saveSettingKey("ceo_primary_v1", "applied");
  }

  private applyOrgChartV1(): void {
    const done = this.sql
      .exec<{ value: string }>("SELECT value FROM office_settings WHERE key = 'org_chart_v1'")
      .toArray()[0];
    if (done) return;
    const bots = this.sql.exec<{ id: string; name: string }>("SELECT id, name FROM bots").toArray();
    const firstWord = (n: string) => n.trim().toLowerCase().split(/[\s_-]+/)[0] ?? "";
    const plan: Record<string, { title: string; boss: string | null }> = {
      jared: { title: "CEO", boss: null },
      bruce: { title: "Business Manager", boss: "jared" },
      randy: { title: "", boss: "bruce" },
      sammy: { title: "", boss: "bruce" },
      bernard: { title: "Executive Assistant", boss: "jared" },
      wyatt: { title: "", boss: "bernard" },
      andy: { title: "", boss: "bernard" },
      chad: { title: "", boss: "bernard" },
      cornelius: { title: "", boss: "bernard" },
    };
    const idByKey = new Map<string, string>();
    for (const b of bots) {
      const k = firstWord(b.name) in plan ? firstWord(b.name) : firstWord(b.id) in plan ? firstWord(b.id) : "";
      if (k && !idByKey.has(k)) idByKey.set(k, b.id);
    }
    // Only reshape the office when it actually contains this team.
    if (idByKey.size >= 3) {
      const now = new Date().toISOString();
      if (!idByKey.has("sammy")) {
        const deskRow = this.sql.exec<{ mx: number | null }>("SELECT MAX(desk_index) as mx FROM bots").one();
        let sammyId = "sammy";
        if (this.sql.exec<{ id: string }>("SELECT id FROM bots WHERE id = ?", sammyId).toArray()[0]) sammyId = `sammy-${crypto.randomUUID().slice(0, 4)}`;
        this.sql.exec(
          `INSERT INTO bots (id, name, role, department, avatar_color, avatar_shape, desk_index, status, task, model, last_seen_at, checkin_token, placeholder)
           VALUES (?, 'Sammy', 'Business Ops (placeholder)', 'Business', '#f0b429', 'squircle', ?, 'no_report', 'Not connected yet', 'grok-4', ?, ?, 1)`,
          sammyId,
          (deskRow?.mx ?? 0) + 1,
          now,
          crypto.randomUUID()
        );
        idByKey.set("sammy", sammyId);
      }
      const keep = new Set(idByKey.values());
      for (const [k, id] of idByKey) {
        const p = plan[k];
        const bossId = p.boss ? idByKey.get(p.boss) ?? null : null;
        this.sql.exec(
          "UPDATE bots SET reports_to = ?, org_title = CASE WHEN ? != '' THEN ? ELSE org_title END, archived = 0 WHERE id = ?",
          bossId,
          p.title,
          p.title,
          id
        );
      }
      for (const b of bots) {
        if (!keep.has(b.id)) this.sql.exec("UPDATE bots SET archived = 1 WHERE id = ?", b.id);
      }
      this.sql.exec("DELETE FROM task_queue WHERE status = 'queued' AND bot_id IN (SELECT id FROM bots WHERE archived = 1)");
      this.sql.exec(
        `UPDATE pending_needs SET status = 'resolved', resolution_note = 'Agent archived', resolved_at = ?
         WHERE status = 'open' AND bot_id IN (SELECT id FROM bots WHERE archived = 1)`,
        now
      );
      this.saveSettingKey("org_chart_v1", "applied");
    } else if (bots.length > 0) {
      // A different team: nothing to do, and do not try again.
      this.saveSettingKey("org_chart_v1", "skipped");
    }
  }

  private async pushPendingTask(taskId: string): Promise<boolean> {
    const t = this.sql
      .exec<{ id: string; list_id: string; title: string; notes: string; due: string | null; status: string }>(
        "SELECT id, list_id, title, notes, due, status FROM google_tasks WHERE id = ? AND sync_pending = 1",
        taskId
      )
      .toArray()[0];
    if (!t) return true;
    const res = await this.callGoogleTasksBridge("update", {
      listId: t.list_id,
      taskId: t.id,
      title: t.title,
      notes: t.notes,
      due: t.due,
      status: t.status,
    });
    if (res.ok) {
      // Only clear if nothing changed again while we were pushing.
      this.sql.exec(
        "UPDATE google_tasks SET sync_pending = 0 WHERE id = ? AND status = ? AND title = ?",
        t.id,
        t.status,
        t.title
      );
      this.saveSettingKey("google_tasks_error", "");
    } else {
      this.saveSettingKey("google_tasks_error", `Saved here, not yet in Google: ${res.error || "push failed"}. Retrying.`);
      await this.ensureAlarmScheduled();
    }
    this.broadcastSnapshot();
    return res.ok;
  }

  private async retryPendingTaskPushes(): Promise<void> {
    const pending = this.sql
      .exec<{ id: string }>("SELECT id FROM google_tasks WHERE sync_pending = 1 ORDER BY updated_at ASC LIMIT 10")
      .toArray();
    for (const p of pending) {
      if (!(await this.pushPendingTask(p.id))) break;
    }
  }

  // ===========================================================================
  // Daily check-in protocol: playbooks, batched orders, team status, delegation,
  // HQ questions ("asks"), routine proposals.
  // ===========================================================================
  private getSettingValue(key: string): string {
    return (
      this.sql.exec<{ value: string }>("SELECT value FROM office_settings WHERE key = ?", key).toArray()[0]?.value ?? ""
    );
  }

  private officeTimeZone(): string {
    const tz = this.getSettingValue("office_timezone");
    return tz && isValidTimeZone(tz) ? tz : "America/New_York";
  }

  private knownOrigin(): string {
    return this.publicOrigin || this.getSettingValue("public_origin");
  }

  /**
   * One-time switch to daily check-ins: daily SLA for connected Grok agents, and a
   * question to Jared asking for the team's recurring routines.
   */
  private applyDailyCheckinV1(): void {
    if (this.getSettingValue("daily_checkin_v1")) return;
    const bots = this.sql
      .exec<{ id: string; name: string }>("SELECT id, name FROM bots WHERE archived = 0")
      .toArray();
    if (bots.length === 0) return;
    const now = new Date().toISOString();
    this.sql.exec(
      "UPDATE bots SET expected_interval_min = 1440, sla_alerted = 0 WHERE archived = 0 AND placeholder = 0 AND agent_kind = 'grok' AND expected_interval_min = 0"
    );
    const jared = bots.find((b) => b.name.trim().toLowerCase().startsWith("jared") || b.id.toLowerCase().startsWith("jared"));
    if (jared) {
      this.sql.exec(
        "INSERT INTO agent_asks (id, bot_id, question, status, created_at) VALUES (?, ?, ?, 'open', ?)",
        `ask-${crypto.randomUUID().slice(0, 8)}`,
        jared.id,
        "List the team's recurring routines so HQ can schedule them. For EACH routine, call orders.howTo.proposeRoutine once (agent id, schedule like \"weekdays 07:00\", short task). Then answer this ask with a one-line summary.",
        now
      );
      this.sql.exec(
        "INSERT INTO task_queue (id, bot_id, task, status, created_at, source) VALUES (?, ?, ?, 'queued', ?, 'owner')",
        crypto.randomUUID(),
        jared.id,
        "HQ request: send the team's recurring routines. Follow orders.asks and orders.howTo in this response.",
        now
      );
    }
    // Give everyone a full day to do their first daily check-in before missed-check-in alerts start.
    this.saveSettingKey("sla_grace_until", new Date(Date.now() + 26 * 3_600_000).toISOString());
    this.saveSettingKey("daily_checkin_v1", now);
  }

  private findBotRef(ref: string): { id: string; name: string } | null {
    const r = clampText(ref, 64).toLowerCase();
    if (!r) return null;
    const bots = this.sql
      .exec<{ id: string; name: string }>("SELECT id, name FROM bots WHERE archived = 0")
      .toArray();
    return (
      bots.find((b) => b.id.toLowerCase() === r) ||
      bots.find((b) => b.name.toLowerCase() === r) ||
      bots.find((b) => b.name.toLowerCase().split(/\s+/)[0] === r) ||
      null
    );
  }

  private descendantIds(botId: string): string[] {
    const rows = this.sql
      .exec<{ id: string; reports_to: string | null }>("SELECT id, reports_to FROM bots WHERE archived = 0")
      .toArray();
    const out: string[] = [];
    const walk = (id: string, depth: number) => {
      if (depth > 10) return;
      for (const r of rows) {
        if (r.reports_to === id && !out.includes(r.id) && r.id !== botId) {
          out.push(r.id);
          walk(r.id, depth + 1);
        }
      }
    };
    walk(botId, 0);
    return out;
  }

  private teamStatus(botId: string): Array<Record<string, unknown>> {
    const ids = this.descendantIds(botId);
    if (!ids.length) return [];
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    return ids
      .map((id) => {
        const b = this.sql
          .exec<{ id: string; name: string; org_title: string; role: string; status: string; task: string; last_seen_at: string; reports_to: string | null; placeholder: number }>(
            "SELECT id, name, org_title, role, status, task, last_seen_at, reports_to, placeholder FROM bots WHERE id = ?",
            id
          )
          .toArray()[0];
        if (!b) return null;
        const queued = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM task_queue WHERE bot_id = ? AND status = 'queued'", id).one()?.c ?? 0;
        const doneToday =
          this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM task_runs WHERE bot_id = ? AND status = 'completed' AND finished_at >= ?", id, dayStart).one()?.c ?? 0;
        const needs = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM pending_needs WHERE bot_id = ? AND status = 'open'", id).one()?.c ?? 0;
        return {
          id: b.id,
          name: b.name,
          title: b.org_title || b.role,
          reportsTo: b.reports_to,
          status: b.placeholder ? "not_connected" : b.status,
          currentTask: b.task,
          lastCheckIn: b.last_seen_at,
          queuedTasks: queued,
          finishedToday: doneToday,
          waitingOnOwner: needs,
        };
      })
      .filter((x) => x !== null) as Array<Record<string, unknown>>;
  }

  private howToFor(botId: string, token: string, hasTeam: boolean): Record<string, string> {
    const base = this.knownOrigin() || "https://YOUR-HQ";
    const b = encodeURIComponent(botId);
    const t = encodeURIComponent(token);
    const how: Record<string, string> = {
      dailyCheckIn: `${base}/api/ping?b=${b}&daily=1&token=${t}`,
      reportDone: `${base}/api/ping?b=${b}&done=1&req=TASK_ID&t=TASK&out=HTTPS_LINK&result=ONE_LINE&tok=TOKENS_USED&token=${t}`,
      needOwner: `${base}/api/ping?b=${b}&s=wait&need=ONE_LINE_QUESTION&token=${t}`,
      answerAsk: `${base}/api/ping?b=${b}&ask=ASK_ID&answer=YOUR_ANSWER&token=${t}`,
      proposeRoutine: `${base}/api/ping?b=${b}&routine=AGENT_ID|SCHEDULE|TASK&token=${t}`,
      scheduleFormat: "daily 07:00 · weekdays 07:00 · mon,thu 09:30 · weekly fri 16:00 · monthly 1 08:00 · monthly last 17:00",
    };
    if (hasTeam) how.delegate = `${base}/api/ping?b=${b}&delegate=AGENT_ID&dt=TASK&parent=TASK_ID&token=${t}`;
    return how;
  }

  /** Extra fields for agents on every check-in. Full playbook/team/asks on daily check-ins. */
  private extendedOrders(botId: string): Record<string, unknown> {
    const bot = this.sql
      .exec<{ instructions: string; instructions_updated_at: string | null; checkin_token: string; name: string }>(
        "SELECT instructions, instructions_updated_at, checkin_token, name FROM bots WHERE id = ?",
        botId
      )
      .toArray()[0];
    if (!bot) return {};
    const tasks = this.sql
      .exec<{ id: string; task: string; source: string; from_bot_id: string | null }>(
        "SELECT id, task, source, from_bot_id FROM task_queue WHERE bot_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 10",
        botId
      )
      .toArray()
      .map((q) => ({ id: q.id, task: q.task, from: q.from_bot_id ? `delegated by ${q.from_bot_id}` : q.source }));
    const asks = this.sql
      .exec<{ id: string; question: string }>(
        "SELECT id, question FROM agent_asks WHERE bot_id = ? AND status = 'open' ORDER BY created_at ASC LIMIT 5",
        botId
      )
      .toArray();
    const team = this.teamStatus(botId);
    const routines = this.sql
      .exec<{ title: string; schedule: string }>(
        "SELECT title, schedule FROM routines WHERE bot_id = ? AND status = 'active' ORDER BY created_at ASC",
        botId
      )
      .toArray()
      .map((r) => {
        const s = parseSchedule(r.schedule);
        return { task: r.title, when: s ? describeSchedule(s) : r.schedule };
      });
    return {
      instructions: bot.instructions || "",
      instructionsUpdatedAt: bot.instructions_updated_at,
      handbook: this.getSettingValue("handbook"),
      tasks,
      asks,
      team,
      canDelegateTo: team.map((m) => m.id),
      routines,
      howTo: this.howToFor(botId, bot.checkin_token, team.length > 0),
      checkInSchedule: "Once a day, plus whenever the owner says check in.",
    };
  }

  /** Daily check-in: everything listed in orders.tasks counts as delivered. */
  private markDailyDelivered(botId: string, orders: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const tasks = Array.isArray(orders.tasks) ? (orders.tasks as Array<{ id: string }>) : [];
    for (const t of tasks) this.sql.exec("UPDATE task_queue SET status = 'dispatched' WHERE id = ? AND status = 'queued'", t.id);
    const asks = Array.isArray(orders.asks) ? (orders.asks as Array<{ id: string }>) : [];
    for (const a of asks) this.sql.exec("UPDATE agent_asks SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ?", now, a.id);
    this.sql.exec("UPDATE bots SET sla_alerted = 0 WHERE id = ?", botId);
  }

  /** delegate=, ask=/answer=, routine= parameters sent by agents. */
  private handleAgentExtras(botId: string, params: URLSearchParams): Record<string, unknown> {
    const results: Record<string, unknown> = {};
    const now = new Date().toISOString();
    const me = this.sql
      .exec<{ name: string; avatar_color: string; status: BotStatus }>("SELECT name, avatar_color, status FROM bots WHERE id = ?", botId)
      .toArray()[0];
    if (!me) return results;

    const delegateTo = params.get("delegate");
    const delegateTask = clampText(params.get("dt") ?? params.get("delegate_task"), 200);
    if (delegateTo) {
      const target = this.findBotRef(delegateTo);
      if (!target) results.delegate = { ok: false, error: `No agent called ${delegateTo}` };
      else if (!this.descendantIds(botId).includes(target.id))
        results.delegate = { ok: false, error: `${target.name} is not on your team. Delegate only to orders.canDelegateTo.` };
      else if (!delegateTask) results.delegate = { ok: false, error: "Add &dt=TASK" };
      else {
        const parentId = clampText(params.get("parent") ?? params.get("req"), 64) || null;
        const parentOk =
          parentId &&
          this.sql.exec<{ id: string }>("SELECT id FROM task_queue WHERE id = ? AND bot_id = ?", parentId, botId).toArray()[0];
        this.enqueueTaskForBot(target.id, delegateTask, {
          source: "delegation",
          fromBotId: botId,
          parentId: parentOk ? parentId : null,
        });
        if (parentOk) {
          this.sql.exec(
            "UPDATE task_queue SET status = CASE WHEN status = 'queued' THEN 'dispatched' ELSE status END, updated_at = ? WHERE id = ?",
            now,
            parentId
          );
        }
        this.insertLog(botId, me.name, me.avatar_color, me.status, "info", `Delegated to ${target.name}: "${clampText(delegateTask, 100)}"`);
        results.delegate = { ok: true, to: target.id, task: delegateTask };
      }
    }

    const reqId = clampText(params.get("req"), 64);
    if (reqId && (params.get("done") === "1" || params.get("done") === "true") && !delegateTo) {
      const row = this.sql
        .exec<{ id: string; bot_id: string }>("SELECT id, bot_id FROM task_queue WHERE id = ?", reqId)
        .toArray()[0];
      if (!row || row.bot_id !== botId) {
        results.request = { ok: false, error: "Unknown request id (req=)" };
      } else {
        const out = clampText(params.get("out") ?? params.get("outputUrl"), 400);
        this.sql.exec(
          "UPDATE task_queue SET status = 'done', result = ?, output_url = ?, updated_at = ? WHERE id = ?",
          clampText(params.get("result") ?? params.get("summary"), 600) || null,
          out && isSafeCallbackUrl(out) ? out : null,
          now,
          reqId
        );
        results.request = { ok: true, id: reqId, status: "done" };
      }
    }

    const askId = clampText(params.get("ask"), 40);
    const answer = clampText(params.get("answer"), 1500);
    if (askId) {
      const ask = this.sql
        .exec<{ id: string; bot_id: string; status: string }>("SELECT id, bot_id, status FROM agent_asks WHERE id = ?", askId)
        .toArray()[0];
      if (!ask || ask.bot_id !== botId) results.answer = { ok: false, error: "Unknown ask id" };
      else if (!answer) results.answer = { ok: false, error: "Add &answer=TEXT" };
      else {
        this.sql.exec(
          "UPDATE agent_asks SET status = 'answered', answer = ?, answered_at = ?, acknowledged = 0 WHERE id = ?",
          answer,
          now,
          askId
        );
        this.insertLog(botId, me.name, me.avatar_color, me.status, "success", `Answered HQ: "${clampText(answer, 100)}"`);
        results.answer = { ok: true, ask: askId };
      }
    }

    for (const raw of params.getAll("routine").slice(0, 10)) {
      const parts = raw.split("|").map((x) => x.trim());
      const list = (results.routines as unknown[]) || [];
      results.routines = list;
      if (parts.length < 3) {
        list.push({ ok: false, error: "Use routine=AGENT_ID|SCHEDULE|TASK" });
        continue;
      }
      const target = this.findBotRef(parts[0]);
      const sched = parseSchedule(parts[1]);
      const title = clampText(parts.slice(2).join(" | "), 200);
      if (!target) list.push({ ok: false, error: `No agent called ${parts[0]}` });
      else if (!sched) list.push({ ok: false, error: `Could not read schedule "${parts[1]}". Examples: weekdays 07:00, mon,thu 09:30, monthly 1 08:00` });
      else if (!title) list.push({ ok: false, error: "Missing task" });
      else {
        const dup = this.sql
          .exec<{ id: string }>(
            "SELECT id FROM routines WHERE bot_id = ? AND lower(title) = lower(?) AND status IN ('active','proposed')",
            target.id,
            title
          )
          .toArray()[0];
        if (dup) {
          list.push({ ok: true, id: dup.id, note: "Already exists" });
          continue;
        }
        const id = `rt-${crypto.randomUUID().slice(0, 8)}`;
        this.sql.exec(
          "INSERT INTO routines (id, bot_id, title, schedule, status, source, proposed_by, created_at) VALUES (?, ?, ?, ?, 'proposed', 'agent', ?, ?)",
          id,
          target.id,
          title,
          scheduleToText(sched),
          botId,
          now
        );
        list.push({ ok: true, id, status: "proposed", note: "Waiting for the owner to approve in HQ" });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Routines
  // ---------------------------------------------------------------------------
  private computeNextRun(scheduleText: string, afterMs: number): string | null {
    const s = parseSchedule(scheduleText);
    return s ? new Date(nextRunAfter(s, afterMs, this.officeTimeZone())).toISOString() : null;
  }

  private runDueRoutines(nowMs: number): boolean {
    const due = this.sql
      .exec<{ id: string; bot_id: string; title: string; schedule: string }>(
        "SELECT id, bot_id, title, schedule FROM routines WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? LIMIT 50",
        new Date(nowMs).toISOString()
      )
      .toArray();
    for (const r of due) {
      const archived = this.sql.exec<{ archived: number }>("SELECT archived FROM bots WHERE id = ?", r.bot_id).toArray()[0];
      if (archived && archived.archived === 0) this.enqueueTaskForBot(r.bot_id, r.title, { source: "routine" });
      this.sql.exec(
        "UPDATE routines SET last_run_at = ?, next_run_at = ? WHERE id = ?",
        new Date(nowMs).toISOString(),
        this.computeNextRun(r.schedule, nowMs),
        r.id
      );
    }
    return due.length > 0;
  }

  private listRoutines(): Array<Record<string, unknown>> {
    const names = new Map(
      this.sql.exec<{ id: string; name: string }>("SELECT id, name FROM bots").toArray().map((b) => [b.id, b.name])
    );
    return this.sql
      .exec<{ id: string; bot_id: string; title: string; schedule: string; status: string; source: string; proposed_by: string | null; last_run_at: string | null; next_run_at: string | null; created_at: string }>(
        "SELECT * FROM routines WHERE status IN ('active','paused','proposed') ORDER BY CASE status WHEN 'proposed' THEN 0 ELSE 1 END, created_at ASC LIMIT 200"
      )
      .toArray()
      .map((r) => {
        const s = parseSchedule(r.schedule);
        return {
          id: r.id,
          botId: r.bot_id,
          botName: names.get(r.bot_id) ?? r.bot_id,
          title: r.title,
          schedule: r.schedule,
          scheduleLabel: s ? describeSchedule(s) : r.schedule,
          status: r.status,
          source: r.source,
          proposedBy: r.proposed_by ? names.get(r.proposed_by) ?? r.proposed_by : null,
          lastRunAt: r.last_run_at,
          nextRunAt: r.next_run_at,
          createdAt: r.created_at,
        };
      });
  }

  // ---------------------------------------------------------------------------
  // Phone notifications (ntfy)
  // ---------------------------------------------------------------------------
  private getNotifyConfig(): { enabled: boolean; server: string; topic: string; finished: boolean; briefTime: string; secret: string } {
    let secret = this.getSettingValue("notify_secret");
    if (!secret) {
      secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
      this.saveSettingKey("notify_secret", secret);
    }
    return {
      enabled: this.getSettingValue("notify_enabled") === "1",
      server: this.getSettingValue("notify_server") || "https://ntfy.sh",
      topic: this.getSettingValue("notify_topic"),
      finished: this.getSettingValue("notify_finished") !== "0",
      briefTime: this.getSettingValue("notify_brief_time") || "07:30",
      secret,
    };
  }

  private async sendNtfy(msg: Omit<NtfyMessage, "topic">, override?: { server: string; topic: string }): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getNotifyConfig();
    const server = override?.server ?? cfg.server;
    const topic = override?.topic ?? cfg.topic;
    if (!topic || !isValidTopic(topic)) return { ok: false, error: "No notification topic set" };
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...msg, topic, title: clip(msg.title, 120), message: clip(msg.message) }),
      });
      return res.ok ? { ok: true } : { ok: false, error: `ntfy returned HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  private notifyChain: Promise<void> = Promise.resolve();

  /** Sends anything new since the last watermark. Calls are serialized so nothing is sent twice. */
  private flushNotifications(): Promise<void> {
    this.notifyChain = this.notifyChain.then(() => this.flushNotificationsNow()).catch(() => {});
    return this.notifyChain;
  }

  private async flushNotificationsNow(): Promise<void> {
    const cfg = this.getNotifyConfig();
    if (!cfg.enabled || !cfg.topic) return;
    const origin = this.knownOrigin();
    const hq = origin || undefined;
    const wm = (k: string) => this.getSettingValue(k) || new Date().toISOString();

    const needWm = wm("notify_wm_need");
    const needs = this.sql
      .exec<{ id: string; bot_name: string; title: string; description: string; severity: string; created_at: string }>(
        "SELECT id, bot_name, title, description, severity, created_at FROM pending_needs WHERE status = 'open' AND created_at > ? ORDER BY created_at ASC LIMIT 10",
        needWm
      )
      .toArray();
    for (const n of needs) {
      const canDecide = n.severity === "approval" || n.severity === "input";
      const actions: NtfyMessage["actions"] = [];
      if (canDecide && origin) {
        actions.push({ action: "http", label: "Approve", url: await actionUrl(origin, cfg.secret, n.id, "approve"), method: "POST", clear: true });
        actions.push({ action: "http", label: "Reject", url: await actionUrl(origin, cfg.secret, n.id, "reject"), method: "POST", clear: true });
      }
      if (hq) actions.push({ action: "view", label: "Open", url: `${hq}/#needs` });
      await this.sendNtfy({
        title: `${n.bot_name} needs you`,
        message: n.description ? `${n.title}\n${n.description}` : n.title,
        priority: n.severity === "error" || n.severity === "budget" ? 5 : 4,
        tags: [n.severity === "error" ? "rotating_light" : n.severity === "budget" ? "moneybag" : "raised_hand"],
        click: hq ? `${hq}/#needs` : undefined,
        actions: actions.slice(0, 3),
      });
      this.saveSettingKey("notify_wm_need", n.created_at);
    }

    if (cfg.finished) {
      const runWm = wm("notify_wm_run");
      const runs = this.sql
        .exec<{ bot_name: string; task: string; result_summary: string | null; output_url: string | null; finished_at: string }>(
          "SELECT bot_name, task, result_summary, output_url, finished_at FROM task_runs WHERE status = 'completed' AND finished_at > ? ORDER BY finished_at ASC LIMIT 10",
          runWm
        )
        .toArray();
      for (const r of runs) {
        const link = r.output_url && /^https:\/\//.test(r.output_url) ? r.output_url : null;
        await this.sendNtfy({
          title: `${r.bot_name} finished`,
          message: r.result_summary ? `${r.task}\n${r.result_summary}` : r.task,
          priority: 3,
          tags: ["white_check_mark"],
          click: link ?? (hq ? `${hq}/#needs` : undefined),
          actions: link ? [{ action: "view", label: "Open result", url: link }] : undefined,
        });
        this.saveSettingKey("notify_wm_run", r.finished_at);
      }
    }

    const askWm = wm("notify_wm_ask");
    const asks = this.sql
      .exec<{ bot_id: string; question: string; answer: string; answered_at: string }>(
        "SELECT bot_id, question, answer, answered_at FROM agent_asks WHERE status = 'answered' AND answered_at > ? ORDER BY answered_at ASC LIMIT 10",
        askWm
      )
      .toArray();
    for (const a of asks) {
      const name = this.sql.exec<{ name: string }>("SELECT name FROM bots WHERE id = ?", a.bot_id).toArray()[0]?.name ?? a.bot_id;
      await this.sendNtfy({ title: `${name} answered`, message: a.answer, priority: 3, tags: ["speech_balloon"], click: hq ? `${hq}/#needs` : undefined });
      this.saveSettingKey("notify_wm_ask", a.answered_at);
    }

    const rtWm = wm("notify_wm_routine");
    const proposed = this.sql
      .exec<{ title: string; schedule: string; created_at: string }>(
        "SELECT title, schedule, created_at FROM routines WHERE status = 'proposed' AND created_at > ? ORDER BY created_at ASC LIMIT 20",
        rtWm
      )
      .toArray();
    if (proposed.length) {
      await this.sendNtfy({
        title: `${proposed.length} routine${proposed.length === 1 ? "" : "s"} to approve`,
        message: proposed.map((p) => `• ${p.title} (${p.schedule})`).join("\n"),
        priority: 3,
        tags: ["repeat"],
        click: hq ? `${hq}/#needs` : undefined,
      });
      this.saveSettingKey("notify_wm_routine", proposed[proposed.length - 1].created_at);
    }
  }

  private async maybeSendMorningBrief(nowMs: number, force = false): Promise<boolean> {
    const cfg = this.getNotifyConfig();
    if (!cfg.enabled || !cfg.topic || !cfg.briefTime) return false;
    const tz = this.officeTimeZone();
    const local = localParts(nowMs, tz);
    const dateKey = `${local.y}-${String(local.mo).padStart(2, "0")}-${String(local.d).padStart(2, "0")}`;
    const [bh, bm] = cfg.briefTime.split(":").map(Number);
    if (!force && local.h * 60 + local.mi < bh * 60 + bm) return false;
    if (!force && this.getSettingValue("notify_last_brief") === dateKey) return false;
    this.saveSettingKey("notify_last_brief", dateKey);

    const dayAgo = new Date(nowMs - 24 * 3_600_000).toISOString();
    const needs = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM pending_needs WHERE status = 'open'").one()?.c ?? 0;
    const done = this.sql
      .exec<{ bot_name: string; task: string }>(
        "SELECT bot_name, task FROM task_runs WHERE status = 'completed' AND finished_at >= ? ORDER BY finished_at DESC LIMIT 5",
        dayAgo
      )
      .toArray();
    const failed = this.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM task_runs WHERE status = 'failed' AND started_at >= ?", dayAgo).one()?.c ?? 0;
    const due = this.sql
      .exec<{ title: string }>("SELECT title FROM google_tasks WHERE status = 'needsAction' AND due IS NOT NULL AND substr(due, 1, 10) <= ? ORDER BY due ASC LIMIT 5", dateKey)
      .toArray();
    const dayStartUtc = new Date(nowMs).toISOString();
    const dayEndUtc = new Date(nowMs + 18 * 3_600_000).toISOString();
    const events = this.sql
      .exec<{ title: string; start_at: string; all_day: number }>(
        "SELECT title, start_at, all_day FROM calendar_events WHERE start_at >= ? AND start_at < ? ORDER BY start_at ASC LIMIT 5",
        dayStartUtc,
        dayEndUtc
      )
      .toArray();
    const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const lines: string[] = [];
    lines.push(needs ? `${needs} item${needs === 1 ? "" : "s"} waiting on you` : "Nothing waiting on you");
    if (events.length) lines.push(`Calendar: ${events.map((e) => (e.all_day ? e.title : `${fmt(e.start_at)} ${e.title}`)).join(" · ")}`);
    if (due.length) lines.push(`Due: ${due.map((t) => t.title).join(" · ")}`);
    lines.push(
      done.length
        ? `Overnight: ${done.map((r) => `${r.bot_name}: ${r.task}`).join(" · ")}${failed ? ` (${failed} failed)` : ""}`
        : `No finished agent work in the last 24h${failed ? `, ${failed} failed` : ""}`
    );
    const origin = this.knownOrigin();
    await this.sendNtfy({
      title: "Good morning. Your HQ brief",
      message: lines.join("\n"),
      priority: 3,
      tags: ["sunrise"],
      click: origin ? `${origin}/#today` : undefined,
    });
    return true;
  }

  private notifySnapshot(): Record<string, unknown> {
    const cfg = this.getNotifyConfig();
    return { enabled: cfg.enabled, server: cfg.server, topic: cfg.topic, finished: cfg.finished, briefTime: cfg.briefTime };
  }

  private getCalendarFeeds(): Array<{ id: string; url: string; name: string; color: string }> {
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM office_settings WHERE key = 'calendar_feeds'")
      .toArray()[0];
    if (!row?.value) return [];
    try {
      const parsed = JSON.parse(row.value) as Array<{ id: string; url: string; name: string; color: string }>;
      return Array.isArray(parsed) ? parsed.filter((f) => f && f.id && f.url) : [];
    } catch {
      return [];
    }
  }

  private saveCalendarFeeds(feeds: Array<{ id: string; url: string; name: string; color: string }>): void {
    this.saveSettingKey("calendar_feeds", JSON.stringify(feeds.slice(0, 12)));
  }

  private async fetchFeed(url: string): Promise<{ ok: boolean; text?: string; error?: string }> {
    if (!isSafeCallbackUrl(url)) return { ok: false, error: "Calendar link must be a public https:// address" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.5", "user-agent": "GrokBotHQ-Calendar/1.0" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: res.status === 404 ? "Calendar link not found (was the secret address reset?)" : `Calendar returned HTTP ${res.status}`,
        };
      }
      const text = await res.text();
      if (text.length > 6_000_000) return { ok: false, error: "Calendar feed is too large" };
      if (!text.includes("BEGIN:VCALENDAR")) return { ok: false, error: "That link is not an iCal (.ics) calendar feed" };
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: clampText(err instanceof Error ? err.message : "Network error", 160) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async syncCalendar(): Promise<{ ok: boolean; count: number; error?: string }> {
    const now = new Date();
    const fromMs = now.getTime() - 3 * 24 * 60 * 60_000;
    const toMs = now.getTime() + 45 * 24 * 60 * 60_000;
    const cfg = this.getCalendarConfig();
    const feeds = this.getCalendarFeeds();
    const events: CalendarEvent[] = [];
    const errors: string[] = [];
    let anyOk = false;

    if (cfg.bridgeUrl) {
      const res = await this.callCalendarBridge("list", {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      });
      if (res.ok) {
        anyOk = true;
        const rawEvents = Array.isArray(res.data?.events) ? (res.data?.events as unknown[]) : [];
        for (const e of rawEvents.slice(0, 1000).map(normalizeBridgeEvent)) if (e) events.push(e);
      } else {
        errors.push(`Bridge: ${res.error || "sync failed"}`);
      }
    }

    for (const feed of feeds) {
      const res = await this.fetchFeed(feed.url);
      if (!res.ok || !res.text) {
        errors.push(`${feed.name}: ${res.error || "sync failed"}`);
        continue;
      }
      anyOk = true;
      try {
        events.push(...parseIcs(res.text, fromMs, toMs, { calendarName: feed.name, color: feed.color, feedId: feed.id, maxEvents: 800 }));
      } catch (err) {
        errors.push(`${feed.name}: could not read feed`);
      }
    }

    if (!anyOk) {
      this.saveSettingKey("calendar_error", clampText(errors.join(" · ") || "Sync failed", 300));
      return { ok: false, count: 0, error: errors[0] };
    }

    // When the bridge and a feed cover the same calendar, keep one copy.
    const seen = new Set<string>();
    const deduped = events.filter((e) => {
      const key = `${e.title}|${e.start}|${e.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.sql.exec("DELETE FROM calendar_events");
    for (const e of deduped.slice(0, 2000)) {
      this.sql.exec(
        `INSERT OR REPLACE INTO calendar_events (id, calendar_id, calendar_name, title, start_at, end_at, all_day, location, html_link, color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id,
        e.calendarId,
        e.calendarName,
        e.title,
        e.start,
        e.end,
        e.allDay ? 1 : 0,
        e.location,
        e.htmlLink,
        e.color
      );
    }
    this.saveSettingKey("calendar_last_sync", now.toISOString());
    this.saveSettingKey("calendar_error", clampText(errors.join(" · "), 300));
    return { ok: true, count: deduped.length, error: errors[0] };
  }

  private getCalendarSnapshot(): { sync: CalendarSyncState; events: CalendarEvent[] } {
    const cfg = this.getCalendarConfig();
    const from = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const events = this.sql
      .exec<{
        id: string;
        calendar_id: string;
        calendar_name: string;
        title: string;
        start_at: string;
        end_at: string;
        all_day: number;
        location: string;
        html_link: string | null;
        color: string | null;
      }>("SELECT * FROM calendar_events WHERE end_at >= ? ORDER BY start_at ASC LIMIT 400", from)
      .toArray()
      .map((r) => ({
        id: r.id,
        calendarId: r.calendar_id,
        calendarName: r.calendar_name,
        title: r.title,
        start: r.start_at,
        end: r.end_at,
        allDay: r.all_day === 1,
        location: r.location,
        htmlLink: r.html_link,
        color: r.color,
      }));
    return {
      sync: {
        connected: Boolean(cfg.bridgeUrl) || this.getCalendarFeeds().length > 0,
        canCreate: Boolean(cfg.bridgeUrl),
        bridgeConnected: Boolean(cfg.bridgeUrl),
        feeds: this.getCalendarFeeds().map((f) => ({ id: f.id, name: f.name, color: f.color, host: feedLabel(f.url) })),
        lastSyncAt: cfg.lastSyncAt,
        error: cfg.error,
        eventCount: events.length,
      },
      events,
    };
  }

  // ---------------------------------------------------------------------------
  // Daily rollups: compact per-day history that survives row-count trimming
  // ---------------------------------------------------------------------------
  private updateDailyRollup(): void {
    const day = new Date().toISOString().slice(0, 10);
    const start = `${day}T00:00:00.000Z`;
    const usage = this.sql
      .exec<{ tokens: number; cost: number; reqs: number }>(
        `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as reqs
         FROM usage_events WHERE created_at >= ?`,
        start
      )
      .one();
    const runs = this.sql
      .exec<{ done: number; failed: number }>(
        `SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as done,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed
         FROM task_runs WHERE started_at >= ?`,
        start
      )
      .one();
    const tasks = this.sql
      .exec<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM google_tasks WHERE status = 'completed' AND completed_at >= ?",
        start
      )
      .one();
    this.sql.exec(
      `INSERT INTO daily_rollups (day, tokens, cost_usd, requests, runs_completed, runs_failed, tasks_done, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         tokens = MAX(daily_rollups.tokens, excluded.tokens),
         cost_usd = MAX(daily_rollups.cost_usd, excluded.cost_usd),
         requests = MAX(daily_rollups.requests, excluded.requests),
         runs_completed = MAX(daily_rollups.runs_completed, excluded.runs_completed),
         runs_failed = MAX(daily_rollups.runs_failed, excluded.runs_failed),
         tasks_done = MAX(daily_rollups.tasks_done, excluded.tasks_done),
         updated_at = excluded.updated_at`,
      day,
      usage?.tokens ?? 0,
      Number((usage?.cost ?? 0).toFixed(4)),
      usage?.reqs ?? 0,
      runs?.done ?? 0,
      runs?.failed ?? 0,
      tasks?.cnt ?? 0,
      new Date().toISOString()
    );
    this.sql.exec("DELETE FROM daily_rollups WHERE day NOT IN (SELECT day FROM daily_rollups ORDER BY day DESC LIMIT 400)");
  }

  private listDailyRollups(days: number): Array<{
    day: string;
    tokens: number;
    costUsd: number;
    requests: number;
    runsCompleted: number;
    runsFailed: number;
    tasksDone: number;
  }> {
    return this.sql
      .exec<{
        day: string;
        tokens: number;
        cost_usd: number;
        requests: number;
        runs_completed: number;
        runs_failed: number;
        tasks_done: number;
      }>("SELECT * FROM daily_rollups ORDER BY day DESC LIMIT ?", days)
      .toArray()
      .reverse()
      .map((r) => ({
        day: r.day,
        tokens: r.tokens,
        costUsd: r.cost_usd,
        requests: r.requests,
        runsCompleted: r.runs_completed,
        runsFailed: r.runs_failed,
        tasksDone: r.tasks_done,
      }));
  }

  private async callGoogleTasksBridge(
    action: "list" | "create" | "update" | "delete",
    payload: Record<string, unknown>
  ): Promise<{
    ok: boolean;
    error?: string;
    lists?: Array<{ id: string; title: string; updated?: string }>;
    tasks?: Array<{
      id: string;
      listId: string;
      title: string;
      notes?: string;
      due?: string | null;
      status?: string;
      completed?: string | null;
      position?: string;
      updated?: string;
    }>;
    task?: {
      id: string;
      listId?: string;
      title?: string;
      notes?: string;
      due?: string | null;
      status?: string;
      updated?: string;
    };
  }> {
    const cfg = this.getGoogleTasksConfig();
    if (!cfg.bridgeUrl || !isValidGoogleTasksBridgeUrl(cfg.bridgeUrl)) {
      return { ok: false, error: "Google Tasks bridge URL is not configured" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const resp = await fetch(cfg.bridgeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "follow",
        signal: controller.signal,
        body: JSON.stringify({
          secret: cfg.secret,
          action,
          ...payload,
        }),
      });
      const text = await resp.text();
      if (!resp.ok) {
        return { ok: false, error: `Bridge returned HTTP ${resp.status}` };
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          error: "Bridge returned HTML instead of JSON — check Apps Script deployment access is set to 'Anyone'",
        };
      }
      if (parsed.ok === false || parsed.error) {
        return { ok: false, error: clampText(parsed.error, 200) || "Bridge rejected request" };
      }
      return { ok: true, ...(parsed as Record<string, unknown>) } as ReturnType<
        OfficeHub["callGoogleTasksBridge"]
      > extends Promise<infer R>
        ? R
        : never;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      return { ok: false, error: clampText(msg, 180) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async syncGoogleTasks(): Promise<{ ok: boolean; count: number; error?: string }> {
    const res = await this.callGoogleTasksBridge("list", {});
    const now = new Date().toISOString();
    if (!res.ok) {
      this.saveSettingKey("google_tasks_error", res.error || "Sync failed");
      return { ok: false, count: 0, error: res.error };
    }

    const lists = Array.isArray(res.lists) ? res.lists : [];
    const tasks = Array.isArray(res.tasks) ? res.tasks : [];

    // Preserve any bot assignments attached to existing Google tasks
    const existingAssign = new Map(
      this.sql
        .exec<{ id: string; assigned_bot_id: string | null }>(
          "SELECT id, assigned_bot_id FROM google_tasks WHERE assigned_bot_id IS NOT NULL"
        )
        .toArray()
        .map((r) => [r.id, r.assigned_bot_id])
    );

    const seenListIds = new Set<string>();
    for (const l of lists) {
      const id = clampText(l.id, 120);
      const title = clampText(l.title, 100) || "Tasks";
      if (!id) continue;
      seenListIds.add(id);
      this.sql.exec(
        `INSERT INTO google_task_lists (id, title, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        id,
        title,
        l.updated || now
      );
    }

    const existingLists = this.sql
      .exec<{ id: string }>("SELECT id FROM google_task_lists WHERE id != 'local'")
      .toArray();
    for (const row of existingLists) {
      if (!seenListIds.has(row.id)) {
        this.sql.exec("DELETE FROM google_task_lists WHERE id = ?", row.id);
      }
    }

    const pendingIds = new Set(
      this.sql
        .exec<{ id: string }>("SELECT id FROM google_tasks WHERE sync_pending = 1")
        .toArray()
        .map((r) => r.id)
    );
    const seenTaskIds = new Set<string>(pendingIds);
    for (const t of tasks) {
      const id = clampText(t.id, 160);
      const listId = clampText(t.listId, 120);
      const title = clampText(t.title, 200);
      if (!id || !listId || !title) continue;
      seenTaskIds.add(id);
      if (pendingIds.has(id)) continue;
      const status: GoogleTaskStatus = t.status === "completed" ? "completed" : "needsAction";
      const due = t.due ? clampText(t.due, 40) : null;
      const notes = clampText(t.notes, 1000);
      const completedAt = t.completed ? clampText(t.completed, 40) : status === "completed" ? now : null;
      const position = clampText(t.position, 40);
      const assignedBotId = existingAssign.get(id) ?? null;

      this.sql.exec(
        `INSERT INTO google_tasks (id, list_id, title, notes, due, status, completed_at, position, assigned_bot_id, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'google', ?)
         ON CONFLICT(id) DO UPDATE SET
           list_id = excluded.list_id,
           title = excluded.title,
           notes = excluded.notes,
           due = excluded.due,
           status = excluded.status,
           completed_at = excluded.completed_at,
           position = excluded.position,
           source = 'google',
           updated_at = excluded.updated_at`,
        id,
        listId,
        title,
        notes,
        due,
        status,
        completedAt,
        position,
        assignedBotId,
        t.updated || now
      );
    }

    const existingGoogleTasks = this.sql
      .exec<{ id: string }>("SELECT id FROM google_tasks WHERE source = 'google'")
      .toArray();
    for (const row of existingGoogleTasks) {
      if (!seenTaskIds.has(row.id)) {
        this.sql.exec("DELETE FROM google_tasks WHERE id = ?", row.id);
      }
    }

    this.saveSettingKey("google_tasks_last_sync", now);
    this.saveSettingKey("google_tasks_error", "");
    return { ok: true, count: seenTaskIds.size };
  }

  private listGoogleTaskLists(): GoogleTaskList[] {
    const rows = this.sql
      .exec<{ id: string; title: string; updated_at: string }>(
        "SELECT id, title, updated_at FROM google_task_lists ORDER BY CASE WHEN id = 'local' THEN 1 ELSE 0 END, title ASC"
      )
      .toArray();
    if (rows.length === 0) {
      return [{ id: "local", title: "My Tasks", updatedAt: new Date().toISOString() }];
    }
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
  }

  private listGoogleTasks(bots: BotRecord[]): GoogleTaskItem[] {
    const botNames = new Map(bots.map((b) => [b.id, b.name]));
    return this.sql
      .exec<{
        id: string;
        list_id: string;
        title: string;
        notes: string;
        due: string | null;
        status: GoogleTaskStatus;
        completed_at: string | null;
        position: string;
        assigned_bot_id: string | null;
        sync_pending?: number;
        source: "google" | "local";
        updated_at: string;
      }>(
        `SELECT * FROM google_tasks
         ORDER BY CASE WHEN status = 'needsAction' THEN 0 ELSE 1 END,
                  CASE WHEN due IS NULL OR due = '' THEN 1 ELSE 0 END,
                  due ASC,
                  updated_at DESC
         LIMIT 300`
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        listId: r.list_id,
        title: r.title,
        notes: r.notes,
        due: r.due,
        status: r.status === "completed" ? "completed" : "needsAction",
        completedAt: r.completed_at,
        position: r.position,
        assignedBotId: r.assigned_bot_id,
        assignedBotName: r.assigned_bot_id ? botNames.get(r.assigned_bot_id) ?? r.assigned_bot_id : null,
        source: r.source === "google" ? "google" : "local",
        updatedAt: r.updated_at,
        syncPending: r.sync_pending === 1,
      }));
  }

  private resetOffice(): void {
    this.sql.exec("DELETE FROM bots");
    this.sql.exec("DELETE FROM pending_needs");
    this.sql.exec("DELETE FROM usage_events");
    this.sql.exec("DELETE FROM activity_logs");
    this.sql.exec("DELETE FROM task_runs");
    this.sql.exec("DELETE FROM task_queue");
    this.sql.exec("DELETE FROM objectives");
    this.sql.exec("DELETE FROM google_tasks");
    this.sql.exec("DELETE FROM google_task_lists");
    this.sql.exec("DELETE FROM daily_rollups");
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

  return runProxyGuard({
    request,
    checkGuardrail: () => stub.fetch("https://internal/api/guardrail-check"),
    onUnavailable: () => {
      console.log(JSON.stringify({ event: "guardrail_unavailable" }));
      return withSecurityHeaders(jsonResponse({ error: "Guardrail unavailable" }, 503));
    },
    onBlocked: (reason) =>
      withSecurityHeaders(
        jsonResponse(
          {
            error: {
              message: `Grok Bot HQ Guardrail Circuit-Breaker: ${reason || "Daily cap reached"}`,
              type: "office_budget_cap_exceeded",
              code: "daily_budget_cap_reached",
            },
          },
          429
        )
      ),
    onTooLarge: (error) => withSecurityHeaders(jsonResponse({ error }, 413)),
    forward: async (bodyBuffer) => {
  const upstreamBase = (env.AI_GATEWAY_BASE_URL ?? "https://api.x.ai/v1").replace(/\/+$/, "");
  const url = new URL(request.url);
  const upstreamUrl = `${upstreamBase}${restPath}${url.search}`;

  const startedAt = Date.now();
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete("host");
  forwardHeaders.delete("cookie");
  forwardHeaders.delete("x-report-secret");

  let requestModel = "grok-4";
  if (bodyBuffer && bodyBuffer.byteLength > 0) {
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
    },
  });
}

async function checkOfficePassword(request: Request, env: Env): Promise<Response | null> {
  if (!env.OFFICE_PASSWORD) return null;
  const url = new URL(request.url);
  if (
    url.pathname === "/api/report" ||
    url.pathname === "/api/ping" ||
    url.pathname === "/api/notify/act" ||
    url.pathname.startsWith("/api/bot/") ||
    url.pathname.startsWith("/proxy/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icons/")
  ) {
    return null;
  }
  if (url.pathname === "/auth" && request.method === "POST") {
    return null;
  }

  const headerPass = request.headers.get("x-office-password");
  if (headerPass && (await timingSafeEqualStrings(headerPass, env.OFFICE_PASSWORD))) {
    return null;
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  if (cookies.office_session && (await verifySessionCookieValue(cookies.office_session, env.OFFICE_PASSWORD))) {
    // Prevent cross-site request forgery on cookie-authenticated mutations
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) {
        return withSecurityHeaders(jsonResponse({ error: "Cross-origin request blocked" }, 403));
      }
    }
    return null;
  }

  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
    return withSecurityHeaders(jsonResponse({ error: "Unauthorized" }, 401));
  }

  return withSecurityHeaders(
    new Response(renderOfficePasswordPage(), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const proxyMatch = url.pathname.match(/^\/proxy\/([^/]+)(\/v1\/.*)$/);
    if (proxyMatch) {
      // Leave Authorization alone: the SDK sends the model API key there.
      // A per-bot check-in token is not a proxy credential.
      const proxyAllowed = await decideReportAccess({
        reportSecret: env.REPORT_SECRET,
        authorizationHeader: null,
        reportSecretHeader: request.headers.get("x-report-secret"),
        tokenQuery: url.searchParams.get("token"),
        pathname: url.pathname,
        botId: decodeURIComponent(proxyMatch[1]),
        ownedCheckinToken: null,
      });
      if (!proxyAllowed) {
        return withSecurityHeaders(jsonResponse({ error: "Unauthorized proxy access" }, 401));
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
      return withSecurityHeaders(
        new Response(renderOfficePasswordPage("That password didn't match. Try again."), {
          status: 403,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      );
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
