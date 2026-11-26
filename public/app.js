(() => {
  let snapshot = null;
  let selectedBotId = null;
  let inspectorTab = "overview";
  const VIEWS = ["today", "office", "fleet", "tasks", "calendar", "needs", "metrics"];
  let activeView = (() => {
    try {
      const v = localStorage.getItem("grok_hq_view");
      return VIEWS.includes(v) ? v : "today";
    } catch {
      return "today";
    }
  })();
  let calWeekOffset = 0;
  let teamFilter = "all";
  let actFilter = "all";
  let actSearch = "";
  let chartMode = "runs";
  let donutMode = "fleet";
  let fleetFilter = "all";
  let sidebarTab = "roster";
  let needsTab = "open";
  let leaderboardSort = { col: "tasks", dir: "desc" };
  let soundEnabled = localStorage.getItem("grok_hq_chime") !== "off";
  let sidebarCollapsed = localStorage.getItem("grok_hq_sidebar") === "collapsed";
  let knownOpenNeedIds = new Set();
  let firstSnapshotLoaded = false;
  let wsInstance = null;
  let wsReconnectTimer = null;
  let wsReconnectAttempts = 0;
  let inspectorRenderDeferred = false;
  let fleetRenderDeferred = false;
  let needsRenderDeferred = false;
  let tasksRenderDeferred = false;
  let taskListFilter = "all";
  let taskStatusFilter = "open";
  let editingTaskId = null;
  let completingTaskIds = new Set();
  let exitingTaskIds = new Set();
  let justAddedTaskId = null;
  // Bridge secrets live only in the office database. Drafts are generated in memory per session.
  function randomSecret() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  try {
    localStorage.removeItem("grok_hq_gtasks_secret");
  } catch {
    // Storage blocked
  }
  let gtasksDraftSecret = randomSecret();
  let calDraftSecret = randomSecret();
  let cmdSelectedIndex = 0;
  let cmdItems = [];

  function isEditingInside(el) {
    const active = document.activeElement;
    if (!el || !active || !el.contains(active)) return false;
    const tag = active.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  async function apiFetch(url, opts = {}, errorLabel = "Request failed") {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          if (body?.error) detail = `: ${body.error}`;
        } catch {
          // Non-JSON response
        }
        showToast(`${errorLabel}${detail || ` (HTTP ${res.status})`}`, "error");
      }
      return res;
    } catch {
      showToast(`${errorLabel}: network error`, "error");
      return { ok: false, status: 0 };
    }
  }

  const ICONS = {
    volOn: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
    volOff: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
    panelClose: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="10 9 13 12 10 15"/></svg>`,
    panelOpen: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="12 15 9 12 12 9"/></svg>`,
    cpu: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg>`,
    chart: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    target: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    check: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    box: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    search: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    bell: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    sliders: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>`,
    plus: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    link: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    sun: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>`,
    cam: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    help: `<svg class="ui-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };

  const stageEl = document.getElementById("office-3d-stage");
  const labelLayer = document.getElementById("label-layer");
  const tooltipEl = document.getElementById("bot-tooltip");

  function onOfficeBotSelected(botId) {
    const changedBot = selectedBotId !== botId;
    selectedBotId = botId;
    if (changedBot) inspectorTab = "overview";
    renderInspector();
    renderTeamList();
    if (actFilter === "bot") renderActivity();
  }

  // The 3D office (~600 KB with three.js) loads only when the Office tab is opened.
  const office3d = (() => {
    let real = null;
    let loading = null;
    const pending = { bots: null, usage: null, select: null, lighting: null, cam: null, labels: true };
    function load() {
      if (real) return Promise.resolve(real);
      if (loading) return loading;
      stageEl?.classList.add("is-loading");
      loading = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "/office3d.bundle.js?v=10";
        script.async = true;
        script.onload = () => {
          try {
            real = new window.Office3D(stageEl, labelLayer, tooltipEl, onOfficeBotSelected);
            real.showAllLabels = pending.labels;
            if (pending.lighting) real.setLighting(pending.lighting);
            if (pending.cam) real.setCameraMode(pending.cam);
            if (pending.bots) real.updateBots(pending.bots, pending.usage);
            real.setPaused(activeView !== "office");
            real.handleResize();
            if (pending.select) {
              real.selectBot(pending.select);
              pending.select = null;
            }
          } catch (err) {
            showToast("The 3D office could not start on this device", "error");
          }
          stageEl?.classList.remove("is-loading");
          resolve(real);
        };
        script.onerror = () => {
          loading = null;
          stageEl?.classList.remove("is-loading");
          showToast("Could not load the 3D office. Check your connection and try again.", "error");
          resolve(null);
        };
        document.head.appendChild(script);
      });
      return loading;
    }
    return {
      load,
      updateBots(bots, usage) {
        pending.bots = bots;
        pending.usage = usage;
        real?.updateBots(bots, usage);
      },
      setPaused(p) { real?.setPaused(p); },
      handleResize() { real?.handleResize(); },
      focusRoom(room) { real?.focusRoom(room); },
      resetView() { real?.resetView(); },
      selectBot(id) {
        if (real) real.selectBot(id);
        else { pending.select = id; load(); }
      },
      setLighting(mode) { pending.lighting = mode; real?.setLighting(mode); },
      setCameraMode(mode) { pending.cam = mode; real?.setCameraMode(mode); },
      get showAllLabels() { return real ? real.showAllLabels : pending.labels; },
      set showAllLabels(v) { pending.labels = v; if (real) real.showAllLabels = v; },
    };
  })();

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

  const ROOM_LABELS = {
    working: "Work",
    waiting: "Wait",
    error: "Repair",
    meeting: "War Room",
    idle: "Lounge",
    no_report: "Standby",
  };

  function statusLabel(s) {
    return ROOM_LABELS[s] || s;
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
  function showToast(message, type = "info", opts = {}) {
    if (!toastStack) return;
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${esc(message)}</span>`;
    if (opts.actionLabel && typeof opts.onAction === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-undo-btn";
      btn.textContent = opts.actionLabel;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        opts.onAction();
        dismiss();
      });
      el.appendChild(btn);
    }
    toastStack.appendChild(el);
    while (toastStack.children.length > 4) toastStack.firstChild.remove();
    const dismiss = () => {
      if (el.dataset.dismissed) return;
      el.dataset.dismissed = "1";
      el.classList.add("toast-out");
      setTimeout(() => el.remove(), 200);
    };
    el.addEventListener("click", dismiss);
    setTimeout(dismiss, opts.duration || (opts.actionLabel ? 4800 : 3200));
  }

  function playCompleteChime() {
    if (!soundEnabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + i * 0.065);
        gain.gain.setValueAtTime(0.001, now + i * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.06, now + i * 0.065 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.065 + 0.19);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.065);
        osc.stop(now + i * 0.065 + 0.2);
      });
      setTimeout(() => ctx.close().catch(() => {}), 500);
    } catch {
      // AudioContext blocked or unavailable
    }
  }

  // In-App Confirmation Modal
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

  confirmOkBtn?.addEventListener("click", () => finishConfirm(true));
  confirmCancelBtn?.addEventListener("click", () => finishConfirm(false));
  confirmCloseBtn?.addEventListener("click", () => finishConfirm(false));
  confirmModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => finishConfirm(false));

  // Guided Empty State Helper
  function emptyStateHtml({ icon = ICONS.cpu, title, subtitle = "", actionsHtml = "", compact = false }) {
    return `
      <div class="empty-state ${compact ? "empty-state-compact" : ""}">
        <div class="empty-state-icon" aria-hidden="true">${icon}</div>
        <div class="empty-state-title">${esc(title)}</div>
        ${subtitle ? `<div class="empty-state-sub">${esc(subtitle)}</div>` : ""}
        ${actionsHtml ? `<div class="empty-state-actions">${actionsHtml}</div>` : ""}
      </div>`;
  }

  // Alert Chime
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
    soundBtn.innerHTML = soundEnabled ? ICONS.volOn : ICONS.volOff;
    soundBtn.classList.toggle("active", soundEnabled);
    soundBtn.title = soundEnabled ? "Alert chime: On (click to mute)" : "Alert chime: Muted (click to enable)";
  }
  updateSoundBtn();
  soundBtn?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("grok_hq_chime", soundEnabled ? "on" : "off");
    updateSoundBtn();
    showToast(soundEnabled ? "Alert chime enabled" : "Alert chime muted", "info");
    if (soundEnabled) playAlertChime(false);
  });

  // Collapsible Right Sidebar
  const officeViewEl = document.getElementById("view-office");
  const toggleSidebarBtn = document.getElementById("btn-toggle-sidebar");
  function applySidebarState(animateResize = false) {
    officeViewEl?.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    if (toggleSidebarBtn) {
      toggleSidebarBtn.innerHTML = sidebarCollapsed ? ICONS.panelOpen : ICONS.panelClose;
      toggleSidebarBtn.classList.toggle("active", !sidebarCollapsed);
      toggleSidebarBtn.title = sidebarCollapsed ? "Expand right sidebar ([)" : "Collapse right sidebar ([)";
    }
    if (animateResize) setTimeout(() => office3d.handleResize(), 220);
  }
  applySidebarState(false);

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem("grok_hq_sidebar", sidebarCollapsed ? "collapsed" : "expanded");
    applySidebarState(true);
  }
  toggleSidebarBtn?.addEventListener("click", toggleSidebar);

  // Live WebSocket + Reconnect Banner
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
    const wsLabel = document.getElementById("ws-label");
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    wsInstance = ws;

    ws.onopen = () => {
      wsReconnectAttempts = 0;
      wsDot?.classList.add("live");
      if (wsDot) wsDot.title = "Live WebSocket connected";
      if (wsLabel) wsLabel.textContent = "LIVE";
      wsBanner?.classList.add("hidden");
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
      wsDot?.classList.remove("live");
      if (wsDot) wsDot.title = "Reconnecting…";
      if (wsLabel) wsLabel.textContent = "SYNC";
      wsBanner?.classList.remove("hidden");
      const delay = Math.min(20000, 1500 * Math.pow(1.8, wsReconnectAttempts)) + Math.random() * 500;
      wsReconnectAttempts = Math.min(wsReconnectAttempts + 1, 8);
      wsReconnectTimer = setTimeout(connectWS, Math.round(delay));
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // Ignore
      }
    };
  }

  wsRetryBtn?.addEventListener("click", () => {
    wsReconnectAttempts = 0;
    fetchSnapshotFallback();
    connectWS();
    showToast("Reconnecting live stream…", "info");
  });

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
    const openNeedIdSet = new Set(openNeeds.map((n) => n.id));
    let newUrgent = false;
    let newIsError = false;
    openNeeds.forEach((n) => {
      if (!knownOpenNeedIds.has(n.id)) {
        if (firstSnapshotLoaded) {
          newUrgent = true;
          if (n.severity === "error" || n.severity === "budget") newIsError = true;
        }
      }
    });
    knownOpenNeedIds = openNeedIdSet;
    firstSnapshotLoaded = true;
    if (newUrgent) playAlertChime(newIsError);

    document.title = openNeeds.length > 0 ? `(${openNeeds.length}) Grok Bot HQ` : "Grok Bot HQ";

    office3d.updateBots(data.bots || [], data.usageSummary);
    renderAll();
  }

  function renderAll(force = false) {
    if (!snapshot) return;
    renderRoomCounts();
    renderStatusStrip();
    if (activeView === "today") {
      const todayEl = document.getElementById("view-today");
      if (!force && isEditingInside(todayEl)) return;
      renderTodayPage();
    } else if (activeView === "calendar") {
      const calEl = document.getElementById("view-calendar");
      if (!force && isEditingInside(calEl)) return;
      renderCalendarPage();
    } else if (activeView === "office") {
      renderTeamList();
      renderActivity();
      if (selectedBotId) {
        const inspEl = document.getElementById("bot-inspector");
        if (!force && isEditingInside(inspEl)) {
          inspectorRenderDeferred = true;
        } else {
          inspectorRenderDeferred = false;
          renderInspector();
        }
      }
    } else if (activeView === "fleet") {
      const fleetEl = document.getElementById("fleet-grid");
      if (!force && isEditingInside(fleetEl)) {
        fleetRenderDeferred = true;
      } else {
        fleetRenderDeferred = false;
        renderFleet();
      }
    } else if (activeView === "tasks") {
      const tasksEl = document.getElementById("view-tasks");
      if (!force && isEditingInside(tasksEl)) {
        tasksRenderDeferred = true;
      } else {
        tasksRenderDeferred = false;
        renderTasksPage();
      }
    } else if (activeView === "metrics") {
      renderMetricsPage();
    } else if (activeView === "needs") {
      const needsEl = document.getElementById("needs-grid");
      if (!force && isEditingInside(needsEl)) {
        needsRenderDeferred = true;
      } else {
        needsRenderDeferred = false;
        renderNeedsPage();
      }
    }
  }

  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (inspectorRenderDeferred && selectedBotId && !isEditingInside(document.getElementById("bot-inspector"))) {
        inspectorRenderDeferred = false;
        renderInspector();
      }
      if (fleetRenderDeferred && activeView === "fleet" && !isEditingInside(document.getElementById("fleet-grid"))) {
        fleetRenderDeferred = false;
        renderFleet();
      }
      if (tasksRenderDeferred && activeView === "tasks" && !isEditingInside(document.getElementById("view-tasks"))) {
        tasksRenderDeferred = false;
        renderTasksPage();
      }
      if (needsRenderDeferred && activeView === "needs" && !isEditingInside(document.getElementById("needs-grid"))) {
        needsRenderDeferred = false;
        renderNeedsPage();
      }
    }, 150);
  });

  function renderRoomCounts() {
    const { bots, pendingNeeds, usageSummary, lastBotUpdateAt } = snapshot;
    const counts = {
      working: bots.filter((b) => b.status === "working").length,
      waiting: bots.filter((b) => b.status === "waiting").length,
      error: bots.filter((b) => b.status === "error").length,
      meeting: bots.filter((b) => b.status === "meeting").length,
      idle: bots.filter((b) => b.status === "idle").length,
      no_report: bots.filter((b) => b.status === "no_report").length,
    };

    document.getElementById("cnt-all").textContent = String(bots.length);
    document.getElementById("cnt-working").textContent = String(counts.working);
    document.getElementById("cnt-waiting").textContent = String(counts.waiting);
    document.getElementById("cnt-error").textContent = String(counts.error);
    document.getElementById("cnt-meeting").textContent = String(counts.meeting);
    document.getElementById("cnt-idle").textContent = String(counts.idle);
    document.getElementById("cnt-noreport").textContent = String(counts.no_report);

    // Proportional Fleet Health Bar in Sidebar
    const healthBar = document.getElementById("team-health-bar");
    if (healthBar) {
      if (bots.length === 0) {
        healthBar.innerHTML = "";
      } else {
        const order = ["working", "meeting", "idle", "waiting", "error", "no_report"];
        healthBar.innerHTML = order
          .filter((k) => counts[k] > 0)
          .map((k) => {
            const pct = (counts[k] / bots.length) * 100;
            return `<span class="health-seg health-${k}" style="width:${pct.toFixed(1)}%" title="${statusLabel(k)}: ${counts[k]}"></span>`;
          })
          .join("");
      }
    }

    const openNeeds = (pendingNeeds || []).filter((n) => n.status === "open").length;
    const navBadge = document.getElementById("nav-needs-badge");
    navBadge.textContent = String(openNeeds);
    navBadge.classList.toggle("hidden", openNeeds === 0);

    const openTasksCount = (snapshot.tasks || []).filter((t) => t.status !== "completed").length;
    const tasksBadge = document.getElementById("nav-tasks-badge");
    if (tasksBadge) {
      tasksBadge.textContent = String(openTasksCount);
      tasksBadge.classList.toggle("hidden", openTasksCount === 0);
    }

    const lastUpdEl = document.getElementById("last-update-label");
    lastUpdEl.textContent = timeAgo(lastBotUpdateAt);
    if (lastBotUpdateAt) lastUpdEl.dataset.liveTs = lastBotUpdateAt;
    else delete lastUpdEl.dataset.liveTs;

    const remPct = Math.max(0, Math.min(100, Math.round(usageSummary?.usageRemainingPct ?? 100)));
    document.getElementById("usage-left-pill").textContent = usageSummary?.budgetLocked
      ? "CAP LOCKED"
      : `${remPct}% budget`;

    const meterFill = document.getElementById("stage-budget-fill");
    if (meterFill) {
      meterFill.style.width = `${remPct}%`;
      meterFill.style.background = remPct <= 15 ? "var(--red)" : remPct <= 40 ? "var(--amber)" : "var(--green)";
    }

    const pill = document.getElementById("mode-pill");
    if (usageSummary?.budgetLocked) {
      pill.innerHTML = `<span class="live-pulse"></span>CAP STOP`;
      pill.className = "mode-pill locked";
    } else {
      pill.innerHTML = `<span class="live-pulse"></span>LIVE`;
      pill.className = "mode-pill live";
    }
  }

  function miniGrokIcon(color, large = false, status = null) {
    const c = esc(color || "#3b93f0");
    const size = large ? 36 : 28;
    const cls = large ? "grok-mini grok-mini-lg" : "grok-mini";
    const svg = `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><rect x="2" y="1.5" width="20" height="21" rx="7" fill="${c}"/><ellipse cx="9" cy="11.6" rx="2.4" ry="3" fill="#fff"/><ellipse cx="15" cy="11.6" rx="2.4" ry="3" fill="#fff"/><circle cx="9.3" cy="11.8" r="1.25" fill="#0a0a0c"/><circle cx="15.3" cy="11.8" r="1.25" fill="#0a0a0c"/></svg>`;
    if (!status) return svg;
    return `<span class="avatar-wrap">${svg}<span class="avatar-status-dot st-${esc(status)}"></span></span>`;
  }

  function renderTeamList() {
    const bots = snapshot.bots || [];
    document.getElementById("team-count").textContent = String(bots.length);

    const filtered = bots.filter((b) => {
      if (teamFilter === "all") return true;
      return b.status === teamFilter;
    });

    const el = document.getElementById("team-list");
    if (bots.length === 0) {
      el.innerHTML = emptyStateHtml({
        icon: ICONS.cpu,
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
        ${miniGrokIcon(b.avatarColor, false, b.status)}
        <div class="team-info">
          <div class="team-name-row">
            <span class="team-name">${esc(b.name)} <span class="team-role-tag">· ${esc(b.role)}</span></span>
          </div>
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
      el.innerHTML = `<div class="empty-msg">No matching activity events.</div>`;
      return;
    }

    el.innerHTML = filtered
      .slice(0, 50)
      .map((l) => {
        const ts = new Date(l.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const nodeColor =
          l.level === "error"
            ? "var(--red)"
            : l.level === "warn"
            ? "var(--amber)"
            : l.level === "success"
            ? "var(--green)"
            : esc(l.botColor || "#38bdf8");
        return `
        <div class="act-item lvl-${esc(l.level || "info")}" data-select-bot="${esc(l.botId)}">
          <span class="act-node" style="background:${nodeColor}"></span>
          <div style="min-width:0;flex:1">
            <div><strong style="color:var(--text-bright)">${esc(l.botName)}</strong> <span class="muted">—</span> ${esc(l.message)}</div>
            <div class="act-meta">${esc(ts)} · <span data-live-ts="${esc(l.createdAt)}">${esc(timeAgo(l.createdAt))}</span></div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderGradeButtons(run) {
    return `
      <span class="grade-row">
        <button class="grade-btn ${run.qualityRating === 1 ? "active-up" : ""}" data-rate-run="${esc(run.id)}" data-rating="${run.qualityRating === 1 ? 0 : 1}" title="Good run">👍</button>
        <button class="grade-btn ${run.qualityRating === -1 ? "active-down" : ""}" data-rate-run="${esc(run.id)}" data-rating="${run.qualityRating === -1 ? 0 : -1}" title="Flag bad run">👎</button>
      </span>`;
  }

  function renderBudgetRing(remPct, locked) {
    const slot = document.getElementById("m-budget-ring");
    if (!slot) return;
    const clamped = Math.max(0, Math.min(100, Math.round(remPct)));
    const r = 24;
    const C = 2 * Math.PI * r;
    const len = (clamped / 100) * C;
    const stroke = locked || clamped <= 15 ? "#f43f5e" : clamped <= 40 ? "#f59e0b" : "#38bdf8";
    slot.innerHTML = `
      <svg width="62" height="62" viewBox="0 0 62 62">
        <circle cx="31" cy="31" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5.5" />
        <circle cx="31" cy="31" r="${r}" fill="none" stroke="${stroke}" stroke-width="5.5" stroke-linecap="round"
          stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 31 31)" />
      </svg>`;
  }

  // Build chart series from recentRuns (so chart is rich & populated immediately!) or proxy timeline
  function buildRunsSeries(recentRuns, bots) {
    if (recentRuns && recentRuns.length > 0) {
      const byBot = new Map();
      recentRuns.forEach((r) => {
        const key = r.botName || r.botId || "Bot";
        const entry = byBot.get(key) || { label: key.slice(0, 10), fullName: key, value: 0, failed: 0, durSum: 0 };
        entry.value += 1;
        if (r.status === "failed") entry.failed += 1;
        entry.durSum += Number(r.durationSec || 0);
        byBot.set(key, entry);
      });
      return [...byBot.values()]
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((e) => ({
          label: e.label,
          value: e.value,
          errors: e.failed,
          sub: `${e.value} run${e.value === 1 ? "" : "s"}${e.failed ? ` · ${e.failed} failed` : ""} · avg ${formatDuration(Math.round(e.durSum / e.value))}`,
          title: e.fullName,
        }));
    }
    if (bots && bots.length > 0) {
      return bots.slice(0, 10).map((b) => ({
        label: b.name.slice(0, 10),
        title: b.name,
        value: Number(b.tasksCompleted || 0),
        errors: Number(b.errorCount || 0),
        sub: `${b.tasksCompleted || 0} completed · ${b.errorCount || 0} err`,
      }));
    }
    return [];
  }

  function chartIsEmpty(series) {
    return series.length === 0 || series.every((item) => Number(item.value) === 0);
  }

  function renderUsageChart(timeline, recentRuns, bots) {
    const chartEl = document.getElementById("usage-chart");
    const subEl = document.getElementById("usage-chart-sub");
    if (!chartEl) return;

    let series = [];
    if (chartMode === "runs") {
      series = recentRuns && recentRuns.length > 0 ? buildRunsSeries(recentRuns, []) : [];
      if (subEl) subEl.textContent = "Recent task runs & completion volume by agent";
    } else {
      series = (timeline || []).map((t) => ({
        label: t.label,
        title: t.label,
        value: chartMode === "tokens" ? Number(t.tokens || 0) : Number(t.costUsd || 0),
        errors: Number(t.errors || 0),
        sub: `${formatNum(t.tokens)} tok · $${Number(t.costUsd || 0).toFixed(4)} · ${t.requests} req${t.errors > 0 ? ` · ${t.errors} err` : ""}`,
      }));
      if (subEl) {
        subEl.textContent =
          chartMode === "tokens"
            ? "Token throughput logged via /proxy/* or reported telemetry"
            : "Estimated spend ($ USD) over time";
      }
    }

    if (chartIsEmpty(series)) {
      chartEl.innerHTML = emptyStateHtml({
        icon: ICONS.chart,
        title: chartMode === "runs" ? "No task runs logged yet" : "No proxy token telemetry yet",
        subtitle:
          chartMode === "runs"
            ? "Runs appear here as bots report completed work."
            : "Switch to Runs to view check-in volume, or route SDK traffic via /proxy/* for token & cost tracking.",
        compact: true,
      });
      return;
    }

    const W = 580;
    const H = 200;
    const padL = 44;
    const padR = 14;
    const padT = 16;
    const padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const vals = series.map((s) => s.value);
    const maxVal = Math.max(...vals, chartMode === "cost" ? 0.01 : 1);

    const gridSvg = [0, 0.5, 1]
      .map((ratio) => {
        const y = padT + plotH * (1 - ratio);
        const val = maxVal * ratio;
        const lbl =
          chartMode === "cost"
            ? `$${val.toFixed(val < 0.1 ? 3 : 2)}`
            : formatNum(Math.round(val));
        return `
          <line class="svg-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" />
          <text class="svg-axis-label" x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${esc(lbl)}</text>`;
      })
      .join("");

    const stepW = plotW / series.length;
    const barW = Math.min(36, Math.max(12, stepW * 0.52));
    const pts = [];

    const barsSvg = series
      .map((item, idx) => {
        const barH = Math.max(5, (item.value / maxVal) * plotH);
        const cx = padL + stepW * idx + stepW / 2;
        const x = cx - barW / 2;
        const y = padT + plotH - barH;
        pts.push({ x: cx, y });
        const fill = item.errors > 0 ? "url(#barGradErr)" : "url(#barGradOk)";
        return `
          <g class="svg-bar-group" data-bar-idx="${idx}">
            <rect class="svg-bar-rect" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="5" fill="${fill}" />
            <rect class="svg-bar-hit" x="${(padL + stepW * idx).toFixed(1)}" y="${padT}" width="${stepW.toFixed(1)}" height="${plotH + padB}" data-bar-idx="${idx}" />
            <text class="svg-axis-label" x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(item.label)}</text>
          </g>`;
      })
      .join("");

    let areaAndLine = "";
    if (pts.length > 1) {
      const linePts = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const baseY = (padT + plotH).toFixed(1);
      const areaPts = `${pts[0].x.toFixed(1)},${baseY} ${linePts} ${pts[pts.length - 1].x.toFixed(1)},${baseY}`;
      areaAndLine = `
        <polygon fill="url(#areaGlow)" points="${areaPts}" pointer-events="none" />
        <polyline fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${linePts}" pointer-events="none" />
        ${pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.8" fill="#090b10" stroke="#38bdf8" stroke-width="1.8" pointer-events="none" />`).join("")}`;
    }

    chartEl.innerHTML = `
      <svg class="usage-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Activity and usage chart">
        <defs>
          <linearGradient id="barGradOk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.92" />
            <stop offset="100%" stop-color="#0284c7" stop-opacity="0.28" />
          </linearGradient>
          <linearGradient id="barGradErr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fb7185" stop-opacity="0.92" />
            <stop offset="100%" stop-color="#e11d48" stop-opacity="0.28" />
          </linearGradient>
          <linearGradient id="areaGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${gridSvg}
        ${barsSvg}
        ${areaAndLine}
      </svg>
      <div id="chart-tooltip" class="chart-tooltip hidden"></div>`;

    const tip = document.getElementById("chart-tooltip");
    chartEl.querySelectorAll(".svg-bar-hit").forEach((hit) => {
      const moveTip = (ev) => {
        const item = series[Number(hit.dataset.barIdx)];
        if (!item || !tip) return;
        tip.innerHTML = `<div><strong>${esc(item.title)}</strong></div><div class="chart-tooltip-sub">${esc(item.sub)}</div>`;
        tip.classList.remove("hidden");
        const rect = chartEl.getBoundingClientRect();
        const left = Math.max(88, Math.min(rect.width - 88, ev.clientX - rect.left));
        const top = Math.max(46, ev.clientY - rect.top - 8);
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      };
      hit.addEventListener("mouseenter", moveTip);
      hit.addEventListener("mousemove", moveTip);
      hit.addEventListener("mouseleave", () => tip?.classList.add("hidden"));
    });
  }

  // Breakdown Donut (Fleet Status OR Spend by Model)
  const STATUS_COLORS = {
    working: "#10b981",
    waiting: "#f59e0b",
    error: "#f43f5e",
    meeting: "#818cf8",
    idle: "#38bdf8",
    no_report: "#64748b",
  };
  const DONUT_COLORS = ["#38bdf8", "#10b981", "#f59e0b", "#818cf8", "#fb7185", "#94a3b8"];

  function renderBreakdownPanel(bots, models) {
    const wrap = document.getElementById("model-donut-wrap");
    const thead = document.getElementById("model-thead");
    const tbody = document.getElementById("model-tbody");
    if (!wrap || !tbody || !thead) return;

    const r = 46;
    const C = 2 * Math.PI * r;

    if (donutMode === "fleet") {
      thead.innerHTML = `<tr><th>Room / State</th><th class="num-col">Agents</th><th class="num-col">Tasks</th><th class="num-col">Share</th></tr>`;
      const groups = ["working", "waiting", "error", "meeting", "idle", "no_report"]
        .map((st) => {
          const list = bots.filter((b) => b.status === st);
          return {
            key: st,
            label: statusLabel(st),
            count: list.length,
            tasks: list.reduce((acc, b) => acc + Number(b.tasksCompleted || 0), 0),
            color: STATUS_COLORS[st],
          };
        })
        .filter((g) => g.count > 0);

      if (groups.length === 0) {
        wrap.innerHTML = `<svg viewBox="0 0 128 128" width="124" height="124"><circle cx="64" cy="64" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14"/><text x="64" y="64" text-anchor="middle" fill="#8b95a7" font-size="12" font-weight="700" font-family="JetBrains Mono,monospace">0 BOTS</text></svg>`;
        tbody.innerHTML = `<tr><td colspan="4" class="muted">No agents registered yet</td></tr>`;
        return;
      }

      const total = bots.length;
      let offset = 0;
      const segs = groups.map((g) => {
        const frac = g.count / total;
        const len = Math.max(2, frac * C - 2);
        const seg = `<circle cx="64" cy="64" r="${r}" fill="none" stroke="${g.color}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 64 64)" />`;
        offset += frac * C;
        return seg;
      });

      const onlyIdle = groups.length === 1 && groups[0].key === "idle";
      const countY = onlyIdle ? 58 : 68;
      wrap.innerHTML = `
        <svg viewBox="0 0 128 128" width="126" height="126" role="img" aria-label="Fleet status distribution">
          <circle cx="64" cy="64" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14" />
          ${segs.join("")}
          <text x="64" y="${countY}" text-anchor="middle" fill="#f8fafc" font-size="18" font-weight="700" font-family="Space Grotesk,sans-serif">${total}</text>
          ${onlyIdle ? `<text x="64" y="76" text-anchor="middle" fill="#8b95a7" font-size="8.5" font-weight="700" letter-spacing="0.8">IDLE</text>` : ""}
        </svg>`;

      tbody.innerHTML = groups
        .map(
          (g) => `
          <tr>
            <td><span style="display:inline-flex;align-items:center;gap:7px"><span class="model-legend-dot" style="background:${g.color}"></span><strong>${esc(g.label)}</strong></span></td>
            <td class="num-cell mono">${g.count}</td>
            <td class="num-cell mono">${g.tasks}</td>
            <td class="num-cell mono muted">${Math.round((g.count / total) * 100)}%</td>
          </tr>`
        )
        .join("");
      return;
    }

    // By Model mode
    thead.innerHTML = `<tr><th>Model</th><th class="num-col">Requests</th><th class="num-col">Tokens</th><th class="num-col">Est. Cost</th></tr>`;
    if (!models || models.length === 0) {
      wrap.innerHTML = `
        <svg viewBox="0 0 128 128" width="126" height="126">
          <circle cx="64" cy="64" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14" />
          <text x="64" y="61" text-anchor="middle" fill="#8b95a7" font-size="13" font-weight="700" font-family="JetBrains Mono,monospace">$0.00</text>
          <text x="64" y="76" text-anchor="middle" fill="#5d6678" font-size="8.5">NO PROXY LOGS</text>
        </svg>`;
      tbody.innerHTML = `<tr><td colspan="4" class="muted">No proxy spend events yet — switch to Fleet Status to view live bots.</td></tr>`;
      return;
    }

    const totalCost = models.reduce((acc, m) => acc + Number(m.costUsd || 0), 0);
    const totalTokens = models.reduce((acc, m) => acc + Number((m.tokensIn || 0) + (m.tokensOut || 0)), 0);
    const useCost = totalCost > 0;
    const denom = useCost ? totalCost : Math.max(totalTokens, 1);
    let offset = 0;

    const slices = models.slice(0, 6).map((m, i) => {
      const val = useCost ? Number(m.costUsd || 0) : Number((m.tokensIn || 0) + (m.tokensOut || 0));
      const frac = Math.max(0.02, val / denom);
      const len = Math.max(2, frac * C - 2);
      const color = DONUT_COLORS[i % DONUT_COLORS.length];
      const seg = `<circle cx="64" cy="64" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 64 64)" />`;
      offset += frac * C;
      return { seg, color };
    });

    wrap.innerHTML = `
      <svg viewBox="0 0 128 128" width="126" height="126" role="img" aria-label="Spend by model">
        <circle cx="64" cy="64" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14" />
        ${slices.map((s) => s.seg).join("")}
        <text x="64" y="61" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="700" font-family="JetBrains Mono,monospace">$${totalCost.toFixed(totalCost < 1 ? 3 : 2)}</text>
        <text x="64" y="76" text-anchor="middle" fill="#8b95a7" font-size="8.5" font-weight="700">TOTAL SPEND</text>
      </svg>`;

    tbody.innerHTML = models
      .map(
        (m, i) => `
        <tr>
          <td><span style="display:inline-flex;align-items:center;gap:7px"><span class="model-legend-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span><strong>${esc(m.model)}</strong></span></td>
          <td class="num-cell mono">${m.requests}</td>
          <td class="num-cell mono">${formatNum(m.tokensIn + m.tokensOut)}</td>
          <td class="num-cell mono"><strong>$${m.costUsd.toFixed(4)}</strong></td>
        </tr>`
      )
      .join("");
  }

  function sortBotsForLeaderboard(bots) {
    const { col, dir } = leaderboardSort;
    const mul = dir === "asc" ? 1 : -1;
    return [...bots].sort((a, b) => {
      switch (col) {
        case "name": return a.name.localeCompare(b.name) * mul;
        case "status": return a.status.localeCompare(b.status) * mul;
        case "model": return (a.model || "").localeCompare(b.model || "") * mul;
        case "tasks": return ((a.tasksCompleted || 0) - (b.tasksCompleted || 0)) * mul || a.name.localeCompare(b.name);
        case "duration": return ((a.avgDurationSec || 0) - (b.avgDurationSec || 0)) * mul;
        case "quality": return ((a.qualityScorePct ?? -1) - (b.qualityScorePct ?? -1)) * mul;
        case "tokens": return ((a.tokensTotal || 0) - (b.tokensTotal || 0)) * mul;
        case "errors": return ((a.errorCount || 0) - (b.errorCount || 0)) * mul;
        case "lastSeen": return ((Date.parse(a.lastSeenAt || 0) || 0) - (Date.parse(b.lastSeenAt || 0) || 0)) * mul;
        case "cost":
        default: return ((a.costTotalUsd || 0) - (b.costTotalUsd || 0)) * mul || ((b.tasksCompleted || 0) - (a.tasksCompleted || 0));
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

    document.getElementById("dig-cost-per-task").textContent = `$${(usageSummary.costPerCompletedTaskUsd ?? 0).toFixed(4)}`;
    document.getElementById("dig-quality").textContent =
      usageSummary.fleetQualityPct !== null && usageSummary.fleetQualityPct !== undefined ? `${usageSummary.fleetQualityPct}%` : "—";
    document.getElementById("dig-approvals").textContent = String(usageSummary.approvalsResolvedToday ?? 0);
    document.getElementById("dig-failed").textContent = String(usageSummary.failedRunsToday ?? 0);
    document.getElementById("dig-top-bot").textContent = usageSummary.topBotName || "—";

    const costCap = settings?.dailyCostCapUsd || 10;
    const todayCost = usageSummary.todayCostUsd ?? 0;
    const remPct = usageSummary.usageRemainingPct ?? 100;
    document.getElementById("m-budget-pct").textContent = `${remPct}%`;
    renderBudgetRing(remPct, usageSummary.budgetLocked);
    document.getElementById("m-budget-foot").textContent =
      `$${todayCost.toFixed(2)} of $${costCap.toFixed(2)} cap${usageSummary.budgetLocked ? " (LOCKED)" : ""}`;

    const taskTarget = settings?.dailyTaskTarget || 30;
    const tasksDone = usageSummary.todayTasksCompleted ?? 0;
    const taskPct = Math.round((tasksDone / taskTarget) * 100);
    document.getElementById("m-tasks-val").textContent = `${tasksDone} / ${taskTarget}`;
    setBar("m-tasks-bar", taskPct);
    document.getElementById("m-tasks-foot").textContent = `${taskPct}% of daily target (${usageSummary.totalTasksCompleted ?? 0} total)`;

    const hasProxy = (usageSummary.totalRequests ?? 0) > 0 || (usageSummary.todayTokens ?? 0) > 0;
    const kpi3Label = document.getElementById("m-kpi3-label");
    const kpi4Label = document.getElementById("m-kpi4-label");
    const tokPbar = document.getElementById("m-tokens-pbar");

    if (hasProxy) {
      if (kpi3Label) kpi3Label.textContent = "Tokens Today";
      const tokCap = settings?.dailyTokenCap || 500000;
      const todayTok = usageSummary.todayTokens ?? 0;
      document.getElementById("m-tokens-val").textContent = formatNum(todayTok);
      tokPbar?.classList.remove("hidden");
      setBar("m-tokens-bar", (todayTok / tokCap) * 100);
      document.getElementById("m-tokens-foot").textContent =
        `${formatNum(usageSummary.totalTokensIn)} in · ${formatNum(usageSummary.totalTokensOut)} out`;

      if (kpi4Label) kpi4Label.textContent = "Fleet Speed & Health";
      document.getElementById("m-latency-val").textContent = `${usageSummary.avgLatencyMs} ms`;
      document.getElementById("m-health-foot").textContent =
        `p95 ${usageSummary.p95LatencyMs ?? 0} ms · ${usageSummary.errorRatePct ?? 0}% errors · ${usageSummary.totalRequests} req`;
    } else {
      if (kpi3Label) kpi3Label.textContent = "Runs Logged";
      const totalRuns = recentRuns.length;
      const completedRuns = recentRuns.filter((r) => r.status === "completed").length;
      const avgRunDur = totalRuns > 0 ? Math.round(recentRuns.reduce((a, r) => a + Number(r.durationSec || 0), 0) / totalRuns) : 0;
      document.getElementById("m-tokens-val").textContent = String(totalRuns);
      tokPbar?.classList.remove("hidden");
      setBar("m-tokens-bar", totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0);
      document.getElementById("m-tokens-foot").textContent = `${completedRuns} completed · avg ${formatDuration(avgRunDur)}`;

      if (kpi4Label) kpi4Label.textContent = "Fleet Readiness";
      const readyCount = bots.filter((b) => b.status !== "error").length;
      const workingCount = bots.filter((b) => b.status === "working" || b.status === "meeting").length;
      const openNeedsCount = (snapshot.pendingNeeds || []).filter((n) => n.status === "open").length;
      document.getElementById("m-latency-val").textContent = `${readyCount} / ${bots.length}`;
      document.getElementById("m-health-foot").textContent = `${workingCount} active · ${openNeedsCount} open needs`;
    }

    // Interactive Charts (Always populated with real data!)
    renderUsageChart(usageSummary.timeline || [], recentRuns, bots);
    renderBreakdownPanel(bots, usageSummary.byModel || []);

    // Sortable Leaderboard
    updateLeaderboardSortHeaders();
    const leaderTbody = document.getElementById("agent-leaderboard-tbody");
    if (bots.length === 0) {
      leaderTbody.innerHTML = `<tr><td colspan="11" style="padding:14px">${emptyStateHtml({
        icon: ICONS.cpu,
        title: "No agents registered yet",
        subtitle: "Add your first Grok bot or connect an existing bot via /api/ping or /proxy/*.",
        compact: true,
        actionsHtml: `<button class="btn btn-primary" data-open-modal="add-bot">+ Add Bot</button>
          <button class="btn btn-secondary" data-open-modal="connect">Connect Guide</button>`,
      })}</td></tr>`;
    } else {
      const sortedBots = sortBotsForLeaderboard(bots);
      leaderTbody.innerHTML = sortedBots
        .map(
          (b) => `
          <tr data-jump-bot="${esc(b.id)}">
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                ${miniGrokIcon(b.avatarColor, false, b.status)}
                <div>
                  <div style="font-weight:700;color:var(--text-bright)">${esc(b.name)}</div>
                  <div class="muted" style="font-size:0.74rem">${esc(b.role)}</div>
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
            <td class="muted mono" style="font-size:0.76rem"><span data-live-ts="${esc(b.lastSeenAt)}">${esc(timeAgo(b.lastSeenAt))}</span></td>
          </tr>`
        )
        .join("");
    }

    // Recent Runs
    const runsTbody = document.getElementById("runs-tbody");
    if (recentRuns.length === 0) {
      runsTbody.innerHTML = `<tr><td colspan="6" style="padding:14px">${emptyStateHtml({
        icon: ICONS.box,
        title: "No task runs recorded yet",
        subtitle: "When a bot reports done=1 with an output link or summary, it lands here for quality grading.",
        compact: true,
      })}</td></tr>`;
    } else {
      runsTbody.innerHTML = recentRuns
        .slice(0, 20)
        .map((r) => {
          const safeUrl = r.outputUrl ? safeHttpsUrl(r.outputUrl) : null;
          const runPill = r.status === "completed" ? "st-working" : r.status === "failed" ? "st-error" : "st-idle";
          return `
          <tr>
            <td><strong style="color:var(--text-bright)">${esc(r.botName)}</strong></td>
            <td style="max-width:300px">
              <div style="font-weight:600">${esc(r.task)}</div>
              ${r.resultSummary ? `<div class="muted" style="font-size:0.74rem">${esc(r.resultSummary)}</div>` : ""}
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
        icon: ICONS.target,
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
                    ? `<button class="btn btn-secondary" style="padding:5px 10px;font-size:0.77rem" data-goal-bump="${esc(o.id)}" data-next="${Math.min(100, o.progress + 25)}">+25%</button>
                       <button class="btn btn-approve" style="padding:5px 10px;font-size:0.77rem" data-goal-bump="${esc(o.id)}" data-next="100">Complete</button>`
                    : `<span class="st-pill st-working">Completed</span>`
                }
              </div>
              <button class="btn btn-reject" style="padding:5px 10px;font-size:0.77rem" data-goal-del="${esc(o.id)}">Remove</button>
            </div>
          </div>`;
        })
        .join("");
    }
  }

  function renderNeedsPage() {
    const needs = snapshot.pendingNeeds || [];
    const bots = snapshot.bots || [];
    const openNeeds = needs.filter((n) => n.status === "open");
    const historyNeeds = needs.filter((n) => n.status !== "open");
    const openSafe = openNeeds.filter((n) => n.severity === "approval" || n.severity === "input");
    document.getElementById("btn-approve-all").classList.toggle("hidden", needsTab !== "open" || openSafe.length < 2);

    const openCntEl = document.getElementById("needs-open-count");
    const histCntEl = document.getElementById("needs-history-count");
    if (openCntEl) openCntEl.textContent = String(openNeeds.length);
    if (histCntEl) histCntEl.textContent = String(historyNeeds.length);

    const reviewRuns = runsToReview();
    const reviewCntEl = document.getElementById("needs-review-count");
    if (reviewCntEl) reviewCntEl.textContent = String(reviewRuns.length);
    const grid = document.getElementById("needs-grid");
    if (needsTab === "review") {
      grid.innerHTML = reviewRuns.length
        ? reviewRuns.map((r) => reviewCardHtml(r, bots)).join("")
        : emptyStateHtml({
            icon: ICONS.check,
            title: "Nothing to review",
            subtitle: "Finished agent work from the last 7 days shows up here so you can open the deliverable and rate it.",
          });
      return;
    }
    const visible = needsTab === "history" ? historyNeeds : openNeeds;
    if (visible.length === 0) {
      grid.innerHTML = emptyStateHtml({
        icon: ICONS.check,
        title: needsTab === "history" ? "No resolved history yet" : "All clear — zero open requests",
        subtitle:
          needsTab === "history"
            ? "Approved, rejected, or cleared bot requests will appear here for reference."
            : "When a bot pauses for human approval, hits a loop, or encounters a failure, its request will appear right here.",
      });
      return;
    }

    grid.innerHTML = visible
      .map((n) => {
        const isOpen = n.status === "open";
        const bot = bots.find((b) => b.id === n.botId);
        return `
        <div class="need-card severity-${esc(n.severity)} ${isOpen ? "" : "resolved"}">
          <div class="need-head">
            <div class="need-bot-row">
              ${miniGrokIcon(bot?.avatarColor || "#38bdf8", false)}
              <div style="min-width:0">
                <div class="need-title">${esc(n.botName)} — ${esc(n.title)}</div>
                ${n.createdAt ? `<div class="need-age"><span data-live-ts="${esc(n.createdAt)}">${esc(timeAgo(n.createdAt))}</span></div>` : ""}
              </div>
            </div>
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

    const botOpenNeed = (snapshot.pendingNeeds || []).find((n) => n.botId === bot.id && n.status === "open");
    const botRuns = (snapshot.recentRuns || []).filter((r) => r.botId === bot.id).slice(0, 12);
    const queued = bot.queuedTasks || [];

    const overviewHtml = `
      <div class="insp-task">${esc(bot.task || "Standing by")}</div>

      <div class="insp-kpis">
        <div class="insp-kpi"><span>Tasks</span><strong class="mono">${bot.tasksCompleted}</strong></div>
        <div class="insp-kpi"><span>Avg Dur</span><strong class="mono">${esc(formatDuration(bot.avgDurationSec))}</strong></div>
        <div class="insp-kpi"><span>Spend</span><strong class="mono">$${bot.costTotalUsd.toFixed(3)}</strong></div>
        <div class="insp-kpi"><span>Quality</span><strong class="mono">${bot.qualityScorePct !== null && bot.qualityScorePct !== undefined ? `${bot.qualityScorePct}%` : "—"}</strong></div>
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
            <input id="insp-task-input" class="insp-input" type="text" placeholder="Send command for next check-in…" maxlength="200" />
            <button class="btn btn-primary" style="padding:6px 12px;font-size:0.75rem" data-save-bot-task="${esc(bot.id)}">Send</button>
          </div>
          ${
            queued.length > 0
              ? `<div class="muted" style="font-size:0.72rem;line-height:1.4">Queued next: <strong style="color:var(--text)">${esc(queued[0].task)}</strong>${queued.length > 1 ? ` <span class="mono">(+${queued.length - 1} more)</span>` : ""}</div>`
              : ""
          }
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
          <button class="chip-btn ${bot.status === "working" ? "active" : ""}" data-move-bot="${esc(bot.id)}" data-status="working">Work</button>
          <button class="chip-btn ${bot.status === "waiting" ? "active" : ""}" data-move-bot="${esc(bot.id)}" data-status="waiting">Wait</button>
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
          <button class="btn btn-primary" style="padding:6px 12px;font-size:0.75rem" data-add-queue="${esc(bot.id)}">+ Queue</button>
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
                icon: ICONS.box,
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
                icon: ICONS.box,
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
          <button type="button" id="btn-back-office" class="btn btn-secondary insp-back-btn">Back to office</button>
          <div style="display:flex;align-items:center;gap:11px;min-width:0;flex:1">
            ${miniGrokIcon(bot.avatarColor, true, bot.status)}
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span class="insp-name">${esc(bot.name)}</span>
                <span class="st-pill st-${esc(bot.status)}">${esc(statusLabel(bot.status))}</span>
              </div>
              <div style="font-size:0.73rem;color:var(--accent);font-weight:600;margin-top:2px">
                ${esc(bot.role || "Grok Bot")} · <span class="muted mono">${esc(bot.model)} · <span data-live-ts="${esc(bot.lastSeenAt)}">${esc(timeAgo(bot.lastSeenAt))}</span></span>
              </div>
            </div>
          </div>
          <button id="btn-close-insp" class="btn-icon" title="Close inspector (Esc)" aria-label="Close">✕</button>
        </div>
        <div class="insp-tabs" role="tablist">
          <button class="insp-tab ${inspectorTab === "overview" ? "active" : ""}" data-insp-tab="overview" role="tab">Overview</button>
          <button class="insp-tab ${inspectorTab === "queue" ? "active" : ""}" data-insp-tab="queue" role="tab">Queue <span class="mono">(${queued.length})</span></button>
          <button class="insp-tab ${inspectorTab === "runs" ? "active" : ""}" data-insp-tab="runs" role="tab">Runs <span class="mono">(${botRuns.length})</span></button>
        </div>
      </div>

      <div class="insp-body">
        ${inspectorTab === "queue" ? queueHtml : inspectorTab === "runs" ? runsHtml : overviewHtml}
      </div>

      <div class="insp-footer">
        <button class="btn btn-secondary" style="flex:1" data-copy-grok-prompt="${esc(bot.id)}" title="Copy instruction block to paste into the Grok app">Copy Grok prompt</button>
        <button class="btn btn-reject" data-delete-bot="${esc(bot.id)}" data-delete-bot-name="${esc(bot.name)}" title="Remove bot from office">Remove</button>
      </div>
    `;
  }

  function switchView(viewName) {
    if (!VIEWS.includes(viewName)) viewName = "today";
    activeView = viewName;
    try {
      localStorage.setItem("grok_hq_view", viewName);
    } catch {
      // Storage blocked
    }
    if (viewName === "office") office3d.load();
    document.getElementById("app-root")?.setAttribute("data-active-view", viewName);
    document.querySelectorAll(".nav-tab[data-view]").forEach((b) => {
      const on = b.dataset.view === viewName;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view-panel").forEach((p) =>
      p.classList.toggle("active", p.id === `view-${viewName}`)
    );
    document.querySelectorAll(".office-only").forEach((el) =>
      el.classList.toggle("hidden", viewName !== "office")
    );
    if (typeof office3d.setPaused === "function") {
      office3d.setPaused(viewName !== "office");
    }
    renderAll(true);
    if (viewName === "office" && typeof office3d.handleResize === "function") {
      setTimeout(() => office3d.handleResize(), 40);
    }
    if (viewName === "tasks" && snapshot?.googleTasksSync?.connected) {
      const lastMs = snapshot.googleTasksSync.lastSyncAt ? Date.parse(snapshot.googleTasksSync.lastSyncAt) : 0;
      if (!Number.isFinite(lastMs) || Date.now() - lastMs > 45_000) {
        fetch("/api/tasks/sync", { method: "POST" }).catch(() => {});
      }
    }
  }

  document.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view]");
    if (!viewBtn) return;
    e.preventDefault();
    switchView(viewBtn.dataset.view);
    if (viewBtn.closest(".page-view, .status-strip")) window.scrollTo({ top: 0 });
  });

  document.querySelectorAll("[data-room]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-room]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      office3d.focusRoom(btn.dataset.room);
    });
  });

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

  // Command Palette
  const cmdModal = document.getElementById("cmd-modal");
  const cmdInput = document.getElementById("cmd-input");
  const cmdList = document.getElementById("cmd-list");
  const shortcutsModal = document.getElementById("shortcuts-modal");

  function buildCmdCatalog() {
    const items = [];
    (snapshot?.bots || []).forEach((b) => {
      items.push({
        group: "Grok Bots",
        title: b.name,
        subtitle: `${b.role} · ${statusLabel(b.status)}`,
        iconHtml: miniGrokIcon(b.avatarColor, false, b.status),
        keywords: `${b.name} ${b.role} ${b.status} ${b.model} ${b.task}`.toLowerCase(),
        run: () => {
          switchView("office");
          setTimeout(() => office3d.selectBot(b.id), 60);
        },
      });
    });

    [
      { title: "Go to Today", subtitle: "Your day, inbox and agents at a glance", icon: ICONS.sun, view: "today" },
      { title: "Go to 3D Office", subtitle: "Live 3D office", icon: ICONS.box, view: "office" },
      { title: "Go to Agents", subtitle: "Check-ins, queued orders, add agents", icon: ICONS.cpu, view: "fleet" },
      { title: "Go to Tasks", subtitle: "Google Tasks sync & agent hand-off", icon: ICONS.check, view: "tasks" },
      { title: "Go to Calendar", subtitle: "Google Calendar week view", icon: ICONS.target, view: "calendar" },
      { title: "Go to Inbox", subtitle: "Approvals, alerts and work to review", icon: ICONS.bell, view: "needs" },
      { title: "Go to Insights", subtitle: "Throughput, runs, spend & goals", icon: ICONS.chart, view: "metrics" },
    ].forEach((n) => {
      items.push({
        group: "Navigation",
        title: n.title,
        subtitle: n.subtitle,
        iconHtml: `<span class="kpi-ico">${n.icon}</span>`,
        keywords: `${n.title} ${n.subtitle}`.toLowerCase(),
        run: () => switchView(n.view),
      });
    });

    items.push(
      { group: "Actions", title: "Connect Google Tasks", subtitle: "Two-way auto-sync via private Apps Script bridge", iconHtml: `<span class="kpi-ico">${ICONS.check}</span>`, keywords: "google tasks sync connect import calendar", run: () => openGTasksModal() },
      { group: "Actions", title: "Add an agent", subtitle: "Grok, n8n, webhook or script", iconHtml: `<span class="kpi-ico">${ICONS.plus}</span>`, keywords: "add new create bot grok agent n8n webhook", run: () => openAddBotModal() },
      { group: "Actions", title: "Connect Google Calendar", subtitle: "Private Apps Script bridge", iconHtml: `<span class="kpi-ico">${ICONS.target}</span>`, keywords: "google calendar connect events", run: () => openCalModal() },
      { group: "Actions", title: "Connect Guide", subtitle: "View Grok App prompt & SDK proxy snippets", iconHtml: `<span class="kpi-ico">${ICONS.link}</span>`, keywords: "connect prompt instructions proxy sdk", run: () => openConnectModal() },
      { group: "Actions", title: "Guardrails & Alerts", subtitle: "Budget caps, circuit-breaker, Discord/Slack webhook", iconHtml: `<span class="kpi-ico">${ICONS.sliders}</span>`, keywords: "guardrails settings budget cap webhook alerts", run: () => openGuardrailsModal() },
      { group: "Actions", title: soundEnabled ? "Mute Alert Chime" : "Enable Alert Chime", subtitle: "Toggle audio notification for approvals & errors", iconHtml: `<span class="kpi-ico">${soundEnabled ? ICONS.volOff : ICONS.volOn}</span>`, keywords: "sound chime audio mute alert", run: () => soundBtn?.click() },
      { group: "Actions", title: sidebarCollapsed ? "Expand Right Sidebar" : "Collapse Right Sidebar", subtitle: "Widen the 3D office viewport ([)", iconHtml: `<span class="kpi-ico">${sidebarCollapsed ? ICONS.panelOpen : ICONS.panelClose}</span>`, keywords: "sidebar collapse expand panel toggle", run: () => { switchView("office"); toggleSidebar(); } },
      { group: "Actions", title: "Reset 3D Camera", subtitle: "Return to full penthouse overview (0)", iconHtml: `<span class="kpi-ico">${ICONS.cam}</span>`, keywords: "camera reset view overview", run: () => { switchView("office"); document.getElementById("btn-reset-view")?.click(); } },
      { group: "Actions", title: "Keyboard Shortcuts", subtitle: "Show hotkey reference (?)", iconHtml: `<span class="kpi-ico">${ICONS.help}</span>`, keywords: "keyboard shortcuts hotkeys help", run: () => shortcutsModal?.classList.remove("hidden") }
    );

    const openSafe = (snapshot?.pendingNeeds || []).filter((n) => n.status === "open" && (n.severity === "approval" || n.severity === "input"));
    if (openSafe.length > 0) {
      items.push({
        group: "Actions",
        title: `Approve All Safe (${openSafe.length})`,
        subtitle: "Approve all open non-error requests at once",
        iconHtml: `<span class="kpi-ico">${ICONS.check}</span>`,
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
        iconHtml: `<span class="kpi-ico">${ICONS.sun}</span>`,
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

  function captureCmdItems(raw) {
    const text = raw.trim();
    if (!text || !window.QuickCapture) return [];
    const explicit = QuickCapture.parseQuickCapture(text);
    const c = explicit || QuickCapture.parseAsTask(text);
    if (!c) return [];
    const when = QuickCapture.describeCapture(c);
    const meta = when ? ` · ${when}` : "";
    let item;
    if (c.kind === "bot") {
      const bot = findBotByHandle(c.botHandle);
      item = {
        group: "Capture",
        title: bot ? `Send to ${bot.name}: ${c.title}` : `No agent called @${c.botHandle}`,
        subtitle: bot ? "Queues the order (n8n/webhook agents get it instantly)" : "Type @ and the agent's name or id",
        iconHtml: `<span class="kpi-ico">${ICONS.cpu}</span>`,
        keywords: "",
        run: () => bot && runCapture(c),
      };
    } else if (c.kind === "event") {
      item = {
        group: "Capture",
        title: `Add event: ${c.title}`,
        subtitle: `Google Calendar${meta}`,
        iconHtml: `<span class="kpi-ico">${ICONS.target}</span>`,
        keywords: "",
        run: () => runCapture(c),
      };
    } else {
      item = {
        group: "Capture",
        title: `Add task: ${c.title}`,
        subtitle: `Tasks${meta}${explicit ? "" : " · tip: start with task:, event: or @agent"}`,
        iconHtml: `<span class="kpi-ico">${ICONS.check}</span>`,
        keywords: "",
        run: () => runCapture(c),
      };
    }
    return [{ ...item, explicit: Boolean(explicit) }];
  }

  function renderCmdList() {
    if (!cmdList || !cmdInput) return;
    const raw = cmdInput.value;
    const q = raw.trim().toLowerCase();
    const all = buildCmdCatalog();
    const matches = q ? all.filter((item) => item.title.toLowerCase().includes(q) || item.keywords.includes(q)) : all;
    const capture = captureCmdItems(raw);
    // Explicit capture commands go first; plain text offers "Add task" after any matches.
    cmdItems = capture[0]?.explicit ? [...capture, ...matches] : [...matches, ...capture];
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
          <span class="muted mono" style="font-size:0.72rem">↵</span>
        </button>`;
    });
    cmdList.innerHTML = html;
    cmdList.querySelector(".cmd-item.selected")?.scrollIntoView({ block: "nearest" });
  }

  function openCmdPalette() {
    if (!cmdModal || !cmdInput) return;
    cmdInput.value = "";
    cmdSelectedIndex = 0;
    renderCmdList();
    cmdModal.classList.remove("hidden");
    setTimeout(() => cmdInput.focus(), 15);
  }
  function closeCmdPalette() { cmdModal?.classList.add("hidden"); }

  document.getElementById("btn-cmd-palette")?.addEventListener("click", openCmdPalette);
  cmdModal?.querySelector(".modal-backdrop")?.addEventListener("click", closeCmdPalette);
  cmdInput?.addEventListener("input", () => { cmdSelectedIndex = 0; renderCmdList(); });
  cmdInput?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdItems.length > 0) { cmdSelectedIndex = (cmdSelectedIndex + 1) % cmdItems.length; renderCmdList(); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdItems.length > 0) { cmdSelectedIndex = (cmdSelectedIndex - 1 + cmdItems.length) % cmdItems.length; renderCmdList(); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = cmdItems[cmdSelectedIndex];
      if (target) { closeCmdPalette(); target.run(); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCmdPalette();
    }
  });
  cmdList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd-idx]");
    if (!btn) return;
    const item = cmdItems[Number(btn.dataset.cmdIdx)];
    if (item) { closeCmdPalette(); item.run(); }
  });

  document.getElementById("btn-shortcuts")?.addEventListener("click", () => shortcutsModal?.classList.remove("hidden"));
  document.getElementById("btn-close-shortcuts")?.addEventListener("click", () => shortcutsModal?.classList.add("hidden"));
  shortcutsModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => shortcutsModal.classList.add("hidden"));

  // Global Keyboard Shortcuts
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
        if (document.activeElement.id === "insp-task-input") document.querySelector("[data-save-bot-task]")?.click();
        else if (document.activeElement.id === "insp-queue-input") document.querySelector("[data-add-queue]")?.click();
      }
      return;
    }
    if (e.key === "Escape") {
      if (confirmResolver) { finishConfirm(false); return; }
      const openModal = document.querySelector(".modal:not(.hidden)");
      if (openModal) { openModal.classList.add("hidden"); return; }
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
      document.querySelector(`[data-room="${roomKeys[num]}"]`)?.click();
    }
  });

  async function clearOfficeData() {
    const ok = await askConfirm({
      title: "Reset Office Data",
      message: "This will clear all bots, tasks, activity logs, task runs, pending approvals, and usage history. Are you sure?",
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
    document.querySelectorAll("[data-room]").forEach((b) => b.classList.toggle("active", b.dataset.room === "all"));
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
      document.querySelectorAll("[data-chart-mode]").forEach((b) => b.classList.toggle("active", b.dataset.chartMode === chartMode));
      renderMetricsPage();
    });
  });

  document.querySelectorAll("[data-sb-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sidebarTab = btn.dataset.sbTab;
      document.querySelectorAll("[data-sb-tab]").forEach((b) => b.classList.toggle("active", b.dataset.sbTab === sidebarTab));
      document.getElementById("sb-pane-roster")?.classList.toggle("active", sidebarTab === "roster");
      document.getElementById("sb-pane-timeline")?.classList.toggle("active", sidebarTab === "timeline");
    });
  });

  document.querySelectorAll("[data-needs-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      needsTab = btn.dataset.needsTab;
      document.querySelectorAll("[data-needs-tab]").forEach((b) => b.classList.toggle("active", b.dataset.needsTab === needsTab));
      renderNeedsPage();
    });
  });

  document.querySelectorAll("[data-donut-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      donutMode = btn.dataset.donutMode;
      document.querySelectorAll("[data-donut-mode]").forEach((b) => b.classList.toggle("active", b.dataset.donutMode === donutMode));
      renderMetricsPage();
    });
  });

  const goalForm = document.getElementById("goal-form");
  document.getElementById("btn-toggle-goal-form").addEventListener("click", () => {
    goalForm.classList.toggle("hidden");
    if (!goalForm.classList.contains("hidden")) document.getElementById("goal-title-input")?.focus();
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

  const GROK_PALETTE = [
    "#3b93f0", "#8b5cf6", "#3ecf8e", "#f08a24", "#e152b0", "#f0b429",
    "#2fbfa0", "#e8483f", "#06b6d4", "#ec4899", "#f1efe9", "#64748b",
  ];

  function makeSlug(str) {
    return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "grok-bot";
  }

  function buildGrokAppPrompt(botId, name, role, token) {
    return GrokPrompt.buildGrokAppPrompt(botId, name, role, token || "", location.origin);
  }

  function effectiveLink(bot) {
    const raw = bot?.link || "waiting";
    if ((bot?.expectedIntervalMinutes || 0) <= 0 && (raw === "stale" || raw === "due")) {
      return "standby";
    }
    return raw;
  }

  function linkLabel(link) {
    if (link === "fresh") return "Fresh";
    if (link === "standby") return "Standby";
    if (link === "due") return "Due";
    if (link === "stale") return "Stale";
    if (link === "offline") return "Offline";
    return "Waiting";
  }

  // Executive Fleet View
  function renderFleet() {
    const grid = document.getElementById("fleet-grid");
    const updates = document.getElementById("fleet-updates");
    if (!grid || !snapshot) return;
    const bots = snapshot.bots || [];
    const needs = snapshot.pendingNeeds || [];
    const openNeeds = needs.filter((n) => n.status === "open");
    const usage = snapshot.usageSummary || {};

    const fresh = bots.filter((b) => effectiveLink(b) === "fresh").length;
    const standby = bots.filter((b) => effectiveLink(b) === "standby").length;
    const due = bots.filter((b) => effectiveLink(b) === "due").length;
    const scheduledLate = bots.filter((b) => (b.expectedIntervalMinutes || 0) > 0 && (effectiveLink(b) === "stale" || effectiveLink(b) === "offline")).length;

    document.getElementById("fleet-linked").textContent = String(bots.length);
    document.getElementById("fleet-linked-foot").textContent =
      bots.length === 0 ? "Add a bot, then paste its office link" : `${fresh} fresh · ${standby} standby · ${scheduledLate} late`;
    document.getElementById("fleet-fresh").textContent = String(fresh + standby);
    document.getElementById("fleet-fresh-foot").textContent =
      scheduledLate === 0 && bots.length > 0 ? "All agents healthy or on-demand standby" : `${due} due · ${scheduledLate} missed SLA`;
    document.getElementById("fleet-waiting").textContent = String(openNeeds.length);
    const budgetPct = Math.round(usage.usageRemainingPct ?? 100);
    document.getElementById("fleet-budget").textContent = `${budgetPct}%`;
    document.getElementById("fleet-budget-foot").textContent = usage.budgetLocked ? "Budget lock is on" : `$${(usage.todayCostUsd ?? 0).toFixed(2)} spent today`;

    // Only alert badge for true scheduled SLA misses or open human needs (no false alarm on calm on-demand bots!)
    const badge = document.getElementById("nav-fleet-badge");
    if (badge) {
      const attention = scheduledLate + openNeeds.length;
      badge.textContent = String(attention);
      badge.classList.toggle("hidden", attention === 0);
    }

    const visible = bots.filter((bot) => {
      const lnk = effectiveLink(bot);
      if (fleetFilter === "all") return true;
      if (fleetFilter === "attention") {
        return bot.status === "waiting" || bot.status === "error" || openNeeds.some((n) => n.botId === bot.id) || lnk === "stale";
      }
      return lnk === fleetFilter;
    });

    if (bots.length === 0) {
      grid.innerHTML = emptyStateHtml({
        icon: ICONS.cpu,
        title: "No Grok bots linked yet",
        subtitle: "Add a bot, then paste the office link into its Grok instructions. Each check-in lands live on this Fleet board.",
        actionsHtml: `<button class="btn btn-primary" data-open-modal="add-bot">+ Add First Bot</button>
          <button class="btn btn-secondary" data-open-modal="connect">Connect Guide</button>`,
      });
    } else if (visible.length === 0) {
      grid.innerHTML = emptyStateHtml({
        icon: ICONS.search,
        title: "No bots match this filter",
        subtitle: "Switch back to All to see your entire fleet.",
        compact: true,
      });
    } else {
      grid.innerHTML = visible
        .map((bot) => {
          const lnk = effectiveLink(bot);
          const botNeeds = openNeeds.filter((n) => n.botId === bot.id);
          const goal = (snapshot.objectives || []).find((o) => o.ownerBotId === bot.id && o.status === "active");
          const queuedList = bot.queuedTasks || [];
          const queued = queuedList[0];
          const orderBits = [
            queued
              ? `<div>Next task: <strong>${esc(queued.task)}</strong>${queuedList.length > 1 ? ` <span class="muted mono">(+${queuedList.length - 1} more)</span>` : ""}</div>`
              : "",
            goal ? `<div>Goal: <strong>${esc(goal.title)}</strong> <span class="mono">${goal.progress}%</span></div>` : "",
            botNeeds.length ? `<div><strong style="color:#fcd34d">${botNeeds.length} open request${botNeeds.length === 1 ? "" : "s"}</strong></div>` : "",
          ].filter(Boolean).join("");
          return `<article class="fleet-card fleet-accent-${esc(lnk)}">
            <div class="fleet-card-top">
              <div class="fleet-id">
                ${miniGrokIcon(bot.avatarColor, true, bot.status)}
                <div style="min-width:0">
                  <div class="fleet-name">${esc(bot.name)}</div>
                  <div class="fleet-role">${esc(bot.role)} · <span class="mono">${esc(bot.model)}</span></div>
                </div>
              </div>
              <div class="fleet-badges">
                <span class="kind-pill kind-${esc(bot.agentKind || "grok")}">${esc(KIND_LABELS[bot.agentKind] || "Grok")}</span>
                <span class="link-pill link-${esc(lnk)}">${linkLabel(lnk)}</span>
              </div>
            </div>
            <div class="fleet-stats-strip">
              <div class="fleet-stat-cell"><span>Room</span><strong>${esc(statusLabel(bot.status))}</strong></div>
              <div class="fleet-stat-cell"><span>Last Ping</span><strong data-live-ts="${esc(bot.lastSeenAt)}">${esc(timeAgo(bot.lastSeenAt))}</strong></div>
              <div class="fleet-stat-cell"><span>Completed</span><strong>${bot.tasksCompleted || 0} tasks</strong></div>
            </div>
            <div class="fleet-task">${esc(bot.task || "No task reported")}</div>
            <div class="fleet-orders">${orderBits || "<span>No queued orders — next ping reports status only.</span>"}</div>
            <form class="fleet-quick-assign" data-fleet-assign-form="${esc(bot.id)}">
              <input type="text" placeholder="Quick-assign next task…" maxlength="140" />
              <button type="submit" class="chip-btn active">Send</button>
            </form>
            <div class="fleet-card-actions">
              <button class="btn btn-secondary" data-copy-grok-prompt="${esc(bot.id)}">Copy setup</button>
              <button class="btn btn-secondary" data-jump-bot="${esc(bot.id)}">Open in 3D</button>
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
              <span class="act-node" style="background:${esc(log.botColor || "#38bdf8")}"></span>
              <div>
                <div><strong style="color:var(--text-bright)">${esc(log.botName)}</strong> <span class="muted">—</span> ${esc(log.message)}</div>
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
    if (ping) ping.textContent = buildGrokAppPrompt(id, name, role, bot?.checkinToken || "");
    const n8n = document.getElementById("n8n-snippet");
    if (n8n) n8n.textContent = agentSetupSnippet("n8n", id, bot?.checkinToken || "");
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
    const options = bots.length ? bots : [{ id: "atlas", name: "Atlas (sample)", role: "Market Research" }];
    const current = preferredId || select.value || options[0].id;
    select.innerHTML = options.map((bot) => `<option value="${esc(bot.id)}">${esc(bot.name)}</option>`).join("");
    select.value = options.some((b) => b.id === current) ? current : options[0].id;
    fillConnectSnippets(select.value);
  }

  const addBotModal = document.getElementById("add-bot-modal");
  const addBotNameInput = document.getElementById("add-bot-name");
  const addBotRoleInput = document.getElementById("add-bot-role");
  const addBotColorInput = document.getElementById("add-bot-color");
  const addBotSwatches = document.getElementById("add-bot-colors");
  const addBotPreview = document.getElementById("add-bot-prompt-preview");

  const addBotKindInput = document.getElementById("add-bot-kind");
  const addBotDispatchWrap = document.getElementById("add-bot-dispatch-wrap");
  const addBotDispatchInput = document.getElementById("add-bot-dispatch");
  const addBotPreviewLabel = document.getElementById("add-bot-preview-label");

  function setupTextForKind(kind, botId, name, role, token) {
    if (kind === "grok") return buildGrokAppPrompt(botId, name, role, token);
    return agentSetupSnippet(kind, botId, token);
  }

  function refreshAddBotPreview() {
    const nm = addBotNameInput.value.trim() || "Atlas";
    const rl = addBotRoleInput.value.trim() || "Market Research";
    const kind = addBotKindInput?.value || "grok";
    addBotPreview.textContent = setupTextForKind(kind, makeSlug(nm), nm, rl, "");
    if (addBotPreviewLabel) {
      addBotPreviewLabel.textContent =
        kind === "grok"
          ? "Paste into your Grok bot's instructions:"
          : kind === "script"
          ? "Call these from your script:"
          : "Your flow receives this, then calls doneUrl:";
    }
  }

  document.getElementById("add-bot-kind-group")?.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-kind]");
    if (!opt) return;
    const kind = opt.dataset.kind;
    addBotKindInput.value = kind;
    document.querySelectorAll("#add-bot-kind-group [data-kind]").forEach((b) => {
      const on = b === opt;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    addBotDispatchWrap?.classList.toggle("hidden", !(kind === "n8n" || kind === "webhook"));
    const modelSel = document.getElementById("add-bot-model");
    if (modelSel && kind !== "grok" && modelSel.value.startsWith("grok")) modelSel.value = "claude-sonnet-5.5";
    refreshAddBotPreview();
  });
  function openAddBotModal() {
    refreshAddBotPreview();
    addBotModal.classList.remove("hidden");
    addBotNameInput.focus();
  }

  if (addBotSwatches) {
    addBotSwatches.innerHTML = GROK_PALETTE.map(
      (hex, i) => `<button type="button" class="color-swatch ${i === 0 ? "active" : ""}" data-pick-color="${hex}" style="background:${hex}" title="${hex}"></button>`
    ).join("");
    addBotSwatches.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pick-color]");
      if (!btn) return;
      addBotColorInput.value = btn.dataset.pickColor;
      addBotSwatches.querySelectorAll(".color-swatch").forEach((b) => b.classList.toggle("active", b === btn));
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
    const agentKind = addBotKindInput?.value || "grok";
    const dispatchUrl = addBotDispatchInput?.value.trim() || "";
    if (!name) return;
    if ((agentKind === "n8n" || agentKind === "webhook") && !dispatchUrl) {
      showToast("Add the webhook URL so tasks can be pushed to this agent", "error");
      addBotDispatchInput?.focus();
      return;
    }

    const botId = makeSlug(name);
    const resp = await apiFetch(
      "/api/bots",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId, name, role, avatarColor, status, model, expectedIntervalMinutes, agentKind, dispatchUrl }),
      },
      "Could not add agent"
    );
    if (resp.ok) {
      const created = await resp.json().catch(() => ({}));
      let copied = false;
      try {
        await navigator.clipboard.writeText(
          setupTextForKind(agentKind, created.botId || botId, name, role, created.checkinToken || "")
        );
        copied = true;
      } catch {
        copied = false;
      }
      addBotModal.classList.add("hidden");
      document.getElementById("add-bot-form").reset();
      addBotColorInput.value = GROK_PALETTE[0];
      document.querySelector('#add-bot-kind-group [data-kind="grok"]')?.click();
      selectedBotId = created.botId || botId;
      inspectorTab = "overview";
      showToast(
        copied ? `Added ${name} and copied its setup` : `${name} was added. Copy its setup from the Agents page.`,
        "success"
      );
      if (activeView === "office") setTimeout(() => office3d.selectBot(botId), 80);
    }
  });

  const connectModal = document.getElementById("connect-modal");
  const settingsModal = document.getElementById("settings-modal");

  function openConnectModal() {
    refreshConnectBotSelect(selectedBotId);
    connectModal.classList.remove("hidden");
  }
  function openGuardrailsModal() {
    const s = snapshot?.settings ?? {
      dailyCostCapUsd: 10, dailyTokenCap: 500000, dailyTaskTarget: 30,
      autoIdleMinutes: 5, hardBudgetStop: false, alertWebhookUrl: "",
    };
    document.getElementById("set-cost-cap").value = s.dailyCostCapUsd;
    document.getElementById("set-token-cap").value = s.dailyTokenCap;
    document.getElementById("set-task-target").value = s.dailyTaskTarget;
    document.getElementById("set-auto-idle").value = s.autoIdleMinutes;
    document.getElementById("set-hard-stop").checked = Boolean(s.hardBudgetStop);
    const webhookInput = document.getElementById("set-webhook-url");
    const webhookNote = document.getElementById("webhook-saved-note");
    const clearWebhookBtn = document.getElementById("btn-clear-webhook");
    webhookInput.value = "";
    webhookInput.dataset.clearOnSave = "0";
    const webhookSaved = Boolean(s.alertWebhookConfigured);
    webhookInput.placeholder = webhookSaved ? "A webhook is saved" : "https://discord.com/api/webhooks/...";
    if (webhookNote) {
      webhookNote.textContent = webhookSaved
        ? "A webhook is saved. Leave this blank to keep it, or clear it explicitly."
        : "";
    }
    if (clearWebhookBtn) clearWebhookBtn.classList.toggle("hidden", !webhookSaved);
    settingsModal.classList.remove("hidden");
  }

  document.getElementById("btn-connect").addEventListener("click", () => openAddBotModal());
  document.getElementById("connect-bot-select").addEventListener("change", (e) => fillConnectSnippets(e.target.value));
  document.getElementById("btn-fleet-add").addEventListener("click", openAddBotModal);
  document.getElementById("btn-fleet-connect").addEventListener("click", openConnectModal);
  document.getElementById("btn-close-connect").addEventListener("click", () => connectModal.classList.add("hidden"));
  connectModal.querySelector(".modal-backdrop").addEventListener("click", () => connectModal.classList.add("hidden"));

  document.getElementById("btn-open-guardrails").addEventListener("click", openGuardrailsModal);
  document.getElementById("btn-topbar-guardrails")?.addEventListener("click", openGuardrailsModal);
  document.getElementById("btn-close-settings").addEventListener("click", () => settingsModal.classList.add("hidden"));
  settingsModal.querySelector(".modal-backdrop").addEventListener("click", () => settingsModal.classList.add("hidden"));

  document.getElementById("btn-clear-webhook")?.addEventListener("click", () => {
    const webhookInput = document.getElementById("set-webhook-url");
    const webhookNote = document.getElementById("webhook-saved-note");
    webhookInput.value = "";
    webhookInput.dataset.clearOnSave = "1";
    webhookInput.placeholder = "Webhook will be cleared on save";
    if (webhookNote) webhookNote.textContent = "The saved webhook will be removed when you save.";
  });

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const webhookInput = document.getElementById("set-webhook-url");
    const typedWebhook = webhookInput.value.trim();
    const settingsBody = {
      dailyCostCapUsd: Number(document.getElementById("set-cost-cap").value),
      dailyTokenCap: Number(document.getElementById("set-token-cap").value),
      dailyTaskTarget: Number(document.getElementById("set-task-target").value),
      autoIdleMinutes: Number(document.getElementById("set-auto-idle").value),
      hardBudgetStop: document.getElementById("set-hard-stop").checked,
    };
    if (typedWebhook) settingsBody.alertWebhookUrl = typedWebhook;
    else if (webhookInput.dataset.clearOnSave === "1") settingsBody.clearAlertWebhook = true;
    const res = await apiFetch(
      "/api/settings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settingsBody),
      },
      "Could not save settings"
    );
    if (res.ok) {
      settingsModal.classList.add("hidden");
      showToast("Guardrails & alert settings saved", "success");
    }
  });

  document.getElementById("btn-approve-all").addEventListener("click", async () => {
    const res = await apiFetch("/api/needs/resolve-all", { method: "POST" }, "Could not approve requests");
    if (res.ok) showToast("Approved all safe requests", "success");
  });

  document.addEventListener("submit", async (e) => {
    const fleetForm = e.target.closest("[data-fleet-assign-form]");
    if (!fleetForm) return;
    e.preventDefault();
    const botId = fleetForm.dataset.fleetAssignForm;
    const input = fleetForm.querySelector("input");
    const task = input ? input.value.trim() : "";
    if (!task) return;
    const res = await apiFetch(
      `/api/bots/${encodeURIComponent(botId)}/command`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, enqueue: true }),
      },
      "Could not queue command"
    );
    if (res.ok) {
      input.value = "";
      input.blur();
      fleetRenderDeferred = false;
      const qb = (snapshot?.bots || []).find((b) => b.id === botId);
      const instant = qb?.dispatchConfigured && (qb.agentKind === "n8n" || qb.agentKind === "webhook");
      showToast(instant ? "Sent to the agent now" : "Queued for the next check-in", "success");
    }
  });

  document.addEventListener("change", async (e) => {
    const slaSel = e.target.closest("[data-save-bot-sla]");
    if (slaSel) {
      const botId = slaSel.dataset.saveBotSla;
      const val = Number(slaSel.value || 0);
      const res = await apiFetch(
        `/api/bots/${encodeURIComponent(botId)}/command`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedIntervalMinutes: val }),
        },
        "Could not update SLA"
      );
      if (res.ok) {
        slaSel.blur();
        inspectorRenderDeferred = false;
        showToast(val === 0 ? "SLA disabled & alerts cleared" : `SLA set to every ${val}m`, "success");
      }
    }
  });

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
      inspectorRenderDeferred = false;
      renderInspector();
      return;
    }
    if (e.target.closest("#btn-close-insp, #btn-back-office")) {
      selectedBotId = null;
      inspectorRenderDeferred = false;
      renderInspector();
      renderTeamList();
      return;
    }
    const rateBtn = e.target.closest("[data-rate-run]");
    if (rateBtn) {
      const runId = rateBtn.dataset.rateRun;
      const rating = Number(rateBtn.dataset.rating);
      const res = await apiFetch(
        `/api/runs/${encodeURIComponent(runId)}/rate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rating }),
        },
        "Could not grade run"
      );
      if (res.ok) showToast(rating === 1 ? "Run graded positive" : rating === -1 ? "Run flagged for review" : "Grade cleared", "info");
      return;
    }
    const addQueueBtn = e.target.closest("[data-add-queue]");
    if (addQueueBtn) {
      const botId = addQueueBtn.dataset.addQueue;
      const qInput = document.getElementById("insp-queue-input");
      if (qInput && qInput.value.trim()) {
        const res = await apiFetch(
          `/api/bots/${encodeURIComponent(botId)}/queue`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task: qInput.value.trim() }),
          },
          "Could not add to queue"
        );
        if (res.ok) {
          qInput.value = "";
          qInput.blur();
          inspectorRenderDeferred = false;
          showToast("Added task to dispatch queue", "success");
        }
      }
      return;
    }
    const delQueueBtn = e.target.closest("[data-del-queue-id]");
    if (delQueueBtn) {
      const res = await apiFetch(
        `/api/bots/${encodeURIComponent(delQueueBtn.dataset.delQueueBot)}/queue/${encodeURIComponent(delQueueBtn.dataset.delQueueId)}`,
        { method: "DELETE" },
        "Could not remove queued task"
      );
      if (res.ok) showToast("Removed task from queue", "info");
      return;
    }
    const copyPromptBtn = e.target.closest("[data-copy-grok-prompt]");
    if (copyPromptBtn) {
      const bot = snapshot?.bots?.find((b) => b.id === copyPromptBtn.dataset.copyGrokPrompt);
      if (bot) {
        try {
          await navigator.clipboard.writeText(setupTextForKind(bot.agentKind || "grok", bot.id, bot.name, bot.role, bot.checkinToken || ""));
          showToast(`Copied setup for ${bot.name}`, "success");
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
      document.querySelectorAll("[data-fleet-filter]").forEach((b) => b.classList.toggle("active", b === fleetPill));
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
      const taskInput = document.getElementById("insp-task-input");
      const task = taskInput ? taskInput.value.trim() : "";
      if (task) {
        const res = await apiFetch(
          `/api/bots/${encodeURIComponent(saveTaskBtn.dataset.saveBotTask)}/command`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task, enqueue: true }),
          },
          "Could not queue command"
        );
        if (res.ok) {
          taskInput.value = "";
          taskInput.blur();
          inspectorRenderDeferred = false;
          const qb = (snapshot?.bots || []).find((b) => b.id === botId);
      const instant = qb?.dispatchConfigured && (qb.agentKind === "n8n" || qb.agentKind === "webhook");
      showToast(instant ? "Sent to the agent now" : "Queued for the next check-in", "success");
        }
      }
      return;
    }
    const saveRoleBtn = e.target.closest("[data-save-bot-role]");
    if (saveRoleBtn) {
      const roleInput = document.getElementById("insp-role-input");
      if (roleInput && roleInput.value.trim()) {
        const res = await apiFetch(
          `/api/bots/${encodeURIComponent(saveRoleBtn.dataset.saveBotRole)}/command`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: roleInput.value.trim() }),
          },
          "Could not update role"
        );
        if (res.ok) {
          roleInput.blur();
          inspectorRenderDeferred = false;
          showToast("Role updated", "success");
        }
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
      inspectorRenderDeferred = false;
      const res = await apiFetch(`/api/bots/${encodeURIComponent(botId)}`, { method: "DELETE" }, "Could not remove bot");
      if (res.ok) showToast(`Removed ${botName}`, "warn");
      return;
    }
    const moveBtn = e.target.closest("[data-move-bot]");
    if (moveBtn) {
      const status = moveBtn.dataset.status;
      const res = await apiFetch(
        `/api/bots/${encodeURIComponent(moveBtn.dataset.moveBot)}/command`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        },
        "Could not move bot"
      );
      if (res.ok) showToast(`Moved bot to ${statusLabel(status)}`, "info");
      return;
    }
    const resolveBtn = e.target.closest("[data-resolve]");
    if (resolveBtn) {
      const id = resolveBtn.dataset.resolve;
      const action = resolveBtn.dataset.action;
      const noteEl = document.querySelector(`[data-note-for="${CSS.escape(id)}"]`);
      const res = await apiFetch(
        `/api/needs/${encodeURIComponent(id)}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, note: noteEl ? noteEl.value.trim() : "" }),
        },
        "Could not resolve request"
      );
      if (res.ok) {
        needsRenderDeferred = false;
        showToast(action === "approve" ? "Request approved" : "Request rejected", action === "approve" ? "success" : "warn");
      }
      return;
    }
    const bumpBtn = e.target.closest("[data-goal-bump]");
    if (bumpBtn) {
      const next = Number(bumpBtn.dataset.next);
      const res = await apiFetch(
        `/api/objectives/${encodeURIComponent(bumpBtn.dataset.goalBump)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ progress: next }),
        },
        "Could not update goal"
      );
      if (res.ok) showToast(next >= 100 ? "Goal completed!" : `Goal progress updated to ${next}%`, "success");
      return;
    }
    const delBtn = e.target.closest("[data-goal-del]");
    if (delBtn) {
      const res = await fetch(`/api/objectives/${encodeURIComponent(delBtn.dataset.goalDel)}`, { method: "DELETE" });
      if (res.ok) showToast("Goal removed", "info");
      return;
    }
    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
      if (copyBtn.dataset.target === "add-bot-prompt-preview") {
        showToast("Add the bot to copy a prompt with its check-in token.", "info");
        return;
      }
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

  setInterval(() => {
    document.querySelectorAll("[data-live-ts]").forEach((el) => {
      const ts = el.dataset.liveTs;
      if (ts) el.textContent = timeAgo(ts);
    });
  }, 15000);

  // =========================================================================
  // UNIFIED TASKS & TWO-WAY GOOGLE TASKS SYNC
  // =========================================================================
  const gtasksModal = document.getElementById("gtasks-modal");
  const gtasksScriptEl = document.getElementById("gtasks-script-code");
  const gtasksUrlInput = document.getElementById("gtasks-url-input");
  const gtasksSecretInput = document.getElementById("gtasks-secret-input");
  const gtasksDisconnectBtn = document.getElementById("btn-gtasks-disconnect");

  function buildGoogleTasksAppsScript(secret) {
    const safeSec = String(secret || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `const SECRET = "${safeSec}";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (!SECRET || body.secret !== SECRET) return out({ ok: false, error: "Unauthorized" });
    const act = body.action || "list";

    if (act === "list") {
      const listsRes = Tasks.Tasklists.list({ maxResults: 50 });
      const lists = (listsRes.items || []).map(l => ({ id: l.id, title: l.title, updated: l.updated }));
      const tasks = [];
      lists.forEach(l => {
        const res = Tasks.Tasks.list(l.id, { maxResults: 100, showCompleted: true, showHidden: true });
        (res.items || []).forEach(t => {
          if (!t.title) return;
          tasks.push({
            id: t.id, listId: l.id, title: t.title, notes: t.notes || "",
            due: t.due || null, status: t.status || "needsAction",
            completed: t.completed || null, position: t.position || "", updated: t.updated || ""
          });
        });
      });
      return out({ ok: true, lists, tasks });
    }

    if (act === "create") {
      const resource = { title: body.title, notes: body.notes || "" };
      if (body.due) resource.due = toRfc3339(body.due);
      const created = Tasks.Tasks.insert(resource, body.listId || "@default");
      return out({ ok: true, task: { id: created.id, listId: body.listId || "@default", title: created.title, notes: created.notes || "", due: created.due || null, status: created.status || "needsAction", updated: created.updated || "" } });
    }

    if (act === "update") {
      const resource = { title: body.title, notes: body.notes || "", status: body.status || "needsAction" };
      resource.due = body.due ? toRfc3339(body.due) : null;
      if (resource.status === "needsAction") resource.completed = null;
      const updated = Tasks.Tasks.patch(resource, body.listId, body.taskId);
      return out({ ok: true, task: { id: updated.id, listId: body.listId, title: updated.title, notes: updated.notes || "", due: updated.due || null, status: updated.status || "needsAction", updated: updated.updated || "" } });
    }

    if (act === "delete") {
      Tasks.Tasks.remove(body.listId, body.taskId);
      return out({ ok: true });
    }
    return out({ ok: false, error: "Unknown action" });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function toRfc3339(d) {
  return String(d).length === 10 ? d + "T00:00:00.000Z" : String(d);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
  }

  function refreshGTasksScriptPreview() {
    if (!gtasksScriptEl) return;
    const sec = (gtasksSecretInput?.value || gtasksDraftSecret).trim();
    gtasksScriptEl.textContent = buildGoogleTasksAppsScript(sec);
  }

  function openGTasksModal() {
    if (!gtasksModal) return;
    const syncState = snapshot?.googleTasksSync;
    if (gtasksSecretInput) gtasksSecretInput.value = gtasksDraftSecret;
    refreshGTasksScriptPreview();
    if (gtasksDisconnectBtn) {
      gtasksDisconnectBtn.classList.toggle("hidden", !syncState?.connected);
    }
    gtasksModal.classList.remove("hidden");
  }

  gtasksSecretInput?.addEventListener("input", () => {
    const val = gtasksSecretInput.value.trim();
    if (val) gtasksDraftSecret = val;
    refreshGTasksScriptPreview();
  });

  document.getElementById("btn-open-gtasks-modal")?.addEventListener("click", openGTasksModal);
  document.getElementById("btn-close-gtasks")?.addEventListener("click", () => gtasksModal?.classList.add("hidden"));
  gtasksModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => gtasksModal.classList.add("hidden"));

  document.getElementById("btn-gtasks-sync")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-gtasks-sync");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Syncing…";
    const res = await apiFetch("/api/tasks/sync", { method: "POST" }, "Google Tasks sync failed");
    btn.disabled = false;
    btn.textContent = orig;
    if (res.ok) {
      try {
        const d = await res.json();
        showToast(`Synced ${d.syncedCount ?? 0} Google Tasks`, "success");
      } catch {
        showToast("Google Tasks synced", "success");
      }
    }
  });

  document.getElementById("gtasks-config-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("btn-gtasks-submit");
    const bridgeUrl = gtasksUrlInput ? gtasksUrlInput.value.trim() : "";
    const secret = gtasksSecretInput ? gtasksSecretInput.value.trim() : "";
    if (!bridgeUrl) return;
    if (!secret && !snapshot?.googleTasksSync?.connected) {
      showToast("Paste the shared secret from the script", "error");
      return;
    }
    if (secret) gtasksDraftSecret = secret;
    const orig = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Connecting & syncing…";
    const res = await apiFetch(
      "/api/tasks/config",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bridgeUrl, secret }),
      },
      "Could not connect Google Tasks"
    );
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
    if (res.ok) {
      gtasksModal?.classList.add("hidden");
      try {
        const d = await res.json();
        showToast(`Google Tasks connected — imported ${d.syncedCount ?? 0} tasks`, "success");
      } catch {
        showToast("Google Tasks connected & synced", "success");
      }
    }
  });

  gtasksDisconnectBtn?.addEventListener("click", async () => {
    const ok = await askConfirm({
      title: "Disconnect Google Tasks?",
      message: "This removes the bridge URL and clears cached Google Tasks from Grok Bot HQ (nothing is deleted in your Google account).",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    const res = await apiFetch(
      "/api/tasks/config",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disconnect: true }),
      },
      "Could not disconnect"
    );
    if (res.ok) {
      if (gtasksUrlInput) gtasksUrlInput.value = "";
      gtasksModal?.classList.add("hidden");
      showToast("Google Tasks disconnected", "info");
    }
  });

  function formatDueChip(dueIso, isCompleted) {
    if (!dueIso) return "";
    const datePart = String(dueIso).slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let cls = "";
    let label = datePart;
    if (!isCompleted && datePart < todayStr) {
      cls = "overdue";
      label = `Overdue · ${datePart}`;
    } else if (datePart === todayStr) {
      cls = isCompleted ? "" : "due-soon";
      label = "Due Today";
    } else if (datePart === tomorrow) {
      cls = isCompleted ? "" : "due-soon";
      label = "Due Tomorrow";
    } else {
      label = `Due ${datePart}`;
    }
    return `<span class="task-chip ${cls}">${esc(label)}</span>`;
  }

  function renderTasksPage() {
    if (!snapshot) return;
    const tasks = snapshot.tasks || [];
    const lists = snapshot.taskLists || [{ id: "local", title: "My Tasks" }];
    const bots = snapshot.bots || [];
    const sync = snapshot.googleTasksSync || { connected: false, lastSyncAt: null, error: null };

    // Sync header controls
    const syncPill = document.getElementById("gtasks-sync-pill");
    const syncBtn = document.getElementById("btn-gtasks-sync");
    const openBtn = document.getElementById("btn-open-gtasks-modal");
    const errBanner = document.getElementById("gtasks-error-banner");

    if (syncPill) {
      if (sync.error) {
        syncPill.className = "sync-pill error";
        syncPill.textContent = "Sync error";
      } else if (sync.connected) {
        syncPill.className = "sync-pill connected";
        syncPill.textContent = sync.lastSyncAt ? `Google Synced · ${timeAgo(sync.lastSyncAt)}` : "Google Connected";
        if (sync.lastSyncAt) syncPill.dataset.liveTs = sync.lastSyncAt;
      } else {
        syncPill.className = "sync-pill";
        syncPill.textContent = "Local tasks · Not synced";
        delete syncPill.dataset.liveTs;
      }
    }
    if (syncBtn) syncBtn.classList.toggle("hidden", !sync.connected);
    if (openBtn) {
      openBtn.textContent = sync.connected ? "Google Sync Settings" : "Connect Google Tasks";
      openBtn.className = sync.connected ? "btn btn-secondary" : "btn btn-primary";
    }
    if (errBanner) {
      if (sync.error) {
        errBanner.textContent = `Google Tasks sync issue: ${sync.error}`;
        errBanner.classList.remove("hidden");
      } else {
        errBanner.classList.add("hidden");
      }
    }

    // KPIs
    const todayStr = new Date().toISOString().slice(0, 10);
    const openTasks = tasks.filter((t) => t.status !== "completed");
    const dueCount = openTasks.filter((t) => t.due && String(t.due).slice(0, 10) <= todayStr).length;
    const botAssignedCount = openTasks.filter((t) => Boolean(t.assignedBotId)).length;
    const doneCount = tasks.length - openTasks.length;

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(v);
    };
    setTxt("tasks-kpi-open", openTasks.length);
    setTxt("tasks-kpi-due", dueCount);
    setTxt("tasks-kpi-bots", botAssignedCount);
    setTxt("tasks-kpi-done", doneCount);

    // Populate composer dropdowns while preserving current selection
    const listSel = document.getElementById("task-create-list");
    if (listSel) {
      const prev = listSel.value;
      listSel.innerHTML = lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join("");
      if (lists.some((l) => l.id === prev)) listSel.value = prev;
    }
    const botSel = document.getElementById("task-create-bot");
    if (botSel) {
      const prev = botSel.value;
      botSel.innerHTML =
        `<option value="">No agent (personal)</option>` +
        bots.map((b) => `<option value="${esc(b.id)}">Dispatch → ${esc(b.name)}</option>`).join("");
      if (bots.some((b) => b.id === prev)) botSel.value = prev;
    }

    // List filter pills
    const listMap = new Map(lists.map((l) => [l.id, l.title]));
    if (taskListFilter !== "all" && !listMap.has(taskListFilter)) taskListFilter = "all";
    const pillsEl = document.getElementById("tasks-list-pills");
    if (pillsEl) {
      pillsEl.innerHTML =
        `<button class="chip-btn ${taskListFilter === "all" ? "active" : ""}" data-task-list="all">All Lists <span class="mono">${openTasks.length}</span></button>` +
        lists
          .map((l) => {
            const cnt = openTasks.filter((t) => t.listId === l.id).length;
            return `<button class="chip-btn ${taskListFilter === l.id ? "active" : ""}" data-task-list="${esc(l.id)}">${esc(l.title)} <span class="mono">${cnt}</span></button>`;
          })
          .join("");
    }

    // Status filter tabs active state
    document.querySelectorAll("[data-task-filter]").forEach((b) =>
      b.classList.toggle("active", b.dataset.taskFilter === taskStatusFilter)
    );

    // Filter tasks (keep actively completing tasks visible briefly so the user sees the green check celebration!)
    const next3Days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const visible = tasks.filter((t) => {
      if (taskListFilter !== "all" && t.listId !== taskListFilter) return false;
      const isCelebrating = completingTaskIds.has(t.id);
      if (taskStatusFilter === "open") return t.status !== "completed" || isCelebrating;
      if (taskStatusFilter === "completed") return t.status === "completed";
      if (taskStatusFilter === "bots") return (t.status !== "completed" || isCelebrating) && Boolean(t.assignedBotId);
      if (taskStatusFilter === "due") return (t.status !== "completed" || isCelebrating) && Boolean(t.due) && String(t.due).slice(0, 10) <= next3Days;
      return true;
    });

    const container = document.getElementById("tasks-list-container");
    if (!container) return;
    if (visible.length === 0) {
      container.innerHTML = emptyStateHtml({
        icon: ICONS.check,
        title: taskStatusFilter === "completed" ? "No completed tasks yet" : "No tasks in this view",
        subtitle: sync.connected
          ? "Add a task above — it saves directly to Google Tasks and updates automatically."
          : "Add a local task above, or click Connect Google Tasks to import and two-way sync your Google Tasks.",
      });
      return;
    }

    const botOptionsHtml = (selectedId) =>
      `<option value="">Assign agent…</option>` +
      bots
        .map((b) => `<option value="${esc(b.id)}" ${b.id === selectedId ? "selected" : ""}>${esc(b.name)}</option>`)
        .join("");

    const checkSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

    container.innerHTML = visible
      .map((t) => {
        const isDone = t.status === "completed";
        const isCelebrating = completingTaskIds.has(t.id);
        const isExiting = exitingTaskIds.has(t.id);
        const isJustAdded = justAddedTaskId === t.id;
        const isEditing = editingTaskId === t.id;
        const listTitle = listMap.get(t.listId) || "My Tasks";
        const dueDateVal = t.due ? String(t.due).slice(0, 10) : "";
        const cardClasses = [
          "task-row-card",
          isDone ? "completed" : "",
          isCelebrating ? "completing" : "",
          isExiting ? "exiting" : "",
          isJustAdded ? "just-added" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<article class="${cardClasses}" data-task-card="${esc(t.id)}">
          <div class="task-row-main">
            <button class="task-check-btn ${isDone ? "checked" : ""}" data-toggle-task="${esc(t.id)}" data-next-status="${isDone ? "needsAction" : "completed"}" title="${isDone ? "Mark incomplete" : "Mark complete"}">${checkSvg}</button>
            <div class="task-row-body">
              <div class="task-row-title" data-dblclick-edit="${esc(t.id)}" title="Double-click to edit">${esc(t.title)}${isCelebrating ? `<span class="task-done-pill">✓ Done</span>` : ""}</div>
              ${t.notes ? `<div class="task-row-notes">${esc(t.notes)}</div>` : ""}
              <div class="task-row-meta">
                <span class="task-chip ${t.source === "google" ? "google" : ""}">${t.source === "google" ? "Google · " : ""}${esc(listTitle)}</span>
                ${formatDueChip(t.due, isDone)}
                ${t.assignedBotName ? `<span class="task-chip bot-chip">Bot: ${esc(t.assignedBotName)}</span>` : ""}
              </div>
            </div>
            <div class="task-row-actions">
              ${
                bots.length > 0 && !isDone
                  ? `<select class="task-assign-select" data-assign-task-bot="${esc(t.id)}" title="Dispatch task directly to a Grok bot">${botOptionsHtml(t.assignedBotId)}</select>`
                  : ""
              }
              <button class="btn btn-secondary" style="padding:4px 9px;font-size:0.74rem" data-edit-task="${esc(t.id)}">${isEditing ? "Close" : "Edit"}</button>
              <button class="link-btn danger-link" style="font-size:0.78rem;padding:4px 6px" data-delete-task="${esc(t.id)}" title="Delete task">✕</button>
            </div>
          </div>
          ${
            isEditing
              ? `<form class="task-edit-form" data-save-task-edit="${esc(t.id)}">
                  <div class="task-edit-row">
                    <input type="text" name="title" value="${esc(t.title)}" required maxlength="200" placeholder="Task title…" />
                    <input type="date" name="due" value="${esc(dueDateVal)}" />
                    <button type="submit" class="btn btn-primary" style="padding:6px 12px;font-size:0.76rem">Save</button>
                    <button type="button" class="btn btn-secondary" style="padding:6px 10px;font-size:0.76rem" data-cancel-task-edit>Cancel</button>
                  </div>
                  <textarea name="notes" rows="2" maxlength="1000" placeholder="Notes / details (syncs to Google Tasks notes)…">${esc(t.notes || "")}</textarea>
                </form>`
              : ""
          }
        </article>`;
      })
      .join("");
  }

  function syncQuickDueChips() {
    const dueEl = document.getElementById("task-create-due");
    const val = dueEl ? dueEl.value : "";
    const todayStr = new Date().toISOString().slice(0, 10);
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    document.querySelectorAll("[data-quick-due]").forEach((btn) => {
      const k = btn.dataset.quickDue;
      const isMatch = (k === "today" && val === todayStr) || (k === "tomorrow" && val === tomorrowStr) || (k === "none" && !val);
      btn.classList.toggle("active", isMatch);
    });
  }

  document.getElementById("task-create-due")?.addEventListener("change", syncQuickDueChips);
  document.getElementById("btn-toggle-create-notes")?.addEventListener("click", (e) => {
    const notesEl = document.getElementById("task-create-notes");
    if (!notesEl) return;
    const willShow = notesEl.classList.contains("hidden");
    notesEl.classList.toggle("hidden", !willShow);
    e.currentTarget.classList.toggle("active", willShow);
    if (willShow) notesEl.focus();
  });

  document.getElementById("task-create-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleEl = document.getElementById("task-create-title");
    const notesEl = document.getElementById("task-create-notes");
    const listEl = document.getElementById("task-create-list");
    const dueEl = document.getElementById("task-create-due");
    const botEl = document.getElementById("task-create-bot");
    const title = titleEl ? titleEl.value.trim() : "";
    if (!title) return;

    const notes = notesEl ? notesEl.value.trim() : "";
    const listId = listEl ? listEl.value : "local";
    const due = dueEl && dueEl.value ? dueEl.value : null;
    const assignedBotId = botEl && botEl.value ? botEl.value : null;
    const assignedBot = assignedBotId ? (snapshot?.bots || []).find((b) => b.id === assignedBotId) : null;

    // Optimistic instant insert so adding tasks feels instantaneous
    const tempId = `optimistic-${Date.now()}`;
    const optimisticTask = {
      id: tempId,
      listId,
      title,
      notes,
      due,
      status: "needsAction",
      completedAt: null,
      position: "",
      assignedBotId,
      assignedBotName: assignedBot ? assignedBot.name : null,
      source: snapshot?.googleTasksSync?.connected && listId !== "local" ? "google" : "local",
      updatedAt: new Date().toISOString(),
    };
    if (snapshot) {
      snapshot.tasks = [optimisticTask, ...(snapshot.tasks || [])];
      justAddedTaskId = tempId;
      if (taskStatusFilter === "completed") taskStatusFilter = "open";
      renderTasksPage();
      renderRoomCounts();
      setTimeout(() => {
        if (justAddedTaskId === tempId) justAddedTaskId = null;
      }, 850);
    }

    // Clear and keep cursor focused for rapid multi-task entry!
    titleEl.value = "";
    if (notesEl) {
      notesEl.value = "";
      notesEl.classList.add("hidden");
      document.getElementById("btn-toggle-create-notes")?.classList.remove("active");
    }
    if (dueEl) {
      dueEl.value = "";
      syncQuickDueChips();
    }
    if (botEl) botEl.value = "";
    tasksRenderDeferred = false;
    titleEl.focus();

    const res = await apiFetch(
      "/api/tasks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId, title, notes, due, assignedBotId }),
      },
      "Could not add task"
    );
    if (!res.ok) {
      if (snapshot) {
        snapshot.tasks = (snapshot.tasks || []).filter((t) => t.id !== tempId);
        renderTasksPage();
        renderRoomCounts();
      }
      return;
    }
    try {
      const data = await res.json();
      if (data?.id && snapshot) {
        const item = (snapshot.tasks || []).find((t) => t.id === tempId);
        if (item) {
          item.id = data.id;
          justAddedTaskId = null;
          if (activeView === "tasks" && !isEditingInside(document.getElementById("tasks-list-container"))) {
            renderTasksPage();
          }
        }
      }
    } catch {
      // Ignore JSON parse fallback
    }
    showToast(snapshot?.googleTasksSync?.connected ? "Added & synced to Google Tasks" : "Task added", "success");
  });

  document.addEventListener("submit", async (e) => {
    const editForm = e.target.closest("[data-save-task-edit]");
    if (!editForm) return;
    e.preventDefault();
    const taskId = editForm.dataset.saveTaskEdit;
    const title = editForm.querySelector('[name="title"]')?.value.trim() || "";
    const due = editForm.querySelector('[name="due"]')?.value || null;
    const notes = editForm.querySelector('[name="notes"]')?.value.trim() || "";
    if (!title) return;
    const res = await apiFetch(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, due, notes }),
      },
      "Could not save task"
    );
    if (res.ok) {
      editingTaskId = null;
      tasksRenderDeferred = false;
      showToast("Task updated", "success");
    }
  });

  document.addEventListener("change", async (e) => {
    const assignSel = e.target.closest("[data-assign-task-bot]");
    if (!assignSel) return;
    const taskId = assignSel.dataset.assignTaskBot;
    const botId = assignSel.value || null;
    const res = await apiFetch(
      `/api/tasks/${encodeURIComponent(taskId)}/assign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId }),
      },
      "Could not assign task"
    );
    if (res.ok) {
      assignSel.blur();
      tasksRenderDeferred = false;
      showToast(botId ? "Task dispatched to bot's command queue" : "Unassigned bot from task", botId ? "success" : "info");
    }
  });

  async function toggleTaskCompletion(taskId, nextStatus) {
    const task = (snapshot?.tasks || []).find((t) => t.id === taskId);
    const prevStatus = task ? task.status : nextStatus === "completed" ? "needsAction" : "completed";
    const isCompleting = nextStatus === "completed";

    if (task) {
      task.status = nextStatus;
      task.completedAt = isCompleting ? new Date().toISOString() : null;
    }
    if (activeView === "today") renderTodayPage();
    else if (activeView === "calendar") renderCalendarPage();

    if (isCompleting) {
      playCompleteChime();
      completingTaskIds.add(taskId);
      exitingTaskIds.delete(taskId);
      renderTasksPage();
      renderRoomCounts();

      setTimeout(() => {
        if (!completingTaskIds.has(taskId)) return;
        exitingTaskIds.add(taskId);
        const card = document.querySelector(`[data-task-card="${CSS.escape(taskId)}"]`);
        if (card) card.classList.add("exiting");
      }, 620);

      setTimeout(() => {
        completingTaskIds.delete(taskId);
        exitingTaskIds.delete(taskId);
        if (activeView === "tasks") renderTasksPage();
      }, 860);
    } else {
      completingTaskIds.delete(taskId);
      exitingTaskIds.delete(taskId);
      renderTasksPage();
      renderRoomCounts();
    }

    const res = await apiFetch(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      },
      "Could not update task status"
    );
    if (!res.ok) {
      completingTaskIds.delete(taskId);
      exitingTaskIds.delete(taskId);
      if (task) task.status = prevStatus;
      renderTasksPage();
      renderRoomCounts();
      return;
    }
    if (isCompleting) {
      const label = task?.title ? `Completed: ${task.title.slice(0, 38)}${task.title.length > 38 ? "…" : ""}` : "Task completed";
      showToast(label, "success", {
        actionLabel: "Undo",
        onAction: () => toggleTaskCompletion(taskId, "needsAction"),
      });
    } else {
      showToast("Task reopened", "info");
    }
  }

  document.addEventListener("dblclick", (e) => {
    const titleEl = e.target.closest("[data-dblclick-edit]");
    if (!titleEl) return;
    editingTaskId = titleEl.dataset.dblclickEdit;
    tasksRenderDeferred = false;
    renderTasksPage();
    document.querySelector(`[data-save-task-edit="${CSS.escape(editingTaskId)}"] input[name="title"]`)?.focus();
  });

  document.addEventListener("click", async (e) => {
    const quickDueBtn = e.target.closest("[data-quick-due]");
    if (quickDueBtn) {
      const dueEl = document.getElementById("task-create-due");
      if (dueEl) {
        const mode = quickDueBtn.dataset.quickDue;
        if (mode === "today") dueEl.value = new Date().toISOString().slice(0, 10);
        else if (mode === "tomorrow") dueEl.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        else dueEl.value = "";
        syncQuickDueChips();
      }
      return;
    }
    const listBtn = e.target.closest("[data-task-list]");
    if (listBtn) {
      taskListFilter = listBtn.dataset.taskList;
      renderTasksPage();
      return;
    }
    const filterBtn = e.target.closest("[data-task-filter]");
    if (filterBtn) {
      taskStatusFilter = filterBtn.dataset.taskFilter;
      renderTasksPage();
      return;
    }
    const toggleBtn = e.target.closest("[data-toggle-task]");
    if (toggleBtn) {
      const taskId = toggleBtn.dataset.toggleTask;
      const nextStatus = toggleBtn.dataset.nextStatus;
      toggleTaskCompletion(taskId, nextStatus);
      return;
    }
    const editBtn = e.target.closest("[data-edit-task]");
    if (editBtn) {
      const id = editBtn.dataset.editTask;
      editingTaskId = editingTaskId === id ? null : id;
      tasksRenderDeferred = false;
      renderTasksPage();
      return;
    }
    if (e.target.closest("[data-cancel-task-edit]")) {
      editingTaskId = null;
      tasksRenderDeferred = false;
      renderTasksPage();
      return;
    }
    const delTaskBtn = e.target.closest("[data-delete-task]");
    if (delTaskBtn) {
      const taskId = delTaskBtn.dataset.deleteTask;
      const res = await apiFetch(
        `/api/tasks/${encodeURIComponent(taskId)}`,
        { method: "DELETE" },
        "Could not delete task"
      );
      if (res.ok) {
        if (editingTaskId === taskId) editingTaskId = null;
        showToast("Task deleted", "info");
      }
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && gtasksModal && !gtasksModal.classList.contains("hidden")) {
      gtasksModal.classList.add("hidden");
    }
  });

  // =========================================================================
  // AGENT KINDS (Grok, n8n, webhook, script)
  // =========================================================================
  const KIND_LABELS = { grok: "Grok", n8n: "n8n", webhook: "Webhook", script: "Script" };

  function agentSetupSnippet(kind, botId, token) {
    const base = location.origin;
    const b = encodeURIComponent(botId || "my-agent");
    const t = encodeURIComponent(token || "<CHECKIN_TOKEN>");
    if (kind === "script") {
      return `# Report progress (any language, plain HTTPS GET)
GET ${base}/api/ping?b=${b}&s=w&t=Writing%20report&token=${t}

# Finished, with a deliverable link and one-line result
GET ${base}/api/ping?b=${b}&done=1&out=https://link&result=Done&token=${t}

# Ask a human
GET ${base}/api/ping?b=${b}&s=wait&need=Approve%20send&token=${t}

Every response includes orders.nextTask: run it next.`;
    }
    return `1. Add a Webhook trigger node (POST) and paste its production URL into this agent.
2. Each new task arrives as JSON:
{
  "event": "task.dispatched",
  "botId": "${botId || "my-agent"}",
  "task": "Research 5 competitors",
  "reportUrl": "${base}/api/ping?b=${b}&s=w&t=…&token=${t}",
  "doneUrl": "${base}/api/ping?b=${b}&done=1&t=…&token=${t}"
}
3. At the end of the flow, add an HTTP Request node (GET) to:
   {{$json.doneUrl}}&out=https://link-to-result&result=One%20line
   The matching task checks itself off and lands in your Inbox for review.`;
  }

  function findBotByHandle(handle) {
    const h = String(handle || "").toLowerCase();
    if (!h) return null;
    const bots = snapshot?.bots || [];
    return (
      bots.find((b) => b.id.toLowerCase() === h) ||
      bots.find((b) => b.name.toLowerCase() === h) ||
      bots.find((b) => makeSlug(b.name) === h) ||
      bots.find((b) => b.name.toLowerCase().startsWith(h)) ||
      null
    );
  }

  // =========================================================================
  // INBOX: finished work to review
  // =========================================================================
  function runsToReview() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
    return (snapshot?.recentRuns || []).filter(
      (r) => r.status === "completed" && r.qualityRating === 0 && Date.parse(r.finishedAt || r.startedAt) >= cutoff
    );
  }

  function reviewCardHtml(r, bots) {
    const bot = bots.find((b) => b.id === r.botId);
    const link = r.outputUrl ? safeHttpsUrl(r.outputUrl) : null;
    return `<div class="need-card review-card">
      <div class="need-head">
        <div class="need-bot-row">
          ${miniGrokIcon(bot?.avatarColor || "#ffb547", false)}
          <div style="min-width:0">
            <div class="need-title">${esc(r.botName)} finished: ${esc(r.task)}</div>
            <div class="need-age"><span data-live-ts="${esc(r.finishedAt || r.startedAt)}">${esc(timeAgo(r.finishedAt || r.startedAt))}</span> · ${esc(formatDuration(r.durationSec))}</div>
          </div>
        </div>
        <span class="st-pill st-working">done</span>
      </div>
      ${r.resultSummary ? `<div class="need-desc">${esc(r.resultSummary)}</div>` : ""}
      <div class="need-actions review-actions">
        ${link ? `<a class="btn btn-secondary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open deliverable ↗</a>` : `<span class="muted" style="font-size:0.8rem">No deliverable link</span>`}
        <span class="spacer"></span>
        <button class="btn btn-approve" data-rate-run="${esc(r.id)}" data-rating="1">👍 Good</button>
        <button class="btn btn-reject" data-rate-run="${esc(r.id)}" data-rating="-1">👎 Redo</button>
      </div>
    </div>`;
  }

  // =========================================================================
  // STATUS STRIP (topbar)
  // =========================================================================
  function renderStatusStrip() {
    const bots = snapshot.bots || [];
    const healthy = bots.filter((b) => ["fresh", "standby"].includes(effectiveLink(b))).length;
    const openNeeds = (snapshot.pendingNeeds || []).filter((n) => n.status === "open").length;
    const review = runsToReview().length;
    const budget = Math.round(snapshot.usageSummary?.usageRemainingPct ?? 100);
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("ss-agents", bots.length ? `${healthy}/${bots.length}` : "0");
    set("ss-budget", `${budget}%`);
    set("ss-inbox", String(openNeeds + review));
    document.getElementById("ss-inbox")?.closest(".status-chip")?.classList.toggle("hot", openNeeds > 0);
    document.getElementById("ss-budget")?.closest(".status-chip")?.classList.toggle("hot", budget <= 15);
    const badge = document.getElementById("nav-needs-badge");
    if (badge) {
      badge.textContent = String(openNeeds + review);
      badge.classList.toggle("hidden", openNeeds + review === 0);
    }
  }

  // =========================================================================
  // DATE HELPERS
  // =========================================================================
  function localDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtClock(dateOrIso) {
    const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
  }
  function minutesOfDay(d) {
    return d.getHours() * 60 + d.getMinutes();
  }
  function eventDayKeys(ev) {
    // All-day end dates from Google are exclusive.
    const start = new Date(ev.start);
    const end = new Date(Math.max(Date.parse(ev.end) - (ev.allDay ? 1 : 0), Date.parse(ev.start)));
    const keys = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cur <= end && keys.length < 15) {
      keys.push(localDateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return keys;
  }
  function eventsOnDay(key) {
    return (snapshot?.calendar?.events || []).filter((ev) => eventDayKeys(ev).includes(key));
  }
  function dueKey(t) {
    return t.due ? String(t.due).slice(0, 10) : null;
  }

  // =========================================================================
  // TODAY
  // =========================================================================
  function renderTodayPage() {
    if (!snapshot) return;
    const now = new Date();
    const todayKey = localDateKey(now);
    const bots = snapshot.bots || [];
    const tasks = snapshot.tasks || [];
    const openNeeds = (snapshot.pendingNeeds || []).filter((n) => n.status === "open");
    const review = runsToReview();
    const hour = now.getHours();
    const greet = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    document.getElementById("today-date").textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    document.getElementById("today-greeting").textContent = `${greet}.`;

    const openTasks = tasks.filter((t) => t.status !== "completed");
    const dueToday = openTasks.filter((t) => dueKey(t) && dueKey(t) <= todayKey);
    const eventsToday = eventsOnDay(todayKey);
    const nextEvent = eventsToday.find((ev) => !ev.allDay && Date.parse(ev.start) > now.getTime());
    const working = bots.filter((b) => b.status === "working" || b.status === "meeting");

    const bits = [];
    bits.push(
      openNeeds.length
        ? `<strong>${openNeeds.length}</strong> thing${openNeeds.length === 1 ? "" : "s"} waiting on you`
        : "Nothing is blocked on you"
    );
    bits.push(`<strong>${dueToday.length}</strong> task${dueToday.length === 1 ? "" : "s"} due`);
    if (snapshot.calendar?.sync?.connected) {
      bits.push(
        nextEvent
          ? `next up <strong>${esc(nextEvent.title)}</strong> at ${esc(fmtClock(nextEvent.start))}`
          : `${eventsToday.length ? "no more events today" : "a clear calendar"}`
      );
    }
    bits.push(`<strong>${working.length}</strong> agent${working.length === 1 ? "" : "s"} working`);
    document.getElementById("today-summary").innerHTML = bits.join(" · ") + ".";

    renderDayRail(now, eventsToday, dueToday);

    // Inbox preview
    const inboxEl = document.getElementById("today-inbox");
    document.getElementById("t-inbox-count").textContent = String(openNeeds.length + review.length);
    const inboxRows = [
      ...openNeeds.slice(0, 4).map((n) => {
        const bot = bots.find((b) => b.id === n.botId);
        const urgent = n.severity === "error" || n.severity === "budget";
        return `<div class="t-row ${urgent ? "t-urgent" : ""}">
          ${miniGrokIcon(bot?.avatarColor || "#ffb547", false)}
          <div class="t-main"><div class="t-title">${esc(n.title)}</div><div class="t-sub">${esc(n.botName)} · ${esc(n.severity)} · <span data-live-ts="${esc(n.createdAt)}">${esc(timeAgo(n.createdAt))}</span></div></div>
          <div class="t-actions">
            <button class="mini-btn ok" data-resolve="${esc(n.id)}" data-action="approve" title="Approve">Approve</button>
            <button class="mini-btn no" data-resolve="${esc(n.id)}" data-action="reject" title="Reject">Reject</button>
          </div>
        </div>`;
      }),
      ...review.slice(0, Math.max(0, 4 - Math.min(4, openNeeds.length))).map((r) => {
        const link = r.outputUrl ? safeHttpsUrl(r.outputUrl) : null;
        return `<div class="t-row">
          <span class="t-glyph done">✓</span>
          <div class="t-main"><div class="t-title">${esc(r.task)}</div><div class="t-sub">${esc(r.botName)} finished · ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">open ↗</a>` : "no link"}</div></div>
          <div class="t-actions">
            <button class="mini-btn ok" data-rate-run="${esc(r.id)}" data-rating="1" title="Good work">👍</button>
            <button class="mini-btn no" data-rate-run="${esc(r.id)}" data-rating="-1" title="Needs a redo">👎</button>
          </div>
        </div>`;
      }),
    ];
    inboxEl.innerHTML = inboxRows.length
      ? inboxRows.join("")
      : `<div class="t-empty">You're clear. Approvals and finished work land here.</div>`;

    // My day
    const tasksEl = document.getElementById("today-tasks");
    const myDay = [...dueToday].sort((a, b) => (dueKey(a) || "").localeCompare(dueKey(b) || ""));
    document.getElementById("t-tasks-count").textContent = String(myDay.length);
    const upcoming = openTasks.filter((t) => !dueKey(t) || dueKey(t) > todayKey).slice(0, Math.max(0, 5 - myDay.length));
    const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    const taskRow = (t, faded) => {
      const k = dueKey(t);
      const overdue = k && k < todayKey;
      return `<div class="t-row ${faded ? "t-faded" : ""}">
        <button class="task-check-btn sm" data-toggle-task="${esc(t.id)}" data-next-status="completed" title="Mark complete">${checkSvg}</button>
        <div class="t-main"><div class="t-title">${esc(t.title)}</div>
          <div class="t-sub">${overdue ? `<span class="t-overdue">overdue · ${esc(k)}</span>` : k === todayKey ? "today" : k ? esc(k) : "no date"}${t.assignedBotName ? ` · with ${esc(t.assignedBotName)}` : ""}</div></div>
      </div>`;
    };
    tasksEl.innerHTML =
      myDay.length || upcoming.length
        ? myDay.map((t) => taskRow(t, false)).join("") +
          (upcoming.length ? `<div class="t-divider mono">coming up</div>` + upcoming.map((t) => taskRow(t, true)).join("") : "")
        : `<div class="t-empty">No tasks due. Capture one above.</div>`;

    // Agents at work
    const agentsEl = document.getElementById("today-agents");
    const order = { error: 0, waiting: 1, working: 2, meeting: 3, idle: 4, no_report: 5 };
    const shown = [...bots]
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
      .slice(0, 5);
    agentsEl.innerHTML = shown.length
      ? shown
          .map((b) => {
            const q = (b.queuedTasks || []).length;
            return `<div class="t-row t-click" data-jump-bot="${esc(b.id)}">
            ${miniGrokIcon(b.avatarColor, false, b.status)}
            <div class="t-main"><div class="t-title">${esc(b.name)} <span class="kind-pill kind-${esc(b.agentKind || "grok")}">${esc(KIND_LABELS[b.agentKind] || "Grok")}</span></div>
              <div class="t-sub">${esc(b.task || "No task reported")}${q ? ` · ${q} queued` : ""}</div></div>
            <span class="room-tag st-${esc(b.status)}">${esc(statusLabel(b.status))}</span>
          </div>`;
          })
          .join("")
      : `<div class="t-empty">No agents yet. <button class="link-btn" data-open-modal="add-bot">Add your first agent</button></div>`;

    // Up next
    const agendaEl = document.getElementById("today-agenda");
    if (!snapshot.calendar?.sync?.connected) {
      agendaEl.innerHTML = `<div class="t-empty">Connect Google Calendar to see your day here. <button class="link-btn" data-open-cal-modal>Connect</button></div>`;
    } else {
      const upcomingEvents = (snapshot.calendar.events || [])
        .filter((ev) => Date.parse(ev.end) > now.getTime())
        .slice(0, 6);
      agendaEl.innerHTML = upcomingEvents.length
        ? upcomingEvents
            .map((ev) => {
              const s = new Date(ev.start);
              const sameDay = localDateKey(s) === todayKey;
              const live = !ev.allDay && Date.parse(ev.start) <= now.getTime();
              const when = ev.allDay
                ? sameDay ? "all day" : s.toLocaleDateString(undefined, { weekday: "short" }) + " · all day"
                : (sameDay ? "" : s.toLocaleDateString(undefined, { weekday: "short" }) + " ") + fmtClock(s) + "–" + fmtClock(ev.end);
              return `<div class="t-row ${live ? "t-live" : ""}">
              <span class="t-cal-bar" style="background:${esc(ev.color || "var(--cal)")}"></span>
              <div class="t-main"><div class="t-title">${esc(ev.title)}</div><div class="t-sub">${live ? "<strong>now</strong> · " : ""}${esc(when)}${ev.location ? ` · ${esc(ev.location)}` : ""}</div></div>
            </div>`;
            })
            .join("")
        : `<div class="t-empty">Nothing on the calendar for the next 30 days.</div>`;
    }

    // Since yesterday digest
    const dayAgo = now.getTime() - 24 * 60 * 60_000;
    const runs = snapshot.recentRuns || [];
    const doneRuns = runs.filter((r) => r.status === "completed" && Date.parse(r.finishedAt || r.startedAt) >= dayAgo);
    const failedRuns = runs.filter((r) => r.status === "failed" && Date.parse(r.finishedAt || r.startedAt) >= dayAgo);
    const tasksDone = tasks.filter((t) => t.status === "completed" && t.completedAt && Date.parse(t.completedAt) >= dayAgo);
    const us = snapshot.usageSummary || {};
    const tile = (label, value, tone = "") => `<div class="dg-tile ${tone}"><span>${label}</span><strong class="mono">${value}</strong></div>`;
    const topRuns = doneRuns.slice(0, 3);
    document.getElementById("today-digest").innerHTML = `
      <div class="dg-tiles">
        ${tile("Agent runs finished", doneRuns.length)}
        ${tile("Runs failed", failedRuns.length, failedRuns.length ? "bad" : "")}
        ${tile("Tasks checked off", tasksDone.length)}
        ${tile("Spent today", `$${(us.todayCostUsd ?? 0).toFixed(2)}`)}
        ${tile("Approvals handled", us.approvalsResolvedToday ?? 0)}
      </div>
      <div class="dg-list">
        ${
          topRuns.length
            ? topRuns
                .map((r) => {
                  const link = r.outputUrl ? safeHttpsUrl(r.outputUrl) : null;
                  return `<div class="dg-item"><strong>${esc(r.botName)}</strong> ${esc(r.task)}${r.resultSummary ? ` <span class="muted">— ${esc(r.resultSummary)}</span>` : ""}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">open ↗</a>` : ""}</div>`;
                })
                .join("")
            : `<div class="dg-item muted">No finished agent work in the last 24 hours yet.</div>`
        }
      </div>`;
  }

  function renderDayRail(now, eventsToday, dueToday) {
    const rail = document.getElementById("day-rail");
    if (!rail) return;
    const todayKey = localDateKey(now);
    const timed = eventsToday.filter((ev) => !ev.allDay);
    const allDay = eventsToday.filter((ev) => ev.allDay);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const runs = (snapshot.recentRuns || []).filter((r) => Date.parse(r.startedAt) >= dayStart);

    // Window: 7am-10pm by default, stretched to fit what actually happens today.
    let startH = 7;
    let endH = 22;
    const clampMin = (ms) => (ms - dayStart) / 60000;
    timed.forEach((ev) => {
      startH = Math.min(startH, Math.floor(Math.max(0, clampMin(Date.parse(ev.start))) / 60));
      endH = Math.max(endH, Math.ceil(Math.min(1440, clampMin(Date.parse(ev.end))) / 60));
    });
    runs.forEach((r) => {
      startH = Math.min(startH, Math.floor(clampMin(Date.parse(r.startedAt)) / 60));
    });
    const nowMin = minutesOfDay(now);
    startH = Math.max(0, Math.min(startH, Math.floor(nowMin / 60) - 1));
    endH = Math.min(24, Math.max(endH, Math.ceil(nowMin / 60) + 1));
    const span = (endH - startH) * 60;
    const pct = (min) => Math.max(0, Math.min(100, ((min - startH * 60) / span) * 100));

    const hours = [];
    for (let h = startH; h <= endH; h += 1) {
      const label = h === 0 || h === 24 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;
      hours.push(`<span class="rail-hour ${h % 3 === 0 ? "major" : ""}" style="left:${pct(h * 60)}%"><i></i><b>${label}</b></span>`);
    }

    // Greedy lane packing for overlapping events (max 3 lanes)
    const lanes = [];
    const placed = timed
      .slice()
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .map((ev) => {
        const s = clampMin(Date.parse(ev.start));
        const e = Math.max(s + 15, clampMin(Date.parse(ev.end)));
        let lane = lanes.findIndex((end) => end <= s);
        if (lane === -1) {
          lane = lanes.length < 3 ? lanes.length : lanes.indexOf(Math.min(...lanes));
          if (lane >= lanes.length) lanes.push(0);
        }
        lanes[lane] = e;
        return { ev, s, e, lane };
      });
    const laneCount = Math.max(1, lanes.length);

    const eventBlocks = placed
      .map(({ ev, s, e, lane }) => {
        const left = pct(s);
        const width = Math.max(1.2, pct(e) - left);
        const past = e < nowMin;
        const live = s <= nowMin && e > nowMin;
        return `<div class="rail-ev ${past ? "past" : ""} ${live ? "live" : ""}" style="left:${left}%;width:${width}%;top:calc(${(lane / laneCount) * 100}% + 2px);height:calc(${100 / laneCount}% - 4px);${ev.color ? `--ev:${esc(ev.color)}` : ""}" title="${esc(ev.title)} · ${esc(fmtClock(ev.start))}–${esc(fmtClock(ev.end))}">
          <span>${esc(ev.title)}</span><em>${esc(fmtClock(ev.start))}</em>
        </div>`;
      })
      .join("");

    const runMarks = runs
      .map((r) => {
        const s = clampMin(Date.parse(r.startedAt));
        const e = r.finishedAt ? clampMin(Date.parse(r.finishedAt)) : r.status === "running" ? nowMin : s + 2;
        const left = pct(s);
        const width = Math.max(0.6, pct(Math.max(e, s + 2)) - left);
        const bot = (snapshot.bots || []).find((b) => b.id === r.botId);
        return `<div class="rail-run st-${esc(r.status)}" style="left:${left}%;width:${width}%;--bot:${esc(bot?.avatarColor || "#4fd1b5")}" title="${esc(r.botName)}: ${esc(r.task)} (${esc(r.status)})"></div>`;
      })
      .join("");

    const allDayChips = allDay
      .map((ev) => `<span class="rail-chip" style="${ev.color ? `--ev:${esc(ev.color)}` : ""}">${esc(ev.title)}</span>`)
      .join("");
    const dueChip = dueToday.length
      ? `<button class="rail-chip task" data-view="tasks">${dueToday.length} task${dueToday.length === 1 ? "" : "s"} due</button>`
      : "";
    const calConnected = snapshot.calendar?.sync?.connected;

    rail.innerHTML = `
      <div class="rail-chips">${allDayChips}${dueChip}${
        !calConnected ? `<button class="rail-chip ghost" data-open-cal-modal>+ Connect Google Calendar</button>` : ""
      }${calConnected && !timed.length && !allDay.length ? `<span class="rail-chip ghost">No events today</span>` : ""}</div>
      <div class="rail-track">
        <div class="rail-hours">${hours.join("")}</div>
        <div class="rail-lane rail-lane-cal">${eventBlocks}</div>
        <div class="rail-lane rail-lane-run">${runMarks || `<span class="rail-lane-empty">agent runs appear here as they happen</span>`}</div>
        <div class="rail-now" style="left:${pct(nowMin)}%"><b class="mono">${esc(fmtClock(now))}</b></div>
      </div>`;
    rail.setAttribute(
      "aria-label",
      `Today ${todayKey}: ${timed.length} timed events, ${allDay.length} all-day, ${runs.length} agent runs, ${dueToday.length} tasks due`
    );
  }

  // =========================================================================
  // CALENDAR
  // =========================================================================
  function startOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - dow);
    return x;
  }

  function renderCalendarPage() {
    if (!snapshot) return;
    const cal = snapshot.calendar || { sync: { connected: false }, events: [] };
    const sync = cal.sync || {};
    const pill = document.getElementById("cal-sync-pill");
    const syncBtn = document.getElementById("btn-cal-sync");
    const openBtn = document.getElementById("btn-open-cal-modal");
    const errBanner = document.getElementById("cal-error-banner");
    if (pill) {
      pill.className = `sync-pill ${sync.error ? "error" : sync.connected ? "connected" : ""}`;
      pill.textContent = sync.error
        ? "Sync error"
        : sync.connected
        ? sync.lastSyncAt
          ? `Synced ${timeAgo(sync.lastSyncAt)}`
          : "Connected"
        : "Not connected";
    }
    syncBtn?.classList.toggle("hidden", !sync.connected);
    if (openBtn) {
      openBtn.textContent = sync.connected ? "Calendar settings" : "Connect Google Calendar";
      openBtn.className = sync.connected ? "btn btn-secondary" : "btn btn-primary";
    }
    if (errBanner) {
      errBanner.classList.toggle("hidden", !sync.error);
      errBanner.textContent = sync.error ? `Google Calendar: ${sync.error}` : "";
    }

    const today = new Date();
    const todayKey = localDateKey(today);
    const weekStart = startOfWeek(today);
    weekStart.setDate(weekStart.getDate() + calWeekOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
    const label = document.getElementById("cal-range-label");
    if (label) {
      const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      label.textContent = `${fmt(days[0])} – ${fmt(days[6])}`;
    }

    const tasks = (snapshot.tasks || []).filter((t) => t.status !== "completed");
    const week = document.getElementById("cal-week");
    week.innerHTML = days
      .map((d) => {
        const key = localDateKey(d);
        const evs = eventsOnDay(key).sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start));
        const dayTasks = tasks.filter((t) => dueKey(t) === key);
        const isToday = key === todayKey;
        const isPast = key < todayKey;
        const items =
          evs
            .map((ev) => {
              const link = ev.htmlLink ? safeHttpsUrl(ev.htmlLink) : null;
              return `<div class="cal-ev ${ev.allDay ? "allday" : ""}" style="${ev.color ? `--ev:${esc(ev.color)}` : ""}">
                <div class="cal-ev-time mono">${ev.allDay ? "all day" : `${esc(fmtClock(ev.start))}–${esc(fmtClock(ev.end))}`}</div>
                <div class="cal-ev-title">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(ev.title)}</a>` : esc(ev.title)}</div>
                ${ev.location ? `<div class="cal-ev-loc">${esc(ev.location)}</div>` : ""}
                <button class="cal-ev-del" data-del-event="${esc(ev.id)}" title="Delete event" aria-label="Delete ${esc(ev.title)}">×</button>
              </div>`;
            })
            .join("") +
          dayTasks
            .map(
              (t) => `<div class="cal-task"><button class="task-check-btn sm" data-toggle-task="${esc(t.id)}" data-next-status="completed" title="Mark complete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></button><span>${esc(t.title)}</span></div>`
            )
            .join("");
        return `<div class="cal-day ${isToday ? "today" : ""} ${isPast ? "past" : ""}">
          <button class="cal-day-head" data-cal-pick-day="${key}" title="Add an event on this day">
            <span class="mono">${esc(d.toLocaleDateString(undefined, { weekday: "short" }))}</span>
            <strong>${d.getDate()}</strong>
          </button>
          <div class="cal-day-body">${items || `<div class="cal-empty">—</div>`}</div>
        </div>`;
      })
      .join("");

    const dateIn = document.getElementById("cal-new-date");
    if (dateIn && !dateIn.value) dateIn.value = todayKey;
  }

  function buildCalendarAppsScript(secret) {
    const safeSec = String(secret || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `const SECRET = "${safeSec}";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (!SECRET || body.secret !== SECRET) return out({ ok: false, error: "Unauthorized" });
    const act = body.action || "list";

    if (act === "list") {
      const from = new Date(body.from || Date.now());
      const to = new Date(body.to || Date.now() + 30 * 864e5);
      const events = [];
      CalendarApp.getAllCalendars().forEach(cal => {
        if (cal.isHidden() || !cal.isSelected()) return;
        cal.getEvents(from, to).forEach(ev => {
          events.push({
            id: ev.getId() + "::" + ev.getStartTime().getTime(),
            calendarId: cal.getId(),
            calendarName: cal.getName(),
            title: ev.getTitle(),
            start: ev.getStartTime().toISOString(),
            end: ev.getEndTime().toISOString(),
            allDay: ev.isAllDayEvent(),
            location: ev.getLocation() || "",
            color: cal.getColor()
          });
        });
      });
      return out({ ok: true, events: events.slice(0, 1000) });
    }

    if (act === "create") {
      const cal = CalendarApp.getDefaultCalendar();
      const start = new Date(body.start);
      const end = new Date(body.end);
      const opts = body.description ? { description: body.description } : {};
      const ev = body.allDay
        ? cal.createAllDayEvent(body.title, start, end, opts)
        : cal.createEvent(body.title, start, end, opts);
      return out({ ok: true, event: {
        id: ev.getId() + "::" + ev.getStartTime().getTime(),
        calendarId: cal.getId(), calendarName: cal.getName(), title: ev.getTitle(),
        start: ev.getStartTime().toISOString(), end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(), location: "", color: cal.getColor()
      }});
    }

    if (act === "delete") {
      const parts = String(body.eventId || "").split("::");
      const cal = CalendarApp.getCalendarById(body.calendarId) || CalendarApp.getDefaultCalendar();
      const at = new Date(Number(parts[1]));
      const match = cal.getEvents(new Date(at.getTime() - 6e4), new Date(at.getTime() + 6e4))
        .find(ev => ev.getId() === parts[0]);
      if (!match) return out({ ok: false, error: "Event not found" });
      match.deleteEvent();
      return out({ ok: true });
    }
    return out({ ok: false, error: "Unknown action" });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
  }

  const calModal = document.getElementById("cal-modal");
  const calSecretInput = document.getElementById("cal-secret-input");
  const calUrlInput = document.getElementById("cal-url-input");
  function refreshCalScript() {
    const el = document.getElementById("cal-script-code");
    if (el) el.textContent = buildCalendarAppsScript((calSecretInput?.value || calDraftSecret).trim());
  }
  function openCalModal() {
    if (!calModal) return;
    const connected = Boolean(snapshot?.calendar?.sync?.connected);
    if (calSecretInput) {
      calSecretInput.value = connected ? "" : calDraftSecret;
      calSecretInput.placeholder = connected ? "Saved. Leave blank to keep it, or paste a new one." : "";
    }
    refreshCalScript();
    document.getElementById("btn-cal-disconnect")?.classList.toggle("hidden", !connected);
    calModal.classList.remove("hidden");
  }
  calSecretInput?.addEventListener("input", () => {
    const v = calSecretInput.value.trim();
    if (v) calDraftSecret = v;
    refreshCalScript();
  });
  document.getElementById("btn-open-cal-modal")?.addEventListener("click", openCalModal);
  document.getElementById("btn-close-cal")?.addEventListener("click", () => calModal?.classList.add("hidden"));
  calModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => calModal.classList.add("hidden"));
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-cal-modal]")) {
      e.preventDefault();
      openCalModal();
    }
  });

  document.getElementById("cal-config-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-cal-submit");
    const bridgeUrl = calUrlInput?.value.trim() || "";
    const secret = calSecretInput?.value.trim() || "";
    if (!bridgeUrl) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Connecting…";
    const res = await apiFetch(
      "/api/calendar/config",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bridgeUrl, secret }) },
      "Could not connect Google Calendar"
    );
    btn.disabled = false;
    btn.textContent = orig;
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      calModal.classList.add("hidden");
      calDraftSecret = randomSecret();
      showToast(`Google Calendar connected: ${d.syncedCount ?? 0} events`, "success");
    }
  });

  document.getElementById("btn-cal-disconnect")?.addEventListener("click", async () => {
    const ok = await askConfirm({
      title: "Disconnect Google Calendar?",
      message: "This removes the bridge from Grok Bot HQ. Nothing changes in your Google account.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    const res = await apiFetch(
      "/api/calendar/config",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ disconnect: true }) },
      "Could not disconnect"
    );
    if (res.ok) {
      calModal.classList.add("hidden");
      showToast("Google Calendar disconnected", "info");
    }
  });

  document.getElementById("btn-cal-sync")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await apiFetch("/api/calendar/sync", { method: "POST" }, "Calendar sync failed");
    btn.disabled = false;
    if (res.ok) showToast("Calendar synced", "success");
  });
  document.getElementById("btn-cal-prev")?.addEventListener("click", () => { calWeekOffset -= 1; renderCalendarPage(); });
  document.getElementById("btn-cal-next")?.addEventListener("click", () => { calWeekOffset += 1; renderCalendarPage(); });
  document.getElementById("btn-cal-today")?.addEventListener("click", () => { calWeekOffset = 0; renderCalendarPage(); });

  document.getElementById("cal-new-allday")?.addEventListener("change", (e) => {
    const off = e.target.checked;
    document.getElementById("cal-new-start").disabled = off;
    document.getElementById("cal-new-end").disabled = off;
  });

  document.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-cal-pick-day]");
    if (pick) {
      const dateIn = document.getElementById("cal-new-date");
      if (dateIn) dateIn.value = pick.dataset.calPickDay;
      document.getElementById("cal-new-title")?.focus();
      return;
    }
    const del = e.target.closest("[data-del-event]");
    if (del) {
      const ev = (snapshot?.calendar?.events || []).find((x) => x.id === del.dataset.delEvent);
      const ok = await askConfirm({
        title: "Delete event?",
        message: `“${ev?.title || "This event"}” will be deleted from Google Calendar.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const res = await apiFetch(`/api/calendar/events/${encodeURIComponent(del.dataset.delEvent)}`, { method: "DELETE" }, "Could not delete event");
      if (res.ok) showToast("Event deleted", "info");
    }
  });

  function localToIso(dateKey, minutes) {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).toISOString();
  }

  async function createCalendarEvent({ title, date, startMin, durationMin, allDay }) {
    if (!snapshot?.calendar?.sync?.connected) {
      showToast("Connect Google Calendar first", "info");
      openCalModal();
      return false;
    }
    let start;
    let end;
    if (allDay || startMin === null) {
      start = localToIso(date, 0);
      const [y, m, d] = date.split("-").map(Number);
      end = new Date(y, m - 1, d + 1).toISOString();
      allDay = true;
    } else {
      start = localToIso(date, startMin);
      end = new Date(Date.parse(start) + Math.max(15, durationMin || 60) * 60000).toISOString();
    }
    const res = await apiFetch(
      "/api/calendar/events",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, start, end, allDay }) },
      "Could not add event"
    );
    if (res.ok) showToast(`Added “${title}” to Google Calendar`, "success");
    return res.ok;
  }

  document.getElementById("cal-create-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("cal-new-title").value.trim();
    const date = document.getElementById("cal-new-date").value;
    const allDay = document.getElementById("cal-new-allday").checked;
    const st = document.getElementById("cal-new-start").value;
    const en = document.getElementById("cal-new-end").value;
    if (!title || !date) return;
    const toMin = (v) => (v ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)) : null);
    const startMin = allDay ? null : toMin(st) ?? 9 * 60;
    const endMin = toMin(en);
    const durationMin = startMin !== null && endMin !== null && endMin > startMin ? endMin - startMin : 60;
    const ok = await createCalendarEvent({ title, date, startMin, durationMin, allDay: allDay || !st });
    if (ok) document.getElementById("cal-new-title").value = "";
  });

  // =========================================================================
  // QUICK CAPTURE (Today bar + command palette)
  // =========================================================================
  async function runCapture(c) {
    if (!c) return false;
    if (c.kind === "event") {
      return createCalendarEvent({ title: c.title, date: c.date, startMin: c.startMin, durationMin: c.durationMin, allDay: c.startMin === null });
    }
    if (c.kind === "bot") {
      const bot = findBotByHandle(c.botHandle);
      if (!bot) {
        showToast(`No agent called @${c.botHandle}`, "error");
        return false;
      }
      const res = await apiFetch(
        `/api/bots/${encodeURIComponent(bot.id)}/command`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: c.title, enqueue: true }) },
        "Could not send order"
      );
      if (res.ok) {
        const instant = bot.dispatchConfigured && (bot.agentKind === "n8n" || bot.agentKind === "webhook");
        showToast(instant ? `Sent to ${bot.name} now` : `Queued for ${bot.name}'s next check-in`, "success");
      }
      return res.ok;
    }
    const res = await apiFetch(
      "/api/tasks",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: c.title, due: c.date || null }) },
      "Could not add task"
    );
    if (res.ok) showToast(`Task added${c.date ? ` · ${QuickCapture.describeCapture(c)}` : ""}`, "success");
    return res.ok;
  }

  const todayCaptureInput = document.getElementById("today-capture-input");
  const todayCaptureHint = document.getElementById("today-capture-hint");
  function currentTodayCapture() {
    const raw = todayCaptureInput?.value || "";
    if (!raw.trim() || !window.QuickCapture) return null;
    return QuickCapture.parseQuickCapture(raw) || QuickCapture.parseAsTask(raw);
  }
  todayCaptureInput?.addEventListener("input", () => {
    const c = currentTodayCapture();
    if (!todayCaptureHint) return;
    if (!c) {
      todayCaptureHint.textContent = "";
      return;
    }
    const kindLabel = c.kind === "bot" ? `→ @${c.botHandle}` : c.kind === "event" ? "event" : "task";
    const when = QuickCapture.describeCapture(c);
    todayCaptureHint.textContent = when ? `${kindLabel} · ${when}` : kindLabel;
  });
  document.getElementById("today-capture")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = currentTodayCapture();
    if (!c) return;
    const ok = await runCapture(c);
    if (ok && todayCaptureInput) {
      todayCaptureInput.value = "";
      if (todayCaptureHint) todayCaptureHint.textContent = "";
    }
  });

  // Keep "today" accurate across midnight and refresh the now-line.
  setInterval(() => {
    if (activeView === "today" && snapshot && !isEditingInside(document.getElementById("view-today"))) renderDayRail(new Date(), eventsOnDay(localDateKey(new Date())), (snapshot.tasks || []).filter((t) => t.status !== "completed" && dueKey(t) && dueKey(t) <= localDateKey(new Date())));
  }, 60_000);

  // "g" then a letter jumps between views
  let gPressedAt = 0;
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector(".modal:not(.hidden)")) return;
    if (e.key === "g") {
      gPressedAt = Date.now();
      return;
    }
    if (Date.now() - gPressedAt < 900) {
      const map = { t: "today", o: "office", a: "fleet", k: "tasks", c: "calendar", i: "needs", m: "metrics" };
      if (map[e.key]) {
        e.preventDefault();
        switchView(map[e.key]);
      }
      gPressedAt = 0;
      return;
    }
    if (e.key === "n" && activeView === "today") {
      e.preventDefault();
      todayCaptureInput?.focus();
    }
  });

  switchView(activeView);

  fetchSnapshotFallback();
  connectWS();
})();
