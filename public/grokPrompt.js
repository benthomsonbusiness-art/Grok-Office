"use strict";
var GrokPrompt = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/grokPrompt.ts
  var grokPrompt_exports = {};
  __export(grokPrompt_exports, {
    buildGrokAppPrompt: () => buildGrokAppPrompt
  });
  function buildGrokAppPrompt(botId, name, role, token = "", origin = "https://office.example", hasTeam = false) {
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
      ...hasTeam ? [`- orders.team: your reports and their status. Delegate with orders.howTo.delegate.`] : [],
      `- orders.howTo: the exact links for reporting back. Use them.`,
      `AFTER EACH TASK: GET ${base}/api/ping?b=${b}&done=1&req=TASK_ID&t=TASK&out=HTTPS_LINK&result=ONE_LINE&tok=TOKENS_USED&token=${t}`,
      `NEED THE OWNER: GET ${base}/api/ping?b=${b}&s=wait&need=SHORT_TITLE&detail=WHAT_HAPPENED_WHY_AND_THE_OPTIONS&sev=approval_or_input_or_error&token=${t}`,
      `Always fill detail: what you were doing, what went wrong or what you need, and the choices the owner has.`,
      `Replace CAPITAL words with real values (URL-encoded). Stop if orders.budgetBlocked is true.`,
      `If a link returns Unauthorized, tell the user the HQ link was rejected.`
    ];
    return lines.join("\n");
  }
  return __toCommonJS(grokPrompt_exports);
})();
