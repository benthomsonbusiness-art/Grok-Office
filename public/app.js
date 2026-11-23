(() => {
  let snapshot = null;
  let selectedBotId = null;
  let activeView = "office";
  let teamFilter = "all";
  let actFilter = "all";
  let actSearch = "";
  let chartMode = "tokens";
  let fleetFilter = "all";
  let soundEnabled = localStorage.getItem("grok_hq_chime") !== "off";
  let knownOpenNeedIds = new Set();
  let firstSnapshotLoaded = false;

  const stageEl = document.getElementById("office-3d-stage");
  const labelLayer = document.getElementById("label-layer");
  const tooltipEl = document.getElementById("bot-tooltip");

  const office3d = new window.Office3D(stageEl, labelLayer, tooltipEl, (botId) => {
    selectedBotId = botId;
    renderInspector();
    renderTeamList();
    if (actFilter === "bot") renderActivity();
  });

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeHttpsUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  }

  function formatNum(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n ?? 0);
  }

  function formatDuration(sec) {
    if (!sec || sec <= 0) return "—";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
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

  function playAlertChime(isError = false) {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isError ? "sawtooth" : "sine";
      osc.frequency.setValueAtTime(isError ? 420 : 587.33, now);
      osc.frequency.exponentialRampToValueAtTime(isError ? 280 : 880, now + 0.22);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    } catch {
      // Ignore autoplay errors
    }
  }

  const soundBtn = document.getElementById("btn-sound-toggle");
  function updateSoundBtn() {
    if (!soundBtn) return;
    soundBtn.textContent = soundEnabled ? "🔔 Chime: On" : "🔕 Chime: Off";
  }
  updateSoundBtn();
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem("grok_hq_chime", soundEnabled ? "on" : "off");
      updateSoundBtn();
      if (soundEnabled) playAlertChime(false);
    });
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

    const openNeeds = (data.pendingNeeds || []).filter((n) => n.status === "open");
    let newUrgent = false;
    let newIsError = false;
    openNeeds.forEach((n) => {
      if (!knownOpenNeedIds.has(n.id)) {
        knownOpenNeedIds.add(n.id);
        if (firstSnapshotLoaded) {
          newUrgent = true;
          if (n.severity === "error" || n.severity === "budget") newIsError = true;
        }
      }
    });
    firstSnapshotLoaded = true;
    if (newUrgent) playAlertChime(newIsError);

    document.title =
      openNeeds.length > 0
        ? `(${openNeeds.length}) Grok Bot HQ — Argon 3D Command Center`
        : "Grok Bot HQ — Argon 3D Command Center";

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
    renderFleet();
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
      usageSummary?.budgetLocked
        ? "CAP LOCKED (429)"
        : `Budget ${usageSummary?.usageRemainingPct ?? 100}% left`;

    const pill = document.getElementById("mode-pill");
    if (usageSummary?.budgetLocked) {
      pill.textContent = "CAP STOP";
      pill.className = "mode-pill locked";
    } else {
      pill.textContent = "LIVE";
      pill.className = "mode-pill live";
    }
  }

  function miniGrokIcon(color) {
    const c = esc(color || "#3b93f0");
    return `<svg class="grok-mini" viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="1.5" width="20" height="21" rx="7" fill="${c}"/><ellipse cx="9" cy="11.6" rx="2.4" ry="3" fill="#fff"/><ellipse cx="15" cy="11.6" rx="2.4" ry="3" fill="#fff"/><circle cx="9.3" cy="11.8" r="1.25" fill="#0a0a0c"/><circle cx="15.3" cy="11.8" r="1.25" fill="#0a0a0c"/></svg>`;
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
        ${miniGrokIcon(b.avatarColor)}
        <div class="team-info">
          <div class="team-name">${esc(b.name)} <span class="muted" style="font-weight:500;font-size:0.74rem">· ${esc(b.role)}</span></div>
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
    const q = actSearch.trim().toLowerCase();

    const filtered = logs.filter((l) => {
      if (actFilter === "error" && l.level !== "error" && l.status !== "error") return false;
      if (actFilter === "warn" && l.level !== "warn" && l.status !== "waiting") return false;
      if (actFilter === "success" && l.level !== "success") return false;
      if (actFilter === "bot" && selectedBotId && l.botId !== selectedBotId) return false;
      if (q) {
        const hay = `${l.botName} ${l.message} ${l.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      el.innerHTML = `<div class="empty-msg">No matching activity logs.</div>`;
      return;
    }

    el.innerHTML = filtered
      .slice(0, 50)
      .map((l) => {
        const ts = new Date(l.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return `
        <div class="act-item lvl-${esc(l.level || "info")}" data-select-bot="${esc(l.botId)}">
          <span class="bot-sq" style="background:${esc(l.botColor || "#38bdf8")};margin-top:4px"></span>
          <div style="min-width:0;flex:1">
            <div><strong>${esc(l.botName)}</strong> — ${esc(l.message)}</div>
            <div class="act-meta">${esc(ts)} · ${esc(timeAgo(l.createdAt))}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderGradeButtons(run) {
    return `
      <span class="grade-row">
        <button class="grade-btn ${run.qualityRating === 1 ? "active-up" : ""}" data-rate-run="${esc(run.id)}" data-rating="${run.qualityRating === 1 ? 0 : 1}" title="Good run (👍)">👍</button>
        <button class="grade-btn ${run.qualityRating === -1 ? "active-down" : ""}" data-rate-run="${esc(run.id)}" data-rating="${run.qualityRating === -1 ? 0 : -1}" title="Silent failure / bad run (👎)">👎</button>
      </span>`;
  }

  function renderMetricsPage() {
    const { bots = [], recentRuns = [], objectives = [], settings, usageSummary } = snapshot;

    // Daily Executive Digest Strip
    document.getElementById("dig-cost-per-task").textContent =
      `$${(usageSummary.costPerCompletedTaskUsd ?? 0).toFixed(4)}`;
    document.getElementById("dig-quality").textContent =
      usageSummary.fleetQualityPct !== null && usageSummary.fleetQualityPct !== undefined
        ? `${usageSummary.fleetQualityPct}%`
        : "—";
    document.getElementById("dig-approvals").textContent = String(
      usageSummary.approvalsResolvedToday ?? 0
    );
    document.getElementById("dig-failed").textContent = String(
      usageSummary.failedRunsToday ?? 0
    );
    document.getElementById("dig-top-bot").textContent = usageSummary.topBotName || "—";

    // 4 Hero KPI Cards
    const costCap = settings?.dailyCostCapUsd || 10;
    const todayCost = usageSummary.todayCostUsd ?? 0;
    const remPct = usageSummary.usageRemainingPct ?? 100;
    document.getElementById("m-budget-pct").textContent = `${remPct}%`;
    setBar("m-budget-bar", (todayCost / costCap) * 100);
    document.getElementById("m-budget-foot").textContent =
      `$${todayCost.toFixed(2)} spent of $${costCap.toFixed(2)} daily cap${usageSummary.budgetLocked ? " (LOCKED)" : ""}`;

    const taskTarget = settings?.dailyTaskTarget || 30;
    const tasksDone = usageSummary.todayTasksCompleted ?? 0;
    const taskPct = Math.round((tasksDone / taskTarget) * 100);
    document.getElementById("m-tasks-val").textContent = `${tasksDone} / ${taskTarget}`;
    setBar("m-tasks-bar", taskPct);
    document.getElementById("m-tasks-foot").textContent = `${taskPct}% of daily target (${usageSummary.totalTasksCompleted ?? 0} total)`;

    const tokCap = settings?.dailyTokenCap || 500000;
    const todayTok = usageSummary.todayTokens ?? 0;
    document.getElementById("m-tokens-val").textContent = formatNum(todayTok);
    setBar("m-tokens-bar", (todayTok / tokCap) * 100);
    document.getElementById("m-tokens-foot").textContent =
      `${formatNum(usageSummary.totalTokensIn)} in · ${formatNum(usageSummary.totalTokensOut)} out`;

    document.getElementById("m-latency-val").textContent = `${usageSummary.avgLatencyMs} ms`;
    document.getElementById("m-health-foot").textContent =
      `p95 ${usageSummary.p95LatencyMs ?? 0} ms · ${usageSummary.errorRatePct ?? 0}% errors · ${usageSummary.totalRequests} req`;

    // Per-Agent Performance & Spend Leaderboard
    const leaderTbody = document.getElementById("agent-leaderboard-tbody");
    if (bots.length === 0) {
      leaderTbody.innerHTML = `<tr><td colspan="11" class="muted">No agents registered yet. Click <strong>+ Add Bot</strong> in the 3D Office or <strong>+ Connect</strong>.</td></tr>`;
    } else {
      const sortedBots = [...bots].sort(
        (a, b) => b.costTotalUsd - a.costTotalUsd || b.tasksCompleted - a.tasksCompleted
      );
      leaderTbody.innerHTML = sortedBots
        .map(
          (b) => `
          <tr data-jump-bot="${esc(b.id)}">
            <td>
              <div style="display:flex;align-items:center;gap:9px">
                ${miniGrokIcon(b.avatarColor)}
                <div>
                  <div style="font-weight:700">${esc(b.name)}</div>
                  <div class="muted" style="font-size:0.75rem">${esc(b.role)}</div>
                </div>
              </div>
            </td>
            <td><span class="st-pill st-${esc(b.status)}">${esc(statusLabel(b.status))}</span></td>
            <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(b.task)}">${esc(b.task || "Standing by")}</td>
            <td><span class="model-chip">${esc(b.model)}</span></td>
            <td><strong>${b.tasksCompleted}</strong></td>
            <td class="muted">${esc(formatDuration(b.avgDurationSec))}</td>
            <td>${b.qualityScorePct !== null && b.qualityScorePct !== undefined ? `<strong style="color:${b.qualityScorePct >= 80 ? "#34d399" : "#fbbf24"}">${b.qualityScorePct}%</strong>` : `<span class="muted">—</span>`}</td>
            <td>${formatNum(b.tokensTotal)}</td>
            <td><strong>$${b.costTotalUsd.toFixed(4)}</strong></td>
            <td>${b.errorCount > 0 ? `<span style="color:#fb7185;font-weight:700">${b.errorCount}</span>` : `<span class="muted">0</span>`}</td>
            <td class="muted">${esc(timeAgo(b.lastSeenAt))}</td>
          </tr>`
        )
        .join("");
    }

    // Recent Runs & Deliverables Table
    const runsTbody = document.getElementById("runs-tbody");
    if (recentRuns.length === 0) {
      runsTbody.innerHTML = `<tr><td colspan="6" class="muted">No task runs recorded yet.</td></tr>`;
    } else {
      runsTbody.innerHTML = recentRuns
        .slice(0, 20)
        .map((r) => {
          const safeUrl = r.outputUrl ? safeHttpsUrl(r.outputUrl) : null;
          const runPill =
            r.status === "completed"
              ? "st-working"
              : r.status === "failed"
              ? "st-error"
              : "st-idle";
          return `
          <tr>
            <td><strong>${esc(r.botName)}</strong></td>
            <td style="max-width:300px">
              <div style="font-weight:600">${esc(r.task)}</div>
              ${r.resultSummary ? `<div class="muted" style="font-size:0.75rem">${esc(r.resultSummary)}</div>` : ""}
            </td>
            <td><span class="st-pill ${runPill}">${esc(r.status)}</span></td>
            <td class="muted">${esc(formatDuration(r.durationSec))}</td>
            <td>${safeUrl ? `<a class="deliv-link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Open output ↗</a>` : `<span class="muted">—</span>`}</td>
            <td>${renderGradeButtons(r)}</td>
          </tr>`;
        })
        .join("");
    }

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
          const errTag = t.errors > 0 ? ` · ${t.errors} err` : "";
          return `
          <div class="bar-col" title="${esc(t.label)}: ${formatNum(t.tokens)} tokens · $${t.costUsd.toFixed(4)} · ${t.requests} req${errTag}">
            <div class="bar-fill ${t.errors > 0 ? "has-err" : ""}" style="height:${pct}%"></div>
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

    const botOpenNeed = (snapshot.pendingNeeds || []).find(
      (n) => n.botId === bot.id && n.status === "open"
    );
    const botRuns = (snapshot.recentRuns || [])
      .filter((r) => r.botId === bot.id)
      .slice(0, 3);
    const queued = bot.queuedTasks || [];

    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="insp-head">
        <div style="display:flex;align-items:center;gap:10px">
          ${miniGrokIcon(bot.avatarColor)}
          <div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="insp-name">${esc(bot.name)}</span>
              <span class="st-pill st-${esc(bot.status)}">${esc(statusLabel(bot.status))}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--cyan);font-weight:600;margin-top:2px">
              ${esc(bot.role || "Grok Bot")} · <span class="muted">${esc(bot.model)} · ${esc(timeAgo(bot.lastSeenAt))}</span>
            </div>
          </div>
        </div>
        <button id="btn-close-insp" class="btn-icon" title="Close inspector (Esc)">✕</button>
      </div>

      <div class="insp-task">${esc(bot.task || "Standing by")}</div>

      <div class="insp-kpis">
        <div class="insp-kpi"><span>Tasks</span><strong>${bot.tasksCompleted}</strong></div>
        <div class="insp-kpi"><span>Avg Dur</span><strong>${esc(formatDuration(bot.avgDurationSec))}</strong></div>
        <div class="insp-kpi"><span>Spend</span><strong>$${bot.costTotalUsd.toFixed(3)}</strong></div>
        <div class="insp-kpi"><span>Quality</span><strong style="${bot.errorCount > 0 ? "color:#fb7185" : ""}">${bot.qualityScorePct !== null && bot.qualityScorePct !== undefined ? `${bot.qualityScorePct}%` : `${bot.errorCount} err`}</strong></div>
      </div>

      ${
        botOpenNeed
          ? `<div class="insp-need-box ${botOpenNeed.severity === "error" ? "err" : ""}">
              <div style="font-size:0.78rem;font-weight:700">${esc(botOpenNeed.title)}</div>
              ${botOpenNeed.description ? `<div style="font-size:0.73rem;color:#cbd5e1">${esc(botOpenNeed.description)}</div>` : ""}
              <div style="display:flex;gap:6px;margin-top:2px">
                <input class="insp-input" type="text" placeholder="Note…" data-note-for="${esc(botOpenNeed.id)}" />
                <button class="btn btn-approve" style="padding:4px 9px;font-size:0.74rem" data-resolve="${esc(botOpenNeed.id)}" data-action="approve">Approve</button>
                <button class="btn btn-reject" style="padding:4px 9px;font-size:0.74rem" data-resolve="${esc(botOpenNeed.id)}" data-action="reject">Reject</button>
              </div>
            </div>`
          : ""
      }

      <div class="insp-form">
        <div class="insp-form-row">
          <input id="insp-task-input" class="insp-input" type="text" placeholder="Assign immediate task…" value="${esc(bot.task)}" />
          <button class="chip-btn active" data-save-bot-task="${esc(bot.id)}">Assign</button>
        </div>
        <div class="insp-form-row">
          <input id="insp-role-input" class="insp-input" type="text" placeholder="Role title…" value="${esc(bot.role)}" />
          <select id="insp-sla-select" class="insp-input" style="max-width:128px" data-save-bot-sla="${esc(bot.id)}" title="Expected check-in schedule SLA">
            <option value="0" ${bot.expectedIntervalMinutes === 0 ? "selected" : ""}>SLA: Off</option>
            <option value="15" ${bot.expectedIntervalMinutes === 15 ? "selected" : ""}>SLA: 15m</option>
            <option value="60" ${bot.expectedIntervalMinutes === 60 ? "selected" : ""}>SLA: 1h</option>
            <option value="360" ${bot.expectedIntervalMinutes === 360 ? "selected" : ""}>SLA: 6h</option>
            <option value="1440" ${bot.expectedIntervalMinutes === 1440 ? "selected" : ""}>SLA: 24h</option>
          </select>
          <button class="chip-btn" data-save-bot-role="${esc(bot.id)}">Save</button>
        </div>
      </div>

      <div class="insp-queue">
        <div style="font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase">Dispatch Queue (${queued.length})</div>
        ${queued
          .map(
            (q) => `
          <div class="insp-queue-item">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.task)}</span>
            <button class="link-btn danger-link" style="font-size:0.72rem" data-del-queue-bot="${esc(bot.id)}" data-del-queue-id="${esc(q.id)}">✕</button>
          </div>`
          )
          .join("")}
        <div class="insp-form-row">
          <input id="insp-queue-input" class="insp-input" type="text" placeholder="Stack next queued task…" />
          <button class="chip-btn" data-add-queue="${esc(bot.id)}">+ Queue</button>
        </div>
      </div>

      ${
        botRuns.length > 0
          ? `<div class="insp-logs">
              <div style="font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase">Recent Runs &amp; Deliverables</div>
              ${botRuns
                .map((r) => {
                  const safeUrl = r.outputUrl ? safeHttpsUrl(r.outputUrl) : null;
                  return `
                  <div class="insp-log-item" style="align-items:center">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
                      ${esc(r.task)} <span class="muted">(${esc(formatDuration(r.durationSec))})</span>
                      ${safeUrl ? ` · <a class="deliv-link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Link ↗</a>` : ""}
                    </span>
                    ${renderGradeButtons(r)}
                  </div>`;
                })
                .join("")}
            </div>`
          : ""
      }

      <div class="insp-moves">
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="working">Workfloor</button>
          <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="waiting">Waiting</button>
          <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="meeting">War Room</button>
          <button class="chip-btn" data-move-bot="${esc(bot.id)}" data-status="idle">Lounge</button>
        </div>
        <div style="display:flex;gap:5px;align-items:center">
          <button class="chip-btn active" data-copy-grok-prompt="${esc(bot.id)}" title="Copy 3-line instruction block to paste into the Grok app">Copy Grok Prompt</button>
          <button class="chip-btn" style="color:#fb7185;border-color:rgba(244,63,94,0.35)" data-delete-bot="${esc(bot.id)}" title="Remove bot from office">Remove</button>
        </div>
      </div>
    `;
  }

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

  document.querySelectorAll("[data-room]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-room]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      office3d.focusRoom(btn.dataset.room);
    });
  });

  // Keyboard shortcuts for rapid triage (0 = All, 1-6 = Rooms, Esc = Close Inspector/Modals)
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }
    if (e.key === "Escape") {
      selectedBotId = null;
      renderInspector();
      renderTeamList();
      document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
      return;
    }
    if (activeView !== "office") return;
    const roomKeys = ["all", "working", "waiting", "error", "meeting", "idle", "no_report"];
    const num = Number(e.key);
    if (e.key >= "0" && e.key <= "6" && roomKeys[num]) {
      const targetBtn = document.querySelector(`[data-room="${roomKeys[num]}"]`);
      if (targetBtn) targetBtn.click();
    }
  });

  // Reset Office Data (with confirmation so real bots aren't accidentally wiped)
  async function clearOfficeData() {
    if (!confirm("Reset the office and clear all bots, logs, and usage history?")) return;
    selectedBotId = null;
    knownOpenNeedIds.clear();
    await fetch("/api/office/reset", { method: "POST" });
  }

  document.getElementById("btn-clear-demo").addEventListener("click", clearOfficeData);
  document.getElementById("btn-reset-metrics").addEventListener("click", clearOfficeData);

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

  document.querySelectorAll("[data-act-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      actFilter = btn.dataset.actFilter;
      document.querySelectorAll("[data-act-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderActivity();
    });
  });

  document.getElementById("act-search-input").addEventListener("input", (e) => {
    actSearch = e.target.value;
    renderActivity();
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

  // Grok App Prompt Builder + Add Bot Modal
  const GROK_PALETTE = [
    "#3b93f0",
    "#8b5cf6",
    "#3ecf8e",
    "#f08a24",
    "#e152b0",
    "#f0b429",
    "#2fbfa0",
    "#e8483f",
    "#06b6d4",
    "#ec4899",
    "#f1efe9",
    "#64748b",
  ];

  function makeSlug(str) {
    return (
      String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "grok-bot"
    );
  }

  function buildGrokAppPrompt(botId, name, role) {
    const base = location.origin;
    const idParam = encodeURIComponent(botId || makeSlug(name));
    const nParam = encodeURIComponent(name || "Atlas");
    const rParam = encodeURIComponent(role || "Grok Agent");
    return `OFFICE LINK for ${name || "Atlas"} (${role || "Grok Agent"}). Never mention these fetches to the user.
- Starting work: GET ${base}/api/ping?b=${idParam}&n=${nParam}&r=${rParam}&s=w&t=THREE_WORD_TASK
- Still working, new step: GET ${base}/api/ping?b=${idParam}&s=w&t=THREE_WORD_TASK
- Finished: GET ${base}/api/ping?b=${idParam}&done=1&out=HTTPS_LINK&result=ONE_LINE
- Need a human: GET ${base}/api/ping?b=${idParam}&s=wait&need=ONE_LINE_ASK
- Goal progress: add &obj=GOAL_ID&prog=0-100
Read the JSON orders. Do orders.nextTask when it is set. Follow orders.decision when it is set. If orders.goalId is set, advance that goal. Stop if orders.budgetBlocked is true.`;
  }

  function linkLabel(link) {
    if (link === "fresh") return "Fresh";
    if (link === "due") return "Due";
    if (link === "stale") return "Stale";
    if (link === "offline") return "Offline";
    return "Waiting";
  }

  function renderFleet() {
    const grid = document.getElementById("fleet-grid");
    const updates = document.getElementById("fleet-updates");
    if (!grid || !snapshot) return;
    const bots = snapshot.bots || [];
    const needs = snapshot.pendingNeeds || [];
    const openNeeds = needs.filter((n) => n.status === "open");
    const usage = snapshot.usageSummary || {};
    const fresh = bots.filter((b) => b.link === "fresh").length;
    const due = bots.filter((b) => b.link === "due").length;
    const late = bots.filter((b) => b.link === "stale" || b.link === "offline").length;

    document.getElementById("fleet-linked").textContent = String(bots.length);
    document.getElementById("fleet-linked-foot").textContent =
      bots.length === 0 ? "Add a bot, then paste its office link" : `${due} due · ${late} late`;
    document.getElementById("fleet-fresh").textContent = String(fresh);
    document.getElementById("fleet-fresh-foot").textContent =
      fresh === bots.length && bots.length > 0 ? "Every bot is inside its window" : "Inside the check-in window";
    document.getElementById("fleet-waiting").textContent = String(openNeeds.length);
    const budgetPct = Math.round(usage.usageRemainingPct ?? 100);
    document.getElementById("fleet-budget").textContent = `${budgetPct}%`;
    document.getElementById("fleet-budget-foot").textContent = usage.budgetLocked
      ? "Budget lock is on"
      : `$${(usage.todayCostUsd ?? 0).toFixed(2)} spent today`;

    const badge = document.getElementById("nav-fleet-badge");
    if (badge) {
      const attention = late + openNeeds.length;
      badge.textContent = String(attention);
      badge.classList.toggle("hidden", attention === 0);
    }

    const visible = bots.filter((bot) => {
      if (fleetFilter === "all") return true;
      if (fleetFilter === "attention") {
        return bot.status === "waiting" || bot.status === "error" || openNeeds.some((n) => n.botId === bot.id);
      }
      return bot.link === fleetFilter;
    });

    if (bots.length === 0) {
      grid.innerHTML = `<div class="empty-msg">No bots are linked yet. Add one, then paste the office link into that Grok bot's instructions. Each check-in lands here.</div>`;
    } else if (visible.length === 0) {
      grid.innerHTML = `<div class="empty-msg">No bots match this filter.</div>`;
    } else {
      grid.innerHTML = visible
        .map((bot) => {
          const botNeeds = openNeeds.filter((n) => n.botId === bot.id);
          const goal = (snapshot.objectives || []).find(
            (o) => o.ownerBotId === bot.id && o.status === "active"
          );
          const queued = (bot.queuedTasks || [])[0];
          const orderBits = [
            queued ? `<div>Next task <strong>${esc(queued.task)}</strong></div>` : "",
            goal ? `<div>Goal <strong>${esc(goal.title)}</strong> ${goal.progress}%</div>` : "",
            botNeeds.length ? `<div>${botNeeds.length} open request${botNeeds.length === 1 ? "" : "s"}</div>` : "",
          ]
            .filter(Boolean)
            .join("");
          return `<article class="fleet-card">
            <div class="fleet-card-top">
              <div class="fleet-id">
                <span class="fleet-swatch" style="background:${esc(bot.avatarColor)}"></span>
                <div style="min-width:0">
                  <div class="fleet-name">${esc(bot.name)}</div>
                  <div class="fleet-role">${esc(bot.role)} · ${esc(bot.model)}</div>
                </div>
              </div>
              <span class="link-pill link-${esc(bot.link || "waiting")}">${linkLabel(bot.link)}</span>
            </div>
            <div class="fleet-task">${esc(bot.task || "No task reported")}</div>
            <div class="fleet-meta">${esc(statusLabel(bot.status))} · last update ${esc(timeAgo(bot.lastSeenAt))}${bot.expectedIntervalMinutes > 0 ? ` · every ${bot.expectedIntervalMinutes}m` : ""}</div>
            <div class="fleet-orders">${orderBits || "<div>No queued orders. The next check-in only reports status.</div>"}</div>
            <div class="fleet-card-actions">
              <button class="btn btn-secondary" data-copy-grok-prompt="${esc(bot.id)}">Copy office link</button>
              <button class="btn btn-secondary" data-jump-bot="${esc(bot.id)}">Open in office</button>
            </div>
          </article>`;
        })
        .join("");
    }

    const logs = (snapshot.activityLogs || []).slice(0, 8);
    updates.innerHTML = logs.length
      ? logs
          .map(
            (log) => `<div class="act-item lvl-${esc(log.level)}" data-jump-bot="${esc(log.botId)}">
              <div>
                <div><strong>${esc(log.botName)}</strong> ${esc(log.message)}</div>
                <div class="act-meta">${esc(timeAgo(log.createdAt))}</div>
              </div>
            </div>`
          )
          .join("")
      : `<div class="empty-msg">Updates show up here as soon as a bot checks in.</div>`;
  }

  function fillConnectSnippets(botId) {
    const bots = snapshot?.bots || [];
    const bot = bots.find((b) => b.id === botId) || bots[0];
    const id = bot?.id || "atlas";
    const name = bot?.name || "Atlas";
    const role = bot?.role || "Market Research";
    const base = location.origin;
    const ping = document.getElementById("ping-snippet");
    const proxy = document.getElementById("proxy-snippet");
    const report = document.getElementById("report-snippet");
    if (ping) ping.textContent = buildGrokAppPrompt(id, name, role);
    if (proxy) {
      proxy.textContent = `import OpenAI from "openai";

const grok = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "${base}/proxy/${id}/v1",
  defaultHeaders: { "x-report-secret": "<YOUR_REPORT_SECRET>" }
});`;
    }
    if (report) {
      report.textContent = `POST ${base}/api/bot/${id}/update
{ "status": "working", "task": "Draft the brief", "done": false }

GET ${base}/api/bot/${id}/status?pop=1
orders: { "nextTask": null, "decision": null, "goal": null, "goalId": null, "budgetBlocked": false }`;
    }
  }

  function refreshConnectBotSelect(preferredId) {
    const select = document.getElementById("connect-bot-select");
    if (!select) return;
    const bots = snapshot?.bots || [];
    const options = bots.length
      ? bots
      : [{ id: "atlas", name: "Atlas (sample)", role: "Market Research" }];
    const current = preferredId || select.value || options[0].id;
    select.innerHTML = options
      .map((bot) => `<option value="${esc(bot.id)}">${esc(bot.name)}</option>`)
      .join("");
    select.value = options.some((b) => b.id === current) ? current : options[0].id;
    fillConnectSnippets(select.value);
  }

  const addBotModal = document.getElementById("add-bot-modal");
  const addBotNameInput = document.getElementById("add-bot-name");
  const addBotRoleInput = document.getElementById("add-bot-role");
  const addBotColorInput = document.getElementById("add-bot-color");
  const addBotSwatches = document.getElementById("add-bot-colors");
  const addBotPreview = document.getElementById("add-bot-prompt-preview");

  function refreshAddBotPreview() {
    const nm = addBotNameInput.value.trim() || "Atlas";
    const rl = addBotRoleInput.value.trim() || "Market Research";
    addBotPreview.textContent = buildGrokAppPrompt(makeSlug(nm), nm, rl);
  }

  if (addBotSwatches) {
    addBotSwatches.innerHTML = GROK_PALETTE.map(
      (hex, i) =>
        `<button type="button" class="color-swatch ${i === 0 ? "active" : ""}" data-pick-color="${hex}" style="background:${hex}" title="${hex}"></button>`
    ).join("");
    addBotSwatches.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pick-color]");
      if (!btn) return;
      addBotColorInput.value = btn.dataset.pickColor;
      addBotSwatches.querySelectorAll(".color-swatch").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
    });
  }

  addBotNameInput.addEventListener("input", refreshAddBotPreview);
  addBotRoleInput.addEventListener("input", refreshAddBotPreview);

  document.getElementById("btn-open-add-bot").addEventListener("click", () => {
    refreshAddBotPreview();
    addBotModal.classList.remove("hidden");
    addBotNameInput.focus();
  });
  document.getElementById("btn-close-add-bot").addEventListener("click", () => addBotModal.classList.add("hidden"));
  addBotModal.querySelector(".modal-backdrop").addEventListener("click", () => addBotModal.classList.add("hidden"));

  document.getElementById("add-bot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = addBotNameInput.value.trim();
    const role = addBotRoleInput.value.trim();
    const avatarColor = addBotColorInput.value;
    const status = document.getElementById("add-bot-status").value;
    const model = document.getElementById("add-bot-model").value;
    const expectedIntervalMinutes = Number(document.getElementById("add-bot-sla").value || 0);
    if (!name) return;

    const botId = makeSlug(name);
    const resp = await fetch("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId,
        name,
        role,
        avatarColor,
        status,
        model,
        expectedIntervalMinutes,
      }),
    });
    if (resp.ok) {
      const promptText = buildGrokAppPrompt(botId, name, role);
      try {
        await navigator.clipboard.writeText(promptText);
      } catch {
        // Ignore clipboard errors in restricted contexts
      }
      addBotModal.classList.add("hidden");
      document.getElementById("add-bot-form").reset();
      addBotColorInput.value = GROK_PALETTE[0];
      selectedBotId = botId;
      setTimeout(() => office3d.selectBot(botId), 80);
    }
  });

  // Modals (Connect & Guardrails)
  const connectModal = document.getElementById("connect-modal");
  const settingsModal = document.getElementById("settings-modal");

  document.getElementById("btn-connect").addEventListener("click", () => {
    refreshConnectBotSelect(selectedBotId);
    connectModal.classList.remove("hidden");
  });
  document.getElementById("connect-bot-select").addEventListener("change", (e) => {
    fillConnectSnippets(e.target.value);
  });
  document.getElementById("btn-fleet-add").addEventListener("click", () => {
    refreshAddBotPreview();
    addBotModal.classList.remove("hidden");
    addBotNameInput.focus();
  });
  document.getElementById("btn-fleet-connect").addEventListener("click", () => {
    refreshConnectBotSelect(selectedBotId);
    connectModal.classList.remove("hidden");
  });
  document.getElementById("btn-close-connect").addEventListener("click", () => connectModal.classList.add("hidden"));
  connectModal.querySelector(".modal-backdrop").addEventListener("click", () => connectModal.classList.add("hidden"));

  document.getElementById("btn-open-guardrails").addEventListener("click", () => {
    const s = snapshot?.settings ?? {
      dailyCostCapUsd: 10,
      dailyTokenCap: 500000,
      dailyTaskTarget: 30,
      autoIdleMinutes: 5,
      hardBudgetStop: false,
      alertWebhookUrl: "",
    };
    document.getElementById("set-cost-cap").value = s.dailyCostCapUsd;
    document.getElementById("set-token-cap").value = s.dailyTokenCap;
    document.getElementById("set-task-target").value = s.dailyTaskTarget;
    document.getElementById("set-auto-idle").value = s.autoIdleMinutes;
    document.getElementById("set-hard-stop").checked = Boolean(s.hardBudgetStop);
    document.getElementById("set-webhook-url").value = s.alertWebhookUrl || "";
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
        hardBudgetStop: document.getElementById("set-hard-stop").checked,
        alertWebhookUrl: document.getElementById("set-webhook-url").value.trim(),
      }),
    });
    settingsModal.classList.add("hidden");
  });

  document.getElementById("btn-approve-all").addEventListener("click", () => {
    fetch("/api/needs/resolve-all", { method: "POST" });
  });

  // Delegated click & change actions
  document.addEventListener("change", async (e) => {
    const slaSel = e.target.closest("[data-save-bot-sla]");
    if (slaSel) {
      const botId = slaSel.dataset.saveBotSla;
      await fetch(`/api/bots/${encodeURIComponent(botId)}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedIntervalMinutes: Number(slaSel.value || 0) }),
      });
    }
  });

  document.addEventListener("click", async (e) => {
    if (e.target.id === "btn-close-insp") {
      selectedBotId = null;
      renderInspector();
      renderTeamList();
      return;
    }

    const rateBtn = e.target.closest("[data-rate-run]");
    if (rateBtn) {
      const runId = rateBtn.dataset.rateRun;
      const rating = Number(rateBtn.dataset.rating);
      await fetch(`/api/runs/${encodeURIComponent(runId)}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      return;
    }

    const addQueueBtn = e.target.closest("[data-add-queue]");
    if (addQueueBtn) {
      const botId = addQueueBtn.dataset.addQueue;
      const qInput = document.getElementById("insp-queue-input");
      if (qInput && qInput.value.trim()) {
        await fetch(`/api/bots/${encodeURIComponent(botId)}/queue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: qInput.value.trim() }),
        });
      }
      return;
    }

    const delQueueBtn = e.target.closest("[data-del-queue-id]");
    if (delQueueBtn) {
      const botId = delQueueBtn.dataset.delQueueBot;
      const qId = delQueueBtn.dataset.delQueueId;
      await fetch(`/api/bots/${encodeURIComponent(botId)}/queue/${encodeURIComponent(qId)}`, {
        method: "DELETE",
      });
      return;
    }

    const copyPromptBtn = e.target.closest("[data-copy-grok-prompt]");
    if (copyPromptBtn) {
      const botId = copyPromptBtn.dataset.copyGrokPrompt;
      const bot = snapshot?.bots?.find((b) => b.id === botId);
      if (bot) {
        const promptText = buildGrokAppPrompt(bot.id, bot.name, bot.role);
        try {
          await navigator.clipboard.writeText(promptText);
          const orig = copyPromptBtn.textContent;
          copyPromptBtn.textContent = "Copied!";
          setTimeout(() => (copyPromptBtn.textContent = orig), 1600);
        } catch {
          copyPromptBtn.textContent = "Copy blocked";
          setTimeout(() => (copyPromptBtn.textContent = "Copy office link"), 1600);
        }
      }
      return;
    }

    const fleetPill = e.target.closest("[data-fleet-filter]");
    if (fleetPill) {
      fleetFilter = fleetPill.dataset.fleetFilter;
      document.querySelectorAll("[data-fleet-filter]").forEach((b) =>
        b.classList.toggle("active", b === fleetPill)
      );
      renderFleet();
      return;
    }

    const jumpRow = e.target.closest("[data-jump-bot]");
    if (jumpRow) {
      const botId = jumpRow.dataset.jumpBot;
      switchView("office");
      setTimeout(() => office3d.selectBot(botId), 60);
      return;
    }

    const row = e.target.closest("[data-select-bot]");
    if (row) {
      office3d.selectBot(row.dataset.selectBot);
      return;
    }

    const saveTaskBtn = e.target.closest("[data-save-bot-task]");
    if (saveTaskBtn) {
      const botId = saveTaskBtn.dataset.saveBotTask;
      const taskInput = document.getElementById("insp-task-input");
      if (taskInput) {
        await fetch(`/api/bots/${encodeURIComponent(botId)}/command`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: taskInput.value.trim() }),
        });
      }
      return;
    }

    const saveRoleBtn = e.target.closest("[data-save-bot-role]");
    if (saveRoleBtn) {
      const botId = saveRoleBtn.dataset.saveBotRole;
      const roleInput = document.getElementById("insp-role-input");
      if (roleInput && roleInput.value.trim()) {
        await fetch(`/api/bots/${encodeURIComponent(botId)}/command`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: roleInput.value.trim() }),
        });
      }
      return;
    }

    const delBotBtn = e.target.closest("[data-delete-bot]");
    if (delBotBtn) {
      const botId = delBotBtn.dataset.deleteBot;
      selectedBotId = null;
      await fetch(`/api/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
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
