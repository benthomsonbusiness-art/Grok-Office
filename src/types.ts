export type BotStatus = "working" | "waiting" | "error" | "idle" | "meeting" | "no_report";

export type NeedSeverity = "approval" | "input" | "error" | "budget";

export type NeedStatus = "open" | "approved" | "rejected" | "resolved";

export type LogLevel = "info" | "warn" | "error" | "success";

export type ObjectiveStatus = "active" | "completed" | "blocked";

export type GrokShape =
  | "circle"
  | "pebble"
  | "squircle"
  | "capsule"
  | "triangle"
  | "hexagon"
  | "cloud"
  | "droplet";

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
  lastSeenAt: string;
  collaboratingWith: string | null;
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
}

export interface OfficeSnapshot {
  bots: BotRecord[];
  pendingNeeds: PendingNeed[];
  activityLogs: ActivityLog[];
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
    todayTokens: number;
    todayCostUsd: number;
    todayTasksCompleted: number;
    usageRemainingPct: number;
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
