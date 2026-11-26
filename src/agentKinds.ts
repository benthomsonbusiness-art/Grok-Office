/**
 * Agent kinds. Grok bots pull their orders by pinging the office. Webhook-style agents
 * (n8n, Make, Zapier, custom services) also get orders pushed to them the moment a task
 * is queued, so they do not have to wait for their next check-in.
 */

export type AgentKind = "grok" | "n8n" | "webhook" | "script";

export const AGENT_KINDS: AgentKind[] = ["grok", "n8n", "webhook", "script"];

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  grok: "Grok",
  n8n: "n8n",
  webhook: "Webhook",
  script: "Script / API",
};

export function normalizeAgentKind(v: unknown, fallback: AgentKind = "grok"): AgentKind {
  return typeof v === "string" && (AGENT_KINDS as string[]).includes(v) ? (v as AgentKind) : fallback;
}

export function supportsPush(kind: AgentKind): boolean {
  return kind === "n8n" || kind === "webhook";
}

/** Display-safe version of a stored dispatch URL: keep host, hide path and query secrets. */
export function maskDispatchUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return "";
  }
}

export interface DispatchPayload {
  event: "task.dispatched";
  botId: string;
  task: string;
  queueId: string;
  dispatchedAt: string;
  reportUrl: string;
  doneUrl: string;
}

export function buildDispatchPayload(
  origin: string,
  botId: string,
  token: string,
  task: string,
  queueId: string,
  now: string
): DispatchPayload {
  const b = encodeURIComponent(botId);
  const t = encodeURIComponent(token);
  return {
    event: "task.dispatched",
    botId,
    task,
    queueId,
    dispatchedAt: now,
    reportUrl: `${origin}/api/ping?b=${b}&s=w&t=${encodeURIComponent(task)}&token=${t}`,
    doneUrl: `${origin}/api/ping?b=${b}&done=1&t=${encodeURIComponent(task)}&token=${t}`,
  };
}
