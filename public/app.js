(() => {
  let snapshot = null;
  let selectedBotId = null;
  let teamFilter = "all";
  let chartMode = "tokens";
  let simTimer = null;

  const stageEl = document.getElementById("office-3d-stage");
  const labelLayer = document.getElementById("label-layer");
  const tooltipEl = document.getElementById("bot-tooltip");

  const office3d = new window.Office3D(stageEl, labelLayer, tooltipEl, (botId) => {
    selectedBotId = botId;
    renderInspector();
    renderTeamList();
  });

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatNum(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n ?? 0);
  }

  function timeAgo(iso) {
    if (!iso) return "no updates yet";
    const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (diffSec < 10) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  function statusLabel(s) {
    if (s === "no_report") return "No report";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function setBar(elId, pct) {
    const el = document.getElementById(elId);
    if (!el) return;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    el.style.width = `${clamped}%`;
    el.classList.toggle("danger", pct >= 90);
  }

  // WebSocket with automatic reconnect
  function connectWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsDot = document.getElementById("ws-dot");
    const ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      wsDot.classList.add("live");
      wsDot.title = "Realtime WebSocket connected";
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "snapshot" && msg.data) {
          applySnapshot(msg.data);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      wsDot.classList.remove("live");
      wsDot.title = "Reconnecting…";
      setTimeout(connectWS, 2000);
    };
  }

  async function fetchSnapshotFallback() {
    try {
      const res = await fetch("/api/snapshot");
      if (res.ok) applySnapshot(await res.json());
    } catch {
      // Ignore
    }
  }

  function applySnapshot(data) {
    snapshot = data;
    office3d.updateBots(data.bots || [], data.usageSummary);
    renderAll();
  }

  function renderAll() {
    if (!snapshot) return;
    renderHUD();
    renderTeamList();
    renderActivity();
    renderNeeds();
    renderGoals();
    renderAnalyticsModal();
    if (selectedBotId) renderInspector();
  }

  function renderHUD() {
    const { bots, usageSummary, lastBotUpdateAt } = snapshot;
    const working = bots.filter((b) => b.status === "working" || b.status === "meeting").length;
    const waiting = bots.filter((b) => b.status === "waiting").length;
    const err = bots.filter((b) => b.status === "error").length;
    const idle = bots.filter((b) => b.status === "idle").length;
    const noreport = bots.filter((b) => b.status === "no_report").length;

    document.getElementById("cnt-working").textContent = String(working);
    document.getElementById("cnt-waiting").textContent = String(waiting);
    document.getElementById("cnt-error").textContent = String(err);
    document.getElementById("cnt-idle").textContent = String(idle);
    document.getElementById("cnt-noreport").textContent = String(noreport);

    document.getElementById("last-update-label").textContent = lastBotUpdateAt
      ? `last bot update ${timeAgo(lastBotUpdateAt)}`
      : "waiting for bots";

    const rem = usageSummary?.usageRemainingPct ?? 100;
    document.getElementById("usage-left-label").textContent = `Usage ${rem}% left`;

    const isSim = Boolean(simTimer) || snapshot.activityLogs.some((l) => l.simulated);
    const pill = document.getElementById("mode-pill");
    pill.textContent = isSim ? "SIMULATED" : "LIVE";
    pill.className = `mode-pill ${isSim ? "sim" : "live"}`;
    document.getElementById("activity-mode-tag").textContent = isSim ? "· SIMULATED" : "· LIVE";
  }

  function renderTeamList() {
    const bots = snapshot.bots || [];
    document.getElementById("team-count").textContent = String(bots.length);

    const filtered = bots.filter((b) => {
      if (teamFilter === "all") return true;
      if (teamFilter === "working") return b.status === "working" || b.status === "meeting";
      return b.status === teamFilter;
    });

    const el = document.getElementById("team-list");
    if (filtered.length === 0) {
      el.innerHTML = `<div class="empty-msg">No bots match this filter.</div>`;
      return;
    }

    el.innerHTML = filtered
      .map(
        (b) => `
      <div class="team-row ${selectedBotId === b.id ? "selected" : ""}" data-select-bot="${esc(b.id)}">
        <span class="bot-sq" style="background:${esc(b.avatarColor)}"></span>
        <div class="team-info">
          <div class="team-name">${esc(b.name)} <span class="team-role">· ${esc(b.role)}</span></div>
          <div class="team-sub">${esc(b.department)} · ${esc(b.task || "Standing by")}</div>
        </div>
        <span class="st-pill st-${esc(b.status)}">${esc(statusLabel(b.status))}</span>
      </div>`
      )
      .join("");
  }

  function renderActivity() {
    const logs = snapshot.activityLogs || [];
    const el = document.getElementById("activity-list");
    if (logs.length === 0) {
      el.innerHTML = `<div class="empty-msg">No activity logged yet.</div>`;
      return;
    }

    el.innerHTML = logs
      .slice(0, 35)
      .map((l) => {
        const ts = new Date(l.createdAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        return `
        <div class="act-item">
          <span class="bot-sq" style="background:${esc(l.botColor || "#38bdf8")};margin-top:4px"></span>
          <div class="act-body">
            <div class="act-line">
              <strong>${esc(l.botName)}</strong>
              <span class="st-pill st-${esc(l.status || "working")}" style="padding:1px 6px;font-size:0.64rem;margin:0 4px">${esc(statusLabel(l.status || "working"))}</span>
              ${esc(l.message)}
            </div>
            <div class="act-meta">
              ${esc(ts)}${l.simulated ? ` · <span class="act-sim">Simulated</span>` : ""}
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderNeeds() {
    const needs = snapshot.pendingNeeds || [];
    const openNeeds = needs.filter((n) => n.status === "open");
    const openSafe = openNeeds.filter((n) => n.severity === "approval" || n.severity === "input");

    const badge = document.getElementById("needs-count-pill");
    badge.textContent = String(openNeeds.length);
    badge.classList.toggle("hidden", openNeeds.length === 0);

    document.getElementById("btn-approve-all").classList.toggle("hidden", openSafe.length < 2);

    const el = document.getElementById("needs-list");
    if (needs.length === 0) {
      el.innerHTML = `<div class="empty-msg">All clear — no pending needs.</div>`;
      return;
    }

    el.innerHTML = needs
      .map((n) => {
        const isOpen = n.status === "open";
        return `
        <div class="need-card severity-${esc(n.severity)} ${isOpen ? "" : "resolved"}">
          <div style="display:flex;justify-content:space-between;gap:6px;align-items:center">
            <span class="need-title">${esc(n.botName)}: ${esc(n.title)}</span>
            <span class="st-pill ${isOpen ? (n.severity === "error" || n.severity === "budget" ? "st-error" : "st-waiting") : "st-working"}">${esc(isOpen ? n.severity : n.status)}</span>
          </div>
          ${n.description ? `<div class="need-desc">${esc(n.description)}</div>` : ""}
          ${
            isOpen
              ? `<div class="need-actions">
                  <input class="need-note" type="text" placeholder="Optional note…" data-note-for="${esc(n.id)}" />
                  <button class="btn-xs btn-approve" data-resolve="${esc(n.id)}" data-action="approve">Approve</button>
                  <button class="btn-xs btn-reject" data-resolve="${esc(n.id)}" data-action="reject">Reject</button>
                </div>`
              : `<div class="need-desc">Resolved${n.resolutionNote ? `: "${esc(n.resolutionNote)}"` : ""}</div>`
          }
        </div>`;
      })
      .join("");
  }

  function renderGoals() {
    const { settings, usageSummary, objectives = [], bots = [] } = snapshot;

    const costCap = settings?.dailyCostCapUsd || 10;
    const todayCost = usageSummary.todayCostUsd ?? 0;
    document.getElementById("sb-cost").textContent = `$${todayCost.toFixed(2)} / $${costCap.toFixed(2)}`;
    setBar("sb-cost-fill", (todayCost / costCap) * 100);

    const tokCap = settings?.dailyTokenCap || 500000;
    const todayTok = usageSummary.todayTokens ?? 0;
    document.getElementById("sb-tokens").textContent = `${formatNum(todayTok)} / ${formatNum(tokCap)}`;
    setBar("sb-tokens-fill", (todayTok / tokCap) * 100);

    const renderGoalCard = (o, compact) => {
      const done = o.status === "completed" || o.progress >= 100;
      return `
      <div class="goal-card">
        <div class="goal-top">
          <span>${esc(o.title)}</span>
          <span class="st-pill ${done ? "st-working" : "st-meeting"}">${o.progress}%</span>
        </div>
        <div class="goal-meta">${esc(o.ownerBotName || "Team")} · ${esc(o.targetLabel || "Milestone")}</div>
        <div class="pbar"><div class="pbar-fill ${done ? "green" : "blue"}" style="width:${o.progress}%"></div></div>
        ${
          compact
            ? ""
            : `<div class="goal-ctrls">
                <div style="display:flex;gap:5px">
                  ${
                    !done
                      ? `<button class="btn-xs" style="background:#1e293b;color:#f1f5f9" data-goal-bump="${esc(o.id)}" data-next="${Math.min(100, o.progress + 25)}">+25%</button>
                         <button class="btn-xs btn-approve" data-goal-bump="${esc(o.id)}" data-next="100">Done</button>`
                      : `<span class="muted" style="font-size:0.7rem">Completed</span>`
                  }
                </div>
                <button class="btn-xs btn-reject" data-goal-del="${esc(o.id)}">✕</button>
              </div>`
        }
      </div>`;
    };

    const sbList = document.getElementById("sidebar-goals-list");
    const modList = document.getElementById("modal-goals-list");
    if (objectives.length === 0) {
      sbList.innerHTML = `<div class="empty-msg">No objectives yet.</div>`;
      modList.innerHTML = `<div class="empty-msg">Add a team goal above to track progress.</div>`;
    } else {
      sbList.innerHTML = objectives.slice(0, 4).map((o) => renderGoalCard(o, true)).join("");
      modList.innerHTML = objectives.map((o) => renderGoalCard(o, false)).join("");
    }

    const ownerSel = document.getElementById("goal-owner-select");
    const prev = ownerSel.value;
    ownerSel.innerHTML =
      `<option value="">Unassigned</option>` +
      bots.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    ownerSel.value = prev;
  }

  function renderAnalyticsModal() {
    const { bots, pendingNeeds, settings, usageSummary } = snapshot;
    const active = bots.filter((b) => b.status === "working" || b.status === "meeting").length;
    const openNeeds = pendingNeeds.filter((n) => n.status === "open").length;

    document.getElementById("kpi-bots").textContent = `${active} / ${bots.length}`;
    document.getElementById("kpi-bots-sub").textContent = `${bots.length} bots registered`;

    document.getElementById("kpi-needs").textContent = String(openNeeds);
    document.getElementById("kpi-needs-sub").textContent = openNeeds > 0 ? "Action required" : "All clear";

    const target = settings?.dailyTaskTarget || 30;
    const done = usageSummary.todayTasksCompleted ?? 0;
    document.getElementById("kpi-tasks").textContent = `${done} / ${target}`;
    setBar("kpi-tasks-bar", (done / target) * 100);

    document.getElementById("kpi-tokens").textContent = formatNum(usageSummary.totalTokens);
    document.getElementById("kpi-tokens-sub").textContent =
      `${formatNum(usageSummary.totalTokensIn)} in · ${formatNum(usageSummary.totalTokensOut)} out`;

    document.getElementById("kpi-cost").textContent = `$${(usageSummary.todayCostUsd ?? 0).toFixed(4)}`;
    document.getElementById("kpi-requests").textContent = `${usageSummary.totalRequests} API requests`;

    document.getElementById("kpi-latency").textContent = `${usageSummary.avgLatencyMs} ms`;
    document.getElementById("kpi-health").textContent = `${usageSummary.errorRatePct ?? 0}% error rate`;

    const chartEl = document.getElementById("usage-chart");
    const timeline = usageSummary.timeline || [];
    if (timeline.length === 0) {
      chartEl.innerHTML = `<div class="muted" style="margin:auto;font-size:0.77rem">No usage data yet</div>`;
    } else {
      const vals = timeline.map((t) => (chartMode === "tokens" ? t.tokens : t.costUsd));
      const maxVal = Math.max(...vals, 0.0001);
      chartEl.innerHTML = timeline
        .map((t) => {
          const v = chartMode === "tokens" ? t.tokens : t.costUsd;
          const pct = Math.max(6, Math.round((v / maxVal) * 100));
          return `
          <div class="bar-col" title="${esc(t.label)}: ${formatNum(t.tokens)} tok ($${t.costUsd.toFixed(4)})">
            <div class="bar-fill" style="height:${pct}%"></div>
            <div class="bar-label">${esc(t.label)}</div>
          </div>`;
        })
        .join("");
    }

    const tbody = document.getElementById("model-tbody");
    const models = usageSummary.byModel || [];
    if (models.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">No usage events yet</td></tr>`;
    } else {
      tbody.innerHTML = models
        .map(
          (m) => `
          <tr>
            <td><strong>${esc(m.model)}</strong></td>
            <td>${m.requests}</td>
            <td>${formatNum(m.tokensIn)} / ${formatNum(m.tokensOut)}</td>
            <td>$${m.costUsd.toFixed(4)}</td>
          </tr>`
        )
        .join("");
    }
  }

  function renderInspector() {
    const el = document.getElementById("bot-inspector");
    if (!snapshot || !selectedBotId) {
      el.classList.add("hidden");
      return;
    }
    const bot = snapshot.bots.find((b) => b.id === selectedBotId);
    if (!bot) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="insp-head">
        <div>
          <strong>${esc(bot.name)}</strong> <span class="muted" style="font-size:0.75rem">· ${esc(bot.role)}</span>
          <div class="muted" style="font-size:0.71rem">${esc(bot.department)} · <code>${esc(bot.model)}</code></div>
        </div>
        <button id="btn-close-insp" class="btn-icon">✕</button>
      </div>
      <div style="font-size:0.78rem;margin:5px 0">${esc(bot.task || "Standing by")}</div>
      <div class="muted" style="font-size:0.71rem">
        ${formatNum(bot.tokensTotal)} tokens · $${bot.costTotalUsd.toFixed(4)} · ${bot.tasksCompleted} done · ${bot.requestsTotal} reqs
      </div>
      <div class="insp-actions">
        <button class="hud-btn" data-move-bot="${esc(bot.id)}" data-status="working">→ Desk</button>
        <button class="hud-btn" data-move-bot="${esc(bot.id)}" data-status="meeting">→ Meeting</button>
        <button class="hud-btn" data-move-bot="${esc(bot.id)}" data-status="idle">→ Lounge</button>
      </div>
    `;
  }

  // Controls & Event Listeners
  document.getElementById("btn-sim").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (simTimer) {
      clearInterval(simTimer);
      simTimer = null;
      btn.textContent = "Simulate";
      btn.classList.remove("active");
      renderHUD();
    } else {
      if (!snapshot || snapshot.bots.length === 0) {
        await fetch("/api/demo/seed", { method: "POST" });
      }
      simTimer = setInterval(() => fetch("/api/demo/tick", { method: "POST" }), 3200);
      btn.textContent = "Stop simulation";
      btn.classList.add("active");
      renderHUD();
    }
  });

  document.getElementById("btn-seed-mini").addEventListener("click", () => {
    fetch("/api/demo/seed", { method: "POST" });
  });

  document.getElementById("btn-reset-view").addEventListener("click", () => {
    office3d.resetView();
  });

  // Clean View Toggle
  const wsEl = document.getElementById("workspace");
  const exitCleanBtn = document.getElementById("btn-exit-clean");
  document.getElementById("btn-clean-view").addEventListener("click", () => {
    wsEl.classList.add("clean-mode");
    exitCleanBtn.classList.remove("hidden");
    setTimeout(() => office3d.handleResize(), 50);
  });
  exitCleanBtn.addEventListener("click", () => {
    wsEl.classList.remove("clean-mode");
    exitCleanBtn.classList.add("hidden");
    setTimeout(() => office3d.handleResize(), 50);
  });

  // Lighting & Camera Switchers
  document.querySelectorAll("[data-light]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-light]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      office3d.setLighting(btn.dataset.light);
    });
  });

  document.querySelectorAll("[data-cam]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-cam]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      office3d.setCameraMode(btn.dataset.cam);
    });
  });

  // Sidebar Team Filters & Bottom Tabs
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      teamFilter = btn.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTeamList();
    });
  });

  document.querySelectorAll("[data-stab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.stab;
      document.querySelectorAll("[data-stab]").forEach((b) => b.classList.toggle("active", b.dataset.stab === target));
      document.querySelectorAll(".stab-pane").forEach((p) => p.classList.toggle("active", p.id === `stab-${target}`));
    });
  });

  document.querySelectorAll("[data-chart-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chartMode = btn.dataset.chartMode;
      document.querySelectorAll("[data-chart-mode]").forEach((b) => b.classList.toggle("active", b.dataset.chartMode === chartMode));
      renderAnalyticsModal();
    });
  });

  // Modals
  const dashModal = document.getElementById("dashboard-modal");
  const connectModal = document.getElementById("connect-modal");
  const settingsModal = document.getElementById("settings-modal");

  const openDashboard = () => dashModal.classList.remove("hidden");
  document.getElementById("btn-analytics").addEventListener("click", openDashboard);
  document.getElementById("btn-open-dashboard-goals").addEventListener("click", openDashboard);
  document.getElementById("btn-close-dashboard").addEventListener("click", () => dashModal.classList.add("hidden"));
  dashModal.querySelector(".modal-backdrop").addEventListener("click", () => dashModal.classList.add("hidden"));

  document.getElementById("btn-connect").addEventListener("click", () => {
    const base = location.origin;
    document.getElementById("proxy-snippet").textContent =
`import OpenAI from "openai";

const grok = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "${base}/proxy/atlas-bot/v1",
  defaultHeaders: { "x-report-secret": "<YOUR_REPORT_SECRET>" }
});`;

    document.getElementById("ping-snippet").textContent =
`When starting a task, hitting a blocker, or finishing, call this 1-line URL (server auto-idles bots):
GET ${base}/api/ping?b=atlas&d=AI+News+Desk&s=w&t=Scanning+trends&token=<YOUR_REPORT_SECRET>
Status codes: w=working, i=idle, wait=waiting, m=meeting, e=error. Add &need=Title for approval.`;

    document.getElementById("report-snippet").textContent =
`POST ${base}/api/report
Authorization: Bearer <YOUR_REPORT_SECRET>
{
  "b": "atlas", "name": "Atlas", "d": "Analytics Lab",
  "s": "wait", "t": "Ready to publish weekly brief",
  "need": { "title": "Approve publish?", "severity": "approval" }
}`;
    connectModal.classList.remove("hidden");
  });
  document.getElementById("btn-close-connect").addEventListener("click", () => connectModal.classList.add("hidden"));
  connectModal.querySelector(".modal-backdrop").addEventListener("click", () => connectModal.classList.add("hidden"));

  document.getElementById("btn-open-guardrails").addEventListener("click", () => {
    const s = snapshot?.settings ?? { dailyCostCapUsd: 10, dailyTokenCap: 500000, dailyTaskTarget: 30, autoIdleMinutes: 5 };
    document.getElementById("set-cost-cap").value = s.dailyCostCapUsd;
    document.getElementById("set-token-cap").value = s.dailyTokenCap;
    document.getElementById("set-task-target").value = s.dailyTaskTarget;
    document.getElementById("set-auto-idle").value = s.autoIdleMinutes;
    settingsModal.classList.remove("hidden");
  });
  document.getElementById("btn-close-settings").addEventListener("click", () => settingsModal.classList.add("hidden"));
  settingsModal.querySelector(".modal-backdrop").addEventListener("click", () => settingsModal.classList.add("hidden"));

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dailyCostCapUsd: Number(document.getElementById("set-cost-cap").value),
        dailyTokenCap: Number(document.getElementById("set-token-cap").value),
        dailyTaskTarget: Number(document.getElementById("set-task-target").value),
        autoIdleMinutes: Number(document.getElementById("set-auto-idle").value),
      }),
    });
    settingsModal.classList.add("hidden");
  });

  document.getElementById("goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("goal-title-input").value.trim();
    const ownerBotId = document.getElementById("goal-owner-select").value || null;
    const targetLabel = document.getElementById("goal-target-input").value.trim();
    if (!title) return;
    await fetch("/api/objectives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, ownerBotId, targetLabel, progress: 0 }),
    });
    e.target.reset();
  });

  document.getElementById("btn-approve-all").addEventListener("click", () => {
    fetch("/api/needs/resolve-all", { method: "POST" });
  });

  // Delegated click handlers
  document.addEventListener("click", async (e) => {
    if (e.target.id === "btn-close-insp") {
      selectedBotId = null;
      renderInspector();
      renderTeamList();
      return;
    }

    const row = e.target.closest("[data-select-bot]");
    if (row) {
      office3d.selectBot(row.dataset.selectBot);
      return;
    }

    const moveBtn = e.target.closest("[data-move-bot]");
    if (moveBtn) {
      await fetch(`/api/bots/${encodeURIComponent(moveBtn.dataset.moveBot)}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: moveBtn.dataset.status }),
      });
      return;
    }

    const resolveBtn = e.target.closest("[data-resolve]");
    if (resolveBtn) {
      const id = resolveBtn.dataset.resolve;
      const action = resolveBtn.dataset.action;
      const noteEl = document.querySelector(`[data-note-for="${CSS.escape(id)}"]`);
      await fetch(`/api/needs/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: noteEl ? noteEl.value.trim() : "" }),
      });
      return;
    }

    const bumpBtn = e.target.closest("[data-goal-bump]");
    if (bumpBtn) {
      await fetch(`/api/objectives/${encodeURIComponent(bumpBtn.dataset.goalBump)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progress: Number(bumpBtn.dataset.next) }),
      });
      return;
    }

    const delBtn = e.target.closest("[data-goal-del]");
    if (delBtn) {
      await fetch(`/api/objectives/${encodeURIComponent(delBtn.dataset.goalDel)}`, {
        method: "DELETE",
      });
      return;
    }

    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
      const target = document.getElementById(copyBtn.dataset.target);
      if (target) {
        await navigator.clipboard.writeText(target.textContent);
        const orig = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = orig), 1500);
      }
    }
  });

  fetchSnapshotFallback();
  connectWS();
})();
