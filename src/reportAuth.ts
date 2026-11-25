import { timingSafeEqualStrings } from "./security.ts";

export const UNAUTHORIZED_REPORT_STATUS = 401;
export const UNAUTHORIZED_REPORT_BODY = { error: "Unauthorized" } as const;

export interface ReportAuthInput {
  reportSecret: string | undefined;
  authorizationHeader: string | null;
  reportSecretHeader: string | null;
  tokenQuery: string | null;
  pathname: string;
  /** Bot id from `b` or `botId`. Null when the request names no bot. */
  botId: string | null;
  /**
   * Check-in token stored for `botId` only.
   * Callers look the row up by id. A token that belongs to a different bot must not be passed here.
   */
  ownedCheckinToken: string | null;
}

/** Prefer `b`, then `botId`. The caller still clamps the length. */
export function readReportBotId(params: { get(name: string): string | null }): string {
  return (params.get("b") ?? params.get("botId") ?? "").trim();
}

export function extractReportCandidate(input: {
  authorizationHeader: string | null;
  reportSecretHeader: string | null;
  tokenQuery: string | null;
}): string {
  const bearerMatch = input.authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  return (
    (bearerMatch ? bearerMatch[1].trim() : null) ??
    input.reportSecretHeader?.trim() ??
    input.tokenQuery?.trim() ??
    ""
  );
}

/**
 * Report and ping authorization.
 * An unset REPORT_SECRET stays fail-open (local dev).
 * The master secret authorizes every report route.
 * A per-bot check-in token authorizes only `/api/ping` for the bot id that owns it.
 */
export async function decideReportAccess(input: ReportAuthInput): Promise<boolean> {
  if (!input.reportSecret) return true;
  const candidate = extractReportCandidate(input);
  if (!candidate) return false;
  if (await timingSafeEqualStrings(candidate, input.reportSecret)) return true;
  if (input.pathname !== "/api/ping") return false;
  if (!input.botId || !input.ownedCheckinToken) return false;
  return timingSafeEqualStrings(candidate, input.ownedCheckinToken);
}
