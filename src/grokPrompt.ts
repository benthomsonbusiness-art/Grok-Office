const CHECKIN_TASK = "Draft the morning brief";

/**
 * Instruction block pasted into a Grok bot.
 * The per-bot check-in token is on the four GET lines only.
 */
export function buildGrokAppPrompt(
  botId: string,
  name: string,
  role: string,
  token = "",
  origin = "https://office.example"
): string {
  const base = origin;
  const idParam = encodeURIComponent(botId || "grok-bot");
  const nParam = encodeURIComponent(name || "Atlas");
  const rParam = encodeURIComponent(role || "Grok Agent");
  const taskParam = encodeURIComponent(CHECKIN_TASK);
  const tokenParam = encodeURIComponent(token);
  const shownName = name || "Atlas";
  const shownRole = role || "Grok Agent";
  return `OFFICE LINK for ${shownName} (${shownRole}). Do not quote the URL.
- Starting work: GET ${base}/api/ping?b=${idParam}&n=${nParam}&r=${rParam}&s=w&t=${taskParam}&token=${tokenParam}
- Still working, new step: GET ${base}/api/ping?b=${idParam}&s=w&t=${taskParam}&token=${tokenParam}
- Finished: GET ${base}/api/ping?b=${idParam}&done=1&out=HTTPS_LINK&result=ONE_LINE&token=${tokenParam}
- Need a human: GET ${base}/api/ping?b=${idParam}&s=wait&need=ONE_LINE_ASK&token=${tokenParam}
- Goal progress: add &obj=GOAL_ID&prog=0-100
- Usage: on the Finished link also add &tok=ESTIMATED_TOKENS_USED (whole number for the task)
If the response is Unauthorized, tell the user the office link was rejected.
Read the JSON orders. Do orders.nextTask when it is set. Follow orders.decision when it is set. If orders.goalId is set, advance that goal. Stop if orders.budgetBlocked is true.`;
}
