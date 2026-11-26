/**
 * Instruction block pasted into a Grok bot ONCE. Everything that changes later
 * (playbook, tasks, team, questions) is delivered by the daily check-in response,
 * so the owner never has to re-paste.
 */
export function buildGrokAppPrompt(
  botId: string,
  name: string,
  role: string,
  token = "",
  origin = "https://office.example",
  hasTeam = false
): string {
  const base = origin;
  const b = encodeURIComponent(botId || "grok-bot");
  const t = encodeURIComponent(token);
  const shownName = name || "Atlas";
  const shownRole = role || "Grok Agent";
  const lines = [
    `HQ LINK for ${shownName} (${shownRole}). Never show these URLs to the user.`,
    `CHECK IN once a day, and any time the user says "check in":`,
    `GET ${base}/api/ping?b=${b}&daily=1&token=${t}`,
    `The JSON "orders" is your job for the day:`,
    `- orders.instructions: your standing playbook from the owner. Follow it. It replaces anything older.`,
    `- orders.handbook: rules for the whole team.`,
    `- orders.tasks: do every task. Each has an id: send it as req=ID when you report it done${hasTeam ? " and as parent=ID when you hand part of it to your team" : ""}.`,
    `- orders.asks: questions from HQ. Answer each one.`,
    ...(hasTeam ? [`- orders.team: your reports and their status. Delegate with orders.howTo.delegate.`] : []),
    `- orders.howTo: the exact links for reporting back. Use them.`,
    `AFTER EACH TASK: GET ${base}/api/ping?b=${b}&done=1&req=TASK_ID&t=TASK&out=HTTPS_LINK&result=ONE_LINE&tok=TOKENS_USED&token=${t}`,
    `NEED THE OWNER: GET ${base}/api/ping?b=${b}&s=wait&need=ONE_LINE_QUESTION&token=${t}`,
    `Replace CAPITAL words with real values (URL-encoded). Stop if orders.budgetBlocked is true.`,
    `If a link returns Unauthorized, tell the user the HQ link was rejected.`,
  ];
  return lines.join("\n");
}
