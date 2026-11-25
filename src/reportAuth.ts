export interface ReportAuthInput {
  /** Undefined or empty means REPORT_SECRET is unset (local fail-open). */
  reportSecret: string | undefined;
  /** Bearer token, x-report-secret, or token query. Empty when none were sent. */
  candidate: string;
  /** True only when candidate matches the master REPORT_SECRET. */
  masterMatch: boolean;
  pathname: string;
  /** Bot id from `b` or `botId`, read before the per-bot comparison. */
  botId: string | null;
  /** True only when candidate matches the check-in token owned by `botId`. */
  botTokenMatch: boolean;
}

export function readReportCandidate(headers: {
  authorization: string | null;
  reportSecretHeader: string | null;
  tokenQuery: string | null;
}): string {
  const bearerMatch = headers.authorization?.match(/^Bearer\s+(.+)$/i);
  return (
    (bearerMatch ? bearerMatch[1].trim() : "") ||
    headers.reportSecretHeader?.trim() ||
    headers.tokenQuery?.trim() ||
    ""
  );
}

/**
 * Pure authorization decision used by /api/ping, /api/report, bot update,
 * bot status, and /proxy/*. Per-bot tokens authorize only that bot's ping.
 */
export function decideReportAuthorization(input: ReportAuthInput): boolean {
  if (!input.reportSecret) return true;
  if (!input.candidate) return false;
  if (input.masterMatch) return true;
  if (input.pathname === "/api/ping" && input.botId && input.botTokenMatch) return true;
  return false;
}
