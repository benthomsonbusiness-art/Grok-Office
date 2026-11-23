export type BotStatus = "working" | "waiting" | "error" | "idle" | "meeting" | "no_report";

export type NeedSeverity = "approval" | "input" | "error" | "budget";

export type NeedStatus = "open" | "approved" | "rejected" | "resolved";

export type LogLevel = "info" | "warn" | "error" | "success";

export type ObjectiveStatus = "active" | "completed" | "blocked";

export type RunStatus = "running" | "completed" | "failed" | "waiting";

export type ConnectionLink = "fresh" | "due" | "stale" | "offline" | "waiting";

export interface BotOrders {
  nextTask: string | null;
  decision: string | null;
  goal: string | null;
  goalId: string | null;
  goalProgress: number | null;
  budgetBlocked: boolean;
}

export type GrokShape =
  | "circle"
  | "pebble"
  | "squircle"
  | "capsule"
  | "triangle"
  | "hexagon"
  | "cloud"
  | "droplet";

export interface QueuedTask {
  id: string;
  botId: string;
  task: string;
  createdAt: string;
}

export interface TaskRun {
  id: string;
  botId: string;
  botName: string;
  model: string;
  task: string;
  status: RunStatus;
  outputUrl: string | null;
  resultSummary: string | null;
  qualityRating: -1 | 0 | 1;
  startedAt: string;
  finishedAt: string | null;
  durationSec: number;
}

export interface BotRecord {
  id: string;
  name: string;
  role: string;
  department: string;
  avatarColor: string;
  avatarShape: GrokShape;
  deskIndex: number;
  status: BotStatus;
  task: string;
  model: string;
  tokensTotal: number;
  costTotalUsd: number;
  requestsTotal: number;
  tasksCompleted: number;
  errorCount: number;
  expectedIntervalMinutes: number;
  avgDurationSec: number;
  qualityScorePct: number | null;
  ratedCount: number;
  queuedTasks: QueuedTask[];
  lastSeenAt: string;
  collaboratingWith: string | null;
  link: ConnectionLink;
}

export interface PendingNeed {
  id: string;
  botId: string;
  botName: string;
  title: string;
  description: string;
  severity: NeedSeverity;
  status: NeedStatus;
  callbackUrl: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ActivityLog {
  id: string;
  botId: string;
  botName: string;
  botColor: string;
  status: BotStatus;
  level: LogLevel;
  message: string;
  simulated: boolean;
  createdAt: string;
}

export interface Objective {
  id: string;
  title: string;
  ownerBotId: string | null;
  ownerBotName: string | null;
  progress: number;
  targetLabel: string;
  status: ObjectiveStatus;
  updatedAt: string;
}

export interface OfficeSettings {
  dailyTokenCap: number;
  dailyCostCapUsd: number;
  dailyTaskTarget: number;
  autoIdleMinutes: number;
  hardBudgetStop: boolean;
  alertWebhookUrl: string;
}

export interface UsageByModel {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  requests: number;
}

export interface UsageBucket {
  label: string;
  tokens: number;
  costUsd: number;
  requests: number;
  errors: number;
}

export interface OfficeSnapshot {
  bots: BotRecord[];
  pendingNeeds: PendingNeed[];
  activityLogs: ActivityLog[];
  recentRuns: TaskRun[];
  objectives: Objective[];
  settings: OfficeSettings;
  usageSummary: {
    totalTokens: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalCostUsd: number;
    totalRequests: number;
    totalTasksCompleted: number;
    errorRatePct: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    todayTokens: number;
    todayCostUsd: number;
    todayTasksCompleted: number;
    costPerCompletedTaskUsd: number;
    approvalsResolvedToday: number;
    failedRunsToday: number;
    fleetQualityPct: number | null;
    topBotName: string | null;
    usageRemainingPct: number;
    budgetLocked: boolean;
    byModel: UsageByModel[];
    timeline: UsageBucket[];
  };
  lastBotUpdateAt: string | null;
  serverTime: string;
}

export interface ReportPayload {
  botId?: string;
  b?: string;
  name?: string;
  role?: string;
  department?: string;
  d?: string;
  avatarColor?: string;
  avatarShape?: GrokShape;
  shape?: GrokShape;
  deskIndex?: number;
  status?: BotStatus | string;
  s?: string;
  task?: string;
  t?: string;
  model?: string;
  m?: string;
  done?: boolean;
  outputUrl?: string;
  out?: string;
  result?: string;
  expectedIntervalMinutes?: number;
  detectLoop?: boolean;
  simulated?: boolean;
  collaboratingWith?: string | null;
  message?: string;
  level?: LogLevel;
  objectiveId?: string;
  objectiveProgress?: number;
  usage?: {
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    latencyMs?: number;
    error?: boolean;
  };
  need?: {
    id?: string;
    title: string;
    description?: string;
    severity?: NeedSeverity;
    callbackUrl?: string;
  };
}
