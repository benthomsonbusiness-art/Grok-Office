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
  var CHECKIN_TASK = "Draft the morning brief";
  function buildGrokAppPrompt(botId, name, role, token = "", origin = "https://office.example") {
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
If the response is Unauthorized, tell the user the office link was rejected.
Read the JSON orders. Do orders.nextTask when it is set. Follow orders.decision when it is set. If orders.goalId is set, advance that goal. Stop if orders.budgetBlocked is true.`;
  }
  return __toCommonJS(grokPrompt_exports);
})();
