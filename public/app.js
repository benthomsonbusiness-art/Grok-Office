(() => {
  let snapshot = null;
  let selectedBotId = null;
  let needFilter = "all";
  let chartMode = "tokens";
  let autoSimTimer = null;

  const canvas = document.getElementById("office-canvas");
  const tooltip = document.getElementById("bot-tooltip");

  const office = new window.OfficeRenderer(canvas, tooltip, (botId) => {
    selectedBotId = botId;
    activateTab("inspector");
    renderInspector(botId);
  });

  function formatNum(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    const pill = document.getElementById("ws-status");
    const label = document.getElementById("ws-label");

    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => {
      pill.classList.add("live");
      label.textContent = "LIVE";
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
      pill.classList.remove("live");
      label.textContent = "Reconnecting…";
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
    office.updateBots(data.bots || []);
    renderDashboard();
  }

  function renderDashboard() {
    if (!snapshot) return;
    const { bots, pendingNeeds, activityLogs, objectives = [], settings, usageSummary } = snapshot;

    // 1. KPIs
    const workingCount = bots.filter((b) => b.status === "working" || b.status === "meeting").length;
    const errorBots = bots.filter((b) => b.status === "error").length;
    const openNeeds = pendingNeeds.filter((n) => n.status === "open");
    const openApprovals = openNeeds.filter((n) => n.severity === "approval" || n.severity === "input");

    document.getElementById("kpi-bots").textContent = `${workingCount} / ${bots.length}`;
    document.getElementById("kpi-bots-sub").textContent =
      errorBots > 0 ? `${errorBots} bot(s) need attention` : `${bots.length} bots registered`;

    const needsCard = document.getElementById("kpi-needs-card");
    document.getElementById("kpi-needs").textContent = String(openNeeds.length);
    document.getElementById("kpi-needs-sub").textContent =
      openNeeds.length > 0 ? "Human decision needed" : "All clear";
    needsCard.classList.toggle("alert", openNeeds.length > 0);

    const taskTarget = settings?.dailyTaskTarget || 25;
    const tasksDone = usageSummary.todayTasksCompleted ?? usageSummary.totalTasksCompleted ?? 0;
    const taskPct = Math.round((tasksDone / taskTarget) * 100);
    document.getElementById("kpi-tasks").textContent = `${tasksDone} / ${taskTarget}`;
    setBar("kpi-tasks-bar", taskPct);
    document.getElementById("kpi-tasks-sub").textContent = `${taskPct}% of daily goal`;

    const tokenCap = settings?.dailyTokenCap || 500000;
    const todayTokens = usageSummary.todayTokens ?? usageSummary.totalTokens;
    const tokenPct = (todayTokens / tokenCap) * 100;
    document.getElementById("kpi-tokens").textContent = formatNum(usageSummary.totalTokens);
    setBar("kpi-tokens-bar", tokenPct);
    document.getElementById("kpi-tokens-sub").textContent =
      `${formatNum(usageSummary.totalTokensIn)} in · ${formatNum(usageSummary.totalTokensOut)} out`;

    const costCap = settings?.dailyCostCapUsd || 10;
    const todayCost = usageSummary.todayCostUsd ?? usageSummary.totalCostUsd;
    const costPct = (todayCost / costCap) * 100;
    document.getElementById("kpi-cost").textContent = `$${todayCost.toFixed(4)}`;
    setBar("kpi-cost-bar", costPct);
    document.getElementById("kpi-requests").textContent =
      `${usageSummary.totalRequests} reqs · cap $${costCap.toFixed(2)}/d`;

    document.getElementById("kpi-latency").textContent = `${usageSummary.avgLatencyMs} ms`;
    document.getElementById("kpi-health").textContent =
      `${usageSummary.errorRatePct ?? 0}% error rate`;

    // 2. Pending Needs Queue
    const badge = document.getElementById("open-needs-badge");
    badge.textContent = `${openNeeds.length} open`;
    badge.className = `badge ${openNeeds.length > 0 ? "badge-warn" : "badge-neutral"}`;

    const approveAllBtn = document.getElementById("btn-approve-all");
    approveAllBtn.classList.toggle("hidden", openApprovals.length < 2);

    const filteredNeeds = pendingNeeds.filter((n) => {
      if (needFilter === "open") return n.status === "open";
      if (needFilter === "error") return n.severity === "error" || n.severity === "budget";
      return true;
    });

    const needsList = document.getElementById("needs-list");
    if (filteredNeeds.length === 0) {
      needsList.innerHTML =
        `<div class="empty-state">No matching pending needs. Click <strong>Seed Demo Team</strong> or connect a Grok Bot.</div>`;
    } else {
      needsList.innerHTML = filteredNeeds
        .map((n) => {
          const isOpen = n.status === "open";
          return `
          <div class="need-card severity-${esc(n.severity)} ${isOpen ? "" : "resolved"}">
            <div class="need-top">
              <span class="need-title">${esc(n.botName)}: ${esc(n.title)}</span>
              <span class="badge ${
                isOpen
                  ? n.severity === "error" || n.severity === "budget"
                    ? "badge-error"
                    : "badge-warn"
                  : "badge-ok"
              }">${esc(isOpen ? n.severity.toUpperCase() : n.status.toUpperCase())}</span>
            </div>
            ${n.description ? `<div class="need-desc">${esc(n.description)}</div>` : ""}
            ${
              isOpen
                ? `<div class="need-actions">
                    <input class="need-note" type="text" placeholder="Optional reply/note…" data-note-for="${esc(n.id)}" />
                    <button class="btn-sm btn-approve" data-resolve="${esc(n.id)}" data-action="approve">Approve</button>
                    <button class="btn-sm btn-reject" data-resolve="${esc(n.id)}" data-action="reject">Reject</button>
                  </div>`
                : `<div class="need-desc">Resolved${n.resolutionNote ? `: "${esc(n.resolutionNote)}"` : ""}</div>`
            }
          </div>`;
        })
        .join("");
    }

    // 3. Goals & Objectives
    const ownerSelect = document.getElementById("goal-owner-select");
    const prevOwner = ownerSelect.value;
    ownerSelect.innerHTML =
      `<option value="">Unassigned</option>` +
      bots.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    ownerSelect.value = prevOwner;

    const goalsList = document.getElementById("goals-list");
    if (objectives.length === 0) {
      goalsList.innerHTML = `<div class="empty-state">No team objectives yet. Click <strong>+ Add Goal</strong> above.</div>`;
    } else {
      goalsList.innerHTML = objectives
        .map((o) => {
          const isDone = o.status === "completed" || o.progress >= 100;
          return `
          <div class="goal-card">
            <div class="goal-top">
              <div>
                <div class="goal-title">${esc(o.title)}</div>
                <div class="goal-meta">${esc(o.ownerBotName || "Team")} · ${esc(o.targetLabel || "Milestone")}</div>
              </div>
              <span class="badge ${isDone ? "badge-ok" : "badge-purple"}">${o.progress}%</span>
            </div>
            <div class="kpi-bar"><div class="kpi-bar-fill ${isDone ? "green" : "blue"}" style="width:${o.progress}%"></div></div>
            <div class="goal-controls">
              <div style="display:flex;gap:5px">
                ${
                  !isDone
                    ? `<button class="btn-xs btn-secondary" data-goal-bump="${esc(o.id)}" data-next="${Math.min(100, o.progress + 25)}">+25%</button>
                       <button class="btn-xs btn-approve" data-goal-bump="${esc(o.id)}" data-next="100">Done</button>`
                    : `<span class="muted" style="font-size:0.72rem">Completed</span>`
                }
              </div>
              <button class="btn-xs btn-reject" data-goal-del="${esc(o.id)}">✕</button>
            </div>
          </div>`;
        })
        .join("");
    }

    // 4. Usage Analytics Chart + Table
    const chartEl = document.getElementById("usage-chart");
    const timeline = usageSummary.timeline;
    document.getElementById("chart-title").textContent =
      chartMode === "tokens" ? "Recent Token Volume" : "Recent Spend ($ USD)";

    if (timeline.length === 0) {
      chartEl.innerHTML = `<div class="muted" style="margin:auto;font-size:0.78rem">No usage timeline data yet</div>`;
    } else {
      const vals = timeline.map((t) => (chartMode === "tokens" ? t.tokens : t.costUsd));
      const maxVal = Math.max(...vals, 0.0001);
      chartEl.innerHTML = timeline
        .map((t) => {
          const v = chartMode === "tokens" ? t.tokens : t.costUsd;
          const pct = Math.max(6, Math.round((v / maxVal) * 100));
          return `
          <div class="bar-col" title="${esc(t.label)}: ${formatNum(t.tokens)} tokens ($${t.costUsd.toFixed(4)})">
            <div class="bar-fill" style="height:${pct}%"></div>
            <div class="bar-label">${esc(t.label)}</div>
          </div>`;
        })
        .join("");
    }

    const modelTbody = document.getElementById("model-tbody");
    if (usageSummary.byModel.length === 0) {
      modelTbody.innerHTML = `<tr><td colspan="4" class="muted">No usage events yet</td></tr>`;
    } else {
      modelTbody.innerHTML = usageSummary.byModel
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

    // 5. Roster & Activity Feed
    const rosterEl = document.getElementById("roster-list");
    if (bots.length === 0) {
      rosterEl.innerHTML = `<div class="empty-state">No bots registered yet.</div>`;
    } else {
      rosterEl.innerHTML = bots
        .map(
          (b) => `
          <div class="roster-item" data-inspect-bot="${esc(b.id)}">
            <div class="roster-left">
              <span class="avatar-dot" style="background:${esc(b.avatarColor)}"></span>
              <div style="min-width:0">
                <div style="font-weight:600;font-size:0.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.name)} <span class="muted" style="font-weight:400">· ${esc(b.role)}</span></div>
                <div class="muted" style="font-size:0.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.task || "Lounge")}</div>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span class="badge ${
                b.status === "error"
                  ? "badge-error"
                  : b.status === "waiting"
                  ? "badge-warn"
                  : b.status === "working"
                  ? "badge-ok"
                  : b.status === "meeting"
                  ? "badge-purple"
                  : "badge-neutral"
              }">${esc(b.status)}</span>
              <div class="muted" style="font-size:0.7rem;margin-top:3px">${formatNum(b.tokensTotal)} tok · $${b.costTotalUsd.toFixed(3)}</div>
            </div>
          </div>`
        )
        .join("");
    }

    const feedEl = document.getElementById("feed-list");
    if (activityLogs.length === 0) {
      feedEl.innerHTML = `<div class="empty-state">No activity logged yet.</div>`;
    } else {
      feedEl.innerHTML = activityLogs
        .map(
          (l) => `
          <div class="feed-item level-${esc(l.level)}">
            <strong>${esc(l.botName)}</strong>: ${esc(l.message)}
            <span class="muted" style="float:right">${new Date(l.createdAt).toLocaleTimeString()}</span>
          </div>`
        )
        .join("");
    }

    if (selectedBotId) {
      renderInspector(selectedBotId);
    }
  }

  function renderInspector(botId) {
    if (!snapshot) return;
    office.setSelectedBot(botId);
    const bot = snapshot.bots.find((b) => b.id === botId);
    const el = document.getElementById("inspector-body");
    if (!bot) {
      el.innerHTML = `<div class="empty-state">Bot not found.</div>`;
      return;
    }
    const logs = snapshot.activityLogs.filter((l) => l.botId === botId).slice(0, 6);
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <h3 style="margin:0;font-size:0.96rem">${esc(bot.name)}</h3>
          <div class="muted" style="font-size:0.74rem">${esc(bot.role)} · <code>${esc(bot.model)}</code></div>
        </div>
        <span class="badge badge-neutral">${esc(bot.status.toUpperCase())}</span>
      </div>
      <div class="inspector-actions">
        <button class="btn-xs btn-secondary" data-move-bot="${esc(bot.id)}" data-status="working">→ Desk</button>
        <button class="btn-xs btn-secondary" data-move-bot="${esc(bot.id)}" data-status="meeting">→ Boardroom</button>
        <button class="btn-xs btn-secondary" data-move-bot="${esc(bot.id)}" data-status="idle">→ Lounge</button>
      </div>
      <div style="background:#090e1a;border:1px solid #1e293b;border-radius:8px;padding:9px;font-size:0.78rem;margin-bottom:8px">
        <div><strong>Task:</strong> ${esc(bot.task || "None")}</div>
        <div class="muted" style="margin-top:4px">
          Tokens: ${formatNum(bot.tokensTotal)} · Cost: $${bot.costTotalUsd.toFixed(4)} · Done: ${bot.tasksCompleted} · Errors: ${bot.errorCount}
        </div>
      </div>
      <div style="font-size:0.73rem;color:var(--muted);margin-bottom:5px">Recent Logs</div>
      <div class="feed-list">
        ${logs
          .map((l) => `<div class="feed-item level-${esc(l.level)}">${esc(l.message)}</div>`)
          .join("") || `<div class="muted">No logs yet</div>`}
      </div>
    `;
  }

  function activateTab(name) {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab-pane").forEach((p) => {
      p.classList.toggle("active", p.id === `tab-${name}`);
    });
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  document.querySelectorAll("[data-need-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      needFilter = btn.dataset.needFilter;
      document.querySelectorAll("[data-need-filter]").forEach((b) =>
        b.classList.toggle("active", b.dataset.needFilter === needFilter)
      );
      renderDashboard();
    });
  });

  document.querySelectorAll("[data-chart-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chartMode = btn.dataset.chartMode;
      document.querySelectorAll("[data-chart-mode]").forEach((b) =>
        b.classList.toggle("active", b.dataset.chartMode === chartMode)
      );
      renderDashboard();
    });
  });

  // Event delegation for actions
  document.addEventListener("click", async (e) => {
    const resolveBtn = e.target.closest("[data-resolve]");
    if (resolveBtn) {
      const needId = resolveBtn.dataset.resolve;
      const action = resolveBtn.dataset.action;
      const noteInput = document.querySelector(`[data-note-for="${CSS.escape(needId)}"]`);
      const note = noteInput ? noteInput.value.trim() : "";
      await fetch(`/api/needs/${encodeURIComponent(needId)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
    }

    const rosterItem = e.target.closest("[data-inspect-bot]");
    if (rosterItem) {
      selectedBotId = rosterItem.dataset.inspectBot;
      activateTab("inspector");
      renderInspector(selectedBotId);
    }

    const moveBtn = e.target.closest("[data-move-bot]");
    if (moveBtn) {
      await fetch(`/api/bots/${encodeURIComponent(moveBtn.dataset.moveBot)}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: moveBtn.dataset.status }),
      });
    }

    const bumpBtn = e.target.closest("[data-goal-bump]");
    if (bumpBtn) {
      await fetch(`/api/objectives/${encodeURIComponent(bumpBtn.dataset.goalBump)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progress: Number(bumpBtn.dataset.next) }),
      });
    }

    const delGoalBtn = e.target.closest("[data-goal-del]");
    if (delGoalBtn) {
      await fetch(`/api/objectives/${encodeURIComponent(delGoalBtn.dataset.goalDel)}`, {
        method: "DELETE",
      });
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

  // Topbar & Modal Actions
  document.getElementById("btn-seed").addEventListener("click", () => {
    fetch("/api/demo/seed", { method: "POST" });
  });

  document.getElementById("btn-tick").addEventListener("click", () => {
    fetch("/api/demo/tick", { method: "POST" });
  });

  document.getElementById("btn-approve-all").addEventListener("click", () => {
    fetch("/api/needs/resolve-all", { method: "POST" });
  });

  document.getElementById("btn-autosim").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (autoSimTimer) {
      clearInterval(autoSimTimer);
      autoSimTimer = null;
      btn.textContent = "Auto-Sim: Off";
      btn.classList.remove("active");
    } else {
      autoSimTimer = setInterval(() => fetch("/api/demo/tick", { method: "POST" }), 3500);
      btn.textContent = "Auto-Sim: On";
      btn.classList.add("active");
    }
  });

  // Goal Form
  const goalForm = document.getElementById("goal-form");
  document.getElementById("btn-toggle-goal-form").addEventListener("click", () => {
    goalForm.classList.toggle("hidden");
  });

  goalForm.addEventListener("submit", async (e) => {
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
    goalForm.reset();
    goalForm.classList.add("hidden");
  });

  // Connect Modal
  const connectModal = document.getElementById("connect-modal");
  document.getElementById("btn-connect").addEventListener("click", () => {
    const base = location.origin;
    document.getElementById("proxy-snippet").textContent =
`import OpenAI from "openai";

const grok = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "${base}/proxy/atlas-research/v1",
  defaultHeaders: { "x-report-secret": "<YOUR_REPORT_SECRET>" }
});`;

    document.getElementById("ping-snippet").textContent =
`Only call this tiny URL when starting, needing approval, or finishing (server auto-idles inactive bots):
GET ${base}/api/ping?b=atlas&s=w&t=Short+task+note&token=<YOUR_REPORT_SECRET>
(Status codes: w=working, i=idle, wait=waiting, m=meeting, e=error. Add &need=Title to request approval.)`;

    document.getElementById("prompt-snippet").textContent =
`POST ${base}/api/report
Headers: Authorization: Bearer <YOUR_REPORT_SECRET>
{
  "b": "atlas",
  "s": "wait",
  "t": "Ready to publish report",
  "need": { "title": "Approve publish?", "severity": "approval" }
}`;

    connectModal.classList.remove("hidden");
  });

  document.getElementById("btn-close-modal").addEventListener("click", () => {
    connectModal.classList.add("hidden");
  });
  connectModal.querySelector(".modal-backdrop").addEventListener("click", () => {
    connectModal.classList.add("hidden");
  });

  // Guardrails / Settings Modal
  const settingsModal = document.getElementById("settings-modal");
  document.getElementById("btn-settings").addEventListener("click", () => {
    const s = snapshot?.settings ?? {
      dailyCostCapUsd: 10,
      dailyTokenCap: 500000,
      dailyTaskTarget: 25,
      autoIdleMinutes: 5,
    };
    document.getElementById("set-cost-cap").value = s.dailyCostCapUsd;
    document.getElementById("set-token-cap").value = s.dailyTokenCap;
    document.getElementById("set-task-target").value = s.dailyTaskTarget;
    document.getElementById("set-auto-idle").value = s.autoIdleMinutes;
    settingsModal.classList.remove("hidden");
  });

  document.getElementById("btn-close-settings").addEventListener("click", () => {
    settingsModal.classList.add("hidden");
  });
  settingsModal.querySelector(".modal-backdrop").addEventListener("click", () => {
    settingsModal.classList.add("hidden");
  });

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

  fetchSnapshotFallback();
  connectWS();
})();
