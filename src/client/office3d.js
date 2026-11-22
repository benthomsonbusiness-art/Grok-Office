import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const STATUS_HEX = {
  working: "#22c55e",
  waiting: "#f59e0b",
  error: "#ef4444",
  idle: "#3b82f6",
  meeting: "#a855f7",
  no_report: "#64748b",
};

// Department desk coordinates in 3D world space (X: -22..22, Z: -15..15)
const DEPT_DESKS = {
  "Command & Media": [
    { x: -17.5, z: -10.5, rot: 0 },
    { x: -12.0, z: -10.5, rot: 0 },
    { x: -17.5, z: -6.0, rot: 0 },
    { x: -12.0, z: -6.0, rot: 0 },
  ],
  "Executive Studio": [
    { x: -2.0, z: -10.5, rot: 0 },
    { x: 1.5, z: -10.5, rot: 0 },
  ],
  "Analytics Lab": [
    { x: 9.5, z: -10.5, rot: 0 },
    { x: 15.5, z: -10.5, rot: 0 },
    { x: 10.5, z: -5.5, rot: 0 },
    { x: 16.0, z: -5.5, rot: 0 },
  ],
  "Engineering Lab": [
    { x: -17.5, z: 7.0, rot: 0 },
    { x: -12.5, z: 7.0, rot: 0 },
    { x: -17.5, z: 11.2, rot: 0 },
    { x: -12.5, z: 11.2, rot: 0 },
  ],
  "AI News Desk": [
    { x: 11.0, z: 6.5, rot: 0 },
    { x: 16.5, z: 6.5, rot: 0 },
    { x: 11.0, z: 11.0, rot: 0 },
    { x: 16.5, z: 11.0, rot: 0 },
  ],
  "Ops & Finance": [
    { x: -7.5, z: 7.0, rot: 0 },
    { x: -7.5, z: 11.2, rot: 0 },
    { x: 15.5, z: -2.5, rot: 0 },
  ],
};

const ALL_DESKS = Object.values(DEPT_DESKS).flat();

const MEETING_SPOTS = [
  { x: -15.5, z: -0.8 },
  { x: -13.0, z: -0.8 },
  { x: -15.5, z: 1.8 },
  { x: -13.0, z: 1.8 },
  { x: -14.2, z: -1.8 },
  { x: -14.2, z: 2.5 },
];

const LOUNGE_SPOTS = [
  { x: -4.2, z: -0.8 },
  { x: -1.8, z: -0.8 },
  { x: 2.2, z: -0.5 },
  { x: 4.5, z: 0.2 },
  { x: -3.5, z: 3.4 },
  { x: 1.2, z: 3.4 },
  { x: 4.2, z: 3.6 },
  { x: -0.6, z: 1.2 },
];

const LIGHTING_PRESETS = {
  day: {
    bg: 0x0b1220,
    ambient: 0xffffff,
    ambientInt: 0.72,
    sun: 0xfff7ed,
    sunInt: 1.15,
    sunPos: [22, 34, 24],
    fill: 0x93c5fd,
    fillInt: 0.35,
    windowHex: 0xbae6fd,
    lampInt: 0.15,
  },
  evening: {
    bg: 0x100e1c,
    ambient: 0xfde68a,
    ambientInt: 0.5,
    sun: 0xfb923c,
    sunInt: 1.05,
    sunPos: [-26, 18, 22],
    fill: 0xc084fc,
    fillInt: 0.35,
    windowHex: 0xfdba74,
    lampInt: 0.75,
  },
  night: {
    bg: 0x060a14,
    ambient: 0x64748b,
    ambientInt: 0.35,
    sun: 0x60a5fa,
    sunInt: 0.45,
    sunPos: [14, 28, -18],
    fill: 0x38bdf8,
    fillInt: 0.28,
    windowHex: 0x1e293b,
    lampInt: 1.4,
  },
};

class Office3D {
  constructor(container, labelLayer, tooltipEl, onSelectBot) {
    this.container = container;
    this.labelLayer = labelLayer;
    this.tooltip = tooltipEl;
    this.onSelectBot = onSelectBot;

    this.bots = [];
    this.botMeshes = new Map();
    this.labelEls = new Map();
    this.selectedBotId = null;
    this.hoveredBotId = null;
    this.cameraMode = "rotate";
    this.lightingMode = "day";
    this.usagePct = 100;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-99, -99);
    this.clock = new THREE.Clock();

    this.initScene();
    this.buildArchitecture();
    this.bindEvents();
    this.setLighting("day");
    this.animate();
  }

  initScene() {
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1220);

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.5, 200);
    this.defaultCamPos = new THREE.Vector3(-24, 28, 30);
    this.defaultTarget = new THREE.Vector3(-1, 0, 1);
    this.camera.position.copy(this.defaultCamPos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 64;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.35;

    // Lights
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff7ed, 1.15);
    this.sunLight.position.set(22, 34, 24);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -28;
    this.sunLight.shadow.camera.right = 28;
    this.sunLight.shadow.camera.top = 24;
    this.sunLight.shadow.camera.bottom = -24;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x93c5fd, 0.35);
    this.fillLight.position.set(-20, 16, -20);
    this.scene.add(this.fillLight);

    // Interior warm lounge lamp
    this.loungeLamp = new THREE.PointLight(0xfbbf24, 0.25, 22);
    this.loungeLamp.position.set(0, 5.5, 1);
    this.scene.add(this.loungeLamp);
  }

  addBox(w, h, d, color, x, y, z, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.78,
      metalness: opts.metalness ?? 0.08,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    this.scene.add(mesh);
    return mesh;
  }

  buildArchitecture() {
    // Base foundation slab
    this.addBox(42, 0.6, 29, 0x1e2536, 0, -0.35, 0, { castShadow: false });

    // Color-coded Room Floors (matching the architectural reference)
    // 1. Command & Media (Crimson)
    this.addBox(14, 0.12, 11.5, 0x7a1c2d, -13.5, 0.02, -8.2, { castShadow: false });
    // 2. Executive Studio (Raised Plum)
    this.addBox(12.2, 0.45, 9.5, 0x4b243e, -0.4, 0.18, -9.2, { castShadow: false });
    // Steps down from Executive Studio
    this.addBox(6.5, 0.22, 1.0, 0x7c5334, -0.4, 0.08, -4.1, { castShadow: false });
    // 3. Analytics Lab (Teal Blue)
    this.addBox(14.5, 0.12, 13.5, 0x1c6b82, 13.0, 0.02, -7.2, { castShadow: false });
    // 4. Conference Room (Warm Wood)
    this.addBox(9.5, 0.12, 8.2, 0xc79558, -14.2, 0.02, 1.2, { castShadow: false });
    // 5. Central Lounge Hub (Terracotta Orange)
    this.addBox(16.0, 0.12, 12.2, 0xc46729, -0.4, 0.02, 1.4, { castShadow: false });
    // 6. Engineering Lab (Deep Purple + Magenta)
    this.addBox(6.5, 0.12, 9.2, 0x4c2473, -17.2, 0.02, 9.4, { castShadow: false });
    this.addBox(9.2, 0.12, 9.2, 0x7b227a, -9.4, 0.02, 9.4, { castShadow: false });
    // 7. Hardwood Lobby + Tiled Foyer
    this.addBox(10.0, 0.12, 6.4, 0xb0783d, 0.4, 0.02, 10.8, { castShadow: false });
    this.addBox(7.2, 0.12, 6.4, 0xd8d2c5, 9.0, 0.02, 10.8, { castShadow: false });
    // 8. AI News Desk (Olive Gold)
    this.addBox(11.6, 0.12, 11.2, 0x756125, 14.4, 0.02, 8.4, { castShadow: false });

    // Exterior & Interior Cutaway Walls (warm cream beige)
    const wallH = 2.7;
    const wallY = wallH / 2;
    const wallColor = 0xd2c7b6;

    // Back wall
    this.addBox(41.4, wallH, 0.45, wallColor, 0, wallY, -14.1);
    // Left wall
    this.addBox(0.45, wallH, 28.4, wallColor, -20.5, wallY, 0);
    // Right wall
    this.addBox(0.45, wallH, 28.4, wallColor, 20.5, wallY, 0);

    // Interior dividers (low cutaway height for clean visibility)
    const divH = 2.2;
    const divY = divH / 2;
    this.addBox(0.35, divH, 10.0, wallColor, -6.5, divY, -9.0);
    this.addBox(0.35, divH, 10.0, wallColor, 5.7, divY, -9.0);
    this.addBox(11.0, divH, 0.35, wallColor, -14.8, divY, -2.8);
    this.addBox(0.35, divH, 7.6, wallColor, -9.4, divY, 1.1);
    this.addBox(14.0, divH, 0.35, wallColor, -13.2, divY, 4.9);
    this.addBox(0.35, divH, 8.6, wallColor, -14.0, divY, 9.5);
    this.addBox(0.35, divH, 8.6, wallColor, -4.8, divY, 9.5);
    this.addBox(0.35, divH, 10.5, wallColor, 8.6, divY, 8.5);
    this.addBox(11.2, divH, 0.35, wallColor, 14.6, divY, 2.8);

    // Back-wall Windows (color updates with Day/Evening/Night)
    this.windowMeshes = [];
    [-16, -11, 9.5, 14.5, 18.2].forEach((wx) => {
      const win = this.addBox(3.4, 1.35, 0.16, 0xbae6fd, wx, 1.65, -13.85, {
        castShadow: false,
        emissive: 0xbae6fd,
        emissiveIntensity: 0.35,
      });
      this.windowMeshes.push(win);
    });

    // Wall-mounted Live Usage Screen in Command & Media Room
    this.usageCanvas = document.createElement("canvas");
    this.usageCanvas.width = 512;
    this.usageCanvas.height = 160;
    this.usageTex = new THREE.CanvasTexture(this.usageCanvas);
    const screenMat = new THREE.MeshStandardMaterial({
      map: this.usageTex,
      emissive: 0x38bdf8,
      emissiveMap: this.usageTex,
      emissiveIntensity: 0.75,
      roughness: 0.3,
    });
    const screenMesh = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.5, 0.16), screenMat);
    screenMesh.position.set(-13.5, 1.65, -13.75);
    this.scene.add(screenMesh);
    this.updateWallScreen(100, 0);

    // Desks + Dual Monitors
    ALL_DESKS.forEach((d) => this.buildDesk(d.x, d.z));

    // Conference Table + Chairs
    const confTable = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 1.7, 0.15, 24),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 })
    );
    confTable.position.set(-14.2, 0.85, 0.5);
    confTable.castShadow = true;
    confTable.receiveShadow = true;
    this.scene.add(confTable);
    this.addBox(0.35, 0.8, 0.35, 0x334155, -14.2, 0.4, 0.5);

    MEETING_SPOTS.slice(0, 4).forEach((s) => {
      this.addBox(0.65, 0.55, 0.65, 0x2563eb, s.x, 0.35, s.z);
    });

    // Central Lounge Seating Clusters (Dark Rugs + Couches + Coffee Tables)
    this.addBox(6.8, 0.05, 3.8, 0x572c2c, -2.5, 0.09, -0.5, { castShadow: false });
    this.addBox(3.4, 0.75, 1.0, 0x3f2e2b, -2.5, 0.45, -1.7); // Sofa
    this.addBox(2.2, 0.4, 1.1, 0x92400e, -2.5, 0.28, -0.3); // Coffee table

    this.addBox(6.2, 0.05, 3.8, 0x334155, 2.8, 0.09, 2.4, { castShadow: false });
    this.addBox(3.2, 0.75, 1.0, 0x334155, 2.8, 0.45, 3.6); // Sofa 2
    this.addBox(2.0, 0.4, 1.0, 0x78350f, 2.8, 0.28, 2.2); // Coffee table 2

    // Potted Plants
    [
      [-5.8, -1.8],
      [4.8, -2.5],
      [-5.5, 4.1],
      [7.6, 3.6],
      [-19.5, -12.8],
    ].forEach(([px, pz]) => {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.32, 0.65, 12),
        new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 })
      );
      pot.position.set(px, 0.35, pz);
      pot.castShadow = true;
      this.scene.add(pot);

      const bush = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.65, 1),
        new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.75 })
      );
      bush.position.set(px, 1.05, pz);
      bush.castShadow = true;
      this.scene.add(bush);
    });
  }

  buildDesk(x, z) {
    // Tabletop
    this.addBox(2.6, 0.12, 1.25, 0xf1f5f9, x, 0.9, z);
    // Legs
    this.addBox(0.12, 0.88, 1.1, 0x334155, x - 1.15, 0.44, z);
    this.addBox(0.12, 0.88, 1.1, 0x334155, x + 1.15, 0.44, z);
    // Monitor
    this.addBox(1.1, 0.68, 0.08, 0x0f172a, x, 1.38, z - 0.32, {
      emissive: 0x38bdf8,
      emissiveIntensity: 0.35,
    });
    // Monitor stand
    this.addBox(0.14, 0.24, 0.14, 0x475569, x, 1.04, z - 0.32);
    // Chair behind desk
    this.addBox(0.68, 0.45, 0.68, 0x1e293b, x, 0.36, z + 0.85);
  }

  updateWallScreen(remainingPct, activeCount) {
    this.usagePct = remainingPct;
    const c = this.usageCanvas;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#090f1e";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 22px Inter, sans-serif";
    ctx.fillText("DAILY BUDGET REMAINING", 26, 42);

    ctx.fillStyle = remainingPct > 25 ? "#38bdf8" : "#fb7185";
    ctx.font = "700 54px Inter, sans-serif";
    ctx.fillText(`${remainingPct}%`, 26, 102);

    ctx.fillStyle = "#34d399";
    ctx.font = "600 24px Inter, sans-serif";
    ctx.fillText(`${activeCount} ACTIVE`, 320, 96);

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(26, 122, 460, 18);
    ctx.fillStyle = remainingPct > 25 ? "#22c55e" : "#ef4444";
    ctx.fillRect(26, 122, Math.max(8, (460 * remainingPct) / 100), 18);

    this.usageTex.needsUpdate = true;
  }

  createBotAvatar(bot) {
    const group = new THREE.Group();
    group.userData.botId = bot.id;

    const color = new THREE.Color(bot.avatarColor || "#38bdf8");

    // Body capsule
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.72, 6, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.15 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    body.userData.botId = bot.id;
    group.add(body);

    // Visor
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.24, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.6 })
    );
    visor.position.set(0, 1.16, 0.28);
    visor.userData.botId = bot.id;
    group.add(visor);

    // Glowing eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    [-0.14, 0.14].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.05), eyeMat);
      eye.position.set(ex, 1.17, 0.43);
      group.add(eye);
    });

    // Status Halo / Beacon Ring
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.68, 24),
      new THREE.MeshBasicMaterial({
        color: STATUS_HEX[bot.status] || "#22c55e",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.14;
    group.add(halo);

    // Urgent Beacon Sphere above head (visible for waiting / error)
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    );
    beacon.position.y = 2.05;
    beacon.visible = false;
    group.add(beacon);

    this.scene.add(group);

    // Floating 3D-projected HTML Nameplate Pill
    const labelEl = document.createElement("div");
    labelEl.className = "bot-3d-label";
    labelEl.innerHTML = `<span class="lbl-dot"></span><span class="lbl-name"></span>`;
    labelEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectBot(bot.id);
    });
    this.labelLayer.appendChild(labelEl);
    this.labelEls.set(bot.id, labelEl);

    return {
      group,
      body,
      halo,
      beacon,
      target: new THREE.Vector3(0, 0, 0),
      nextRoamAt: performance.now() + 5000 + Math.random() * 6000,
    };
  }

  getTargetForBot(bot, idx) {
    if (bot.status === "idle" || bot.status === "no_report") {
      const spot = LOUNGE_SPOTS[idx % LOUNGE_SPOTS.length];
      return new THREE.Vector3(spot.x, 0, spot.z);
    }
    if (bot.status === "meeting") {
      const spot = MEETING_SPOTS[idx % MEETING_SPOTS.length];
      return new THREE.Vector3(spot.x, 0, spot.z);
    }
    const deptDesks = DEPT_DESKS[bot.department] || ALL_DESKS;
    const desk = deptDesks[(bot.deskIndex ?? idx) % deptDesks.length];
    return new THREE.Vector3(desk.x, 0, desk.z + 0.85);
  }

  updateBots(bots, usageSummary) {
    this.bots = bots;
    const activeCount = bots.filter((b) => b.status === "working" || b.status === "meeting").length;
    if (usageSummary) {
      this.updateWallScreen(usageSummary.usageRemainingPct ?? 100, activeCount);
    }

    const seenIds = new Set();
    bots.forEach((bot, idx) => {
      seenIds.add(bot.id);
      const dest = this.getTargetForBot(bot, idx);
      let entry = this.botMeshes.get(bot.id);
      if (!entry) {
        entry = this.createBotAvatar(bot);
        entry.group.position.copy(dest);
        entry.target.copy(dest);
        this.botMeshes.set(bot.id, entry);
      } else {
        entry.target.copy(dest);
      }

      // Update status colors
      const hex = STATUS_HEX[bot.status] || "#22c55e";
      entry.halo.material.color.set(hex);
      entry.beacon.visible = bot.status === "waiting" || bot.status === "error";
      if (entry.beacon.visible) {
        entry.beacon.material.color.set(bot.status === "error" ? "#ef4444" : "#f59e0b");
      }

      // Update floating label
      const labelEl = this.labelEls.get(bot.id);
      if (labelEl) {
        labelEl.querySelector(".lbl-name").textContent = bot.name;
        const dot = labelEl.querySelector(".lbl-dot");
        dot.style.background = bot.status === "no_report" ? "transparent" : hex;
        dot.style.border = bot.status === "no_report" ? `1.5px solid ${hex}` : "none";
        labelEl.classList.toggle("selected", this.selectedBotId === bot.id);
        labelEl.classList.toggle("urgent", bot.status === "waiting" || bot.status === "error");
      }
    });

    // Clean up removed bots
    for (const [id, entry] of this.botMeshes.entries()) {
      if (!seenIds.has(id)) {
        this.scene.remove(entry.group);
        this.botMeshes.delete(id);
        const lbl = this.labelEls.get(id);
        if (lbl) lbl.remove();
        this.labelEls.delete(id);
      }
    }
  }

  selectBot(botId) {
    this.selectedBotId = botId;
    const entry = this.botMeshes.get(botId);
    if (entry) {
      this.controls.target.lerp(entry.group.position, 0.65);
    }
    for (const [id, el] of this.labelEls.entries()) {
      el.classList.toggle("selected", id === botId);
    }
    this.onSelectBot(botId);
  }

  setLighting(mode) {
    this.lightingMode = mode;
    let resolved = mode;
    if (mode === "now") {
      const hr = new Date().getHours();
      resolved = hr >= 6 && hr < 17 ? "day" : hr >= 17 && hr < 20 ? "evening" : "night";
    }
    const p = LIGHTING_PRESETS[resolved] || LIGHTING_PRESETS.day;
    this.scene.background.setHex(p.bg);
    this.ambientLight.color.setHex(p.ambient);
    this.ambientLight.intensity = p.ambientInt;
    this.sunLight.color.setHex(p.sun);
    this.sunLight.intensity = p.sunInt;
    this.sunLight.position.set(...p.sunPos);
    this.fillLight.color.setHex(p.fill);
    this.fillLight.intensity = p.fillInt;
    this.loungeLamp.intensity = p.lampInt;

    this.windowMeshes.forEach((w) => {
      w.material.color.setHex(p.windowHex);
      w.material.emissive.setHex(p.windowHex);
    });
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    if (mode === "fixed") {
      this.controls.autoRotate = false;
      this.controls.enableRotate = false;
      this.resetView();
    } else {
      this.controls.enableRotate = true;
      this.controls.autoRotate = true;
    }
  }

  resetView() {
    this.camera.position.copy(this.defaultCamPos);
    this.controls.target.copy(this.defaultTarget);
    this.controls.update();
  }

  bindEvents() {
    window.addEventListener("resize", () => this.handleResize());

    const dom = this.renderer.domElement;
    dom.addEventListener("pointermove", (e) => {
      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.checkHover(e.clientX - rect.left, e.clientY - rect.top);
    });

    dom.addEventListener("pointerleave", () => {
      this.hoveredBotId = null;
      this.tooltip.classList.add("hidden");
    });

    dom.addEventListener("click", () => {
      if (this.hoveredBotId) {
        this.selectBot(this.hoveredBotId);
      }
    });
  }

  handleResize() {
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 600;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  checkHover(cx, cy) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const entry of this.botMeshes.values()) {
      meshes.push(entry.body);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const botId = hits[0].object.userData.botId;
      const bot = this.bots.find((b) => b.id === botId);
      if (bot) {
        this.hoveredBotId = bot.id;
        this.renderer.domElement.style.cursor = "pointer";
        this.tooltip.classList.remove("hidden");
        this.tooltip.style.left = `${Math.min(cx + 16, this.container.clientWidth - 260)}px`;
        this.tooltip.style.top = `${Math.max(12, cy - 10)}px`;
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        this.tooltip.innerHTML =
          `<div class="tt-head"><strong>${esc(bot.name)}</strong><span class="tt-pill st-${esc(bot.status)}">${esc(bot.status.replace("_", " "))}</span></div>` +
          `<div class="tt-dept">${esc(bot.department)} · ${esc(bot.role)}</div>` +
          `<div class="tt-task">${esc(bot.task || "Standing by")}</div>` +
          `<div class="tt-meta">${bot.requestsTotal} reqs · $${bot.costTotalUsd.toFixed(4)} · ${esc(bot.model)}</div>`;
        return;
      }
    }
    this.hoveredBotId = null;
    this.renderer.domElement.style.cursor = "grab";
    this.tooltip.classList.add("hidden");
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const elapsed = this.clock.getElapsedTime();
    const now = performance.now();

    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 600;
    const proj = new THREE.Vector3();

    this.bots.forEach((bot, idx) => {
      const entry = this.botMeshes.get(bot.id);
      if (!entry) return;

      // Subtle idle roaming in central lounge
      if (bot.status === "idle" && now > entry.nextRoamAt) {
        const spot = LOUNGE_SPOTS[(idx + Math.floor(now / 8000)) % LOUNGE_SPOTS.length];
        entry.target.set(spot.x, 0, spot.z);
        entry.nextRoamAt = now + 7000 + Math.random() * 6000;
      }

      const pos = entry.group.position;
      const dx = entry.target.x - pos.x;
      const dz = entry.target.z - pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.08) {
        const step = Math.min(dist, 0.09);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        entry.group.rotation.y = Math.atan2(dx, dz);
        entry.body.position.y = 0.85 + Math.abs(Math.sin(elapsed * 9 + idx)) * 0.14;
      } else {
        entry.body.position.y =
          bot.status === "working" ? 0.85 + Math.sin(elapsed * 4 + idx) * 0.04 : 0.85;
      }

      if (entry.beacon.visible) {
        entry.beacon.position.y = 2.05 + Math.sin(elapsed * 5) * 0.14;
      }

      // Project 3D head coordinate to 2D screen space for floating HTML nameplate
      const lbl = this.labelEls.get(bot.id);
      if (lbl) {
        proj.set(pos.x, pos.y + 2.15, pos.z);
        proj.project(this.camera);
        if (proj.z < 1) {
          const sx = (proj.x * 0.5 + 0.5) * w;
          const sy = (-proj.y * 0.5 + 0.5) * h;
          lbl.style.transform = `translate(-50%, -100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
          lbl.style.opacity = "1";
        } else {
          lbl.style.opacity = "0";
        }
      }
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

window.Office3D = Office3D;
