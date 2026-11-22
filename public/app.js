(() => {
  let snapshot = null;
  let selectedBotId = null;
  let activeView = "office";
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
    if (!iso) return "Waiting…";
    const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (diffSec < 10) return "Just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  function statusLabel(s) {
    if (s === "no_report") return "Standby";
    if (s === "meeting") return "War Room";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function setBar(elId, pct) {
    const el = document.getElementById(elId);
    if (!el) return;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    el.style.width = `${clamped}%`;
    el.classList.toggle("danger", pct >= 90);
  }

  function connectWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsDot = document.getElementById("ws-dot");
    const ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      wsDot.classList.add("live");
      wsDot.title = "Live WebSocket connected";
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "snapshot" && msg.data) applySnapshot(msg.data);
      } catch {
        // Ignore malformed frame
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
    renderRoomCounts();
    renderTeamList();
    renderActivity();
    renderMetricsPage();
    renderNeedsPage();
    if (selectedBotId) renderInspector();
  }

  function renderRoomCounts() {
    const { bots, pendingNeeds, usageSummary, lastBotUpdateAt } = snapshot;
    const working = bots.filter((b) => b.status === "working").length;
    const waiting = bots.filter((b) => b.status === "waiting").length;
    const err = bots.filter((b) => b.status === "error").length;
    const meeting = bots.filter((b) => b.status === "meeting").length;
    const idle = bots.filter((b) => b.status === "idle").length;
    const noreport = bots.filter((b) => b.status === "no_report").length;

    document.getElementById("cnt-all").textContent = String(bots.length);
    document.getElementById("cnt-working").textContent = String(working);
    document.getElementById("cnt-waiting").textContent = String(waiting);
    document.getElementById("cnt-error").textContent = String(err);
    document.getElementById("cnt-meeting").textContent = String(meeting);
    document.getElementById("cnt-idle").textContent = String(idle);
    document.getElementById("cnt-noreport").textContent = String(noreport);

    const openNeeds = (pendingNeeds || []).filter((n) => n.status === "open").length;
    const navBadge = document.getElementById("nav-needs-badge");
    navBadge.textContent = String(openNeeds);
    navBadge.classList.toggle("hidden", openNeeds === 0);

    document.getElementById("last-update-label").textContent = timeAgo(lastBotUpdateAt);
    document.getElementById("usage-left-pill").textContent =
      `Budget ${usageSummary?.usageRemainingPct ?? 100}% left`;

    const isSim = Boolean(simTimer) || snapshot.activityLogs.some((l) => l.simulated);
    const pill = document.getElementById("mode-pill");
    pill.textContent = isSim ? "SIMULATED" : "LIVE";
    pill.className = `mode-pill ${isSim ? "sim" : "live"}`;
  }

  function miniGrokIcon(color, shape) {
    const c = esc(color || "#3b93f0");
    let body = `<circle cx="12" cy="12" r="10" fill="${c}"/>`;
    if (shape === "squircle") body = `<rect x="2" y="2" width="20" height="20" rx="6" fill="${c}"/>`;
    else if (shape === "capsule") body = `<rect x="4" y="1.5" width="16" height="21" rx="8" fill="${c}"/>`;
    else if (shape === "triangle") body = `<path d="M12 2.5 L21.5 19.5 Q22 21 20 21 L4 21 Q2 21 2.5 19.5 Z" fill="${c}"/>`;
    else if (shape === "hexagon") body = `<polygon points="12,1.5 21,6.8 21,17.2 12,22.5 3,17.2 3,6.8" fill="${c}"/>`;
    else if (shape === "cloud") body = `<path d="M7 19h10a4.5 4.5 0 0 0 1-8.9A5.5 5.5 0 0 0 7.2 8.5 4.2 4.2 0 0 0 7 19z" fill="${c}"/>`;
    else if (shape === "droplet") body = `<path d="M12 2 C12 2 20 10.5 20 15 a8 8 0 0 1-16 0 C4 10.5 12 2 12 2z" fill="${c}"/>`;
    else if (shape === "pebble") body = `<ellipse cx="12" cy="12.5" rx="10.5" ry="9" transform="rotate(-8 12 12)" fill="${c}"/>`;
    return `<svg class="grok-mini" viewBox="0 0 24 24" width="24" height="24">${body}<ellipse cx="9.2" cy="12.2" rx="2.3" ry="2.8" fill="#fff"/><ellipse cx="14.8" cy="12.2" rx="2.3" ry="2.8" fill="#fff"/><circle cx="9.5" cy="12.3" r="1.2" fill="#0a0a0c"/><circle cx="15.1" cy="12.3" r="1.2" fill="#0a0a0c"/></svg>`;
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
      el.innerHTML = `<div class="empty-msg">No bots in this state.</div>`;
      return;
    }

    el.innerHTML = filtered
      .map(
        (b) => `
      <div class="team-row ${selectedBotId === b.id ? "selected" : ""}" data-select-bot="${esc(b.id)}">
        ${miniGrokIcon(b.avatarColor, b.avatarShape)}
        <div class="team-info">
          <div class="team-name">${esc(b.name)}</div>
          <div class="team-sub">${esc(b.task || "Standing by")}</div>
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
      el.innerHTML = `<div class="empty-msg">No activity yet.</div>`;
      return;
    }

    el.innerHTML = logs
      .slice(0, 20)
      .map((l) => {
        const ts = new Date(l.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return `
        <div class="act-item">
          <span class="bot-sq" style="background:${esc(l.botColor || "#38bdf8")};margin-top:5px"></span>
          <div style="min-width:0;flex:1">
            <div><strong>${esc(l.botName)}</strong> — ${esc(l.message)}</div>
            <div class="act-meta">${esc(ts)}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderMetricsPage() {
    const { bots, objectives = [], settings, usageSummary } = snapshot;

    // 4 Hero KPI Cards
    const costCap = settings?.dailyCostCapUsd || 10;
    const todayCost = usageSummary.todayCostUsd ?? 0;
    const remPct = usageSummary.usageRemainingPct ?? 100;
    document.getElementById("m-budget-pct").textContent = `${remPct}%`;
    setBar("m-budget-bar", (todayCost / costCap) * 100);
    document.getElementById("m-budget-foot").textContent =
      `$${todayCost.toFixed(2)} spent of $${costCap.toFixed(2)} daily cap`;

    const taskTarget = settings?.dailyTaskTarget || 30;
    const tasksDone = usageSummary.todayTasksCompleted ?? 0;
    const taskPct = Math.round((tasksDone / taskTarget) * 100);
    document.getElementById("m-tasks-val").textContent = `${tasksDone} / ${taskTarget}`;
    setBar("m-tasks-bar", taskPct);
    document.getElementById("m-tasks-foot").textContent = `${taskPct}% of daily target`;

    const tokCap = settings?.dailyTokenCap || 500000;
    const todayTok = usageSummary.todayTokens ?? 0;
    document.getElementById("m-tokens-val").textContent = formatNum(todayTok);
    setBar("m-tokens-bar", (todayTok / tokCap) * 100);
    document.getElementById("m-tokens-foot").textContent =
      `${formatNum(usageSummary.totalTokensIn)} in · ${formatNum(usageSummary.totalTokensOut)} out`;

    document.getElementById("m-latency-val").textContent = `${usageSummary.avgLatencyMs} ms`;
    document.getElementById("m-health-foot").textContent =
      `${usageSummary.errorRatePct ?? 0}% error rate · ${usageSummary.totalRequests} requests`;

    // Goals Grid
    const ownerSel = document.getElementById("goal-owner-select");
    const prev = ownerSel.value;
    ownerSel.innerHTML =
      `<option value="">Assign to bot (optional)</option>` +
      bots.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    ownerSel.value = prev;

    const goalsEl = document.getElementById("goals-grid");
    if (objectives.length === 0) {
      goalsEl.innerHTML = `<div class="empty-msg" style="grid-column:1/-1">No goals yet. Click <strong>+ New Goal</strong> above to add one.</div>`;
    } else {
      goalsEl.innerHTML = objectives
        .map((o) => {
          const done = o.status === "completed" || o.progress >= 100;
          return `
          <div class="goal-card">
            <div class="goal-top">
              <div class="goal-title">${esc(o.title)}</div>
              <span class="goal-pct ${done ? "done" : ""}">${o.progress}%</span>
            </div>
            <div class="goal-meta">${esc(o.ownerBotName || "Team")} · ${esc(o.targetLabel || "Milestone")}</div>
            <div class="pbar lg"><div class="pbar-fill ${done ? "green" : "blue"}" style="width:${o.progress}%"></div></div>
            <div class="goal-actions">
              <div style="display:flex;gap:8px">
                ${
                  !done
                    ? `<button class="btn btn-secondary" style="padding:5px 10px;font-size:0.78rem" data-goal-bump="${esc(o.id)}" data-next="${Math.min(100, o.progress + 25)}">+25%</button>
                       <button class="btn btn-approve" style="padding:5px 10px;font-size:0.78rem" data-goal-bump="${esc(o.id)}" data-next="100">Complete</button>`
                    : `<span class="st-pill st-working">Completed</span>`
                }
              </div>
              <button class="btn btn-reject" style="padding:5px 10px;font-size:0.78rem" data-goal-del="${esc(o.id)}">Remove</button>
            </div>
          </div>`;
        })
        .join("");
    }

    // Usage Chart
    const chartEl = document.getElementById("usage-chart");
    const timeline = usageSummary.timeline || [];
    if (timeline.length === 0) {
      chartEl.innerHTML = `<div class="muted" style="margin:auto">No usage timeline data yet</div>`;
    } else {
      const vals = timeline.map((t) => (chartMode === "tokens" ? t.tokens : t.costUsd));
      const maxVal = Math.max(...vals, 0.0001);
      chartEl.innerHTML = timeline
        .map((t) => {
          const v = chartMode === "tokens" ? t.tokens : t.costUsd;
          const pct = Math.max(8, Math.round((v / maxVal) * 100));
          return `
          <div class="bar-col" title="${esc(t.label)}: ${formatNum(t.tokens)} tokens ($${t.costUsd.toFixed(4)})">
            <div class="bar-fill" style="height:${pct}%"></div>
            <div class="bar-label">${esc(t.label)}</div>
          </div>`;
        })
        .join("");
    }

    // Model Spend Table
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
            <td>${formatNum(m.tokensIn + m.tokensOut)}</td>
            <td><strong>$${m.costUsd.toFixed(4)}</strong></td>
          </tr>`
        )
        .join("");
    }
  }

  function renderNeedsPage() {
    const needs = snapshot.pendingNeeds || [];
    const openSafe = needs.filter(
      (n) => n.status === "open" && (n.severity === "approval" || n.severity === "input")
    );
    document.getElementById("btn-approve-all").classList.toggle("hidden", openSafe.length < 2);

    const grid = document.getElementById("needs-grid");
    if (needs.length === 0) {
      grid.innerHTML = `<div class="empty-msg" style="grid-column:1/-1">All clear — no bots are currently waiting on you.</div>`;
      return;
    }

    grid.innerHTML = needs
      .map((n) => {
        const isOpen = n.status === "open";
        return `
        <div class="need-card severity-${esc(n.severity)} ${isOpen ? "" : "resolved"}">
          <div class="need-head">
            <span class="need-title">${esc(n.botName)} — ${esc(n.title)}</span>
            <span class="st-pill ${isOpen ? (n.severity === "error" || n.severity === "budget" ? "st-error" : "st-waiting") : "st-working"}">${esc(isOpen ? n.severity : n.status)}</span>
          </div>
          ${n.description ? `<div class="need-desc">${esc(n.description)}</div>` : ""}
          ${
            isOpen
              ? `<div class="need-actions">
                  <input class="need-note" type="text" placeholder="Optional instruction or note…" data-note-for="${esc(n.id)}" />
                  <button class="btn btn-approve" data-resolve="${esc(n.id)}" data-action="approve">Approve</button>
                  <button class="btn btn-reject" data-resolve="${esc(n.id)}" data-action="reject">Reject</button>
                </div>`
              : `<div class="need-desc">Resolved${n.resolutionNote ? ` — "${esc(n.resolutionNote)}"` : ""}</div>`
          }
        </div>`;
      })
      .join("");
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
          <span class="insp-name">${esc(bot.name)}</span>
          <span class="st-pill st-${esc(bot.status)}" style="margin-left:8px">${esc(statusLabel(bot.status))}</span>
        </div>
        <button id="btn-close-insp" class="btn-icon">✕</button>
      </div>
      <div class="insp-task">${esc(bot.task || "Standing by")}</div>
      <div class="insp-moves">
        <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="working">Workfloor</button>
        <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="waiting">Waiting</button>
        <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="meeting">War Room</button>
        <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="idle">Lounge</button>
      </div>
    `;
  }

  // Primary View Switcher
  function switchView(viewName) {
    activeView = viewName;
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === viewName)
    );
    document.querySelectorAll(".view-panel").forEach((p) =>
      p.classList.toggle("active", p.id === `view-${viewName}`)
    );
    document.querySelectorAll(".office-only").forEach((el) =>
      el.classList.toggle("hidden", viewName !== "office")
    );
    if (viewName === "office") {
      setTimeout(() => office3d.handleResize(), 40);
    }
  }

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // Room Jumper Bar
  document.querySelectorAll("[data-room]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-room]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      office3d.focusRoom(btn.dataset.room);
    });
  });

  // Simulation Toggle
  document.getElementById("btn-sim").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (simTimer) {
      clearInterval(simTimer);
      simTimer = null;
      btn.textContent = "Simulate";
      btn.classList.remove("active");
      renderRoomCounts();
    } else {
      if (!snapshot || snapshot.bots.length === 0) {
        await fetch("/api/demo/seed", { method: "POST" });
      }
      simTimer = setInterval(() => fetch("/api/demo/tick", { method: "POST" }), 3200);
      btn.textContent = "Stop simulation";
      btn.classList.add("active");
      renderRoomCounts();
    }
  });

  document.getElementById("btn-seed-mini").addEventListener("click", () => {
    fetch("/api/demo/seed", { method: "POST" });
  });

  document.getElementById("btn-reset-view").addEventListener("click", () => {
    document.querySelectorAll("[data-room]").forEach((b) =>
      b.classList.toggle("active", b.dataset.room === "all")
    );
    office3d.resetView();
  });

  document.getElementById("btn-toggle-labels").addEventListener("click", (e) => {
    office3d.showAllLabels = !office3d.showAllLabels;
    e.currentTarget.classList.toggle("active", office3d.showAllLabels);
  });

  // Clean View
  const appRoot = document.getElementById("app-root");
  const exitClean = document.getElementById("btn-exit-clean");
  document.getElementById("btn-clean-view").addEventListener("click", () => {
    appRoot.classList.add("clean-mode");
    exitClean.classList.remove("hidden");
    setTimeout(() => office3d.handleResize(), 50);
  });
  exitClean.addEventListener("click", () => {
    appRoot.classList.remove("clean-mode");
    exitClean.classList.add("hidden");
    setTimeout(() => office3d.handleResize(), 50);
  });

  // Lighting & Camera Controls
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

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      teamFilter = btn.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTeamList();
    });
  });

  document.querySelectorAll("[data-chart-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chartMode = btn.dataset.chartMode;
      document.querySelectorAll("[data-chart-mode]").forEach((b) =>
        b.classList.toggle("active", b.dataset.chartMode === chartMode)
      );
      renderMetricsPage();
    });
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

  // Modals (Connect & Guardrails)
  const connectModal = document.getElementById("connect-modal");
  const settingsModal = document.getElementById("settings-modal");

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
`Call this 1-line URL only when changing state (server auto-idles bots to the Coffee Lounge):
GET ${base}/api/ping?b=atlas&s=w&t=Short+task&token=<YOUR_REPORT_SECRET>
Status codes: w=Workfloor, wait=Waiting Room, e=Repair Bay, m=War Room, i=Lounge. Add &need=Title for approval.`;

    document.getElementById("report-snippet").textContent =
`POST ${base}/api/report
Authorization: Bearer <YOUR_REPORT_SECRET>
{
  "b": "atlas", "name": "Atlas", "s": "wait",
  "t": "Ready to publish report",
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

  document.getElementById("btn-approve-all").addEventListener("click", () => {
    fetch("/api/needs/resolve-all", { method: "POST" });
  });

  // Delegated click actions
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
