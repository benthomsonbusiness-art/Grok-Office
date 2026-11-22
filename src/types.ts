export type BotStatus = "working" | "waiting" | "error" | "idle" | "meeting";

export type NeedSeverity = "approval" | "input" | "error" | "budget";

export type NeedStatus = "open" | "approved" | "rejected" | "resolved";

export type LogLevel = "info" | "warn" | "error" | "success";

export type ObjectiveStatus = "active" | "completed" | "blocked";

export interface BotRecord {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
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
  level: LogLevel;
  message: string;
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
    byModel: UsageByModel[];
    timeline: UsageBucket[];
  };
  serverTime: string;
}

export interface ReportPayload {
  botId?: string;
  b?: string; // compact alias for botId
  name?: string;
  role?: string;
  avatarColor?: string;
  deskIndex?: number;
  status?: BotStatus | string;
  s?: string; // compact alias for status
  task?: string;
  t?: string; // compact alias for task
  model?: string;
  m?: string; // compact alias for model
  done?: boolean; // marks previous/current task completed
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
