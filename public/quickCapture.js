"use strict";
var QuickCapture = (() => {
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

  // src/quickCapture.ts
  var quickCapture_exports = {};
  __export(quickCapture_exports, {
    describeCapture: () => describeCapture,
    parseAsTask: () => parseAsTask,
    parseQuickCapture: () => parseQuickCapture,
    toLocalDateKey: () => toLocalDateKey
  });
  var TASK_PREFIX = /^(?:task|todo|t|remind(?:\s+me)?(?:\s+to)?)\s*[:\-]?\s+/i;
  var EVENT_PREFIX = /^(?:event|meet(?:ing)?|cal|e)\s*[:\-]?\s+/i;
  var BOT_PREFIX = /^@([a-z0-9][a-z0-9._-]{0,63})\s+/i;
  var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function toLocalDateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addDays(base, days) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }
  function extractWhen(text, now) {
    let rest = ` ${text} `;
    let date = null;
    let startMin = null;
    let durationMin = null;
    const take = (re, fn) => {
      const m = rest.match(re);
      if (m && fn(m)) rest = rest.replace(m[0], " ");
    };
    take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)(?=\s)/i, (m) => {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;
      durationMin = /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
      return durationMin > 0 && durationMin <= 24 * 60;
    });
    take(/\s(?:at\s+|@)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m) => {
      let h = Number(m[1]);
      const min = Number(m[2] ?? 0);
      if (h < 1 || h > 12 || min > 59) return false;
      const pm = m[3].toLowerCase() === "pm";
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
      startMin = h * 60 + min;
      return true;
    });
    if (startMin === null) {
      take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => {
        startMin = Number(m[1]) * 60 + Number(m[2]);
        return true;
      });
    }
    take(/\s(today|tonight|tomorrow|tmrw|tmr)(?=\s)/i, (m) => {
      const w = m[1].toLowerCase();
      date = toLocalDateKey(w === "today" || w === "tonight" ? now : addDays(now, 1));
      if (w === "tonight" && startMin === null) startMin = 19 * 60;
      return true;
    });
    if (!date) {
      take(/\s(?:next\s+|on\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*(?=\s)/i, (m) => {
        const idx = WEEKDAYS.indexOf(m[1].toLowerCase().slice(0, 3));
        if (idx < 0) return false;
        let delta = (idx - now.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        date = toLocalDateKey(addDays(now, delta));
        return true;
      });
    }
    if (!date) {
      take(/\sin\s+(\d{1,2})\s+days?(?=\s)/i, (m) => {
        date = toLocalDateKey(addDays(now, Number(m[1])));
        return true;
      });
    }
    if (!date) {
      take(/\s(?:on\s+)?(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => {
        date = `${m[1]}-${m[2]}-${m[3]}`;
        return true;
      });
    }
    if (!date) {
      take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?=\s)/, (m) => {
        const month = Number(m[1]);
        const day = Number(m[2]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return false;
        let year = now.getFullYear();
        const candidate = new Date(year, month - 1, day);
        if (candidate < addDays(now, 0)) year += 1;
        date = `${year}-${pad(month)}-${pad(day)}`;
        return true;
      });
    }
    if (startMin !== null && !date) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      date = toLocalDateKey(startMin > nowMin ? now : addDays(now, 1));
    }
    return { rest: rest.replace(/\s+/g, " ").trim(), date, startMin, durationMin };
  }
  function parseQuickCapture(input, now = /* @__PURE__ */ new Date()) {
    const raw = (input || "").trim();
    if (!raw) return null;
    const botMatch = raw.match(BOT_PREFIX);
    if (botMatch) {
      const title2 = raw.slice(botMatch[0].length).trim();
      if (!title2) return null;
      return {
        kind: "bot",
        title: title2.slice(0, 200),
        date: null,
        startMin: null,
        durationMin: 0,
        botHandle: botMatch[1].toLowerCase()
      };
    }
    let kind = null;
    let body = raw;
    const ev = raw.match(EVENT_PREFIX);
    const tk = raw.match(TASK_PREFIX);
    if (ev) {
      kind = "event";
      body = raw.slice(ev[0].length);
    } else if (tk) {
      kind = "task";
      body = raw.slice(tk[0].length);
    }
    if (!kind) return null;
    const when = extractWhen(body, now);
    const title = when.rest.slice(0, 200);
    if (!title) return null;
    if (kind === "event") {
      return {
        kind,
        title,
        date: when.date ?? toLocalDateKey(now),
        startMin: when.startMin,
        durationMin: when.durationMin ?? (when.startMin === null ? 0 : 60),
        botHandle: null
      };
    }
    return {
      kind,
      title,
      date: when.date,
      startMin: null,
      durationMin: 0,
      botHandle: null
    };
  }
  function parseAsTask(input, now = /* @__PURE__ */ new Date()) {
    const raw = (input || "").trim();
    if (!raw) return null;
    const when = extractWhen(raw, now);
    const title = when.rest.slice(0, 200) || raw.slice(0, 200);
    return { kind: "task", title, date: when.date, startMin: null, durationMin: 0, botHandle: null };
  }
  function describeCapture(c, now = /* @__PURE__ */ new Date()) {
    const parts = [];
    if (c.date) {
      const today = toLocalDateKey(now);
      const tomorrow = toLocalDateKey(addDays(now, 1));
      if (c.date === today) parts.push("today");
      else if (c.date === tomorrow) parts.push("tomorrow");
      else {
        const [y, m, d] = c.date.split("-").map(Number);
        parts.push(
          new Date(y, m - 1, d).toLocaleDateString(void 0, { weekday: "short", month: "short", day: "numeric" })
        );
      }
    }
    if (c.startMin !== null) {
      const h = Math.floor(c.startMin / 60);
      const m = c.startMin % 60;
      const h12 = h % 12 === 0 ? 12 : h % 12;
      parts.push(`${h12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`);
      if (c.durationMin) parts.push(`${c.durationMin}m`);
    } else if (c.kind === "event") {
      parts.push("all day");
    }
    return parts.join(" \xB7 ");
  }
  return __toCommonJS(quickCapture_exports);
})();
