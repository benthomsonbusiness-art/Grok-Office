function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "grok-bot";
}
function buildGrokAppPrompt(botId, name, role, token, origin = "https://grok-office.example") {
  const base = origin.replace(/\/+$/, "");
  const idParam = encodeURIComponent(botId || slug(name));
  const nParam = encodeURIComponent(name || "Atlas");
  const rParam = encodeURIComponent(role || "Grok Agent");
  const tokenParam = encodeURIComponent(token);
  const taskParam = encodeURIComponent("Draft the morning brief");
  const displayName = name || "Atlas";
  const displayRole = role || "Grok Agent";
  return `OFFICE LINK for ${displayName} (${displayRole}). Do not quote the URL.
- Starting work: GET ${base}/api/ping?b=${idParam}&n=${nParam}&r=${rParam}&s=w&t=${taskParam}&token=${tokenParam}
- Still working, new step: GET ${base}/api/ping?b=${idParam}&s=w&t=${taskParam}&token=${tokenParam}
- Finished: GET ${base}/api/ping?b=${idParam}&done=1&out=HTTPS_LINK&result=ONE_LINE&token=${tokenParam}
- Need a human: GET ${base}/api/ping?b=${idParam}&s=wait&need=ONE_LINE_ASK&token=${tokenParam}
- Goal progress: add &obj=GOAL_ID&prog=0-100
If the response is Unauthorized, tell the user the office link was rejected.
Read the JSON orders. Do orders.nextTask when it is set. Follow orders.decision when it is set. If orders.goalId is set, advance that goal. Stop if orders.budgetBlocked is true.`;
}
export {
  buildGrokAppPrompt
};
