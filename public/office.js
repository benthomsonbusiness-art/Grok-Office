(() => {
  const LOGICAL_W = 1000;
  const LOGICAL_H = 540;

  // Waypoints along the main horizontal and vertical corridors
  const CORRIDOR_X = 565;
  const CORRIDOR_TOP_Y = 128;
  const CORRIDOR_MID_Y = 266;
  const CORRIDOR_BOT_Y = 398;

  const DESKS = [
    { x: 115, y: 122, aisleY: CORRIDOR_TOP_Y, label: "D1" },
    { x: 255, y: 122, aisleY: CORRIDOR_TOP_Y, label: "D2" },
    { x: 395, y: 122, aisleY: CORRIDOR_TOP_Y, label: "D3" },
    { x: 495, y: 122, aisleY: CORRIDOR_TOP_Y, label: "D4" },
    { x: 115, y: 375, aisleY: CORRIDOR_BOT_Y, label: "D5" },
    { x: 255, y: 375, aisleY: CORRIDOR_BOT_Y, label: "D6" },
    { x: 395, y: 375, aisleY: CORRIDOR_BOT_Y, label: "D7" },
    { x: 495, y: 375, aisleY: CORRIDOR_BOT_Y, label: "D8" },
  ];

  const MEETING_SPOTS = [
    { x: 695, y: 125 },
    { x: 825, y: 125 },
    { x: 695, y: 205 },
    { x: 825, y: 205 },
  ];

  const LOUNGE_SPOTS = [
    { x: 648, y: 400 }, // Sofa left
    { x: 722, y: 400 }, // Sofa right
    { x: 828, y: 356 }, // Espresso bar
    { x: 912, y: 395 }, // Arcade cabinet
    { x: 775, y: 465 }, // Lounge rug
  ];

  // Steam particles above the espresso machine
  const steamParticles = Array.from({ length: 10 }, (_, i) => ({
    x: 825 + (i % 3) * 6,
    y: 318 - i * 4,
    alpha: 0.5 - i * 0.04,
    speed: 0.25 + (i % 4) * 0.08,
  }));

  class OfficeRenderer {
    constructor(canvas, tooltipEl, onSelectBot) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.tooltip = tooltipEl;
      this.onSelectBot = onSelectBot;

      this.bots = [];
      this.animState = new Map();
      this.selectedBotId = null;
      this.hoveredBotId = null;

      this.resizeCanvas();
      window.addEventListener("resize", () => this.resizeCanvas());
      this.bindPointerEvents();
      requestAnimationFrame((ts) => this.render(ts));
    }

    resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = LOGICAL_W * dpr;
      this.canvas.height = LOGICAL_H * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setSelectedBot(botId) {
      this.selectedBotId = botId;
    }

    updateBots(bots) {
      this.bots = bots;
      const now = performance.now();

      bots.forEach((bot, idx) => {
        const dest = this.getDestinationForBot(bot, idx);
        let st = this.animState.get(bot.id);

        if (!st) {
          st = {
            x: dest.x,
            y: dest.y,
            waypoints: [],
            zone: dest.zone,
            facingX: 0,
            walking: false,
            walkPhase: 0,
            nextRoamAt: now + 6000 + Math.random() * 6000,
          };
          this.animState.set(bot.id, st);
        } else {
          const lastWp = st.waypoints[st.waypoints.length - 1] ?? { x: st.x, y: st.y };
          const distToDest = Math.hypot(lastWp.x - dest.x, lastWp.y - dest.y);
          if (distToDest > 8) {
            st.waypoints = this.buildCorridorPath(st.x, st.y, dest.x, dest.y, st.zone, dest.zone);
            st.zone = dest.zone;
          }
        }
      });
    }

    getDestinationForBot(bot, idx) {
      if (bot.status === "idle") {
        const spot = LOUNGE_SPOTS[idx % LOUNGE_SPOTS.length];
        return { x: spot.x, y: spot.y, zone: "lounge" };
      }
      if (bot.status === "meeting") {
        const spot = MEETING_SPOTS[idx % MEETING_SPOTS.length];
        return { x: spot.x, y: spot.y, zone: "meeting" };
      }
      const desk = DESKS[(bot.deskIndex ?? idx) % DESKS.length];
      return { x: desk.x, y: desk.y + 18, zone: "desks" };
    }

    buildCorridorPath(x1, y1, x2, y2, fromZone, toZone) {
      if (fromZone === toZone && Math.hypot(x2 - x1, y2 - y1) < 170) {
        return [{ x: x2, y: y2 }];
      }
      const pts = [];
      // Exit into main corridor if coming from desks
      if (fromZone === "desks") {
        const exitY = y1 < 250 ? CORRIDOR_TOP_Y + 46 : CORRIDOR_BOT_Y - 46;
        pts.push({ x: x1, y: exitY });
        pts.push({ x: CORRIDOR_X, y: exitY });
      } else {
        pts.push({ x: CORRIDOR_X, y: y1 < 270 ? CORRIDOR_MID_Y - 75 : CORRIDOR_MID_Y + 85 });
      }

      // Move along central spine to destination zone
      if (toZone === "desks") {
        const entryY = y2 < 250 ? CORRIDOR_TOP_Y + 46 : CORRIDOR_BOT_Y - 46;
        pts.push({ x: CORRIDOR_X, y: entryY });
        pts.push({ x: x2, y: entryY });
      } else if (toZone === "meeting") {
        pts.push({ x: CORRIDOR_X, y: 165 });
      } else {
        pts.push({ x: CORRIDOR_X, y: 380 });
      }

      pts.push({ x: x2, y: y2 });
      return pts;
    }

    bindPointerEvents() {
      const toLogical = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) / rect.width) * LOGICAL_W,
          y: ((e.clientY - rect.top) / rect.height) * LOGICAL_H,
          clientX: e.clientX - rect.left,
          clientY: e.clientY - rect.top,
        };
      };

      this.canvas.addEventListener("mousemove", (e) => {
        const pos = toLogical(e);
        const bot = this.findBotAt(pos.x, pos.y);
        if (bot) {
          this.hoveredBotId = bot.id;
          this.tooltip.classList.remove("hidden");
          this.tooltip.style.left = `${Math.min(pos.clientX + 14, this.canvas.clientWidth - 220)}px`;
          this.tooltip.style.top = `${Math.max(8, pos.clientY - 12)}px`;
          this.tooltip.innerHTML =
            `<strong>${this.esc(bot.name)}</strong> · <span style="color:#38bdf8">${this.esc(bot.status.toUpperCase())}</span><br/>` +
            `<span style="color:#8b9bb4">${this.esc(bot.task || "Idle in lounge")}</span><br/>` +
            `<span style="color:#64748b;font-size:0.7rem">${bot.requestsTotal} reqs · $${bot.costTotalUsd.toFixed(4)}</span>`;
        } else {
          this.hoveredBotId = null;
          this.tooltip.classList.add("hidden");
        }
      });

      this.canvas.addEventListener("mouseleave", () => {
        this.hoveredBotId = null;
        this.tooltip.classList.add("hidden");
      });

      this.canvas.addEventListener("click", (e) => {
        const pos = toLogical(e);
        const bot = this.findBotAt(pos.x, pos.y);
        if (bot) {
          this.selectedBotId = bot.id;
          this.onSelectBot(bot.id);
        }
      });
    }

    findBotAt(lx, ly) {
      for (const bot of this.bots) {
        const st = this.animState.get(bot.id);
        if (!st) continue;
        if (Math.hypot(lx - st.x, ly - st.y) <= 25) return bot;
      }
      return null;
    }

    esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    render(ts) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      this.drawFloorAndRooms(ctx, ts);
      this.drawFurniture(ctx, ts);
      this.stepAnimations(ts);
      this.drawCollaborationBeams(ctx, ts);
      this.drawBots(ctx, ts);

      requestAnimationFrame((nextTs) => this.render(nextTs));
    }

    drawFloorAndRooms(ctx, ts) {
      // Base dark tile floor
      ctx.fillStyle = "#080d19";
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

      ctx.strokeStyle = "#111a2e";
      ctx.lineWidth = 1;
      for (let x = 0; x < LOGICAL_W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, LOGICAL_H);
        ctx.stroke();
      }
      for (let y = 0; y < LOGICAL_H; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(LOGICAL_W, y);
        ctx.stroke();
      }

      // Main Corridor Highlight
      ctx.fillStyle = "rgba(30, 41, 59, 0.25)";
      ctx.fillRect(540, 20, 48, 500);
      ctx.fillRect(24, 240, 540, 50);

      // Room zones
      const drawZone = (x, y, w, h, title, accent) => {
        ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#64748b";
        ctx.font = "700 10px Inter, sans-serif";
        ctx.fillText(title, x + 14, y + 19);
      };

      drawZone(22, 20, 514, 205, "ENGINEERING & RESEARCH POD", "#1e3256");
      drawZone(22, 298, 514, 222, "OPERATIONS & SUPPORT POD", "#1e3256");
      drawZone(596, 20, 382, 238, "GLASS BOARDROOM · COLLABORATION", "#2d2a5e");
      drawZone(596, 278, 382, 242, "COFFEE LOUNGE & RECHARGE", "#3b2c1e");

      // Server Rack in Operations Pod corner
      const hasError = this.bots.some((b) => b.status === "error");
      ctx.fillStyle = "#0b1325";
      ctx.strokeStyle = "#263659";
      ctx.beginPath();
      ctx.roundRect(38, 444, 52, 62, 6);
      ctx.fill();
      ctx.stroke();
      for (let row = 0; row < 4; row++) {
        const blink = Math.sin(ts / 220 + row * 1.4) > 0;
        ctx.fillStyle = "#172442";
        ctx.fillRect(44, 452 + row * 13, 40, 8);
        ctx.fillStyle = hasError && row === 0 ? (blink ? "#fb7185" : "#4c0519") : blink ? "#34d399" : "#38bdf8";
        ctx.fillRect(47, 454 + row * 13, 4, 4);
      }
    }

    drawFurniture(ctx, ts) {
      // Workstations
      DESKS.forEach((d, idx) => {
        const activeBot = this.bots.find((b) => (b.deskIndex ?? 0) % 8 === idx && b.status === "working");

        // Warm ambient pool if bot is working at desk
        if (activeBot) {
          const grad = ctx.createRadialGradient(d.x, d.y - 12, 4, d.x, d.y - 12, 56);
          grad.addColorStop(0, "rgba(56, 189, 248, 0.16)");
          grad.addColorStop(1, "rgba(56, 189, 248, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(d.x, d.y - 12, 56, 0, Math.PI * 2);
          ctx.fill();
        }

        // Desk surface
        ctx.fillStyle = "#17233d";
        ctx.strokeStyle = activeBot ? "#38bdf8" : "#28395e";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(d.x - 42, d.y - 40, 84, 34, 7);
        ctx.fill();
        ctx.stroke();

        // Dual Monitors
        [-19, 3].forEach((mx) => {
          ctx.fillStyle = "#090f1e";
          ctx.fillRect(d.x + mx, d.y - 34, 17, 11);
          ctx.fillStyle = activeBot ? "#38bdf8" : "#1e293b";
          ctx.fillRect(d.x + mx + 2, d.y - 32, 13, 7);
          if (activeBot) {
            const barW = 4 + ((Math.sin(ts / 160 + mx + idx) + 1) * 4);
            ctx.fillStyle = "#bae6fd";
            ctx.fillRect(d.x + mx + 3, d.y - 30, barW, 2);
          }
        });

        ctx.fillStyle = "#475569";
        ctx.font = "600 9px Inter, sans-serif";
        ctx.fillText(d.label, d.x - 37, d.y - 12);
      });

      // Potted plants
      [
        { x: 54, y: 74 },
        { x: 516, y: 486 },
        { x: 622, y: 66 },
      ].forEach((p) => {
        ctx.fillStyle = "#78350f";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(p.x - 4, p.y - 4, 7, 0, Math.PI * 2);
        ctx.arc(p.x + 5, p.y - 3, 6, 0, Math.PI * 2);
        ctx.arc(p.x, p.y - 7, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      // Holo Boardroom Table
      const meetingCount = this.bots.filter((b) => b.status === "meeting").length;
      ctx.fillStyle = "#171f3b";
      ctx.strokeStyle = meetingCount > 0 ? "#a78bfa" : "#323d69";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(700, 128, 135, 72, 24);
      ctx.fill();
      ctx.stroke();

      // Animated holo-ring in center of table
      ctx.save();
      ctx.translate(767, 164);
      ctx.rotate(ts / 1200);
      ctx.strokeStyle = meetingCount > 0 ? "rgba(167, 139, 250, 0.75)" : "rgba(100, 116, 139, 0.25)";
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([]);

      // Whiteboard on boardroom top wall
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(720, 44, 110, 12);
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(732, 48, 36, 3);
      ctx.fillStyle = "#34d399";
      ctx.fillRect(776, 48, 28, 3);

      // Lounge Rug
      ctx.fillStyle = "rgba(180, 83, 9, 0.14)";
      ctx.strokeStyle = "rgba(251, 191, 36, 0.22)";
      ctx.beginPath();
      ctx.roundRect(628, 376, 210, 112, 14);
      ctx.fill();
      ctx.stroke();

      // Plush Sofa
      ctx.fillStyle = "#2b213a";
      ctx.strokeStyle = "#4b3869";
      ctx.beginPath();
      ctx.roundRect(635, 424, 115, 36, 10);
      ctx.fill();
      ctx.stroke();

      // Espresso Counter
      ctx.fillStyle = "#3f2212";
      ctx.strokeStyle = "#78350f";
      ctx.beginPath();
      ctx.roundRect(790, 314, 82, 28, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fbbf24";
      ctx.font = "13px sans-serif";
      ctx.fillText("☕", 823, 333);

      // Rising steam particles above coffee bar
      steamParticles.forEach((p) => {
        p.y -= p.speed;
        p.alpha -= 0.004;
        if (p.alpha <= 0 || p.y < 285) {
          p.y = 316;
          p.alpha = 0.5;
        }
        ctx.fillStyle = `rgba(226, 232, 240, ${Math.max(0, p.alpha)})`;
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(ts / 400 + p.y) * 2, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });

      // Arcade Cabinet
      ctx.fillStyle = "#1e1b4b";
      ctx.strokeStyle = "#6366f1";
      ctx.beginPath();
      ctx.roundRect(906, 332, 42, 48, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(913, 340, 28, 16);
    }

    stepAnimations(ts) {
      this.bots.forEach((bot, idx) => {
        const st = this.animState.get(bot.id);
        if (!st) return;

        // Organic idle roaming in the Coffee Lounge
        if (bot.status === "idle" && st.waypoints.length === 0 && ts > st.nextRoamAt) {
          const spot = LOUNGE_SPOTS[(idx + Math.floor(ts / 9000)) % LOUNGE_SPOTS.length];
          if (Math.hypot(spot.x - st.x, spot.y - st.y) > 10) {
            st.waypoints = [{ x: spot.x, y: spot.y }];
          }
          st.nextRoamAt = ts + 7000 + Math.random() * 6000;
        }

        if (st.waypoints.length > 0) {
          const target = st.waypoints[0];
          const dx = target.x - st.x;
          const dy = target.y - st.y;
          const dist = Math.hypot(dx, dy);
          const speed = 2.6;

          if (dist <= speed) {
            st.x = target.x;
            st.y = target.y;
            st.waypoints.shift();
            st.walking = st.waypoints.length > 0;
          } else {
            st.x += (dx / dist) * speed;
            st.y += (dy / dist) * speed;
            st.facingX = dx > 1 ? 1 : dx < -1 ? -1 : 0;
            st.walking = true;
            st.walkPhase += 0.25;
          }
        } else {
          st.walking = false;
          st.facingX = 0;
        }
      });
    }

    drawCollaborationBeams(ctx, ts) {
      const drawn = new Set();
      this.bots.forEach((bot) => {
        if (!bot.collaboratingWith) return;
        const pairKey = [bot.id, bot.collaboratingWith].sort().join(":");
        if (drawn.has(pairKey)) return;
        drawn.add(pairKey);

        const a = this.animState.get(bot.id);
        const b = this.animState.get(bot.collaboratingWith);
        if (!a || !b) return;

        ctx.save();
        ctx.strokeStyle = "rgba(167, 139, 250, 0.55)";
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 6]);
        ctx.lineDashOffset = -ts / 35;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 34, b.x, b.y);
        ctx.stroke();
        ctx.restore();
      });
    }

    drawBots(ctx, ts) {
      this.bots.forEach((bot, idx) => {
        const st = this.animState.get(bot.id);
        if (!st) return;

        const walkBob = st.walking ? Math.abs(Math.sin(st.walkPhase)) * 4 : 0;
        const workBob = !st.walking && bot.status === "working" ? Math.sin(ts / 190 + idx) * 1.5 : 0;
        const bx = st.x;
        const by = st.y - walkBob + workBob;

        // Ground shadow
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.beginPath();
        ctx.ellipse(bx, st.y + 15, 13, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (this.selectedBotId === bot.id || this.hoveredBotId === bot.id) {
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(bx, by, 23, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Status aura
        const aura =
          bot.status === "working"
            ? "rgba(52, 211, 153, 0.22)"
            : bot.status === "waiting"
            ? "rgba(251, 191, 36, 0.32)"
            : bot.status === "error"
            ? "rgba(251, 113, 133, 0.36)"
            : bot.status === "meeting"
            ? "rgba(167, 139, 250, 0.28)"
            : "rgba(100, 116, 139, 0.16)";
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(bx, by, 19, 0, Math.PI * 2);
        ctx.fill();

        // Walking legs
        const legSwing = st.walking ? Math.sin(st.walkPhase) * 4 : 0;
        ctx.fillStyle = "#334155";
        ctx.fillRect(bx - 7, by + 9 + legSwing * 0.4, 5, 5);
        ctx.fillRect(bx + 2, by + 9 - legSwing * 0.4, 5, 5);

        // Bot body + antenna
        ctx.fillStyle = bot.avatarColor;
        ctx.fillRect(bx - 1, by - 19, 2, 6);
        ctx.beginPath();
        ctx.arc(bx, by - 20, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.roundRect(bx - 13, by - 13, 26, 24, 7);
        ctx.fill();

        // Visor + directional eyes
        ctx.fillStyle = "#070b14";
        ctx.beginPath();
        ctx.roundRect(bx - 9, by - 7, 18, 8, 3);
        ctx.fill();
        ctx.fillStyle = bot.status === "error" ? "#fb7185" : "#e2e8f0";
        const eyeOffset = st.facingX * 2;
        ctx.fillRect(bx - 5 + eyeOffset, by - 4.5, 3, 3);
        ctx.fillRect(bx + 2 + eyeOffset, by - 4.5, 3, 3);

        // Urgent badge for waiting / error
        if (bot.status === "waiting" || bot.status === "error") {
          const pulse = Math.sin(ts / 190) * 2;
          ctx.fillStyle = bot.status === "error" ? "#fb7185" : "#fbbf24";
          ctx.beginPath();
          ctx.arc(bx + 14, by - 15 + pulse, 7.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#070b14";
          ctx.font = "bold 10px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(bot.status === "error" ? "!" : "?", bx + 14, by - 11.5 + pulse);
        }

        // Nameplate pill
        ctx.font = "600 10.5px Inter, sans-serif";
        ctx.textAlign = "center";
        const nameW = ctx.measureText(bot.name).width + 12;
        ctx.fillStyle = "rgba(9, 13, 22, 0.84)";
        ctx.beginPath();
        ctx.roundRect(bx - nameW / 2, by + 16, nameW, 15, 5);
        ctx.fill();
        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(bot.name, bx, by + 27);

        // Compact floating task pill for selected or urgent bots
        if (this.selectedBotId === bot.id || bot.status === "waiting" || bot.status === "error") {
          const label = (bot.task || bot.status).slice(0, 26) + ((bot.task || "").length > 26 ? "…" : "");
          ctx.font = "500 9.5px Inter, sans-serif";
          const tw = ctx.measureText(label).width + 12;
          const bubbleY = by - 38;
          ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
          ctx.strokeStyle = bot.status === "error" ? "#fb7185" : bot.status === "waiting" ? "#fbbf24" : "#38bdf8";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(bx - tw / 2, bubbleY, tw, 15, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText(label, bx, bubbleY + 10.5);
        }

        ctx.textAlign = "left";
      });
    }
  }

  window.OfficeRenderer = OfficeRenderer;
})();
