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

// 6 Functional State-Mapped Rooms (World X: -21..21, Z: -14..14)
// Every room has a clear operational meaning so you read fleet health in 1 second:
// 1. ACTIVE WORKFLOOR (West / Left)       -> status: "working"
// 2. APPROVAL & WAITING ROOM (Top-Center) -> status: "waiting"
// 3. INCIDENT / REPAIR BAY (Top-Right)    -> status: "error"
// 4. WAR ROOM / COLLAB (Bottom-Left)      -> status: "meeting"
// 5. COFFEE LOUNGE (Bottom-Center)        -> status: "idle"
// 6. STANDBY DOCK (Bottom-Right)          -> status: "no_report"

const WORKFLOOR_DESKS = [
  { x: -17.4, z: -10.8 },
  { x: -11.6, z: -10.8 },
  { x: -17.4, z: -6.4 },
  { x: -11.6, z: -6.4 },
  { x: -17.4, z: -2.0 },
  { x: -11.6, z: -2.0 },
  { x: -17.4, z: 2.2 },
  { x: -11.6, z: 2.2 },
];

const WAITING_SPOTS = [
  { x: -2.6, z: -8.6 },
  { x: -0.4, z: -8.6 },
  { x: 1.8, z: -8.6 },
  { x: -1.5, z: -6.4 },
  { x: 0.9, z: -6.4 },
];

const ERROR_BAY_SPOTS = [
  { x: 10.6, z: -9.8 },
  { x: 14.8, z: -9.8 },
  { x: 10.6, z: -5.8 },
  { x: 14.8, z: -5.8 },
];

const WAR_ROOM_SPOTS = [
  { x: -15.8, z: 7.4 },
  { x: -12.6, z: 7.4 },
  { x: -15.8, z: 10.4 },
  { x: -12.6, z: 10.4 },
  { x: -14.2, z: 6.4 },
  { x: -14.2, z: 11.4 },
];

const LOUNGE_SPOTS = [
  { x: -3.2, z: 4.8 },
  { x: -0.6, z: 4.8 },
  { x: -3.2, z: 9.2 },
  { x: -0.4, z: 9.2 },
  { x: 4.2, z: 5.2 },
  { x: 4.2, z: 8.0 },
  { x: 1.8, z: 7.2 },
  { x: -1.6, z: 7.0 },
];

const STANDBY_PADS = [
  { x: 11.2, z: 6.6 },
  { x: 14.8, z: 6.6 },
  { x: 11.2, z: 10.4 },
  { x: 14.8, z: 10.4 },
  { x: 18.0, z: 8.5 },
];

const ROOM_CAMERA_TARGETS = {
  all: { pos: [-26, 30, 31], target: [0, 0.4, 0.5] },
  working: { pos: [-25, 19, 10], target: [-14.5, 0.5, -4.5] },
  waiting: { pos: [-2, 16, 6], target: [-0.4, 0.6, -8.5] },
  error: { pos: [21, 16, 6], target: [13.2, 0.5, -8.2] },
  meeting: { pos: [-22, 16, 20], target: [-14.2, 0.5, 9.0] },
  idle: { pos: [0, 17, 22], target: [0.6, 0.5, 7.2] },
  no_report: { pos: [22, 16, 20], target: [14.2, 0.5, 8.5] },
};

const LIGHTING_PRESETS = {
  day: {
    bg: 0x0b1220,
    ambient: 0xeef4ff,
    ambientInt: 0.65,
    hemiSky: 0xdbeafe,
    hemiGround: 0x262220,
    hemiInt: 0.56,
    sun: 0xfff8eb,
    sunInt: 1.38,
    sunPos: [24, 36, 26],
    fill: 0x93c5fd,
    fillInt: 0.34,
    windowHex: 0xbae6fd,
    windowEmissive: 0.55,
    lampInt: 0.35,
  },
  evening: {
    bg: 0x110e1c,
    ambient: 0xfde68a,
    ambientInt: 0.42,
    hemiSky: 0xfdba74,
    hemiGround: 0x1e1828,
    hemiInt: 0.44,
    sun: 0xfb923c,
    sunInt: 1.15,
    sunPos: [-28, 17, 22],
    fill: 0xc084fc,
    fillInt: 0.36,
    windowHex: 0xfb923c,
    windowEmissive: 0.65,
    lampInt: 1.2,
  },
  night: {
    bg: 0x060913,
    ambient: 0x64748b,
    ambientInt: 0.28,
    hemiSky: 0x1e3a5f,
    hemiGround: 0x090d16,
    hemiInt: 0.32,
    sun: 0x60a5fa,
    sunInt: 0.48,
    sunPos: [16, 30, -18],
    fill: 0x38bdf8,
    fillInt: 0.25,
    windowHex: 0x1e293b,
    windowEmissive: 0.2,
    lampInt: 1.95,
  },
};

/* ---------- Procedural Canvas Textures ---------- */
function makeWoodTexture(baseHex, grainHex, plankCount = 8) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);
  const h = 256 / plankCount;
  for (let i = 0; i < plankCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.045)";
    ctx.fillRect(0, i * h, 256, h);
    ctx.fillStyle = grainHex;
    ctx.fillRect(0, i * h, 256, 1.5);
    ctx.fillRect(((i * 83) % 200) + 28, i * h, 1.5, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function makeCarpetTexture(baseHex, accentHex) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = accentHex;
  for (let y = 0; y < 128; y += 8) {
    for (let x = y % 16 === 0 ? 0 : 4; x < 128; x += 8) {
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.strokeRect(0, 0, 64, 64);
  ctx.strokeRect(64, 64, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}

function makeHexTileTexture(baseHex, lineHex) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 2;
  const r = 18;
  const dx = r * 1.5;
  const dy = r * Math.sqrt(3);
  for (let row = -1; row < 6; row++) {
    for (let col = -1; col < 6; col++) {
      const cx = col * dx;
      const cy = row * dy + (col % 2 === 0 ? 0 : dy / 2);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i;
        const px = cx + r * Math.cos(ang);
        const py = cy + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function makeCeramicTileTexture(baseHex, groutHex) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = groutHex;
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function makeScreenCodeTexture(accent = "#38bdf8") {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 80;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#08101f";
  ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = "#16233d";
  ctx.fillRect(0, 0, 128, 12);
  ctx.fillStyle = accent;
  ctx.fillRect(6, 4, 24, 4);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 === 0 ? accent : "#64748b";
    ctx.fillRect(8 + (i % 3) * 6, 20 + i * 9, 32 + ((i * 23) % 62), 4);
  }
  return new THREE.CanvasTexture(c);
}

function makeWhiteboardTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = "#0284c7";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 22, 56, 30);
  ctx.strokeStyle = "#7c3aed";
  ctx.strokeRect(102, 22, 56, 30);
  ctx.strokeStyle = "#16a34a";
  ctx.strokeRect(186, 22, 52, 30);
  ctx.strokeStyle = "#334155";
  ctx.beginPath();
  ctx.moveTo(74, 37);
  ctx.lineTo(102, 37);
  ctx.moveTo(158, 37);
  ctx.lineTo(186, 37);
  ctx.stroke();
  ctx.strokeStyle = "#ea580c";
  ctx.beginPath();
  ctx.moveTo(22, 108);
  ctx.lineTo(68, 92);
  ctx.lineTo(114, 98);
  ctx.lineTo(164, 74);
  ctx.lineTo(230, 66);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

function makeWallSignTexture(title, subtitle, accentHex) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b1120";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 14, 128);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 42px Inter, sans-serif";
  ctx.fillText(title, 34, 62);
  ctx.fillStyle = accentHex;
  ctx.font = "700 24px Inter, sans-serif";
  ctx.fillText(subtitle, 34, 102);
  return new THREE.CanvasTexture(c);
}

function makeFloorStamp(text, color = "rgba(255,255,255,0.22)") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "800 50px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.transparent = true;
  return tex;
}

class Office3D {
  constructor(container, labelLayer, tooltipEl, onSelectBot) {
    this.container = container;
    this.labelLayer = labelLayer;
    this.tooltip = tooltipEl;
    this.onSelectBot = onSelectBot;

    this.bots = [];
    this.botMeshes = new Map();
    this.labelEls = new Map();
    this.interiorLamps = [];
    this.serverLeds = [];
    this.standbyRings = [];
    this.selectedBotId = null;
    this.hoveredBotId = null;
    this.cameraMode = "rotate";
    this.lightingMode = "day";
    this.showAllLabels = true;
    this.camLerpTarget = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-99, -99);
    this.clock = new THREE.Clock();

    this.initScene();
    this.buildArchitecture();
    this.buildOfficeCat();
    this.bindEvents();
    this.setLighting("day");
    this.animate();
  }

  initScene() {
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1220);

    this.camera = new THREE.PerspectiveCamera(36, w / h, 0.5, 220);
    this.defaultCamPos = new THREE.Vector3(-26, 30, 31);
    this.defaultTarget = new THREE.Vector3(0, 0.4, 0.5);
    this.camera.position.copy(this.defaultCamPos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 66;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.32;

    this.ambientLight = new THREE.AmbientLight(0xeef4ff, 0.65);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x262220, 0.56);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff8eb, 1.38);
    this.sunLight.position.set(24, 36, 26);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -28;
    this.sunLight.shadow.camera.right = 28;
    this.sunLight.shadow.camera.top = 24;
    this.sunLight.shadow.camera.bottom = -24;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x93c5fd, 0.34);
    this.fillLight.position.set(-22, 18, -20);
    this.scene.add(this.fillLight);

    // Zone accent interior lamps
    [
      [-14.5, 4.6, -4.5, 0x34d399, 18], // Workfloor green-white glow
      [-0.4, 4.4, -8.5, 0xfbbf24, 15],  // Waiting room warm amber
      [13.5, 4.4, -8.2, 0xf87171, 15],  // Repair bay diagnostic red
      [-14.2, 4.4, 9.0, 0xc084fc, 15],  // War room purple
      [0.6, 4.6, 7.2, 0xfdba74, 18],    // Coffee lounge cozy warm
      [14.2, 4.2, 8.5, 0x60a5fa, 14],   // Standby dock cool blue
    ].forEach(([lx, ly, lz, color, dist]) => {
      const lamp = new THREE.PointLight(color, 0.35, dist);
      lamp.position.set(lx, ly, lz);
      this.scene.add(lamp);
      this.interiorLamps.push(lamp);
    });
  }

  addBox(w, h, d, colorOrMat, x, y, z, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat =
      colorOrMat instanceof THREE.Material
        ? colorOrMat
        : new THREE.MeshStandardMaterial({
            color: colorOrMat,
            roughness: opts.roughness ?? 0.72,
            metalness: opts.metalness ?? 0.08,
            emissive: opts.emissive ?? 0x000000,
            emissiveIntensity: opts.emissiveIntensity ?? 0,
            transparent: opts.transparent ?? false,
            opacity: opts.opacity ?? 1,
          });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    this.scene.add(mesh);
    return mesh;
  }

  addWall(w, h, d, x, y, z) {
    this.addBox(w, h, d, 0xd8cebe, x, y, z, { roughness: 0.82 });
    this.addBox(w + 0.04, 0.12, d + 0.04, 0x334155, x, y + h / 2 + 0.04, z, { castShadow: false });
    this.addBox(w + 0.03, 0.18, d + 0.03, 0x8b7e6d, x, 0.12, z, { castShadow: false });
  }

  addGlassPartition(w, h, d, x, y, z) {
    this.addBox(w, h, d, 0x93c5fd, x, y, z, {
      transparent: true,
      opacity: 0.22,
      roughness: 0.15,
      metalness: 0.2,
      castShadow: false,
    });
    this.addBox(w + 0.04, 0.1, d + 0.06, 0x1e293b, x, y + h / 2, z, { castShadow: false });
    this.addBox(w + 0.04, 0.12, d + 0.06, 0x1e293b, x, 0.12, z, { castShadow: false });
    const count = Math.max(2, Math.round(Math.max(w, d) / 2.8));
    for (let i = 0; i <= count; i++) {
      const frac = i / count - 0.5;
      const px = w > d ? x + frac * w : x;
      const pz = d >= w ? z + frac * d : z;
      this.addBox(0.08, h, 0.08, 0x1e293b, px, y, pz, { castShadow: false });
    }
  }

  addFloorStamp(text, x, z, w = 7.4, h = 1.6, color = "rgba(255,255,255,0.22)") {
    const tex = makeFloorStamp(text, color);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, 0.12, z);
    this.scene.add(plane);
  }

  addWallSign(title, subtitle, accentHex, x, y, z, rotY = 0) {
    const tex = makeWallSignTexture(title, subtitle, accentHex);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(accentHex),
      emissiveMap: tex,
      emissiveIntensity: 0.45,
      roughness: 0.3,
    });
    this.addBox(4.3, 1.15, 0.14, 0x0f172a, x, y, z, { rotY, castShadow: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 1.0), mat);
    front.position.set(x, y, z);
    front.rotation.y = rotY;
    front.translateZ(0.08);
    this.scene.add(front);
  }

  buildArchitecture() {
    // Foundation Slab + Central Hardwood Hallway Spine
    this.addBox(42.6, 0.85, 29.6, 0x12192b, 0, -0.45, 0, { castShadow: false, roughness: 0.9 });
    const matHallway = new THREE.MeshStandardMaterial({
      map: makeWoodTexture("#9e6b3b", "#754c26", 8),
      roughness: 0.6,
    });
    this.addBox(41.4, 0.14, 28.4, matHallway, 0, 0.01, 0, { castShadow: false });

    // 1. ACTIVE WORKFLOOR (West Wing: X -20.5..-7.2, Z -14..4.2)
    const matWork = new THREE.MeshStandardMaterial({
      map: makeCarpetTexture("#174957", "#1e5d6e"),
      roughness: 0.86,
    });
    this.addBox(13.2, 0.16, 18.2, matWork, -13.8, 0.03, -4.9, { castShadow: false });
    this.addFloorStamp("ACTIVE WORKFLOOR", -14.2, 3.3, 8.2, 1.4, "rgba(52,211,153,0.28)");

    // 2. APPROVAL & WAITING ROOM (Top-Center: X -6.2..5.4, Z -14..-3.2)
    const matWaiting = new THREE.MeshStandardMaterial({
      map: makeCarpetTexture("#52391c", "#664823"),
      roughness: 0.85,
    });
    this.addBox(11.6, 0.36, 10.6, matWaiting, -0.4, 0.14, -8.6, { castShadow: false });
    // Entry step down to central hallway
    this.addBox(4.8, 0.18, 0.8, matHallway, -0.4, 0.08, -3.0, { castShadow: false });
    this.addFloorStamp("WAITING FOR YOU", -0.4, -4.4, 7.2, 1.3, "rgba(251,191,36,0.34)");

    // 3. INCIDENT / REPAIR BAY (Top-Right: X 6.6..20.5, Z -14..-2.4)
    const matError = new THREE.MeshStandardMaterial({
      map: makeHexTileTexture("#541926", "#7a2437"),
      roughness: 0.72,
    });
    this.addBox(13.8, 0.16, 11.5, matError, 13.5, 0.03, -8.2, { castShadow: false });
    this.addFloorStamp("INCIDENT & REPAIR", 13.5, -3.5, 7.6, 1.3, "rgba(248,113,113,0.32)");

    // 4. COLLABORATION WAR ROOM (Bottom-Left: X -20.5..-7.2, Z 5.0..14.0)
    const matWar = new THREE.MeshStandardMaterial({
      map: makeHexTileTexture("#3f2066", "#562c8a"),
      roughness: 0.75,
    });
    this.addBox(13.2, 0.16, 8.9, matWar, -13.8, 0.03, 9.4, { castShadow: false });
    this.addFloorStamp("WAR ROOM", -14.2, 13.0, 6.2, 1.3, "rgba(192,132,252,0.3)");

    // 5. COFFEE LOUNGE & BREAK ROOM (Bottom-Center: X -6.2..7.6, Z 2.2..14.0)
    const matLounge = new THREE.MeshStandardMaterial({
      map: makeCarpetTexture("#b55c27", "#c96a30"),
      roughness: 0.85,
    });
    this.addBox(13.8, 0.16, 11.6, matLounge, 0.7, 0.03, 8.1, { castShadow: false });
    this.addFloorStamp("COFFEE LOUNGE", 0.7, 13.0, 7.2, 1.3, "rgba(255,255,255,0.26)");

    // 6. STANDBY DOCK (Bottom-Right: X 8.6..20.5, Z 2.2..14.0)
    const matStandby = new THREE.MeshStandardMaterial({
      map: makeCeramicTileTexture("#253045", "#1b2436"),
      roughness: 0.45,
    });
    this.addBox(11.8, 0.16, 11.6, matStandby, 14.5, 0.03, 8.1, { castShadow: false });
    this.addFloorStamp("STANDBY DOCK", 14.5, 13.0, 6.8, 1.3, "rgba(148,163,184,0.28)");

    // Exterior Cutaway Walls
    const wallH = 3.0;
    this.addWall(41.4, wallH, 0.46, 0, wallH / 2, -14.1);
    this.addWall(0.46, wallH, 28.4, -20.5, wallH / 2, 0);
    this.addWall(0.46, wallH, 28.4, 20.5, wallH / 2, 0);

    // Interior Partitions with Clear Walkable Doorways
    const divH = 2.25;
    // Workfloor east wall (leaves wide hallway opening around z = -1..2)
    this.addGlassPartition(0.14, divH, 9.6, -7.0, divH / 2, -9.2);
    // Workfloor / War Room divider
    this.addWall(11.4, divH, 0.3, -14.6, divH / 2, 4.8);
    // Waiting Room east glass wall
    this.addGlassPartition(0.14, divH, 9.6, 5.7, divH / 2, -9.2);
    // Repair Bay south wall (leaves doorway on left)
    this.addWall(11.0, divH, 0.3, 14.8, divH / 2, -2.3);
    // War Room east glass wall
    this.addGlassPartition(0.14, divH, 7.6, -7.0, divH / 2, 10.0);
    // Lounge / Standby divider (leaves doorway near top)
    this.addGlassPartition(0.14, divH, 8.2, 8.2, divH / 2, 9.8);

    // Panoramic Back Windows
    this.windowMeshes = [];
    [-17.2, -10.2, 9.6, 17.6].forEach((wx) => {
      this.addBox(3.4, 1.6, 0.22, 0x1e293b, wx, 1.8, -13.86, { castShadow: false });
      const pane = this.addBox(3.15, 1.38, 0.14, 0xbae6fd, wx, 1.8, -13.82, {
        castShadow: false,
        emissive: 0xbae6fd,
        emissiveIntensity: 0.55,
      });
      this.windowMeshes.push(pane);
      this.addBox(0.08, 1.4, 0.2, 0x1e293b, wx, 1.8, -13.8, { castShadow: false });
    });

    // Live Budget & Active Telemetry Jumbotron (Workfloor Back Wall)
    this.usageCanvas = document.createElement("canvas");
    this.usageCanvas.width = 512;
    this.usageCanvas.height = 170;
    this.usageTex = new THREE.CanvasTexture(this.usageCanvas);
    this.addBox(5.4, 1.8, 0.18, 0x0f172a, -13.7, 1.8, -13.8, { roughness: 0.35 });
    const screenMat = new THREE.MeshStandardMaterial({
      map: this.usageTex,
      emissive: 0x38bdf8,
      emissiveMap: this.usageTex,
      emissiveIntensity: 0.85,
      roughness: 0.25,
    });
    const screenMesh = new THREE.Mesh(new THREE.BoxGeometry(5.1, 1.56, 0.12), screenMat);
    screenMesh.position.set(-13.7, 1.8, -13.7);
    this.scene.add(screenMesh);
    this.updateWallScreen(100, 0);

    // Purpose-Built Wall Signs for Key Zones
    this.addWallSign("APPROVAL DESK", "WAITING FOR HUMAN", "#f59e0b", -0.4, 1.85, -13.76, 0);
    this.addWallSign("REPAIR BAY", "DIAGNOSTICS & ERRORS", "#ef4444", 13.6, 1.85, -13.76, 0);
    this.addWallSign("STANDBY DOCK", "IDLE > 24H / OFFLINE", "#64748b", 20.12, 1.75, 8.2, -Math.PI / 2);

    // --- ROOM 1: ACTIVE WORKFLOOR (8 Dual-Monitor Workstations) ---
    this.codeScreenMat = new THREE.MeshStandardMaterial({
      map: makeScreenCodeTexture("#38bdf8"),
      emissive: 0x38bdf8,
      emissiveMap: makeScreenCodeTexture("#38bdf8"),
      emissiveIntensity: 0.65,
      roughness: 0.25,
    });
    WORKFLOOR_DESKS.forEach((d) => this.buildDesk(d.x, d.z));

    // --- ROOM 2: APPROVAL & WAITING ROOM ---
    // Executive Review Counter + Amber Status Strip + Waiting Bench
    this.addBox(5.2, 1.05, 1.1, 0x292524, -0.4, 0.82, -10.8, { roughness: 0.45 });
    this.addBox(5.4, 0.1, 1.25, 0xfef3c7, -0.4, 1.38, -10.8, { roughness: 0.3 });
    this.addBox(4.4, 0.1, 0.08, 0xf59e0b, -0.4, 1.02, -10.22, {
      emissive: 0xf59e0b,
      emissiveIntensity: 1.0,
      castShadow: false,
    });
    // Waiting bench cushions
    this.addBox(3.8, 0.42, 0.85, 0x78350f, -0.4, 0.5, -5.2);
    this.addBox(3.6, 0.1, 0.75, 0xf59e0b, -0.4, 0.74, -5.2);

    // --- ROOM 3: INCIDENT / REPAIR BAY ---
    // Dual Blinking Server Racks + Diagnostic Console
    [18.8, 18.8].forEach((sx, idx) => {
      const sz = idx === 0 ? -11.0 : -8.2;
      this.addBox(1.1, 2.3, 1.6, 0x0f172a, sx, 1.2, sz, { roughness: 0.35, metalness: 0.45 });
      for (let r = 0; r < 5; r++) {
        this.addBox(0.06, 0.24, 1.3, 0x1e293b, sx - 0.56, 0.48 + r * 0.36, sz, { castShadow: false });
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.07, 0.09),
          new THREE.MeshBasicMaterial({ color: r % 2 === 0 ? 0xef4444 : 0x38bdf8 })
        );
        led.position.set(sx - 0.6, 0.48 + r * 0.36, sz - 0.42 + (r % 2) * 0.18);
        this.scene.add(led);
        this.serverLeds.push(led);
      }
    });
    // Repair workbench
    this.addBox(3.2, 0.92, 1.2, 0x334155, 11.8, 0.5, -11.4, { metalness: 0.35 });
    this.addBox(1.1, 0.65, 0.08, 0x0f172a, 11.8, 1.32, -11.7, {
      emissive: 0xef4444,
      emissiveIntensity: 0.65,
    });

    // --- ROOM 4: WAR ROOM / COLLABORATION ---
    const confTop = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.1, 0.14, 32),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35 })
    );
    confTop.position.set(-14.2, 0.9, 8.9);
    confTop.castShadow = true;
    confTop.receiveShadow = true;
    this.scene.add(confTop);
    this.addBox(0.5, 0.85, 0.5, 0x334155, -14.2, 0.45, 8.9);
    // Glowing holographic ring over War Room table
    this.holoRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.04, 10, 32),
      new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.75 })
    );
    this.holoRing.rotation.x = Math.PI / 2;
    this.holoRing.position.set(-14.2, 1.35, 8.9);
    this.scene.add(this.holoRing);

    WAR_ROOM_SPOTS.slice(0, 4).forEach((s) => this.buildSwivelChair(s.x, s.z, 0x6d28d9));

    // Whiteboard on War Room west wall
    const wbMat = new THREE.MeshStandardMaterial({ map: makeWhiteboardTexture(), roughness: 0.35 });
    this.addBox(0.16, 1.35, 3.6, 0x334155, -20.18, 1.55, 8.9, { castShadow: false });
    this.addBox(0.08, 1.2, 3.4, wbMat, -20.1, 1.55, 8.9, { castShadow: false });

    // --- ROOM 5: COFFEE LOUNGE & BREAK ROOM ---
    this.buildLoungeCluster(-1.8, 6.2, 0x57262d, 0x3d2b2e, 0xf59e0b);
    this.buildLoungeCluster(-1.8, 10.6, 0x26354d, 0x273449, 0x38bdf8);

    // Espresso Counter + Machine + Bar Stools
    this.addBox(1.25, 1.05, 4.8, 0x452215, 6.2, 0.56, 6.8, { roughness: 0.5 });
    this.addBox(1.38, 0.08, 4.95, 0xe2e8f0, 6.2, 1.1, 6.8, { roughness: 0.25 });
    this.addBox(0.68, 0.65, 0.95, 0x1e293b, 6.2, 1.44, 5.4, { metalness: 0.6, roughness: 0.3 });
    this.addBox(0.14, 0.14, 0.14, 0x22c55e, 5.84, 1.56, 5.6, {
      emissive: 0x22c55e,
      emissiveIntensity: 0.9,
    });
    [6.6, 7.2, 7.8].forEach((mz) => {
      const mug = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.09, 0.18, 12),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
      );
      mug.position.set(6.1, 1.22, mz);
      this.scene.add(mug);
    });
    [5.2, 6.6, 8.0].forEach((sz) => {
      const stool = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16),
        new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.55 })
      );
      stool.position.set(4.95, 0.72, sz);
      stool.castShadow = true;
      this.scene.add(stool);
      this.addBox(0.08, 0.68, 0.08, 0x334155, 4.95, 0.36, sz);
    });

    // --- ROOM 6: STANDBY DOCK (Charging Pads) ---
    STANDBY_PADS.forEach((pad) => {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.1, 0.14, 24),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.5 })
      );
      base.position.set(pad.x, 0.12, pad.z);
      base.receiveShadow = true;
      this.scene.add(base);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.74, 0.9, 24),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pad.x, 0.21, pad.z);
      this.scene.add(ring);
      this.standbyRings.push(ring);
    });

    // Potted Fiddle-Leaf Plants across the Office
    [
      [-5.6, -12.6],
      [4.6, -12.6],
      [-5.6, 3.2],
      [7.1, 3.2],
      [-19.5, 5.8],
      [-8.2, 12.6],
      [7.1, 12.6],
    ].forEach(([px, pz]) => this.buildPlant(px, pz));
  }

  buildDesk(x, z) {
    this.addBox(2.75, 0.1, 1.3, 0xf1f5f9, x, 0.92, z, { roughness: 0.4 });
    this.addBox(0.1, 0.88, 1.14, 0x334155, x - 1.24, 0.45, z, { metalness: 0.45 });
    this.addBox(0.1, 0.88, 1.14, 0x334155, x + 1.24, 0.45, z, { metalness: 0.45 });

    [-0.56, 0.56].forEach((ox, idx) => {
      const rot = idx === 0 ? 0.16 : -0.16;
      this.addBox(1.02, 0.62, 0.07, 0x0f172a, x + ox, 1.4, z - 0.34, { rotY: rot });
      this.addBox(0.94, 0.54, 0.04, this.codeScreenMat, x + ox, 1.4, z - 0.3, {
        rotY: rot,
        castShadow: false,
      });
      this.addBox(0.1, 0.28, 0.1, 0x475569, x + ox, 1.06, z - 0.36);
    });

    this.addBox(0.86, 0.03, 0.28, 0x1e293b, x - 0.1, 0.99, z + 0.14, { castShadow: false });
    this.addBox(0.24, 0.02, 0.26, 0x334155, x + 0.56, 0.985, z + 0.16, { castShadow: false });
    // Desk lamp
    this.addBox(0.18, 0.04, 0.18, 0x475569, x - 1.05, 0.99, z - 0.22, { castShadow: false });
    this.addBox(0.05, 0.42, 0.05, 0x64748b, x - 1.05, 1.2, z - 0.22, { castShadow: false });
    this.addBox(0.22, 0.1, 0.16, 0xfef08a, x - 0.99, 1.42, z - 0.2, {
      emissive: 0xfde047,
      emissiveIntensity: 0.7,
      castShadow: false,
    });

    this.buildSwivelChair(x, z + 0.92, 0x1e293b);
  }

  buildSwivelChair(x, z, color = 0x1e293b) {
    this.addBox(0.62, 0.06, 0.08, 0x475569, x, 0.06, z, { castShadow: false });
    this.addBox(0.08, 0.06, 0.62, 0x475569, x, 0.06, z, { castShadow: false });
    this.addBox(0.1, 0.34, 0.1, 0x64748b, x, 0.23, z, { castShadow: false });
    this.addBox(0.72, 0.12, 0.68, color, x, 0.44, z);
    this.addBox(0.68, 0.72, 0.11, color, x, 0.82, z + 0.3);
    [-0.36, 0.36].forEach((ax) => {
      this.addBox(0.08, 0.24, 0.48, 0x334155, x + ax, 0.62, z + 0.04, { castShadow: false });
    });
  }

  buildLoungeCluster(x, z, rugHex, sofaHex, pillowHex) {
    this.addBox(5.8, 0.04, 3.6, rugHex, x, 0.12, z, { castShadow: false, roughness: 0.95 });
    this.addBox(3.4, 0.42, 1.1, sofaHex, x, 0.32, z - 1.05);
    this.addBox(3.4, 0.62, 0.26, sofaHex, x, 0.72, z - 1.5);
    [-1.62, 1.62].forEach((ax) => {
      this.addBox(0.24, 0.56, 1.1, sofaHex, x + ax, 0.56, z - 1.05);
    });
    [-1.08, 1.08].forEach((px) => {
      this.addBox(0.42, 0.36, 0.16, pillowHex, x + px, 0.68, z - 1.24, { rotY: px < 0 ? 0.2 : -0.2 });
    });
    this.addBox(2.0, 0.1, 1.0, 0x854d0e, x, 0.45, z + 0.28);
    [[-0.8, -0.1], [0.8, -0.1], [-0.8, 0.65], [0.8, 0.65]].forEach(([ox, oz]) => {
      this.addBox(0.1, 0.4, 0.1, 0x334155, x + ox, 0.22, z + oz);
    });
  }

  buildPlant(x, z) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.3, 0.68, 14),
      new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.78 })
    );
    pot.position.set(x, 0.38, z);
    pot.castShadow = true;
    this.scene.add(pot);
    this.addBox(0.1, 0.75, 0.1, 0x5c3a21, x, 0.85, z, { castShadow: false });
    [
      [0, 1.35, 0, 0.56, 0x15803d],
      [-0.32, 1.12, 0.22, 0.42, 0x16a34a],
      [0.32, 1.15, -0.18, 0.44, 0x22c55e],
    ].forEach(([ox, oy, oz, rad, col]) => {
      const leaf = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rad, 1),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.72 })
      );
      leaf.position.set(x + ox, oy, z + oz);
      leaf.castShadow = true;
      this.scene.add(leaf);
    });
  }

  buildOfficeCat() {
    const cat = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.75 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.75 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 6, 10), furMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.28;
    body.castShadow = true;
    cat.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), furMat);
    head.position.set(0, 0.42, 0.34);
    head.castShadow = true;
    cat.add(head);

    [-0.1, 0.1].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 4), furMat);
      ear.position.set(ex, 0.6, 0.34);
      cat.add(ear);
    });

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), whiteMat);
    chest.position.set(0, 0.28, 0.22);
    cat.add(chest);

    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.35, 4, 8), furMat);
    tail.position.set(0, 0.42, -0.34);
    tail.rotation.x = -0.65;
    cat.add(tail);

    cat.position.set(1.2, 0.1, 1.0);
    this.scene.add(cat);
    this.cat = {
      group: cat,
      tail,
      target: new THREE.Vector3(2.8, 0.1, 4.2),
      nextMoveAt: 2000,
    };
  }

  updateWallScreen(remainingPct, activeCount) {
    const c = this.usageCanvas;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#08101f";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 20px Inter, sans-serif";
    ctx.fillText("DAILY BUDGET REMAINING", 26, 40);

    ctx.fillStyle = remainingPct > 25 ? "#38bdf8" : "#fb7185";
    ctx.font = "800 58px Inter, sans-serif";
    ctx.fillText(`${remainingPct}%`, 26, 106);

    ctx.fillStyle = "#34d399";
    ctx.font = "700 24px Inter, sans-serif";
    ctx.fillText(`${activeCount} ACTIVE`, 322, 98);

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(26, 128, 460, 20);
    ctx.fillStyle = remainingPct > 25 ? "#22c55e" : "#ef4444";
    ctx.fillRect(26, 128, Math.max(10, (460 * remainingPct) / 100), 20);
    this.usageTex.needsUpdate = true;
  }

  /* ---------- Articulated 3D Bot Character Rig ---------- */
  createBotAvatar(bot) {
    const group = new THREE.Group();
    group.userData.botId = bot.id;

    const primaryColor = new THREE.Color(bot.avatarColor || "#38bdf8");
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.55 });
    const shellMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.32, metalness: 0.22 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.25 });

    const rig = new THREE.Group();
    group.add(rig);

    // Legs + Boots
    const makeLeg = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.17, 0.48, 0);
      const legMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.24, 6, 10), darkMetal);
      legMesh.position.y = -0.18;
      legMesh.castShadow = true;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.3), shellMat);
      boot.position.set(0, -0.36, 0.05);
      pivot.add(legMesh, boot);
      return pivot;
    };
    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);
    rig.add(leftLeg, rightLeg);

    // Sculpted Torso + Glowing Chest Core
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.68, 16), shellMat);
    torso.position.y = 0.84;
    torso.castShadow = true;
    torso.userData.botId = bot.id;
    rig.add(torso);

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.14), trimMat);
    chestPlate.position.set(0, 0.88, 0.28);
    chestPlate.userData.botId = bot.id;
    rig.add(chestPlate);

    const chestCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.06, 14),
      new THREE.MeshStandardMaterial({
        color: STATUS_HEX[bot.status] || "#22c55e",
        emissive: STATUS_HEX[bot.status] || "#22c55e",
        emissiveIntensity: 0.9,
      })
    );
    chestCore.rotation.x = Math.PI / 2;
    chestCore.position.set(0, 0.9, 0.36);
    rig.add(chestCore);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.14, 12), darkMetal);
    neck.position.y = 1.24;
    rig.add(neck);

    // Articulated Arms + Coffee Mug Prop
    const makeArm = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.44, 1.1, 0);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), trimMat);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.32, 6, 10), shellMat);
      upper.position.y = -0.22;
      upper.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 10), darkMetal);
      hand.position.y = -0.44;
      pivot.add(shoulder, upper, hand);
      return pivot;
    };
    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);

    const coffeeMug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.07, 0.15, 10),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
    );
    coffeeMug.position.set(0, -0.46, 0.12);
    coffeeMug.visible = false;
    rightArm.add(coffeeMug);
    rig.add(leftArm, rightArm);

    // Expressive Rounded Robot Head + Glossy Visor + Blinking Eyes
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.54, 0);
    rig.add(headGroup);

    const headShell = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 16), shellMat);
    headShell.scale.set(1.06, 0.92, 0.98);
    headShell.castShadow = true;
    headShell.userData.botId = bot.id;
    headGroup.add(headShell);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.26, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x090f1e, roughness: 0.12, metalness: 0.75 })
    );
    visor.position.set(0, 0.02, 0.26);
    visor.userData.botId = bot.id;
    headGroup.add(visor);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd });
    const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.04), eyeMat);
    leftEye.position.set(-0.14, 0.03, 0.39);
    const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.04), eyeMat);
    rightEye.position.set(0.14, 0.03, 0.39);
    headGroup.add(leftEye, rightEye);

    // Role Accessories
    const dept = bot.department || "";
    if (dept.includes("Media") || dept.includes("News")) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 18, Math.PI), darkMetal);
      band.position.y = 0.02;
      headGroup.add(band);
      [-0.41, 0.41].forEach((ex) => {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12), trimMat);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(ex, 0.02, 0);
        headGroup.add(cup);
      });
    } else if (dept.includes("Executive")) {
      const crest = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8, roughness: 0.2 })
      );
      crest.position.set(0, 0.44, 0);
      headGroup.add(crest);
    } else if (dept.includes("Engineering")) {
      [-0.16, 0.16].forEach((ax) => {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 8), darkMetal);
        stem.position.set(ax, 0.42, 0);
        const tip = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
        );
        tip.position.set(ax, 0.56, 0);
        headGroup.add(stem, tip);
      });
    } else {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 8), darkMetal);
      stem.position.set(0, 0.42, 0);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), trimMat);
      tip.position.set(0, 0.55, 0);
      headGroup.add(stem, tip);
    }

    // Status Halo Ring + Urgent Floating Diamond Beacon
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.54, 0.68, 28),
      new THREE.MeshBasicMaterial({
        color: STATUS_HEX[bot.status] || "#22c55e",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.14;
    group.add(halo);

    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    );
    beacon.position.y = 2.48;
    beacon.visible = false;
    group.add(beacon);

    this.scene.add(group);

    // Compact Nameplate
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
      rig,
      headGroup,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      leftEye,
      rightEye,
      eyeMat,
      chestCore,
      coffeeMug,
      hitMeshes: [torso, headShell, visor, chestPlate],
      halo,
      beacon,
      waypoints: [],
      targetRotY: 0,
      zone: bot.status,
      nextRoamAt: performance.now() + 5000 + Math.random() * 6000,
      nextBlinkAt: performance.now() + 1500 + Math.random() * 4000,
    };
  }

  getRoomSpotForBot(bot, stateIndex) {
    if (bot.status === "waiting") {
      const spot = WAITING_SPOTS[stateIndex % WAITING_SPOTS.length];
      return { pos: new THREE.Vector3(spot.x, 0.28, spot.z), rotY: Math.PI };
    }
    if (bot.status === "error") {
      const spot = ERROR_BAY_SPOTS[stateIndex % ERROR_BAY_SPOTS.length];
      return { pos: new THREE.Vector3(spot.x, 0.04, spot.z), rotY: 0 };
    }
    if (bot.status === "meeting") {
      const spot = WAR_ROOM_SPOTS[stateIndex % WAR_ROOM_SPOTS.length];
      const rotY = Math.atan2(-14.2 - spot.x, 8.9 - spot.z);
      return { pos: new THREE.Vector3(spot.x, 0.04, spot.z), rotY };
    }
    if (bot.status === "idle") {
      const spot = LOUNGE_SPOTS[stateIndex % LOUNGE_SPOTS.length];
      return { pos: new THREE.Vector3(spot.x, 0.04, spot.z), rotY: 0 };
    }
    if (bot.status === "no_report") {
      const spot = STANDBY_PADS[stateIndex % STANDBY_PADS.length];
      return { pos: new THREE.Vector3(spot.x, 0.14, spot.z), rotY: 0 };
    }
    // Default: "working" -> Active Workfloor desks
    const desk = WORKFLOOR_DESKS[stateIndex % WORKFLOOR_DESKS.length];
    return { pos: new THREE.Vector3(desk.x, 0.04, desk.z + 0.92), rotY: Math.PI };
  }

  buildHallwayPath(fromPos, toPos, fromZone, toZone) {
    if (fromZone === toZone) {
      return [toPos.clone()];
    }
    // Route smoothly through the central horizontal hallway spine (z = 0.2)
    return [
      new THREE.Vector3(fromPos.x, 0.04, 0.2),
      new THREE.Vector3(toPos.x, 0.04, 0.2),
      toPos.clone(),
    ];
  }

  updateBots(bots, usageSummary) {
    this.bots = bots;
    const activeCount = bots.filter((b) => b.status === "working" || b.status === "meeting").length;
    if (usageSummary) {
      this.updateWallScreen(usageSummary.usageRemainingPct ?? 100, activeCount);
    }

    // Track per-status slot indices so bots spread cleanly inside each designated room
    const slotCounters = {
      working: 0,
      waiting: 0,
      error: 0,
      meeting: 0,
      idle: 0,
      no_report: 0,
    };

    const seenIds = new Set();
    bots.forEach((bot) => {
      seenIds.add(bot.id);
      const slotIdx = slotCounters[bot.status] ?? 0;
      slotCounters[bot.status] = slotIdx + 1;

      const dest = this.getRoomSpotForBot(bot, slotIdx);
      let entry = this.botMeshes.get(bot.id);
      if (!entry) {
        entry = this.createBotAvatar(bot);
        entry.group.position.copy(dest.pos);
        entry.waypoints = [];
        entry.targetRotY = dest.rotY;
        entry.group.rotation.y = dest.rotY;
        entry.zone = bot.status;
        this.botMeshes.set(bot.id, entry);
      } else {
        const lastWp = entry.waypoints[entry.waypoints.length - 1] ?? entry.group.position;
        if (lastWp.distanceTo(dest.pos) > 0.35) {
          entry.waypoints = this.buildHallwayPath(entry.group.position, dest.pos, entry.zone, bot.status);
          entry.zone = bot.status;
        }
        entry.targetRotY = dest.rotY;
      }

      const hex = STATUS_HEX[bot.status] || "#22c55e";
      entry.halo.material.color.set(hex);
      entry.chestCore.material.color.set(hex);
      entry.chestCore.material.emissive.set(hex);
      entry.eyeMat.color.set(
        bot.status === "error" ? "#fb7185" : bot.status === "waiting" ? "#fbbf24" : "#bae6fd"
      );
      entry.coffeeMug.visible = bot.status === "idle";
      entry.beacon.visible = bot.status === "waiting" || bot.status === "error";
      if (entry.beacon.visible) {
        entry.beacon.material.color.set(bot.status === "error" ? "#ef4444" : "#f59e0b");
      }

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

  focusRoom(roomKey) {
    const preset = ROOM_CAMERA_TARGETS[roomKey] || ROOM_CAMERA_TARGETS.all;
    this.camLerpTarget = {
      pos: new THREE.Vector3(...preset.pos),
      target: new THREE.Vector3(...preset.target),
      frames: 45,
    };
  }

  selectBot(botId) {
    this.selectedBotId = botId;
    const entry = this.botMeshes.get(botId);
    if (entry) {
      this.controls.target.lerp(entry.group.position, 0.55);
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
    this.hemiLight.color.setHex(p.hemiSky);
    this.hemiLight.groundColor.setHex(p.hemiGround);
    this.hemiLight.intensity = p.hemiInt;
    this.sunLight.color.setHex(p.sun);
    this.sunLight.intensity = p.sunInt;
    this.sunLight.position.set(...p.sunPos);
    this.fillLight.color.setHex(p.fill);
    this.fillLight.intensity = p.fillInt;
    this.interiorLamps.forEach((l) => (l.intensity = p.lampInt));

    this.windowMeshes.forEach((w) => {
      w.material.color.setHex(p.windowHex);
      w.material.emissive.setHex(p.windowHex);
      w.material.emissiveIntensity = p.windowEmissive;
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
    this.focusRoom("all");
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
      meshes.push(...entry.hitMeshes);
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
          `<div class="tt-task">${esc(bot.task || "Standing by")}</div>`;
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

    // Smooth camera focus transition
    if (this.camLerpTarget) {
      this.camera.position.lerp(this.camLerpTarget.pos, 0.08);
      this.controls.target.lerp(this.camLerpTarget.target, 0.08);
      this.camLerpTarget.frames--;
      if (this.camLerpTarget.frames <= 0) this.camLerpTarget = null;
    }

    // Animated Props
    if (this.holoRing) {
      this.holoRing.rotation.z = elapsed * 0.9;
      this.holoRing.position.y = 1.32 + Math.sin(elapsed * 2.5) * 0.06;
    }
    this.serverLeds.forEach((led, i) => {
      led.visible = Math.sin(elapsed * 4.5 + i * 1.7) > -0.3;
    });
    this.standbyRings.forEach((r, i) => {
      r.material.opacity = 0.25 + (Math.sin(elapsed * 2 + i) + 1) * 0.18;
    });

    // Wandering Office Cat ("Zelda")
    if (this.cat) {
      if (now > this.cat.nextMoveAt) {
        const spots = [
          [0.5, 0.4],
          [3.2, 5.2],
          [-2.6, 3.8],
          [1.6, 8.2],
          [-4.2, 0.4],
          [6.8, 0.4],
        ];
        const pick = spots[Math.floor(Math.random() * spots.length)];
        this.cat.target.set(pick[0], 0.1, pick[1]);
        this.cat.nextMoveAt = now + 5000 + Math.random() * 5000;
      }
      const cp = this.cat.group.position;
      const cdx = this.cat.target.x - cp.x;
      const cdz = this.cat.target.z - cp.z;
      const cdist = Math.hypot(cdx, cdz);
      if (cdist > 0.06) {
        cp.x += (cdx / cdist) * 0.032;
        cp.z += (cdz / cdist) * 0.032;
        this.cat.group.rotation.y = Math.atan2(cdx, cdz);
      }
      this.cat.tail.rotation.z = Math.sin(elapsed * 5.5) * 0.35;
    }

    // Articulated Bot Waypoint Movement & Expressive State Animations
    this.bots.forEach((bot, idx) => {
      const entry = this.botMeshes.get(bot.id);
      if (!entry) return;

      // Lounge idle roaming
      if (bot.status === "idle" && entry.waypoints.length === 0 && now > entry.nextRoamAt) {
        const spot = LOUNGE_SPOTS[(idx + Math.floor(now / 9000)) % LOUNGE_SPOTS.length];
        entry.waypoints = [new THREE.Vector3(spot.x, 0.04, spot.z)];
        entry.nextRoamAt = now + 7500 + Math.random() * 6000;
      }

      const pos = entry.group.position;
      if (entry.waypoints.length > 0) {
        const wp = entry.waypoints[0];
        const dx = wp.x - pos.x;
        const dz = wp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.12) {
          pos.x = wp.x;
          pos.z = wp.z;
          pos.y = wp.y;
          entry.waypoints.shift();
        } else {
          const step = Math.min(dist, 0.11);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          pos.y += (wp.y - pos.y) * 0.12;
          entry.group.rotation.y = Math.atan2(dx, dz);

          const stride = Math.sin(elapsed * 11 + idx);
          entry.leftLeg.rotation.x = stride * 0.55;
          entry.rightLeg.rotation.x = -stride * 0.55;
          entry.leftArm.rotation.x = -stride * 0.45;
          entry.rightArm.rotation.x = stride * 0.45;
          entry.rig.position.y = Math.abs(stride) * 0.09;
        }
      } else {
        entry.group.rotation.y += (entry.targetRotY - entry.group.rotation.y) * 0.08;
        entry.leftLeg.rotation.x *= 0.85;
        entry.rightLeg.rotation.x *= 0.85;

        if (bot.status === "working") {
          entry.leftArm.rotation.x = -0.95 + Math.sin(elapsed * 14 + idx) * 0.14;
          entry.rightArm.rotation.x = -0.95 + Math.cos(elapsed * 14 + idx) * 0.14;
          entry.headGroup.rotation.y = Math.sin(elapsed * 1.4 + idx) * 0.16;
          entry.rig.position.y = Math.sin(elapsed * 3.5 + idx) * 0.02;
        } else if (bot.status === "waiting") {
          entry.rightArm.rotation.x = -2.35 + Math.sin(elapsed * 6) * 0.25;
          entry.leftArm.rotation.x = -0.15;
          entry.headGroup.rotation.y = Math.sin(elapsed * 2.5) * 0.3;
          entry.rig.position.y = 0;
        } else if (bot.status === "error") {
          entry.leftArm.rotation.x = -1.65;
          entry.rightArm.rotation.x = -1.65;
          entry.headGroup.rotation.y = Math.sin(elapsed * 12) * 0.22;
          entry.rig.position.y = 0;
        } else if (bot.status === "idle") {
          entry.rightArm.rotation.x = -0.75;
          entry.leftArm.rotation.x = 0.08;
          entry.headGroup.rotation.y = Math.sin(elapsed * 0.9 + idx) * 0.28;
          entry.rig.position.y = Math.sin(elapsed * 2 + idx) * 0.02;
        } else if (bot.status === "no_report") {
          entry.leftArm.rotation.x = 0.05;
          entry.rightArm.rotation.x = 0.05;
          entry.headGroup.rotation.x = 0.22; // Sleep / standby tilt
          entry.rig.position.y = 0;
        } else {
          entry.leftArm.rotation.x = -0.65 + Math.sin(elapsed * 4 + idx) * 0.22;
          entry.rightArm.rotation.x = -0.55 + Math.cos(elapsed * 3.5 + idx) * 0.2;
          entry.headGroup.rotation.y = Math.sin(elapsed * 1.8 + idx) * 0.25;
          entry.rig.position.y = 0;
        }
      }

      // Natural Eye Blink
      if (bot.status !== "no_report" && now > entry.nextBlinkAt) {
        entry.leftEye.scale.y = 0.15;
        entry.rightEye.scale.y = 0.15;
        if (now > entry.nextBlinkAt + 130) {
          entry.leftEye.scale.y = 1;
          entry.rightEye.scale.y = 1;
          entry.nextBlinkAt = now + 2600 + Math.random() * 4200;
        }
      }

      if (entry.beacon.visible) {
        entry.beacon.position.y = 2.48 + Math.sin(elapsed * 5) * 0.12;
        entry.beacon.rotation.y = elapsed * 2.5;
      }

      // Project floating HTML nameplate
      const lbl = this.labelEls.get(bot.id);
      if (lbl) {
        const show =
          this.showAllLabels ||
          this.selectedBotId === bot.id ||
          this.hoveredBotId === bot.id ||
          bot.status === "waiting" ||
          bot.status === "error";
        proj.set(pos.x, pos.y + 2.38, pos.z);
        proj.project(this.camera);
        if (show && proj.z < 1) {
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
