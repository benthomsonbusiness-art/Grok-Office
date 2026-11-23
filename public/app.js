(() => {
  let snapshot = null;
  let selectedBotId = null;
  let inspectorTab = "overview";
  let activeView = "office";
  let teamFilter = "all";
  let actFilter = "all";
  let actSearch = "";
  let chartMode = "tokens";
  let fleetFilter = "all";
  let leaderboardSort = { col: "cost", dir: "desc" };
  let soundEnabled = localStorage.getItem("grok_hq_chime") !== "off";
  let sidebarCollapsed = localStorage.getItem("grok_hq_sidebar") === "collapsed";
  let knownOpenNeedIds = new Set();
  let firstSnapshotLoaded = false;
  let wsInstance = null;
  let wsReconnectTimer = null;
  let cmdSelectedIndex = 0;
  let cmdItems = [];

  const stageEl = document.getElementById("office-3d-stage");
  const labelLayer = document.getElementById("label-layer");
  const tooltipEl = document.getElementById("bot-tooltip");

  const office3d = new window.Office3D(stageEl, labelLayer, tooltipEl, (botId) => {
    const changedBot = selectedBotId !== botId;
    selectedBotId = botId;
    if (changedBot) inspectorTab = "overview";
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
    const v = Number(n ?? 0);
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return String(v);
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
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return "Waiting…";
    const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
    if (diffSec < 10) return "Just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
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

  // Toast Notification Stack
  const toastStack = document.getElementById("toast-stack");
  function showToast(message, type = "info") {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    const icon = type === "success" ? "✓" : type === "error" ? "!" : type === "warn" ? "⚠" : "⚡";
    el.innerHTML = `<span style="opacity:0.9">${icon}</span><span>${esc(message)}</span>`;
    toastStack.appendChild(el);
    while (toastStack.children.length > 4) {
      toastStack.firstChild.remove();
    }
    const dismiss = () => {
      el.classList.add("toast-out");
      setTimeout(() => el.remove(), 200);
    };
    el.addEventListener("click", dismiss);
    setTimeout(dismiss, 3200);
  }

  // In-App Confirmation Modal (Replaces native window.confirm)
  const confirmModal = document.getElementById("confirm-modal");
  const confirmTitleEl = document.getElementById("confirm-title");
  const confirmMsgEl = document.getElementById("confirm-message");
  const confirmOkBtn = document.getElementById("btn-confirm-ok");
  const confirmCancelBtn = document.getElementById("btn-confirm-cancel");
  const confirmCloseBtn = document.getElementById("btn-close-confirm");
  let confirmResolver = null;

  function finishConfirm(result) {
    if (!confirmModal) return;
    confirmModal.classList.add("hidden");
    const r = confirmResolver;
    confirmResolver = null;
    if (r) r(result);
  }

  function askConfirm({ title = "Confirm Action", message = "", confirmLabel = "Confirm", danger = true }) {
    if (!confirmModal) return Promise.resolve(false);
    if (confirmResolver) finishConfirm(false);
    confirmTitleEl.textContent = title;
    confirmMsgEl.textContent = message;
    confirmOkBtn.textContent = confirmLabel;
    confirmOkBtn.className = danger ? "btn btn-reject" : "btn btn-primary";
    confirmModal.classList.remove("hidden");
    setTimeout(() => confirmOkBtn.focus(), 20);
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  if (confirmOkBtn) confirmOkBtn.addEventListener("click", () => finishConfirm(true));
  if (confirmCancelBtn) confirmCancelBtn.addEventListener("click", () => finishConfirm(false));
  if (confirmCloseBtn) confirmCloseBtn.addEventListener("click", () => finishConfirm(false));
  if (confirmModal) {
    confirmModal.querySelector(".modal-backdrop").addEventListener("click", () => finishConfirm(false));
  }

  // Guided Empty State Helper
  function emptyStateHtml({ icon = "⚡", title, subtitle = "", actionsHtml = "", compact = false }) {
    return `
      <div class="empty-state ${compact ? "empty-state-compact" : ""}">
        <div class="empty-state-icon" aria-hidden="true">${icon}</div>
        <div class="empty-state-title">${esc(title)}</div>
        ${subtitle ? `<div class="empty-state-sub">${esc(subtitle)}</div>` : ""}
        ${actionsHtml ? `<div class="empty-state-actions">${actionsHtml}</div>` : ""}
      </div>`;
  }

  // Alert Chime (Compact Topbar Icon)
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
    soundBtn.textContent = soundEnabled ? "🔔" : "🔕";
    soundBtn.classList.toggle("active", soundEnabled);
    soundBtn.title = soundEnabled
      ? "Alert chime: On (click to mute)"
      : "Alert chime: Muted (click to enable)";
  }
  updateSoundBtn();
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem("grok_hq_chime", soundEnabled ? "on" : "off");
      updateSoundBtn();
      showToast(soundEnabled ? "Alert chime enabled" : "Alert chime muted", "info");
      if (soundEnabled) playAlertChime(false);
    });
  }

  // Collapsible Right Sidebar
  const officeViewEl = document.getElementById("view-office");
  const toggleSidebarBtn = document.getElementById("btn-toggle-sidebar");
  function applySidebarState(animateResize = false) {
    if (officeViewEl) officeViewEl.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    if (toggleSidebarBtn) {
      toggleSidebarBtn.textContent = sidebarCollapsed ? "◨" : "◧";
      toggleSidebarBtn.classList.toggle("active", !sidebarCollapsed);
      toggleSidebarBtn.title = sidebarCollapsed
        ? "Expand right sidebar ([)"
        : "Collapse right sidebar ([)";
    }
    if (animateResize) {
      setTimeout(() => office3d.handleResize(), 220);
    }
  }
  applySidebarState(false);

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem("grok_hq_sidebar", sidebarCollapsed ? "collapsed" : "expanded");
    applySidebarState(true);
  }
  if (toggleSidebarBtn) toggleSidebarBtn.addEventListener("click", toggleSidebar);

  // Live WebSocket + Reconnecting Banner
  const wsBanner = document.getElementById("ws-reconnect-banner");
  const wsRetryBtn = document.getElementById("btn-ws-retry");

  function connectWS() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (wsInstance && (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsDot = document.getElementById("ws-dot");
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    wsInstance = ws;

    ws.onopen = () => {
      if (wsDot) {
        wsDot.classList.add("live");
        wsDot.title = "Live WebSocket connected";
      }
      if (wsBanner) wsBanner.classList.add("hidden");
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
      if (wsInstance === ws) wsInstance = null;
      if (wsDot) {
        wsDot.classList.remove("live");
        wsDot.title = "Reconnecting…";
      }
      if (wsBanner) wsBanner.classList.remove("hidden");
      wsReconnectTimer = setTimeout(connectWS, 2200);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // Ignore
      }
    };
  }

  if (wsRetryBtn) {
    wsRetryBtn.addEventListener("click", () => {
      fetchSnapshotFallback();
      connectWS();
      showToast("Reconnecting live stream…", "info");
    });
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

    const lastUpdEl = document.getElementById("last-update-label");
    lastUpdEl.textContent = timeAgo(lastBotUpdateAt);
    if (lastBotUpdateAt) lastUpdEl.dataset.liveTs = lastBotUpdateAt;
    else delete lastUpdEl.dataset.liveTs;

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

  function miniGrokIcon(color, large = false) {
    const c = esc(color || "#3b93f0");
    const size = large ? 34 : 26;
    const cls = large ? "grok-mini grok-mini-lg" : "grok-mini";
    return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><rect x="2" y="1.5" width="20" height="21" rx="7" fill="${c}"/><ellipse cx="9" cy="11.6" rx="2.4" ry="3" fill="#fff"/><ellipse cx="15" cy="11.6" rx="2.4" ry="3" fill="#fff"/><circle cx="9.3" cy="11.8" r="1.25" fill="#0a0a0c"/><circle cx="15.3" cy="11.8" r="1.25" fill="#0a0a0c"/></svg>`;
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
    if (bots.length === 0) {
      el.innerHTML = emptyStateHtml({
        icon: "🤖",
        title: "No Grok bots connected yet",
        subtitle: "Add your first bot to spawn it in the 3D office and generate its check-in prompt.",
        compact: true,
        actionsHtml: `<button class="btn btn-primary" style="padding:5px 11px;font-size:0.76rem" data-open-modal="add-bot">+ Add First Bot</button>
          <button class="btn btn-secondary" style="padding:5px 11px;font-size:0.76rem" data-open-modal="connect">Connect Guide</button>`,
      });
      return;
    }
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
            <div class="act-meta">${esc(ts)} · <span data-live-ts="${esc(l.createdAt)}">${esc(timeAgo(l.createdAt))}</span></div>
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

  // Interactive SVG Bar + Trend Line Chart
  function renderUsageChart(timeline) {
    const chartEl = document.getElementById("usage-chart");
    if (!chartEl) return;
    if (!timeline || timeline.length === 0) {
      chartEl.innerHTML = emptyStateHtml({
        icon: "📊",
        title: "No usage telemetry yet",
        subtitle: "Usage bars appear automatically as bots check in or route calls through /proxy/*.",
        compact: true,
      });
      return;
    }

    const W = 580;
    const H = 190;
    const padL = 46;
    const padR = 14;
    const padT = 14;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const vals = timeline.map((t) => (chartMode === "tokens" ? Number(t.tokens || 0) : Number(t.costUsd || 0)));
    const maxVal = Math.max(...vals, chartMode === "tokens" ? 10 : 0.01);

    const gridSteps = [0, 0.5, 1];
    const gridSvg = gridSteps
      .map((ratio) => {
        const y = padT + plotH * (1 - ratio);
        const val = maxVal * ratio;
        const lbl = chartMode === "tokens" ? formatNum(Math.round(val)) : `$${val.toFixed(val < 0.1 ? 3 : 2)}`;
        return `
          <line class="svg-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" />
          <text class="svg-axis-label" x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${esc(lbl)}</text>`;
      })
      .join("");

    const stepW = plotW / timeline.length;
    const barW = Math.min(34, Math.max(10, stepW * 0.56));
    const points = [];

    const barsSvg = timeline
      .map((t, idx) => {
        const v = vals[idx];
        const barH = Math.max(4, (v / maxVal) * plotH);
        const cx = padL + stepW * idx + stepW / 2;
        const x = cx - barW / 2;
        const y = padT + plotH - barH;
        points.push(`${cx.toFixed(1)},${y.toFixed(1)}`);
        const fill = t.errors > 0 ? "url(#barGradErr)" : "url(#barGradOk)";
        const showLabel = timeline.length <= 10 || idx % Math.ceil(timeline.length / 8) === 0 || idx === timeline.length - 1;
        return `
          <g class="svg-bar-group" data-bar-idx="${idx}">
            <rect class="svg-bar-rect" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${fill}" />
            <rect class="svg-bar-hit" x="${(padL + stepW * idx).toFixed(1)}" y="${padT}" width="${stepW.toFixed(1)}" height="${plotH + padB}" data-bar-idx="${idx}" />
            ${showLabel ? `<text class="svg-axis-label" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(t.label)}</text>` : ""}
          </g>`;
      })
      .join("");

    const lineSvg =
      points.length > 1
        ? `<polyline fill="none" stroke="rgba(56,189,248,0.65)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${points.join(" ")}" pointer-events="none" />`
        : "";

    chartEl.innerHTML = `
      <svg class="usage-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Usage over time chart">
        <defs>
          <linearGradient id="barGradOk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" />
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0.72" />
          </linearGradient>
          <linearGradient id="barGradErr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fb7185" />
            <stop offset="100%" stop-color="#a855f7" stop-opacity="0.78" />
          </linearGradient>
        </defs>
        ${gridSvg}
        ${barsSvg}
        ${lineSvg}
      </svg>
      <div id="chart-tooltip" class="chart-tooltip hidden"></div>`;

    const tip = document.getElementById("chart-tooltip");
    chartEl.querySelectorAll(".svg-bar-hit").forEach((hit) => {
      hit.addEventListener("mouseenter", (ev) => {
        const idx = Number(hit.dataset.barIdx);
        const t = timeline[idx];
        if (!t || !tip) return;
        const errTag = t.errors > 0 ? ` · ${t.errors} err` : "";
        tip.innerHTML = `<div><strong>${esc(t.label)}</strong></div><div class="chart-tooltip-sub">${formatNum(t.tokens)} tok · $${Number(t.costUsd || 0).toFixed(4)} · ${t.requests} req${errTag}</div>`;
        tip.classList.remove("hidden");
        const rect = chartEl.getBoundingClientRect();
        const barRect = hit.getBoundingClientRect();
        const left = Math.max(84, Math.min(rect.width - 84, barRect.left - rect.left + barRect.width / 2));
        const top = Math.max(44, ev.clientY - rect.top - 8);
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      });
      hit.addEventListener("mousemove", (ev) => {
        if (!tip) return;
        const rect = chartEl.getBoundingClientRect();
        const left = Math.max(84, Math.min(rect.width - 84, ev.clientX - rect.left));
        const top = Math.max(44, ev.clientY - rect.top - 8);
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      });
      hit.addEventListener("mouseleave", () => {
        if (tip) tip.classList.add("hidden");
      });
    });
  }

  // SVG Spend-by-Model Donut Ring
  const DONUT_COLORS = ["#38bdf8", "#a855f7", "#10b981", "#f59e0b", "#fb7185", "#6366f1"];
  function renderModelDonut(models) {
    const wrap = document.getElementById("model-donut-wrap");
    if (!wrap) return;
    if (!models || models.length === 0) {
      wrap.innerHTML = `
        <svg viewBox="0 0 128 128" width="122" height="122" aria-hidden="true">
          <circle cx="64" cy="64" r="46" fill="none" stroke="rgba(148,163,184,0.14)" stroke-width="14" />
          <text x="64" y="62" text-anchor="middle" fill="#94a3b8" font-size="13" font-weight="700" font-family="ui-monospace,monospace">$0.00</text>
          <text x="64" y="77" text-anchor="middle" fill="#64748b" font-size="9">TOTAL SPEND</text>
        </svg>`;
      return;
    }

    const totalCost = models.reduce((acc, m) => acc + Number(m.costUsd || 0), 0);
    const totalTokens = models.reduce((acc, m) => acc + Number((m.tokensIn || 0) + (m.tokensOut || 0)), 0);
    const useCost = totalCost > 0;
    const denom = useCost ? totalCost : Math.max(totalTokens, 1);
    const r = 46;
    const C = 2 * Math.PI * r;
    let offset = 0;

    const slices = models.slice(0, 6).map((m, i) => {
      const val = useCost ? Number(m.costUsd || 0) : Number((m.tokensIn || 0) + (m.tokensOut || 0));
      const frac = Math.max(0.015, val / denom);
      const len = frac * C;
      const seg = `<circle cx="64" cy="64" r="${r}" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 64 64)" />`;
      offset += len;
      return { seg, model: m.model, pct: Math.round((val / denom) * 100), color: DONUT_COLORS[i % DONUT_COLORS.length] };
    });

    wrap.innerHTML = `
      <svg viewBox="0 0 128 128" width="122" height="122" role="img" aria-label="Spend distribution by model">
        <circle cx="64" cy="64" r="${r}" fill="none" stroke="rgba(148,163,184,0.12)" stroke-width="14" />
        ${slices.map((s) => s.seg).join("")}
        <text x="64" y="61" text-anchor="middle" fill="#f4f7fc" font-size="13" font-weight="800" font-family="ui-monospace,monospace">$${totalCost.toFixed(totalCost < 1 ? 3 : 2)}</text>
        <text x="64" y="76" text-anchor="middle" fill="#64748b" font-size="8.5" font-weight="700">TOTAL SPEND</text>
      </svg>
      <div class="model-legend">
        ${slices
          .map(
            (s) => `
          <div class="model-legend-item">
            <span style="display:flex;align-items:center;gap:6px;min-width:0">
              <span class="model-legend-dot" style="background:${s.color}"></span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.model)}</span>
            </span>
            <strong class="mono" style="color:var(--text)">${s.pct}%</strong>
          </div>`
          )
          .join("")}
      </div>`;
  }

  function sortBotsForLeaderboard(bots) {
    const { col, dir } = leaderboardSort;
    const mul = dir === "asc" ? 1 : -1;
    return [...bots].sort((a, b) => {
      switch (col) {
        case "name":
          return a.name.localeCompare(b.name) * mul;
        case "status":
          return a.status.localeCompare(b.status) * mul;
        case "model":
          return (a.model || "").localeCompare(b.model || "") * mul;
        case "tasks":
          return ((a.tasksCompleted || 0) - (b.tasksCompleted || 0)) * mul;
        case "duration":
          return ((a.avgDurationSec || 0) - (b.avgDurationSec || 0)) * mul;
        case "quality":
          return ((a.qualityScorePct ?? -1) - (b.qualityScorePct ?? -1)) * mul;
        case "tokens":
          return ((a.tokensTotal || 0) - (b.tokensTotal || 0)) * mul;
        case "errors":
          return ((a.errorCount || 0) - (b.errorCount || 0)) * mul;
        case "lastSeen":
          return ((Date.parse(a.lastSeenAt || 0) || 0) - (Date.parse(b.lastSeenAt || 0) || 0)) * mul;
        case "cost":
        default:
          return ((a.costTotalUsd || 0) - (b.costTotalUsd || 0)) * mul || ((b.tasksCompleted || 0) - (a.tasksCompleted || 0));
      }
    });
  }

  function updateLeaderboardSortHeaders() {
    document.querySelectorAll("th.sortable[data-sort-col]").forEach((th) => {
      const active = th.dataset.sortCol === leaderboardSort.col;
      th.classList.toggle("sort-active", active);
      const ind = th.querySelector(".sort-ind");
      if (ind) ind.textContent = active ? (leaderboardSort.dir === "asc" ? "▲" : "▼") : "";
    });
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

    // Sortable Per-Agent Performance & Spend Leaderboard
    updateLeaderboardSortHeaders();
    const leaderTbody = document.getElementById("agent-leaderboard-tbody");
    if (bots.length === 0) {
      leaderTbody.innerHTML = `<tr><td colspan="11" style="padding:14px">${emptyStateHtml({
        icon: "⚡",
        title: "No agents registered yet",
        subtitle: "Add your first Grok bot or connect an existing bot via /api/ping or /proxy/*.",
        compact: true,
        actionsHtml: `<button class="btn btn-primary" data-open-modal="add-bot">+ Add Bot</button>
          <button class="btn btn-secondary" data-open-modal="connect">Connect Instructions</button>`,
      })}</td></tr>`;
    } else {
      const sortedBots = sortBotsForLeaderboard(bots);
      leaderTbody.innerHTML = sortedBots
        .map(
          (b) => `
          <tr data-jump-bot="${esc(b.id)}">
            <td>
              <div style="display:flex;align-items:center;gap:9px">
                ${miniGrokIcon(b.avatarColor)}
                <div>
                  <div style="font-weight:700;color:var(--text-bright)">${esc(b.name)}</div>
                  <div class="muted" style="font-size:0.75rem">${esc(b.role)}</div>
                </div>
              </div>
            </td>
            <td><span class="st-pill st-${esc(b.status)}">${esc(statusLabel(b.status))}</span></td>
            <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(b.task)}">${esc(b.task || "Standing by")}</td>
            <td><span class="model-chip">${esc(b.model)}</span></td>
            <td class="num-cell mono"><strong>${b.tasksCompleted}</strong></td>
            <td class="num-cell mono muted">${esc(formatDuration(b.avgDurationSec))}</td>
            <td class="num-cell mono">${b.qualityScorePct !== null && b.qualityScorePct !== undefined ? `<strong style="color:${b.qualityScorePct >= 80 ? "#6ee7b7" : "#fcd34d"}">${b.qualityScorePct}%</strong>` : `<span class="muted">—</span>`}</td>
            <td class="num-cell mono">${formatNum(b.tokensTotal)}</td>
            <td class="num-cell mono"><strong>$${b.costTotalUsd.toFixed(4)}</strong></td>
            <td class="num-cell mono">${b.errorCount > 0 ? `<span style="color:#fda4af;font-weight:700">${b.errorCount}</span>` : `<span class="muted">0</span>`}</td>
            <td class="muted num"><span data-live-ts="${esc(b.lastSeenAt)}">${esc(timeAgo(b.lastSeenAt))}</span></td>
          </tr>`
        )
        .join("");
    }

    // Recent Runs & Deliverables Table
    const runsTbody = document.getElementById("runs-tbody");
    if (recentRuns.length === 0) {
      runsTbody.innerHTML = `<tr><td colspan="6" style="padding:14px">${emptyStateHtml({
        icon: "📦",
        title: "No task runs recorded yet",
        subtitle: "When a bot reports done=1 with an output link or summary, it lands here for quality grading.",
        compact: true,
      })}</td></tr>`;
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
            <td class="num-cell mono muted">${esc(formatDuration(r.durationSec))}</td>
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
      goalsEl.innerHTML = emptyStateHtml({
        icon: "🎯",
        title: "No team goals yet",
        subtitle: "Create a shared objective and assign it to a bot — HQ will hand that goal back in its check-in orders.",
        compact: true,
        actionsHtml: `<button class="btn btn-primary" data-open-goal-form="1">+ Create First Goal</button>`,
      });
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

    // Interactive SVG Usage Chart & Model Donut + Table
    renderUsageChart(usageSummary.timeline || []);

    const models = usageSummary.byModel || [];
    renderModelDonut(models);

    const tbody = document.getElementById("model-tbody");
    if (models.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">No usage events yet</td></tr>`;
    } else {
      tbody.innerHTML = models
        .map(
          (m) => `
          <tr>
            <td><strong>${esc(m.model)}</strong></td>
            <td class="num-cell mono">${m.requests}</td>
            <td class="num-cell mono">${formatNum(m.tokensIn + m.tokensOut)}</td>
            <td class="num-cell mono"><strong>$${m.costUsd.toFixed(4)}</strong></td>
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
      grid.innerHTML = emptyStateHtml({
        icon: "✅",
        title: "All clear — zero pending needs",
        subtitle: "When a bot pauses for human approval, hits a loop, or encounters a failure, its request will appear right here.",
      });
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

  // Right-Edge Slide-Over Docked Bot Inspector with Tabs (Overview | Queue | Runs)
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
      .slice(0, 12);
    const queued = bot.queuedTasks || [];

    const overviewHtml = `
      <div class="insp-task">${esc(bot.task || "Standing by")}</div>

      <div class="insp-kpis">
        <div class="insp-kpi"><span>Tasks</span><strong class="mono">${bot.tasksCompleted}</strong></div>
        <div class="insp-kpi"><span>Avg Dur</span><strong class="mono">${esc(formatDuration(bot.avgDurationSec))}</strong></div>
        <div class="insp-kpi"><span>Spend</span><strong class="mono">$${bot.costTotalUsd.toFixed(3)}</strong></div>
        <div class="insp-kpi"><span>Quality</span><strong class="mono" style="${bot.errorCount > 0 ? "color:#fda4af" : ""}">${bot.qualityScorePct !== null && bot.qualityScorePct !== undefined ? `${bot.qualityScorePct}%` : `${bot.errorCount} err`}</strong></div>
      </div>

      ${
        botOpenNeed
          ? `<div class="insp-need-box ${botOpenNeed.severity === "error" ? "err" : ""}">
              <div style="font-size:0.8rem;font-weight:700;color:var(--text-bright)">${esc(botOpenNeed.title)}</div>
              ${botOpenNeed.description ? `<div style="font-size:0.74rem;color:var(--muted)">${esc(botOpenNeed.description)}</div>` : ""}
              <div style="display:flex;gap:6px;margin-top:2px">
                <input class="insp-input" type="text" placeholder="Note…" data-note-for="${esc(botOpenNeed.id)}" />
                <button class="btn btn-approve" style="padding:4px 10px;font-size:0.74rem" data-resolve="${esc(botOpenNeed.id)}" data-action="approve">Approve</button>
                <button class="btn btn-reject" style="padding:4px 10px;font-size:0.74rem" data-resolve="${esc(botOpenNeed.id)}" data-action="reject">Reject</button>
              </div>
            </div>`
          : ""
      }

      <div>
        <div class="insp-section-label">Direct Command &amp; Schedule</div>
        <div class="insp-form">
          <div class="insp-form-row">
            <input id="insp-task-input" class="insp-input" type="text" placeholder="Assign immediate task…" value="${esc(bot.task)}" />
            <button class="btn btn-primary" style="padding:6px 11px;font-size:0.75rem" data-save-bot-task="${esc(bot.id)}">Assign</button>
          </div>
          <div class="insp-form-row">
            <input id="insp-role-input" class="insp-input" type="text" placeholder="Role title…" value="${esc(bot.role)}" />
            <select id="insp-sla-select" class="insp-input" style="max-width:118px" data-save-bot-sla="${esc(bot.id)}" title="Expected check-in schedule SLA">
              <option value="0" ${bot.expectedIntervalMinutes === 0 ? "selected" : ""}>SLA: Off</option>
              <option value="15" ${bot.expectedIntervalMinutes === 15 ? "selected" : ""}>SLA: 15m</option>
              <option value="60" ${bot.expectedIntervalMinutes === 60 ? "selected" : ""}>SLA: 1h</option>
              <option value="360" ${bot.expectedIntervalMinutes === 360 ? "selected" : ""}>SLA: 6h</option>
              <option value="1440" ${bot.expectedIntervalMinutes === 1440 ? "selected" : ""}>SLA: 24h</option>
            </select>
            <button class="btn btn-secondary" style="padding:6px 10px;font-size:0.75rem" data-save-bot-role="${esc(bot.id)}">Save</button>
          </div>
        </div>
      </div>

      <div>
        <div class="insp-section-label">Move Room</div>
        <div class="insp-moves-grid">
          <button class="chip-btn ${bot.status === "working" ? "active" : ""}" data-move-bot="${esc(bot.id)}" data-status="working">Workfloor</button>
          <button class="chip-btn ${bot.status === "waiting" ? "active" : ""}" data-move-bot="${esc(bot.id)}" data-status="waiting">Waiting</button>
          <button class="chip-btn ${bot.status === "meeting" ? "active" : ""}" data-move-bot="${esc(bot.id)}" data-status="meeting">War Room</button>
          <button class="chip-btn ${bot.status === "idle" ? "active" : ""}" data-move-bot="${esc(bot.id)}" data-status="idle">Lounge</button>
        </div>
      </div>`;

    const queueHtml = `
      <div class="insp-queue">
        <div class="insp-section-label">Dispatch Queue (${queued.length})</div>
        <p class="muted" style="margin:0 0 4px;font-size:0.77rem;line-height:1.45">Queued tasks are handed back automatically in <code>orders.nextTask</code> on this bot's next check-in.</p>
        <div class="insp-form-row">
          <input id="insp-queue-input" class="insp-input" type="text" placeholder="Stack next queued task…" />
          <button class="btn btn-primary" style="padding:6px 11px;font-size:0.75rem" data-add-queue="${esc(bot.id)}">+ Queue</button>
        </div>
        ${
          queued.length > 0
            ? queued
                .map(
                  (q, idx) => `
                <div class="insp-queue-item">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="mono muted" style="margin-right:6px">#${idx + 1}</span>${esc(q.task)}</span>
                  <button class="link-btn danger-link" style="font-size:0.74rem" data-del-queue-bot="${esc(bot.id)}" data-del-queue-id="${esc(q.id)}" title="Remove from queue">✕</button>
                </div>`
                )
                .join("")
            : emptyStateHtml({
                icon: "🗂",
                title: "Queue is empty",
                subtitle: "Add a follow-up task above so this bot picks up new work automatically.",
                compact: true,
              })
        }
      </div>`;

    const runsHtml = `
      <div class="insp-logs">
        <div class="insp-section-label">Recent Runs &amp; Deliverables (${botRuns.length})</div>
        ${
          botRuns.length > 0
            ? botRuns
                .map((r) => {
                  const safeUrl = r.outputUrl ? safeHttpsUrl(r.outputUrl) : null;
                  return `
                  <div class="insp-log-item">
                    <div style="min-width:0;flex:1">
                      <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.task)}</div>
                      <div class="muted" style="font-size:0.72rem;margin-top:2px">
                        <span class="mono">${esc(formatDuration(r.durationSec))}</span> · ${esc(r.status)}
                        ${safeUrl ? ` · <a class="deliv-link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ""}
                      </div>
                    </div>
                    ${renderGradeButtons(r)}
                  </div>`;
                })
                .join("")
            : emptyStateHtml({
                icon: "📦",
                title: "No runs logged yet",
                subtitle: "Completed runs and deliverable links for this bot will appear here.",
                compact: true,
              })
        }
      </div>`;

    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="insp-top">
        <div class="insp-head">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            ${miniGrokIcon(bot.avatarColor, true)}
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span class="insp-name">${esc(bot.name)}</span>
                <span class="st-pill st-${esc(bot.status)}">${esc(statusLabel(bot.status))}</span>
              </div>
              <div style="font-size:0.74rem;color:var(--cyan);font-weight:600;margin-top:2px">
                ${esc(bot.role || "Grok Bot")} · <span class="muted">${esc(bot.model)} · <span data-live-ts="${esc(bot.lastSeenAt)}">${esc(timeAgo(bot.lastSeenAt))}</span></span>
              </div>
            </div>
          </div>
          <button id="btn-close-insp" class="btn-icon" title="Close inspector (Esc)" aria-label="Close inspector">✕</button>
        </div>
        <div class="insp-tabs" role="tablist">
          <button class="insp-tab ${inspectorTab === "overview" ? "active" : ""}" data-insp-tab="overview" role="tab">Overview</button>
          <button class="insp-tab ${inspectorTab === "queue" ? "active" : ""}" data-insp-tab="queue" role="tab">Queue <span class="num">(${queued.length})</span></button>
          <button class="insp-tab ${inspectorTab === "runs" ? "active" : ""}" data-insp-tab="runs" role="tab">Runs <span class="num">(${botRuns.length})</span></button>
        </div>
      </div>

      <div class="insp-body">
        ${inspectorTab === "queue" ? queueHtml : inspectorTab === "runs" ? runsHtml : overviewHtml}
      </div>

      <div class="insp-footer">
        <button class="btn btn-secondary" style="flex:1" data-copy-grok-prompt="${esc(bot.id)}" title="Copy instruction block to paste into the Grok app">Copy Grok Prompt</button>
        <button class="btn btn-reject" data-delete-bot="${esc(bot.id)}" data-delete-bot-name="${esc(bot.name)}" title="Remove bot from office">Remove</button>
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

  // Sortable Leaderboard Header Clicks
  document.querySelectorAll("th.sortable[data-sort-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sortCol;
      if (leaderboardSort.col === col) {
        leaderboardSort.dir = leaderboardSort.dir === "desc" ? "asc" : "desc";
      } else {
        leaderboardSort.col = col;
        leaderboardSort.dir = col === "name" || col === "status" || col === "model" ? "asc" : "desc";
      }
      renderMetricsPage();
    });
  });

  // Command Palette (Ctrl+K / Cmd+K)
  const cmdModal = document.getElementById("cmd-modal");
  const cmdInput = document.getElementById("cmd-input");
  const cmdList = document.getElementById("cmd-list");
  const shortcutsModal = document.getElementById("shortcuts-modal");

  function buildCmdCatalog() {
    const items = [];
    const bots = snapshot?.bots || [];
    bots.forEach((b) => {
      items.push({
        group: "Grok Bots",
        title: b.name,
        subtitle: `${b.role} · ${statusLabel(b.status)}`,
        iconHtml: miniGrokIcon(b.avatarColor),
        keywords: `${b.name} ${b.role} ${b.status} ${b.model} ${b.task}`.toLowerCase(),
        run: () => {
          switchView("office");
          setTimeout(() => office3d.selectBot(b.id), 60);
        },
      });
    });

    const navItems = [
      { title: "Go to 3D Office", subtitle: "Live 3D command stage", icon: "🏢", view: "office" },
      { title: "Go to Fleet", subtitle: "Check-in freshness & queued orders", icon: "🛰", view: "fleet" },
      { title: "Go to Goals & Metrics", subtitle: "Spend, tokens, runs & objectives", icon: "📊", view: "metrics" },
      { title: "Go to Pending Needs", subtitle: "Open approvals & escalations", icon: "✋", view: "needs" },
    ];
    navItems.forEach((n) => {
      items.push({
        group: "Navigation",
        title: n.title,
        subtitle: n.subtitle,
        iconHtml: `<span style="font-size:1rem">${n.icon}</span>`,
        keywords: `${n.title} ${n.subtitle}`.toLowerCase(),
        run: () => switchView(n.view),
      });
    });

    items.push(
      {
        group: "Actions",
        title: "Add New Grok Bot",
        subtitle: "Create bot & copy check-in prompt",
        iconHtml: `<span style="font-size:1rem">➕</span>`,
        keywords: "add new create bot grok",
        run: () => openAddBotModal(),
      },
      {
        group: "Actions",
        title: "Connect Instructions",
        subtitle: "View Grok App prompt & SDK proxy snippets",
        iconHtml: `<span style="font-size:1rem">🔗</span>`,
        keywords: "connect prompt instructions proxy sdk",
        run: () => openConnectModal(),
      },
      {
        group: "Actions",
        title: "Open Guardrails & Alerts",
        subtitle: "Budget caps, circuit-breaker, Discord/Slack webhook",
        iconHtml: `<span style="font-size:1rem">⚙</span>`,
        keywords: "guardrails settings budget cap webhook alerts",
        run: () => openGuardrailsModal(),
      },
      {
        group: "Actions",
        title: soundEnabled ? "Mute Alert Chime" : "Enable Alert Chime",
        subtitle: "Toggle audio notification for approvals & errors",
        iconHtml: `<span style="font-size:1rem">${soundEnabled ? "🔕" : "🔔"}</span>`,
        keywords: "sound chime audio mute alert",
        run: () => soundBtn?.click(),
      },
      {
        group: "Actions",
        title: sidebarCollapsed ? "Expand Right Sidebar" : "Collapse Right Sidebar",
        subtitle: "Widen the 3D office viewport ([)",
        iconHtml: `<span style="font-size:1rem">◧</span>`,
        keywords: "sidebar collapse expand panel toggle",
        run: () => {
          switchView("office");
          toggleSidebar();
        },
      },
      {
        group: "Actions",
        title: "Reset 3D Camera",
        subtitle: "Return to full penthouse overview (0)",
        iconHtml: `<span style="font-size:1rem">🎥</span>`,
        keywords: "camera reset view overview",
        run: () => {
          switchView("office");
          document.getElementById("btn-reset-view")?.click();
        },
      },
      {
        group: "Actions",
        title: "Keyboard Shortcuts",
        subtitle: "Show hotkey reference (?)",
        iconHtml: `<span style="font-size:1rem">⌨</span>`,
        keywords: "keyboard shortcuts hotkeys help",
        run: () => shortcutsModal?.classList.remove("hidden"),
      }
    );

    const openSafe = (snapshot?.pendingNeeds || []).filter(
      (n) => n.status === "open" && (n.severity === "approval" || n.severity === "input")
    );
    if (openSafe.length > 0) {
      items.push({
        group: "Actions",
        title: `Approve All Safe (${openSafe.length})`,
        subtitle: "Approve all open non-error requests at once",
        iconHtml: `<span style="font-size:1rem">✅</span>`,
        keywords: "approve all safe needs",
        run: async () => {
          await fetch("/api/needs/resolve-all", { method: "POST" });
          showToast(`Approved ${openSafe.length} pending requests`, "success");
        },
      });
    }

    ["day", "evening", "night", "now"].forEach((mode) => {
      items.push({
        group: "3D Lighting",
        title: `Lighting: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`,
        subtitle: "Switch penthouse atmosphere",
        iconHtml: `<span style="font-size:1rem">💡</span>`,
        keywords: `lighting light theme ${mode}`,
        run: () => {
          switchView("office");
          document.querySelector(`[data-light="${mode}"]`)?.click();
          showToast(`Lighting set to ${mode}`, "info");
        },
      });
    });

    return items;
  }

  function renderCmdList() {
    if (!cmdList || !cmdInput) return;
    const q = cmdInput.value.trim().toLowerCase();
    const all = buildCmdCatalog();
    cmdItems = q
      ? all.filter((item) => item.title.toLowerCase().includes(q) || item.keywords.includes(q))
      : all;
    if (cmdSelectedIndex >= cmdItems.length) cmdSelectedIndex = 0;

    if (cmdItems.length === 0) {
      cmdList.innerHTML = `<div class="empty-msg" style="padding:20px">No matching commands or bots.</div>`;
      return;
    }

    let html = "";
    let lastGroup = "";
    cmdItems.forEach((item, idx) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        html += `<div class="cmd-group-label">${esc(item.group)}</div>`;
      }
      html += `
        <button type="button" class="cmd-item ${idx === cmdSelectedIndex ? "selected" : ""}" data-cmd-idx="${idx}">
          <span class="cmd-item-left">
            ${item.iconHtml}
            <span style="min-width:0">
              <div style="font-weight:600">${esc(item.title)}</div>
              <div class="cmd-item-sub">${esc(item.subtitle)}</div>
            </span>
          </span>
          <span class="muted" style="font-size:0.72rem">↵</span>
        </button>`;
    });
    cmdList.innerHTML = html;
    const activeBtn = cmdList.querySelector(".cmd-item.selected");
    if (activeBtn) activeBtn.scrollIntoView({ block: "nearest" });
  }

  function openCmdPalette() {
    if (!cmdModal || !cmdInput) return;
    cmdInput.value = "";
    cmdSelectedIndex = 0;
    renderCmdList();
    cmdModal.classList.remove("hidden");
    setTimeout(() => cmdInput.focus(), 15);
  }

  function closeCmdPalette() {
    cmdModal?.classList.add("hidden");
  }

  document.getElementById("btn-cmd-palette")?.addEventListener("click", openCmdPalette);
  cmdModal?.querySelector(".modal-backdrop")?.addEventListener("click", closeCmdPalette);
  cmdInput?.addEventListener("input", () => {
    cmdSelectedIndex = 0;
    renderCmdList();
  });
  cmdInput?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdItems.length > 0) {
        cmdSelectedIndex = (cmdSelectedIndex + 1) % cmdItems.length;
        renderCmdList();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdItems.length > 0) {
        cmdSelectedIndex = (cmdSelectedIndex - 1 + cmdItems.length) % cmdItems.length;
        renderCmdList();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = cmdItems[cmdSelectedIndex];
      if (target) {
        closeCmdPalette();
        target.run();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCmdPalette();
    }
  });
  cmdList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd-idx]");
    if (!btn) return;
    const item = cmdItems[Number(btn.dataset.cmdIdx)];
    if (item) {
      closeCmdPalette();
      item.run();
    }
  });

  // Shortcuts Modal
  document.getElementById("btn-shortcuts")?.addEventListener("click", () => {
    shortcutsModal?.classList.remove("hidden");
  });
  document.getElementById("btn-close-shortcuts")?.addEventListener("click", () => {
    shortcutsModal?.classList.add("hidden");
  });
  shortcutsModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => {
    shortcutsModal.classList.add("hidden");
  });

  // Global Keyboard Shortcuts (Ctrl/Cmd+K, ?, [, 0-6, Esc)
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (cmdModal && !cmdModal.classList.contains("hidden")) closeCmdPalette();
      else openCmdPalette();
      return;
    }

    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (e.key === "Escape") {
        document.activeElement.blur();
        if (cmdModal && !cmdModal.classList.contains("hidden")) closeCmdPalette();
      } else if (e.key === "Enter") {
        if (document.activeElement.id === "insp-task-input") {
          document.querySelector("[data-save-bot-task]")?.click();
        } else if (document.activeElement.id === "insp-queue-input") {
          document.querySelector("[data-add-queue]")?.click();
        }
      }
      return;
    }

    if (e.key === "Escape") {
      if (confirmResolver) {
        finishConfirm(false);
        return;
      }
      const openModal = document.querySelector(".modal:not(.hidden)");
      if (openModal) {
        openModal.classList.add("hidden");
        return;
      }
      selectedBotId = null;
      renderInspector();
      renderTeamList();
      return;
    }

    if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      shortcutsModal?.classList.toggle("hidden");
      return;
    }

    if (e.key === "[" && activeView === "office" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      toggleSidebar();
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

  // Reset Office Data (Using sleek in-app confirmation modal)
  async function clearOfficeData() {
    const ok = await askConfirm({
      title: "Reset Office Data",
      message: "This will clear all bots, activity logs, task runs, pending approvals, and usage history. Are you sure?",
      confirmLabel: "Reset Office",
      danger: true,
    });
    if (!ok) return;
    selectedBotId = null;
    knownOpenNeedIds.clear();
    const res = await fetch("/api/office/reset", { method: "POST" });
    if (res.ok) showToast("Office reset complete", "warn");
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
    if (!goalForm.classList.contains("hidden")) {
      document.getElementById("goal-title-input")?.focus();
    }
  });
  goalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("goal-title-input").value.trim();
    const ownerBotId = document.getElementById("goal-owner-select").value || null;
    const targetLabel = document.getElementById("goal-target-input").value.trim();
    if (!title) return;
    const res = await fetch("/api/objectives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, ownerBotId, targetLabel, progress: 0 }),
    });
    if (res.ok) showToast(`Goal "${title}" created`, "success");
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

  // Unified Fleet View (Grok Mini SVG Avatars + Inline Quick-Assign)
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
      grid.innerHTML = emptyStateHtml({
        icon: "🛰",
        title: "No Grok bots linked yet",
        subtitle: "Add a bot, then paste the office link into its Grok instructions. Each check-in lands live on this Fleet board.",
        actionsHtml: `<button class="btn btn-primary" data-open-modal="add-bot">+ Add First Bot</button>
          <button class="btn btn-secondary" data-open-modal="connect">Connect Instructions</button>`,
      });
    } else if (visible.length === 0) {
      grid.innerHTML = emptyStateHtml({
        icon: "🔍",
        title: "No bots match this filter",
        subtitle: "Try switching back to All to see your entire fleet.",
        compact: true,
      });
    } else {
      grid.innerHTML = visible
        .map((bot) => {
          const botNeeds = openNeeds.filter((n) => n.botId === bot.id);
          const goal = (snapshot.objectives || []).find(
            (o) => o.ownerBotId === bot.id && o.status === "active"
          );
          const queued = (bot.queuedTasks || [])[0];
          const orderBits = [
            queued ? `<div>Next task: <strong>${esc(queued.task)}</strong></div>` : "",
            goal ? `<div>Goal: <strong>${esc(goal.title)}</strong> <span class="mono">${goal.progress}%</span></div>` : "",
            botNeeds.length ? `<div><strong style="color:#fcd34d">${botNeeds.length} open request${botNeeds.length === 1 ? "" : "s"}</strong></div>` : "",
          ]
            .filter(Boolean)
            .join("");
          return `<article class="fleet-card">
            <div class="fleet-card-top">
              <div class="fleet-id">
                ${miniGrokIcon(bot.avatarColor, true)}
                <div style="min-width:0">
                  <div class="fleet-name">${esc(bot.name)}</div>
                  <div class="fleet-role">${esc(bot.role)} · <span class="mono">${esc(bot.model)}</span></div>
                </div>
              </div>
              <div class="fleet-badges">
                <span class="st-pill st-${esc(bot.status)}">${esc(statusLabel(bot.status))}</span>
                <span class="link-pill link-${esc(bot.link || "waiting")}">${linkLabel(bot.link)}</span>
              </div>
            </div>
            <div class="fleet-task">${esc(bot.task || "No task reported")}</div>
            <div class="fleet-meta">Last update <span data-live-ts="${esc(bot.lastSeenAt)}">${esc(timeAgo(bot.lastSeenAt))}</span>${bot.expectedIntervalMinutes > 0 ? ` · every ${bot.expectedIntervalMinutes}m` : ""} · <span class="mono">$${Number(bot.costTotalUsd || 0).toFixed(3)}</span></div>
            <div class="fleet-orders">${orderBits || "<div>No queued orders. Next check-in only reports status.</div>"}</div>
            <form class="fleet-quick-assign" data-fleet-assign-form="${esc(bot.id)}">
              <input type="text" placeholder="Quick-assign next task…" maxlength="140" />
              <button type="submit" class="chip-btn active">Send</button>
            </form>
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
              <span class="bot-sq" style="background:${esc(log.botColor || "#38bdf8")};margin-top:4px"></span>
              <div>
                <div><strong>${esc(log.botName)}</strong> — ${esc(log.message)}</div>
                <div class="act-meta"><span data-live-ts="${esc(log.createdAt)}">${esc(timeAgo(log.createdAt))}</span></div>
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

  function openAddBotModal() {
    refreshAddBotPreview();
    addBotModal.classList.remove("hidden");
    addBotNameInput.focus();
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

  document.getElementById("btn-open-add-bot").addEventListener("click", openAddBotModal);
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
      let copied = false;
      try {
        await navigator.clipboard.writeText(promptText);
        copied = true;
      } catch {
        // Ignore clipboard errors in restricted contexts
      }
      addBotModal.classList.add("hidden");
      document.getElementById("add-bot-form").reset();
      addBotColorInput.value = GROK_PALETTE[0];
      selectedBotId = botId;
      inspectorTab = "overview";
      showToast(copied ? `Added ${name} & copied Grok prompt` : `Added ${name} to office`, "success");
      setTimeout(() => office3d.selectBot(botId), 80);
    }
  });

  // Modals (Connect & Guardrails — Guardrails accessible from topbar + Metrics)
  const connectModal = document.getElementById("connect-modal");
  const settingsModal = document.getElementById("settings-modal");

  function openConnectModal() {
    refreshConnectBotSelect(selectedBotId);
    connectModal.classList.remove("hidden");
  }

  function openGuardrailsModal() {
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
  }

  document.getElementById("btn-connect").addEventListener("click", openConnectModal);
  document.getElementById("connect-bot-select").addEventListener("change", (e) => {
    fillConnectSnippets(e.target.value);
  });
  document.getElementById("btn-fleet-add").addEventListener("click", openAddBotModal);
  document.getElementById("btn-fleet-connect").addEventListener("click", openConnectModal);
  document.getElementById("btn-close-connect").addEventListener("click", () => connectModal.classList.add("hidden"));
  connectModal.querySelector(".modal-backdrop").addEventListener("click", () => connectModal.classList.add("hidden"));

  document.getElementById("btn-open-guardrails").addEventListener("click", openGuardrailsModal);
  document.getElementById("btn-topbar-guardrails")?.addEventListener("click", openGuardrailsModal);
  document.getElementById("btn-close-settings").addEventListener("click", () => settingsModal.classList.add("hidden"));
  settingsModal.querySelector(".modal-backdrop").addEventListener("click", () => settingsModal.classList.add("hidden"));

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch("/api/settings", {
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
    if (res.ok) showToast("Guardrails & alert settings saved", "success");
  });

  document.getElementById("btn-approve-all").addEventListener("click", async () => {
    const res = await fetch("/api/needs/resolve-all", { method: "POST" });
    if (res.ok) showToast("Approved all safe requests", "success");
  });

  // Delegated submit for Fleet Inline Quick-Assign
  document.addEventListener("submit", async (e) => {
    const fleetForm = e.target.closest("[data-fleet-assign-form]");
    if (!fleetForm) return;
    e.preventDefault();
    const botId = fleetForm.dataset.fleetAssignForm;
    const input = fleetForm.querySelector("input");
    const task = input ? input.value.trim() : "";
    if (!task) return;
    const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task }),
    });
    if (res.ok) {
      input.value = "";
      showToast("Task dispatched to bot", "success");
    }
  });

  // Delegated change actions
  document.addEventListener("change", async (e) => {
    const slaSel = e.target.closest("[data-save-bot-sla]");
    if (slaSel) {
      const botId = slaSel.dataset.saveBotSla;
      const val = Number(slaSel.value || 0);
      const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedIntervalMinutes: val }),
      });
      if (res.ok) {
        showToast(val === 0 ? "SLA disabled & alerts cleared" : `SLA set to every ${val}m`, "success");
      }
    }
  });

  // Delegated click actions
  document.addEventListener("click", async (e) => {
    const openModalTrigger = e.target.closest("[data-open-modal]");
    if (openModalTrigger) {
      const m = openModalTrigger.dataset.openModal;
      if (m === "add-bot") openAddBotModal();
      else if (m === "connect") openConnectModal();
      return;
    }

    if (e.target.closest("[data-open-goal-form]")) {
      goalForm.classList.remove("hidden");
      document.getElementById("goal-title-input")?.focus();
      return;
    }

    const inspTabBtn = e.target.closest("[data-insp-tab]");
    if (inspTabBtn) {
      inspectorTab = inspTabBtn.dataset.inspTab;
      renderInspector();
      return;
    }

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
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (res.ok) showToast(rating === 1 ? "Run graded 👍" : rating === -1 ? "Run flagged 👎" : "Grade cleared", "info");
      return;
    }

    const addQueueBtn = e.target.closest("[data-add-queue]");
    if (addQueueBtn) {
      const botId = addQueueBtn.dataset.addQueue;
      const qInput = document.getElementById("insp-queue-input");
      if (qInput && qInput.value.trim()) {
        const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/queue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: qInput.value.trim() }),
        });
        if (res.ok) showToast("Added task to dispatch queue", "success");
      }
      return;
    }

    const delQueueBtn = e.target.closest("[data-del-queue-id]");
    if (delQueueBtn) {
      const botId = delQueueBtn.dataset.delQueueBot;
      const qId = delQueueBtn.dataset.delQueueId;
      const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/queue/${encodeURIComponent(qId)}`, {
        method: "DELETE",
      });
      if (res.ok) showToast("Removed task from queue", "info");
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
          showToast(`Copied office link for ${bot.name}`, "success");
          const orig = copyPromptBtn.textContent;
          copyPromptBtn.textContent = "Copied!";
          setTimeout(() => (copyPromptBtn.textContent = orig), 1500);
        } catch {
          showToast("Clipboard permission blocked", "error");
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
        const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/command`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: taskInput.value.trim() }),
        });
        if (res.ok) showToast("Task assigned", "success");
      }
      return;
    }

    const saveRoleBtn = e.target.closest("[data-save-bot-role]");
    if (saveRoleBtn) {
      const botId = saveRoleBtn.dataset.saveBotRole;
      const roleInput = document.getElementById("insp-role-input");
      if (roleInput && roleInput.value.trim()) {
        const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/command`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: roleInput.value.trim() }),
        });
        if (res.ok) showToast("Role updated", "success");
      }
      return;
    }

    const delBotBtn = e.target.closest("[data-delete-bot]");
    if (delBotBtn) {
      const botId = delBotBtn.dataset.deleteBot;
      const botName = delBotBtn.dataset.deleteBotName || botId;
      const ok = await askConfirm({
        title: `Remove ${botName}?`,
        message: `This will remove ${botName} from the 3D office and clear its open requests. It can re-register anytime if it pings again.`,
        confirmLabel: "Remove Bot",
        danger: true,
      });
      if (!ok) return;
      selectedBotId = null;
      const res = await fetch(`/api/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
      if (res.ok) showToast(`Removed ${botName}`, "warn");
      return;
    }

    const moveBtn = e.target.closest("[data-move-bot]");
    if (moveBtn) {
      const status = moveBtn.dataset.status;
      const res = await fetch(`/api/bots/${encodeURIComponent(moveBtn.dataset.moveBot)}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) showToast(`Moved bot to ${statusLabel(status)}`, "info");
      return;
    }

    const resolveBtn = e.target.closest("[data-resolve]");
    if (resolveBtn) {
      const id = resolveBtn.dataset.resolve;
      const action = resolveBtn.dataset.action;
      const noteEl = document.querySelector(`[data-note-for="${CSS.escape(id)}"]`);
      const res = await fetch(`/api/needs/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: noteEl ? noteEl.value.trim() : "" }),
      });
      if (res.ok) showToast(action === "approve" ? "Request approved" : "Request rejected", action === "approve" ? "success" : "warn");
      return;
    }

    const bumpBtn = e.target.closest("[data-goal-bump]");
    if (bumpBtn) {
      const next = Number(bumpBtn.dataset.next);
      const res = await fetch(`/api/objectives/${encodeURIComponent(bumpBtn.dataset.goalBump)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progress: next }),
      });
      if (res.ok) showToast(next >= 100 ? "Goal completed!" : `Goal progress updated to ${next}%`, "success");
      return;
    }

    const delBtn = e.target.closest("[data-goal-del]");
    if (delBtn) {
      const res = await fetch(`/api/objectives/${encodeURIComponent(delBtn.dataset.goalDel)}`, {
        method: "DELETE",
      });
      if (res.ok) showToast("Goal removed", "info");
      return;
    }

    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
      const target = document.getElementById(copyBtn.dataset.target);
      if (target) {
        try {
          await navigator.clipboard.writeText(target.textContent);
          showToast("Copied to clipboard", "success");
          const orig = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(() => (copyBtn.textContent = orig), 1500);
        } catch {
          showToast("Clipboard permission blocked", "error");
        }
      }
    }
  });

  // Live-Ticking Relative Timestamps (every 15 seconds, zero server polling)
  setInterval(() => {
    document.querySelectorAll("[data-live-ts]").forEach((el) => {
      const ts = el.dataset.liveTs;
      if (ts) el.textContent = timeAgo(ts);
    });
  }, 15000);

  fetchSnapshotFallback();
  connectWS();
})();
