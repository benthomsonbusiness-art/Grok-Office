import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const STATUS_HEX = {
  working: "#10b981",
  waiting: "#f59e0b",
  error: "#f43f5e",
  idle: "#06b6d4",
  meeting: "#a855f7",
  no_report: "#64748b",
};

// 6 Functional State-Mapped Argon Cyberpunk Penthouse Zones
const WORKFLOOR_DESKS = [
  { x: -17.2, z: -10.6 },
  { x: -11.4, z: -10.6 },
  { x: -17.2, z: -6.2 },
  { x: -11.4, z: -6.2 },
  { x: -17.2, z: -1.8 },
  { x: -11.4, z: -1.8 },
  { x: -17.2, z: 2.3 },
  { x: -11.4, z: 2.3 },
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
  { x: 0.6, z: 15.2 }, // Outdoor Argon sky-terrace
];

const STANDBY_PADS = [
  { x: 11.2, z: 6.6 },
  { x: 14.8, z: 6.6 },
  { x: 11.2, z: 10.4 },
  { x: 14.8, z: 10.4 },
  { x: 18.0, z: 8.5 },
];

const ROOM_CAMERA_TARGETS = {
  all: { pos: [-26, 28, 34], target: [0, 0.8, 0.5] },
  working: { pos: [-25, 18, 10], target: [-14.2, 0.8, -4.5] },
  waiting: { pos: [-2, 15, 6], target: [-0.4, 0.9, -8.5] },
  error: { pos: [21, 15, 6], target: [13.2, 0.8, -8.2] },
  meeting: { pos: [-22, 15, 20], target: [-14.2, 0.8, 9.0] },
  idle: { pos: [0, 16, 25], target: [0.6, 0.8, 8.6] },
  no_report: { pos: [22, 15, 20], target: [14.2, 0.8, 8.5] },
};

const LIGHTING_PRESETS = {
  day: {
    skyTop: "#0c203e",
    skyMid: "#193e6d",
    skyHorizon: "#4ea8de",
    fog: 0x0c1b33,
    ambient: 0xe0f2fe,
    ambientInt: 0.85,
    hemiSky: 0xbae6fd,
    hemiGround: 0x1e293b,
    hemiInt: 0.72,
    sun: 0xfff8eb,
    sunInt: 1.35,
    sunPos: [26, 40, 24],
    fill: 0x38bdf8,
    fillInt: 0.62,
    lampInt: 0.95,
    bloomStrength: 0.34,
    starsOpacity: 0.08,
  },
  evening: {
    skyTop: "#0e0624",
    skyMid: "#3b134c",
    skyHorizon: "#d946ef",
    fog: 0x130926,
    ambient: 0xf5d0fe,
    ambientInt: 0.62,
    hemiSky: 0xe879f9,
    hemiGround: 0x150e2a,
    hemiInt: 0.62,
    sun: 0xf97316,
    sunInt: 1.15,
    sunPos: [-28, 18, 22],
    fill: 0x06b6d4,
    fillInt: 0.68,
    lampInt: 1.55,
    bloomStrength: 0.48,
    starsOpacity: 0.45,
  },
  night: {
    skyTop: "#030510",
    skyMid: "#090f26",
    skyHorizon: "#1e1b4b",
    fog: 0x050816,
    ambient: 0xa5f3fc,
    ambientInt: 0.56,
    hemiSky: 0x38bdf8,
    hemiGround: 0x131129,
    hemiInt: 0.62,
    sun: 0x818cf8,
    sunInt: 0.82,
    sunPos: [18, 34, -20],
    fill: 0xc084fc,
    fillInt: 0.58,
    lampInt: 1.9,
    bloomStrength: 0.5,
    starsOpacity: 0.92,
  },
};

/* ---------- Procedural Argon Cyberpunk Textures ---------- */
function makeTechGridFloor(baseHex, gridHex, accentDot = null) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  // Subtle metallic micro-grain
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 256, 1);

  ctx.strokeStyle = gridHex;
  ctx.lineWidth = 1.6;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }

  if (accentDot) {
    ctx.fillStyle = accentDot;
    for (let x = 0; x <= 256; x += 64) {
      for (let y = 0; y <= 256; y += 64) {
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}

function makeHexTechFloor(baseHex, lineHex, glowDot = null) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 1.8;
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
      if (glowDot && (row + col) % 3 === 0) {
        ctx.fillStyle = glowDot;
        ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function makeArgonWalnutTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#35231b";
  ctx.fillRect(0, 0, 256, 256);
  const h = 32;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,215,175,0.05)" : "rgba(0,0,0,0.1)";
    ctx.fillRect(0, i * h, 256, h);
    ctx.fillStyle = "#1c120d";
    ctx.fillRect(0, i * h, 256, 1.5);
    ctx.fillRect(((i * 97) % 210) + 22, i * h, 1.5, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function makeMetropolisGroundTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#040713";
  ctx.fillRect(0, 0, 512, 512);

  // Dark city blocks
  ctx.fillStyle = "#080e20";
  for (let x = 8; x < 512; x += 64) {
    for (let y = 8; y < 512; y += 64) {
      ctx.fillRect(x, y, 50, 50);
    }
  }

  // Argon Cyan & Plasma Violet Arterial Highways
  for (let i = 0; i <= 512; i += 64) {
    const isMajor = i % 128 === 0;
    ctx.strokeStyle = isMajor ? "rgba(6, 182, 212, 0.55)" : "rgba(139, 92, 246, 0.28)";
    ctx.lineWidth = isMajor ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();

    ctx.strokeStyle = isMajor ? "rgba(168, 85, 247, 0.5)" : "rgba(56, 189, 248, 0.25)";
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  // Glowing highway intersections
  for (let x = 0; x <= 512; x += 128) {
    for (let y = 0; y <= 512; y += 128) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.75)";
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  return tex;
}

function makeSkyscraperFacadeTexture(accentHex, secondaryHex = "#38bdf8", seed = 1) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#060b18";
  ctx.fillRect(0, 0, 256, 512);

  // Subtle vertical structural mullions
  ctx.fillStyle = "#0d162c";
  for (let x = 0; x < 256; x += 32) {
    ctx.fillRect(x, 0, 3, 512);
  }
  // Horizontal floor spandrel bands
  ctx.fillStyle = "#091022";
  for (let y = 0; y < 512; y += 16) {
    ctx.fillRect(0, y, 256, 4);
  }

  // deterministic pseudo-random for crisp architectural window ribbons
  let s = seed * 1337;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let y = 6; y < 504; y += 16) {
    const floorLit = rand() > 0.22;
    const isAccentFloor = rand() > 0.88;
    for (let x = 5; x < 250; x += 16) {
      if (x % 32 === 0) continue;
      const r = rand();
      if (floorLit && r > 0.42) {
        if (isAccentFloor || r > 0.91) {
          ctx.fillStyle = accentHex;
        } else if (r > 0.76) {
          ctx.fillStyle = secondaryHex;
        } else if (r > 0.64) {
          ctx.fillStyle = "#e0f2fe";
        } else {
          ctx.fillStyle = "#1e293b";
        }
        ctx.fillRect(x, y, 10, 8);
      } else {
        ctx.fillStyle = "#0b1325";
        ctx.fillRect(x, y, 10, 8);
      }
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeSkyGradientTexture(top, mid, horizon) {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(0.46, mid);
  g.addColorStop(0.74, horizon);
  g.addColorStop(0.88, "#090d24");
  g.addColorStop(1, "#030612");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 256);
  return new THREE.CanvasTexture(c);
}

function makeCyberScreenTexture(accent = "#06b6d4", titleText = null) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#040817";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  for (let x = 0; x < 256; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  if (titleText) {
    ctx.font = "800 18px Inter, sans-serif";
    ctx.fillText(titleText, 12, 24);
  } else {
    ctx.fillRect(10, 10, 62, 6);
  }
  // Waveform / code bars
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 3 === 0 ? accent : i % 2 === 0 ? "#a855f7" : "#475569";
    ctx.fillRect(12 + (i % 2) * 8, 34 + i * 12, 44 + ((i * 37) % 110), 5);
  }
  // Mini bar chart right side
  for (let b = 0; b < 5; b++) {
    const bh = 22 + ((b * 19) % 52);
    ctx.fillStyle = accent;
    ctx.fillRect(178 + b * 14, 114 - bh, 9, bh);
  }
  return new THREE.CanvasTexture(c);
}

function makeNeonSignTexture(title, subtitle, accentHex) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#050918";
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 504, 120);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 42px Inter, sans-serif";
  ctx.fillText(title, 28, 62);
  ctx.fillStyle = accentHex;
  ctx.font = "700 22px Inter, sans-serif";
  ctx.fillText(subtitle, 28, 100);
  return new THREE.CanvasTexture(c);
}

function makeFloorStamp(text, color) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "800 46px Inter, sans-serif";
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
    this.skyTraffic = [];
    this.skyBeacons = [];
    this.steamPuffs = [];
    this.dataPackets = [];
    this.selectedBotId = null;
    this.hoveredBotId = null;
    this.cameraMode = "rotate";
    this.lightingMode = "night";
    this.showAllLabels = true;
    this.camLerpTarget = null;
    this.roomCounts = { working: 0, waiting: 0, error: 0, meeting: 0, idle: 0, no_report: 0 };

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-99, -99);
    this.clock = new THREE.Clock();

    this.initScene();
    this.buildSkyAndCity();
    this.buildCyberPenthouse();
    this.buildOfficeCat();
    this.bindEvents();
    this.setLighting("night");
    this.animate();
  }

  initScene() {
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x050816, 0.0046);

    this.camera = new THREE.PerspectiveCamera(37, w / h, 0.5, 420);
    this.defaultCamPos = new THREE.Vector3(-26, 28, 34);
    this.defaultTarget = new THREE.Vector3(0, 0.8, 0.5);
    this.camera.position.copy(this.defaultCamPos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.container.appendChild(this.renderer.domElement);

    // Post-processing UnrealBloom + OutputPass for crisp ACES tone-mapped Argon neon & screen glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.42, 0.8);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.22;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 72;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.25;

    // Studio & Argon Accent Lighting (Balanced so furniture & bots pop clearly)
    this.ambientLight = new THREE.AmbientLight(0xa5f3fc, 0.56);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x131129, 0.62);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0x818cf8, 0.82);
    this.sunLight.position.set(18, 34, -20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -28;
    this.sunLight.shadow.camera.right = 28;
    this.sunLight.shadow.camera.top = 26;
    this.sunLight.shadow.camera.bottom = -26;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0xc084fc, 0.58);
    this.fillLight.position.set(-24, 20, 24);
    this.scene.add(this.fillLight);

    [
      [-14.2, 5.2, -4.5, 0x06b6d4, 24], // Workfloor Argon cyan glow
      [-0.4, 5.0, -8.5, 0xfbbf24, 19],  // Approval Desk warm amber
      [13.5, 5.0, -8.2, 0xf43f5e, 19],  // Repair Bay crimson
      [-14.2, 5.0, 9.0, 0xa855f7, 19],  // War Room Argon plasma violet
      [0.6, 5.2, 8.2, 0x38bdf8, 22],    // Cyber Lounge bright Argon fill
      [14.2, 4.8, 8.5, 0x06b6d4, 18],   // Standby Dock cool cyan
      [4.5, 4.2, 16.0, 0xf59e0b, 16],   // Outdoor Sky-Terrace warm lounge glow
    ].forEach(([lx, ly, lz, color, dist]) => {
      const lamp = new THREE.PointLight(color, 1.8, dist);
      lamp.position.set(lx, ly, lz);
      this.scene.add(lamp);
      this.interiorLamps.push(lamp);
    });
  }

  addBox(w, h, d, colorOrMat, x, y, z, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat =
      Array.isArray(colorOrMat) || colorOrMat instanceof THREE.Material
        ? colorOrMat
        : new THREE.MeshStandardMaterial({
            color: colorOrMat,
            roughness: opts.roughness ?? 0.42,
            metalness: opts.metalness ?? 0.28,
            emissive: opts.emissive ?? 0x000000,
            emissiveIntensity: opts.emissiveIntensity ?? 0,
            transparent: opts.transparent ?? false,
            opacity: opts.opacity ?? 1,
          });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    if (opts.rotX) mesh.rotation.x = opts.rotX;
    if (opts.rotZ) mesh.rotation.z = opts.rotZ;
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    this.scene.add(mesh);
    return mesh;
  }

  addNeonStrip(w, h, d, hexColor, x, y, z, intensity = 1.6, rotY = 0) {
    return this.addBox(w, h, d, hexColor, x, y, z, {
      emissive: hexColor,
      emissiveIntensity: intensity,
      roughness: 0.15,
      metalness: 0.1,
      castShadow: false,
      receiveShadow: false,
      rotY,
    });
  }

  addZoneBorder(cx, cz, w, d, hexColor, y = 0.125) {
    const t = 0.08;
    const h = 0.03;
    this.addNeonStrip(w, h, t, hexColor, cx, y, cz - d / 2, 1.5);
    this.addNeonStrip(w, h, t, hexColor, cx, y, cz + d / 2, 1.5);
    this.addNeonStrip(t, h, d, hexColor, cx - w / 2, y, cz, 1.5);
    this.addNeonStrip(t, h, d, hexColor, cx + w / 2, y, cz, 1.5);
  }

  /* ---------- 1. Multi-Plane Argon Metropolis Skyline & Penthouse Megastructure ---------- */
  buildSkyAndCity() {
    // 1A. Sky Gradient Sphere Dome
    this.skyMat = new THREE.MeshBasicMaterial({
      map: makeSkyGradientTexture(
        LIGHTING_PRESETS.night.skyTop,
        LIGHTING_PRESETS.night.skyMid,
        LIGHTING_PRESETS.night.skyHorizon
      ),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 24), this.skyMat);
    this.scene.add(skyDome);

    // 1B. Deep Metropolis Street-Grid Ground Plane at y = -95 (Eliminates empty blue void!)
    const groundTex = makeMetropolisGroundTexture();
    const cityGround = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshBasicMaterial({
        map: groundTex,
        color: 0xffffff,
      })
    );
    cityGround.rotation.x = -Math.PI / 2;
    cityGround.position.y = -95;
    this.scene.add(cityGround);

    // Subtle Argon Horizon Glow Ring at y = -94.5
    const horizonGlow = new THREE.Mesh(
      new THREE.RingGeometry(48, 220, 64),
      new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.08,
      })
    );
    horizonGlow.rotation.x = -Math.PI / 2;
    horizonGlow.position.y = -94.5;
    this.scene.add(horizonGlow);

    // 1C. Starfield Points in Upper Hemisphere
    const starCount = 420;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * (Math.PI * 0.44);
      const r = 230;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi) + 12;
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    this.starsMat = new THREE.PointsMaterial({
      color: 0xe0f2fe,
      size: 1.0,
      transparent: true,
      opacity: 0.92,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starsMat);
    this.scene.add(this.stars);

    // 1D. Penthouse's Own Flagship Skyscraper Megastructure Shaft (y = -1.2 down to y = -95)
    // Grounds the penthouse atop an iconic Argon HQ tower instead of floating in mid-air
    const shaftH = 94;
    const shaftY = -1.2 - shaftH / 2;
    this.addBox(39.6, shaftH, 27.6, 0x070c1a, 0, shaftY, 0.2, {
      roughness: 0.45,
      metalness: 0.55,
      castShadow: false,
    });

    // Chamfered Corner Megacolumns & Cantilevered Terrace Support Beams
    [
      [-20.2, -13.8],
      [20.2, -13.8],
      [-20.2, 14.2],
      [20.2, 14.2],
    ].forEach(([cx, cz], idx) => {
      this.addBox(2.2, shaftH, 2.2, 0x0f172a, cx, shaftY, cz, {
        roughness: 0.35,
        metalness: 0.65,
        castShadow: false,
      });
      // Vertical Argon Neon Light Fins running down the HQ tower shaft
      const finColor = idx % 2 === 0 ? 0x06b6d4 : 0xa855f7;
      this.addNeonStrip(0.18, shaftH - 2, 0.18, finColor, cx + (cx < 0 ? -1.12 : 1.12), shaftY, cz + (cz < 0 ? -1.12 : 1.12), 1.4);
    });

    // Horizontal Architectural Belt Trims around HQ Tower Shaft
    [-4.5, -12.0, -24.0, -40.0].forEach((by, bIdx) => {
      const col = bIdx % 2 === 0 ? 0x06b6d4 : 0x8b5cf6;
      this.addBox(41.2, 0.7, 29.2, 0x111c33, 0, by, 0.2, { castShadow: false });
      this.addNeonStrip(41.5, 0.12, 29.5, col, 0, by, 0.2, 1.2);
    });

    // Cantilevered Structural Steel Ribs supporting the South Sky-Terrace
    [-4.0, 1.6, 7.2, 12.8, 18.4].forEach((rx) => {
      this.addBox(0.65, 2.6, 5.2, 0x162238, rx, -1.9, 15.6, {
        roughness: 0.35,
        metalness: 0.65,
        castShadow: false,
      });
      this.addNeonStrip(0.14, 0.12, 4.6, 0x06b6d4, rx, -0.7, 15.8, 1.3);
    });

    // 1E. 3-Tier Argon Metropolis Skyline with Proper 6-Face Materials & Rooftop Caps
    const argonPalettes = [
      { primary: "#06b6d4", secondary: "#38bdf8", hex: 0x06b6d4 },
      { primary: "#a855f7", secondary: "#c084fc", hex: 0xa855f7 },
      { primary: "#38bdf8", secondary: "#818cf8", hex: 0x38bdf8 },
      { primary: "#ec4899", secondary: "#f472b6", hex: 0xec4899 },
      { primary: "#22d3ee", secondary: "#a855f7", hex: 0x22d3ee },
    ];
    const baseWindowTextures = argonPalettes.map((p, i) =>
      makeSkyscraperFacadeTexture(p.primary, p.secondary, i + 1)
    );
    const roofCapMat = new THREE.MeshStandardMaterial({
      color: 0x070d1b,
      roughness: 0.55,
      metalness: 0.45,
    });

    const yBase = -95;
    const towers = [];

    // Helper to keep foreground camera view (front-left & front-right) unobstructed
    const isInCameraForeground = (x, z, dist) => {
      // Default camera looks from (-26, 28, 34) toward (0, 0.8, 0.5).
      // Any tall tower in front of z > 14 within x in [-46, 46] and dist < 85 can clip into bottom corners
      if (z > 14 && dist < 86) return true;
      return false;
    };

    // Tier 1: Deep Low-Rise City Blocks far below penthouse level (tops around y = -48 to -24)
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * Math.PI * 2 + 0.08;
      const dist = 36 + (i % 3) * 11;
      const bx = Math.cos(angle) * dist * 1.25;
      const bz = Math.sin(angle) * dist * 1.05;
      const topY = -46 + (i % 5) * 4.5;
      towers.push({
        x: bx,
        z: bz,
        w: 7 + (i % 4) * 2.2,
        d: 7 + ((i + 2) % 4) * 2.2,
        topY,
        tier: 1,
        idx: i,
      });
    }

    // Tier 2: Mid-Rise Horizon Skyscrapers framing the penthouse (clear of front camera sector)
    for (let i = 0; i < 34; i++) {
      const angle = (i / 34) * Math.PI * 2;
      const dist = 56 + (i % 3) * 14;
      const bx = Math.cos(angle) * dist * 1.28;
      const bz = Math.sin(angle) * dist * 1.02;
      if (isInCameraForeground(bx, bz, dist)) {
        // Keep foreground towers strictly below the terrace floor line (topY <= -22)
        towers.push({
          x: bx,
          z: bz,
          w: 9 + (i % 3) * 2.5,
          d: 9 + ((i + 1) % 3) * 2.5,
          topY: -26 - (i % 4) * 5,
          tier: 1,
          idx: i + 40,
        });
        continue;
      }
      const topY = -8 + (i % 6) * 5.2;
      towers.push({
        x: bx,
        z: bz,
        w: 8.5 + (i % 4) * 2.5,
        d: 8.5 + ((i + 2) % 4) * 2.5,
        topY,
        tier: 2,
        idx: i,
      });
    }

    // Tier 3: Massive Distant Argon Megatowers along the back & side skyline
    for (let i = 0; i < 24; i++) {
      const frac = i / 23;
      // Sweep behind and around the sides (angle from -1.05*PI to +0.05*PI in back Z < 10)
      const angle = Math.PI * (0.92 + frac * 1.16);
      const dist = 92 + (i % 3) * 18;
      const bx = Math.cos(angle) * dist * 1.32;
      const bz = Math.sin(angle) * dist * 0.98;
      const topY = 14 + (i % 5) * 8.5;
      towers.push({
        x: bx,
        z: bz,
        w: 12 + (i % 4) * 3.5,
        d: 12 + ((i + 1) % 4) * 3.5,
        topY,
        tier: 3,
        idx: i,
      });
    }

    towers.forEach((t) => {
      const h = Math.max(16, t.topY - yBase);
      const pal = argonPalettes[t.idx % argonPalettes.length];
      const baseTex = baseWindowTextures[t.idx % baseWindowTextures.length];

      // Clone texture metadata lightly with proportional world-space UV repeat so windows never stretch!
      const sideTex = baseTex.clone();
      sideTex.needsUpdate = true;
      sideTex.repeat.set(Math.max(1, Math.round(t.w / 7)), Math.max(2, Math.round(h / 18)));

      const facadeMat = new THREE.MeshStandardMaterial({
        color: 0x080f20,
        map: sideTex,
        emissive: new THREE.Color(pal.primary),
        emissiveMap: sideTex,
        emissiveIntensity: t.tier === 3 ? 0.82 : 0.68,
        roughness: 0.42,
        metalness: 0.48,
      });

      // 6-face material array: [+X, -X, +Y (Roof!), -Y (Base), +Z, -Z]
      const materials = [facadeMat, facadeMat, roofCapMat, roofCapMat, facadeMat, facadeMat];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, h, t.d), materials);
      mesh.position.set(t.x, yBase + h / 2, t.z);
      this.scene.add(mesh);

      // Detailed Architectural Rooftop Crown & Mechanical Penthouse Cap (Never flat window tiles!)
      this.addBox(t.w - 0.8, 0.55, t.d - 0.8, 0x0e172a, t.x, t.topY + 0.25, t.z, {
        castShadow: false,
        roughness: 0.5,
        metalness: 0.5,
      });

      // Glowing Argon Crown Frame on Tier 2 & Tier 3 Towers
      if (t.tier >= 2 || t.idx % 2 === 0) {
        this.addNeonStrip(t.w + 0.16, 0.24, t.d + 0.16, pal.hex, t.x, t.topY + 0.08, t.z, 1.45);
      }

      // Vertical Argon Corner Laser Ribs on Megatowers
      if (t.tier === 3 && t.idx % 2 === 0) {
        this.addNeonStrip(0.28, h * 0.85, 0.28, pal.hex, t.x - t.w / 2, yBase + h * 0.55, t.z + t.d / 2, 1.35);
        this.addNeonStrip(0.28, h * 0.85, 0.28, pal.hex, t.x + t.w / 2, yBase + h * 0.55, t.z + t.d / 2, 1.35);
      }

      // Rooftop HVAC Units / Helipad Rings / Communication Spires
      if (t.idx % 3 === 0) {
        // Illuminated Helipad Ring on flat roofs
        const heliRing = new THREE.Mesh(
          new THREE.RingGeometry(Math.min(t.w, t.d) * 0.24, Math.min(t.w, t.d) * 0.29, 24),
          new THREE.MeshBasicMaterial({
            color: pal.hex,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.75,
          })
        );
        heliRing.rotation.x = -Math.PI / 2;
        heliRing.position.set(t.x, t.topY + 0.56, t.z);
        this.scene.add(heliRing);
      } else {
        // Tiered mechanical penthouse + antenna spire
        this.addBox(t.w * 0.45, 2.2, t.d * 0.45, 0x111c33, t.x, t.topY + 1.3, t.z, { castShadow: false });
        if (t.tier >= 2) {
          this.addBox(0.18, 5.5, 0.18, 0x334155, t.x, t.topY + 4.8, t.z, { castShadow: false });
          const b = new THREE.Mesh(
            new THREE.SphereGeometry(0.28, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xf43f5e })
          );
          b.position.set(t.x, t.topY + 7.7, t.z);
          this.scene.add(b);
          this.skyBeacons.push(b);
        }
      }
    });

    // 1F. Multi-Altitude Flying Argon Traffic Streams
    for (let i = 0; i < 18; i++) {
      const col = i % 3 === 0 ? 0xa855f7 : i % 2 === 0 ? 0x06b6d4 : 0xf43f5e;
      const streak = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.14, 0.18),
        new THREE.MeshBasicMaterial({ color: col })
      );
      const laneZ = i < 12 ? -24 - (i % 6) * 9.5 : 26 + (i % 3) * 10;
      const laneY = i < 12 ? -18 + (i % 5) * 7.5 : -28 - (i % 3) * 8;
      streak.position.set((Math.random() - 0.5) * 140, laneY, laneZ);
      this.scene.add(streak);
      this.skyTraffic.push({
        mesh: streak,
        speed: (i % 2 === 0 ? 1 : -1) * (0.16 + Math.random() * 0.16),
      });
    }
  }

  addGlassWall(w, h, d, x, y, z, neonHex = 0x06b6d4) {
    // Tinted Argon glass + brushed titanium mullions + top & bottom neon hairlines
    this.addBox(w, h, d, 0x38bdf8, x, y, z, {
      transparent: true,
      opacity: 0.17,
      roughness: 0.08,
      metalness: 0.4,
      castShadow: false,
    });
    this.addBox(w + 0.06, 0.12, d + 0.08, 0x1e293b, x, y + h / 2, z, { castShadow: false });
    this.addBox(w + 0.06, 0.16, d + 0.08, 0x1e293b, x, 0.14, z, { castShadow: false });
    this.addNeonStrip(
      w > d ? w : 0.06,
      0.048,
      d >= w ? d : 0.06,
      neonHex,
      x,
      y + h / 2 + 0.06,
      z,
      1.45
    );
    const count = Math.max(2, Math.round(Math.max(w, d) / 3.2));
    for (let i = 0; i <= count; i++) {
      const frac = i / count - 0.5;
      const px = w > d ? x + frac * w : x;
      const pz = d >= w ? z + frac * d : z;
      this.addBox(0.1, h, 0.1, 0x334155, px, y, pz, { castShadow: false });
    }
  }

  addSlattedFeatureWall(w, h, d, x, y, z, neonHex = 0x06b6d4) {
    this.addBox(w, h, d, 0x162038, x, y, z, { roughness: 0.48, metalness: 0.38 });
    const isHorizontal = w > d;
    const len = isHorizontal ? w : d;
    const slats = Math.floor(len / 0.65);
    for (let i = 0; i < slats; i++) {
      const offset = -len / 2 + 0.35 + i * 0.65;
      if (isHorizontal) {
        this.addBox(0.16, h - 0.2, 0.08, 0x4a3226, x + offset, y, z + d / 2 + 0.04, { castShadow: false });
      } else {
        this.addBox(0.08, h - 0.2, 0.16, 0x4a3226, x + (x < 0 ? w / 2 + 0.04 : -w / 2 - 0.04), y, z + offset, { castShadow: false });
      }
    }
    this.addNeonStrip(
      isHorizontal ? w : 0.08,
      0.06,
      isHorizontal ? 0.08 : d,
      neonHex,
      x,
      y + h / 2 + 0.04,
      z,
      1.55
    );
  }

  addNeonSign(title, subtitle, accentHex, x, y, z, rotY = 0) {
    const tex = makeNeonSignTexture(title, subtitle, accentHex);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(accentHex),
      emissiveMap: tex,
      emissiveIntensity: 1.12,
      roughness: 0.2,
    });
    this.addBox(4.4, 1.15, 0.14, 0x0b1326, x, y, z, { rotY, castShadow: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.0), mat);
    front.position.set(x, y, z);
    front.rotation.y = rotY;
    front.translateZ(0.08);
    this.scene.add(front);
  }

  addFloorStamp(text, x, z, w, h, color) {
    const tex = makeFloorStamp(text, color);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, 0.145, z);
    this.scene.add(plane);
  }

  addPendantBar(w, x, y, z, hex = 0x06b6d4, rotY = 0) {
    this.addBox(w, 0.08, 0.18, 0x1e293b, x, y, z, { rotY, castShadow: false });
    this.addBox(w - 0.12, 0.055, 0.12, hex, x, y - 0.04, z, {
      rotY,
      emissive: hex,
      emissiveIntensity: 1.85,
      castShadow: false,
    });
  }

  /* ---------- 2. Argon Cyberpunk Skyscraper Penthouse Command Center ---------- */
  buildCyberPenthouse() {
    // Skyscraper Penthouse Structural Floor Slab + Double Argon Exterior Edge Trim
    this.addBox(43.4, 1.35, 33.8, 0x0c1428, 0, -0.68, 1.7, {
      castShadow: false,
      roughness: 0.48,
      metalness: 0.45,
    });
    this.addNeonStrip(43.6, 0.09, 0.09, 0x06b6d4, 0, -0.02, -15.2, 1.6);
    this.addNeonStrip(43.6, 0.09, 0.09, 0xa855f7, 0, -0.02, 18.6, 1.6);
    this.addNeonStrip(0.09, 0.09, 33.8, 0x06b6d4, -21.7, -0.02, 1.7, 1.5);
    this.addNeonStrip(0.09, 0.09, 33.8, 0xa855f7, 21.7, -0.02, 1.7, 1.5);

    // Central Argon Obsidian Tech Concourse Spine
    const matConcourse = new THREE.MeshStandardMaterial({
      map: makeTechGridFloor("#111b33", "#22345c", "#06b6d4"),
      roughness: 0.32,
      metalness: 0.45,
    });
    this.addBox(41.4, 0.14, 28.4, matConcourse, 0, 0.01, 0, { castShadow: false });

    // Dual Glowing Argon Guide Strips along the Central Concourse
    this.addNeonStrip(38.4, 0.03, 0.07, 0x06b6d4, 0, 0.1, -0.15, 1.45);
    this.addNeonStrip(38.4, 0.03, 0.07, 0xa855f7, 0, 0.1, 0.55, 1.35);

    // --- ZONE 1. ACTIVE WORKFLOOR (West Wing: working) ---
    const matWork = new THREE.MeshStandardMaterial({
      map: makeHexTechFloor("#0f2b3c", "#1c5670", "#10b981"),
      roughness: 0.38,
      metalness: 0.32,
    });
    this.addBox(13.2, 0.16, 18.2, matWork, -13.8, 0.03, -4.9, { castShadow: false });
    this.addZoneBorder(-13.8, -4.9, 13.1, 18.1, 0x10b981);
    this.addFloorStamp("WORKFLOOR", -14.2, 3.25, 7.6, 1.3, "rgba(16,185,129,0.52)");

    // --- ZONE 2. APPROVAL & WAITING ROOM (Top-Center: waiting) ---
    const matWaiting = new THREE.MeshStandardMaterial({
      map: makeTechGridFloor("#231c18", "#573f1e", "#f59e0b"),
      roughness: 0.36,
      metalness: 0.35,
    });
    this.addBox(11.6, 0.36, 10.6, matWaiting, -0.4, 0.14, -8.6, { castShadow: false });
    this.addZoneBorder(-0.4, -8.6, 11.5, 10.5, 0xf59e0b, 0.33);
    this.addBox(4.8, 0.18, 0.85, 0x26344d, -0.4, 0.08, -2.9, { castShadow: false });
    this.addNeonStrip(4.8, 0.04, 0.06, 0xf59e0b, -0.4, 0.18, -2.48, 1.5);
    this.addFloorStamp("WAITING FOR YOU", -0.4, -4.4, 7.2, 1.3, "rgba(251,191,36,0.55)");

    // --- ZONE 3. INCIDENT / REPAIR BAY (Top-Right: error) ---
    const matError = new THREE.MeshStandardMaterial({
      map: makeHexTechFloor("#2d0f1b", "#6e1b33", "#f43f5e"),
      roughness: 0.4,
      metalness: 0.35,
    });
    this.addBox(13.8, 0.16, 11.5, matError, 13.5, 0.03, -8.2, { castShadow: false });
    this.addZoneBorder(13.5, -8.2, 13.7, 11.4, 0xf43f5e);
    this.addFloorStamp("REPAIR BAY", 13.5, -3.4, 7.2, 1.3, "rgba(244,63,94,0.52)");

    // --- ZONE 4. COLLABORATION WAR ROOM (Bottom-Left: meeting) ---
    const matWar = new THREE.MeshStandardMaterial({
      map: makeHexTechFloor("#231442", "#4c2889", "#c084fc"),
      roughness: 0.38,
      metalness: 0.35,
    });
    this.addBox(13.2, 0.16, 8.9, matWar, -13.8, 0.03, 9.4, { castShadow: false });
    this.addZoneBorder(-13.8, 9.4, 13.1, 8.8, 0xa855f7);
    this.addFloorStamp("WAR ROOM", -14.2, 13.0, 6.2, 1.3, "rgba(192,132,252,0.52)");

    // --- ZONE 5. CYBER COFFEE LOUNGE (Bottom-Center: idle) ---
    const matWalnut = new THREE.MeshStandardMaterial({
      map: makeArgonWalnutTexture(),
      roughness: 0.46,
      metalness: 0.16,
    });
    this.addBox(13.8, 0.16, 11.6, matWalnut, 0.7, 0.03, 8.1, { castShadow: false });
    this.addZoneBorder(0.7, 8.1, 13.7, 11.5, 0x06b6d4);
    this.addFloorStamp("CYBER LOUNGE", 0.7, 13.0, 7.2, 1.3, "rgba(56,189,248,0.48)");

    // --- ZONE 6. STANDBY DOCK (Bottom-Right: no_report) ---
    const matStandby = new THREE.MeshStandardMaterial({
      map: makeTechGridFloor("#152038", "#29416e", "#38bdf8"),
      roughness: 0.35,
      metalness: 0.45,
    });
    this.addBox(11.8, 0.16, 11.6, matStandby, 14.5, 0.03, 8.1, { castShadow: false });
    this.addZoneBorder(14.5, 8.1, 11.7, 11.5, 0x38bdf8);
    this.addFloorStamp("STANDBY DOCK", 14.5, 13.0, 6.8, 1.3, "rgba(148,163,184,0.45)");

    // --- ZONE 7. OUTDOOR ROOFTOP ARGON SKY-TERRACE (South Balcony off Cyber Lounge) ---
    this.addBox(26.4, 0.16, 4.4, matWalnut, 7.2, 0.02, 16.2, { castShadow: false });
    // Glowing Argon Infinity-Edge Perimeter Light Rail
    this.addNeonStrip(26.4, 0.06, 0.08, 0x06b6d4, 7.2, 0.12, 18.35, 1.65);
    this.addNeonStrip(0.08, 0.06, 4.4, 0xa855f7, -5.95, 0.12, 16.2, 1.55);
    this.addNeonStrip(0.08, 0.06, 4.4, 0xa855f7, 20.35, 0.12, 16.2, 1.55);

    // Sleek Glass Balcony Railing + Glowing Argon Handrail
    this.addGlassWall(26.4, 1.25, 0.1, 7.2, 0.65, 18.3, 0x06b6d4);
    this.addGlassWall(0.1, 1.25, 4.4, -5.95, 0.65, 16.2, 0xa855f7);
    this.addGlassWall(0.1, 1.25, 4.4, 20.35, 0.65, 16.2, 0xa855f7);

    // Illuminated Terrace Cyber-Bonsai Planters
    [-4.2, 4.6, 12.8, 18.4].forEach((tx) => this.buildCyberPlanter(tx, 17.0));

    // Outdoor Terrace Lounge Seating & Holographic Plasma Fire-Table Centerpiece
    [-1.6, 2.0].forEach((cx) => {
      this.addBox(1.3, 0.34, 1.15, 0x263554, cx, 0.25, 16.0, { roughness: 0.45 });
      this.addBox(1.3, 0.58, 0.2, 0x3b4f78, cx, 0.56, 16.48, { roughness: 0.45 });
      this.addNeonStrip(1.15, 0.035, 0.05, 0x06b6d4, cx, 0.12, 15.42, 1.45);
    });
    // Terrace Holographic Fire-Table
    this.addBox(1.4, 0.42, 0.9, 0x1e293b, 0.2, 0.26, 16.1, { metalness: 0.55 });
    this.addNeonStrip(1.1, 0.05, 0.55, 0xf59e0b, 0.2, 0.49, 16.1, 1.9);

    // Overhead Warm Terrace String Lights
    for (let sx = -4.5; sx <= 18.5; sx += 2.3) {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xfde68a })
      );
      bulb.position.set(sx, 2.75 - Math.abs(Math.sin(sx * 0.4)) * 0.22, 17.9);
      this.scene.add(bulb);
    }

    // --- PERIMETER FLOOR-TO-CEILING PANORAMIC GLASS CURTAIN WALLS ---
    const winH = 3.2;
    this.addGlassWall(41.4, winH, 0.18, 0, winH / 2, -14.1, 0x06b6d4);
    this.addGlassWall(0.18, winH, 28.4, -20.5, winH / 2, 0, 0x06b6d4);
    this.addGlassWall(0.18, winH, 28.4, 20.5, winH / 2, 0, 0xa855f7);

    // Architectural Slatted Feature Dividers & Glass Partitions
    const divH = 2.4;
    this.addGlassWall(0.14, divH, 9.6, -7.0, divH / 2, -9.2, 0x10b981);
    this.addSlattedFeatureWall(11.4, divH, 0.28, -14.6, divH / 2, 4.8, 0xa855f7);
    this.addGlassWall(0.14, divH, 9.6, 5.7, divH / 2, -9.2, 0xf59e0b);
    this.addSlattedFeatureWall(11.0, divH, 0.28, 14.8, divH / 2, -2.3, 0xf43f5e);
    this.addGlassWall(0.14, divH, 7.6, -7.0, divH / 2, 10.0, 0xa855f7);
    this.addGlassWall(0.14, divH, 8.2, 8.2, divH / 2, 9.8, 0x06b6d4);

    // Suspended Architectural Argon Pendant Light Bars
    this.addPendantBar(6.0, -14.2, 3.6, -6.2, 0x06b6d4);
    this.addPendantBar(4.2, -0.4, 3.5, -10.5, 0xf59e0b);
    this.addPendantBar(3.6, -14.2, 3.5, 8.9, 0xa855f7);
    this.addPendantBar(4.4, 0.7, 3.6, 8.2, 0x38bdf8);
    this.addPendantBar(4.0, 6.2, 3.5, 6.8, 0xfb923c, Math.PI / 2);

    // --- GIANT TELEMETRY COMMAND JUMBOTRON (Workfloor Back Wall) ---
    this.usageCanvas = document.createElement("canvas");
    this.usageCanvas.width = 512;
    this.usageCanvas.height = 170;
    this.usageTex = new THREE.CanvasTexture(this.usageCanvas);
    this.addBox(6.3, 2.05, 0.16, 0x0b1326, -14.2, 2.0, -13.85, { roughness: 0.25, metalness: 0.6 });
    this.addNeonStrip(6.4, 0.055, 0.055, 0x06b6d4, -14.2, 3.04, -13.8, 1.75);
    const screenMat = new THREE.MeshStandardMaterial({
      map: this.usageTex,
      emissive: 0x38bdf8,
      emissiveMap: this.usageTex,
      emissiveIntensity: 1.1,
      roughness: 0.18,
    });
    const screenMesh = new THREE.Mesh(new THREE.BoxGeometry(5.95, 1.78, 0.1), screenMat);
    screenMesh.position.set(-14.2, 2.0, -13.75);
    this.scene.add(screenMesh);
    this.updateWallScreen(100, 0);

    // Neon Room Header Signs
    this.addNeonSign("APPROVAL DESK", "WAITING FOR HUMAN", "#f59e0b", -0.4, 2.1, -13.8, 0);
    this.addNeonSign("REPAIR BAY", "DIAGNOSTICS & ERRORS", "#f43f5e", 13.6, 2.1, -13.8, 0);
    this.addNeonSign("STANDBY DOCK", "IDLE > 24H // SLEEP", "#06b6d4", 20.1, 2.0, 8.2, -Math.PI / 2);

    // --- ROOM 1: CYBER WORKFLOOR (8 Curved Dual-Monitor Command Desks) ---
    const deskScreenTex = makeCyberScreenTexture("#06b6d4", "GROK // ACTIVE");
    this.codeScreenMat = new THREE.MeshStandardMaterial({
      map: deskScreenTex,
      emissive: 0x06b6d4,
      emissiveMap: deskScreenTex,
      emissiveIntensity: 1.05,
      roughness: 0.18,
    });
    WORKFLOOR_DESKS.forEach((d, idx) => this.buildCyberDesk(d.x, d.z, idx));

    // Glowing Data Packets arcing from active Workfloor desks to the Command Jumbotron
    WORKFLOOR_DESKS.slice(0, 6).forEach((d, idx) => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 10),
        new THREE.MeshBasicMaterial({ color: idx % 2 === 0 ? 0x06b6d4 : 0xa855f7 })
      );
      this.scene.add(orb);
      this.dataPackets.push({
        mesh: orb,
        start: new THREE.Vector3(d.x, 1.5, d.z - 0.3),
        end: new THREE.Vector3(-14.2 + (idx - 2.5) * 0.7, 2.0, -13.6),
        t: idx / 6,
        speed: 0.0055 + (idx % 3) * 0.0015,
      });
    });

    // --- ROOM 2: APPROVAL & WAITING ROOM ---
    // Rich Brushed Indigo-Slate Review Counter + Glowing Amber Halo Strip + Plush Bench
    this.addBox(5.4, 1.05, 1.12, 0x1e293b, -0.4, 0.84, -10.8, { roughness: 0.32, metalness: 0.55 });
    this.addBox(5.65, 0.11, 1.3, 0x334155, -0.4, 1.4, -10.8, { roughness: 0.22, metalness: 0.45 });
    this.addNeonStrip(5.2, 0.075, 0.06, 0xf59e0b, -0.4, 1.06, -10.22, 1.85);
    this.addNeonStrip(5.2, 0.045, 0.06, 0xf59e0b, -0.4, 0.38, -10.22, 1.45);

    // Live-Synced Holographic Check-in Screen on Approval Desk
    const waitTex = makeCyberScreenTexture("#f59e0b", "APPROVAL QUEUE");
    this.waitScreenMat = new THREE.MeshStandardMaterial({
      map: waitTex,
      emissive: 0xf59e0b,
      emissiveMap: waitTex,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.9,
    });
    this.waitScreenMesh = this.addBox(2.3, 0.88, 0.06, this.waitScreenMat, -0.4, 1.92, -10.7, {
      castShadow: false,
    });
    // Sleek waiting bench with high-contrast upholstery
    this.addBox(3.8, 0.44, 0.9, 0x293752, -0.4, 0.54, -5.2, { roughness: 0.45 });
    this.addNeonStrip(3.6, 0.045, 0.045, 0xf59e0b, -0.4, 0.34, -4.74, 1.55);

    // --- ROOM 3: INCIDENT / REPAIR BAY (Tall Glowing Mainframe Towers) ---
    [18.8, 18.8, 18.8].forEach((sx, idx) => {
      const sz = -11.4 + idx * 2.5;
      this.addBox(1.18, 2.58, 1.78, 0x162036, sx, 1.32, sz, { roughness: 0.28, metalness: 0.65 });
      this.addNeonStrip(0.06, 2.42, 0.06, 0xf43f5e, sx - 0.6, 1.32, sz - 0.84, 1.65);
      this.addNeonStrip(0.06, 2.42, 0.06, 0x06b6d4, sx - 0.6, 1.32, sz + 0.84, 1.35);
      for (let r = 0; r < 6; r++) {
        this.addBox(0.06, 0.22, 1.38, 0x263554, sx - 0.59, 0.46 + r * 0.34, sz, { castShadow: false });
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.07, 0.14),
          new THREE.MeshBasicMaterial({ color: r % 2 === 0 ? 0xf43f5e : 0x06b6d4 })
        );
        led.position.set(sx - 0.63, 0.46 + r * 0.34, sz - 0.42 + (r % 3) * 0.25);
        this.scene.add(led);
        this.serverLeds.push(led);
      }
    });
    // Live-Synced Diagnostic Console
    this.addBox(3.45, 0.94, 1.24, 0x1e293b, 11.8, 0.5, -11.4, { metalness: 0.55, roughness: 0.32 });
    this.addNeonStrip(3.3, 0.045, 0.05, 0xf43f5e, 11.8, 0.94, -10.77, 1.6);
    const errTex = makeCyberScreenTexture("#f43f5e", "DIAGNOSTICS");
    this.errScreenMat = new THREE.MeshStandardMaterial({
      map: errTex,
      emissive: 0xf43f5e,
      emissiveMap: errTex,
      emissiveIntensity: 1.05,
    });
    this.errScreenMesh = this.addBox(1.95, 0.84, 0.08, this.errScreenMat, 11.8, 1.44, -11.65);

    // --- ROOM 4: WAR ROOM (Illuminated Glass Table + Rotating 3D Argon Holographic Globe) ---
    const confBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.25, 2.25, 0.12, 36),
      new THREE.MeshStandardMaterial({
        color: 0x293a5c,
        roughness: 0.16,
        metalness: 0.65,
        transparent: true,
        opacity: 0.88,
      })
    );
    confBase.position.set(-14.2, 0.92, 8.9);
    confBase.castShadow = true;
    confBase.receiveShadow = true;
    this.scene.add(confBase);

    // Glowing Argon table rim ring
    const tableRim = new THREE.Mesh(
      new THREE.TorusGeometry(2.25, 0.035, 10, 48),
      new THREE.MeshBasicMaterial({ color: 0xa855f7 })
    );
    tableRim.rotation.x = Math.PI / 2;
    tableRim.position.set(-14.2, 0.94, 8.9);
    this.scene.add(tableRim);

    this.addBox(0.7, 0.86, 0.7, 0x1e293b, -14.2, 0.45, 8.9, { metalness: 0.65 });

    // Multi-ring Rotating 3D Argon Holographic Globe above War Room table
    this.holoGroup = new THREE.Group();
    this.holoGroup.position.set(-14.2, 1.75, 8.9);
    const globe = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.56, 1),
      new THREE.MeshBasicMaterial({ color: 0xc084fc, wireframe: true, transparent: true, opacity: 0.9 })
    );
    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(0.94, 0.03, 10, 36),
      new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.9 })
    );
    ring1.rotation.x = Math.PI / 2.2;
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.14, 0.024, 10, 36),
      new THREE.MeshBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.78 })
    );
    ring2.rotation.x = Math.PI / 3;
    ring2.rotation.y = Math.PI / 4;
    this.holoGroup.add(globe, ring1, ring2);
    this.scene.add(this.holoGroup);

    WAR_ROOM_SPOTS.slice(0, 4).forEach((s) => this.buildCyberChair(s.x, s.z, 0x8b5cf6));

    // --- ROOM 5: CYBER COFFEE LOUNGE & RETRO ARCADE (High-Contrast Argon Indigo Upholstery) ---
    this.buildCyberLoungeCluster(-1.8, 6.2, 0x221a3a, 0x283655, 0x06b6d4);
    this.buildCyberLoungeCluster(-1.8, 10.6, 0x2e1a36, 0x31284f, 0xe879f9);

    // Cyber Espresso Bar + Brushed Titanium Top + Glowing Under-Counter Strips + Rising Steam
    this.addBox(1.32, 1.05, 4.95, 0x1e293b, 6.2, 0.56, 6.8, { roughness: 0.35, metalness: 0.5 });
    this.addBox(1.48, 0.1, 5.1, 0x475569, 6.2, 1.1, 6.8, { roughness: 0.2, metalness: 0.45 });
    this.addNeonStrip(0.06, 0.06, 4.85, 0xfb923c, 5.52, 0.98, 6.8, 1.7);
    this.addNeonStrip(0.06, 0.05, 4.85, 0x06b6d4, 5.52, 0.22, 6.8, 1.5);

    // Chrome Espresso Machine
    this.addBox(0.7, 0.66, 0.96, 0x334155, 6.2, 1.45, 5.4, { metalness: 0.78, roughness: 0.2 });
    this.addNeonStrip(0.08, 0.14, 0.44, 0x06b6d4, 5.84, 1.56, 5.4, 1.65);

    // Animated Rising Espresso Steam Puffs
    for (let i = 0; i < 8; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.38 })
      );
      puff.position.set(6.15 + (i % 3) * 0.08, 1.8 + i * 0.16, 5.4 + ((i % 2) - 0.5) * 0.12);
      this.scene.add(puff);
      this.steamPuffs.push({ mesh: puff, offset: i * 0.45 });
    }

    // Modern Argon Bar Stools
    [5.2, 6.6, 8.0].forEach((sz) => {
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.33, 0.29, 0.11, 18),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.38, metalness: 0.2 })
      );
      seat.position.set(4.85, 0.75, sz);
      seat.castShadow = true;
      this.scene.add(seat);
      this.addBox(0.09, 0.7, 0.09, 0x94a3b8, 4.85, 0.36, sz, { metalness: 0.75 });
    });

    // Glowing Cyber-Arcade Cabinet in Lounge Corner
    this.addBox(1.12, 2.04, 0.98, 0x1e1640, 6.4, 1.04, 11.6, { roughness: 0.32, metalness: 0.38 });
    const arcadeTex = makeCyberScreenTexture("#ec4899", "ARGON ARCADE");
    const arcadeScreenMat = new THREE.MeshStandardMaterial({
      map: arcadeTex,
      emissive: 0xec4899,
      emissiveMap: arcadeTex,
      emissiveIntensity: 1.15,
    });
    this.addBox(0.08, 0.74, 0.78, arcadeScreenMat, 5.83, 1.46, 11.6, { castShadow: false });
    this.addNeonStrip(0.06, 0.08, 0.88, 0x06b6d4, 5.82, 2.0, 11.6, 1.8);
    this.addNeonStrip(0.06, 1.95, 0.06, 0xec4899, 5.84, 1.04, 11.14, 1.45);
    this.addNeonStrip(0.06, 1.95, 0.06, 0xec4899, 5.84, 1.04, 12.06, 1.45);

    // --- ROOM 6: STANDBY DOCK (Glowing Inductive Stasis Charging Pads) ---
    STANDBY_PADS.forEach((pad) => {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.06, 1.2, 0.15, 28),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.65 })
      );
      base.position.set(pad.x, 0.12, pad.z);
      base.receiveShadow = true;
      this.scene.add(base);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.76, 0.94, 28),
        new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pad.x, 0.21, pad.z);
      this.scene.add(ring);
      this.standbyRings.push(ring);
    });

    // Illuminated Cyber-Planter Trees Inside Penthouse
    [
      [-5.6, -12.6],
      [4.6, -12.6],
      [-5.6, 3.2],
      [7.1, 3.2],
      [-19.4, 5.8],
      [-8.2, 12.6],
    ].forEach(([px, pz]) => this.buildCyberPlanter(px, pz));
  }

  buildCyberDesk(x, z, idx) {
    // Sleek Titanium-Slate Desk + Glowing Argon Edge & Under-Desk Bounce Strip
    this.addBox(2.92, 0.1, 1.36, 0x1e293b, x, 0.92, z, { roughness: 0.28, metalness: 0.52 });
    const stripCol = idx % 2 === 0 ? 0x06b6d4 : 0x10b981;
    this.addNeonStrip(2.85, 0.04, 0.045, stripCol, x, 0.93, z + 0.68, 1.55);
    this.addNeonStrip(2.7, 0.03, 0.04, 0x8b5cf6, x, 0.14, z, 1.25);
    this.addBox(0.12, 0.88, 1.16, 0x334155, x - 1.3, 0.45, z, { metalness: 0.65 });
    this.addBox(0.12, 0.88, 1.16, 0x334155, x + 1.3, 0.45, z, { metalness: 0.65 });

    // Dual Curved Glowing Monitors
    [-0.6, 0.6].forEach((ox, mIdx) => {
      const rot = mIdx === 0 ? 0.2 : -0.2;
      this.addBox(1.08, 0.64, 0.06, 0x0f172a, x + ox, 1.42, z - 0.34, { rotY: rot });
      this.addBox(1.0, 0.56, 0.04, this.codeScreenMat, x + ox, 1.42, z - 0.3, {
        rotY: rot,
        castShadow: false,
      });
      this.addBox(0.09, 0.28, 0.09, 0x475569, x + ox, 1.07, z - 0.36);
    });

    // Glowing RGB Keyboard
    this.addBox(0.88, 0.03, 0.28, 0x0f172a, x - 0.08, 0.985, z + 0.14, { castShadow: false });
    this.addNeonStrip(0.84, 0.018, 0.045, 0x06b6d4, x - 0.08, 1.0, z + 0.27, 1.35);

    this.buildCyberChair(x, z + 0.94, 0x293a5c);
  }

  buildCyberChair(x, z, accent = 0x293a5c) {
    this.addBox(0.64, 0.06, 0.08, 0x64748b, x, 0.06, z, { castShadow: false, metalness: 0.75 });
    this.addBox(0.08, 0.06, 0.64, 0x64748b, x, 0.06, z, { castShadow: false, metalness: 0.75 });
    this.addBox(0.1, 0.34, 0.1, 0x94a3b8, x, 0.23, z, { castShadow: false, metalness: 0.75 });
    this.addBox(0.72, 0.12, 0.68, 0x1e293b, x, 0.44, z, { roughness: 0.4 });
    this.addBox(0.66, 0.78, 0.12, accent, x, 0.85, z + 0.3, { roughness: 0.38 });
    [-0.36, 0.36].forEach((ax) => {
      this.addBox(0.08, 0.24, 0.48, 0x475569, x + ax, 0.62, z + 0.04, { castShadow: false });
    });
  }

  buildCyberLoungeCluster(x, z, rugHex, sofaHex, neonHex) {
    this.addBox(5.8, 0.045, 3.65, rugHex, x, 0.12, z, { castShadow: false, roughness: 0.82 });
    this.addNeonStrip(5.8, 0.03, 0.055, neonHex, x, 0.135, z + 1.82, 1.3);
    this.addNeonStrip(5.8, 0.03, 0.055, neonHex, x, 0.135, z - 1.82, 1.3);

    // High-contrast Argon sofa with wrap-around neon piping & under-glow
    this.addBox(3.55, 0.44, 1.18, sofaHex, x, 0.35, z - 1.05, { roughness: 0.48, metalness: 0.18 });
    this.addNeonStrip(3.35, 0.045, 0.055, neonHex, x, 0.16, z - 0.46, 1.45);
    this.addBox(3.55, 0.64, 0.3, sofaHex, x, 0.75, z - 1.52, { roughness: 0.48, metalness: 0.18 });
    this.addNeonStrip(3.52, 0.035, 0.045, neonHex, x, 1.08, z - 1.52, 1.35);

    [-1.68, 1.68].forEach((ax) => {
      this.addBox(0.26, 0.58, 1.18, sofaHex, x + ax, 0.58, z - 1.05, { roughness: 0.48 });
    });
    // Vibrant Accent Cushions
    [-1.08, 1.08].forEach((px) => {
      this.addBox(0.44, 0.38, 0.18, neonHex, x + px, 0.72, z - 1.24, {
        rotY: px < 0 ? 0.2 : -0.2,
        emissive: neonHex,
        emissiveIntensity: 0.35,
      });
    });
    // Illuminated Glass-Top Argon Coffee Table
    this.addBox(2.05, 0.08, 1.04, 0x38bdf8, x, 0.48, z + 0.28, {
      transparent: true,
      opacity: 0.5,
      roughness: 0.12,
      metalness: 0.3,
    });
    this.addNeonStrip(1.95, 0.03, 0.94, neonHex, x, 0.44, z + 0.28, 1.25);
    [
      [-0.82, -0.1],
      [0.82, -0.1],
      [-0.82, 0.66],
      [0.82, 0.66],
    ].forEach(([ox, oz]) => {
      this.addBox(0.08, 0.42, 0.08, 0x64748b, x + ox, 0.22, z + oz, { metalness: 0.75 });
    });
  }

  buildCyberPlanter(x, z) {
    this.addBox(0.9, 0.68, 0.9, 0x1e293b, x, 0.36, z, { roughness: 0.32, metalness: 0.52 });
    this.addNeonStrip(0.94, 0.045, 0.94, 0x06b6d4, x, 0.67, z, 1.35);
    this.addBox(0.11, 0.76, 0.11, 0x5c3a28, x, 0.86, z, { castShadow: false });
    [
      [0, 1.42, 0, 0.56, 0x10b981],
      [-0.32, 1.16, 0.22, 0.42, 0x059669],
      [0.32, 1.2, -0.18, 0.44, 0x34d399],
    ].forEach(([ox, oy, oz, rad, col]) => {
      const leaf = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rad, 1),
        new THREE.MeshStandardMaterial({
          color: col,
          roughness: 0.52,
          emissive: 0x064e3b,
          emissiveIntensity: 0.25,
        })
      );
      leaf.position.set(x + ox, oy, z + oz);
      leaf.castShadow = true;
      this.scene.add(leaf);
    });
  }

  buildOfficeCat() {
    const cat = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.65 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 });

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

    // Glowing Argon cyan cyber-collar
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.03, 8, 18),
      new THREE.MeshBasicMaterial({ color: 0x06b6d4 })
    );
    collar.position.set(0, 0.34, 0.24);
    collar.rotation.x = Math.PI / 2.6;
    cat.add(collar);

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

  /* ---------- 3. Live Telemetry Sync Into the 3D World ---------- */
  updateWallScreen(remainingPct, activeCount, waitingCount = 0, errorCount = 0) {
    const c = this.usageCanvas;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#040817";
    ctx.fillRect(0, 0, c.width, c.height);

    // Subtle Argon header bar
    ctx.fillStyle = "rgba(6, 182, 212, 0.16)";
    ctx.fillRect(0, 0, c.width, 44);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "800 17px Inter, sans-serif";
    ctx.fillText("ARGON COMMAND HQ // LIVE FLEET TELEMETRY", 24, 28);

    ctx.fillStyle = remainingPct > 25 ? "#38bdf8" : "#fb7185";
    ctx.font = "800 54px Inter, sans-serif";
    ctx.fillText(`${remainingPct}%`, 24, 102);

    ctx.fillStyle = "#10b981";
    ctx.font = "800 22px Inter, sans-serif";
    ctx.fillText(`${activeCount} ACTIVE`, 235, 80);

    ctx.fillStyle = waitingCount > 0 ? "#fbbf24" : "#64748b";
    ctx.font = "700 17px Inter, sans-serif";
    ctx.fillText(`${waitingCount} WAITING`, 235, 106);

    ctx.fillStyle = errorCount > 0 ? "#f43f5e" : "#64748b";
    ctx.fillText(`${errorCount} ALERTS`, 368, 106);

    ctx.fillStyle = "#16233d";
    ctx.fillRect(24, 128, 464, 20);
    const grad = ctx.createLinearGradient(24, 0, 488, 0);
    if (remainingPct > 25) {
      grad.addColorStop(0, "#06b6d4");
      grad.addColorStop(1, "#a855f7");
    } else {
      grad.addColorStop(0, "#f43f5e");
      grad.addColorStop(1, "#f59e0b");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(24, 128, Math.max(10, (464 * remainingPct) / 100), 20);
    this.usageTex.needsUpdate = true;
  }

  /* ---------- Unified Iconic 3D Grok Bot Character System ---------- */
  buildGrokBodyMesh(mat, botId) {
    const bodyGroup = new THREE.Group();
    const hitMeshes = [];

    const s = new THREE.Shape();
    const r = 0.34;
    const w = 0.56;
    const h = 0.62;
    s.moveTo(-w + r, -h);
    s.lineTo(w - r, -h);
    s.quadraticCurveTo(w, -h, w, -h + r);
    s.lineTo(w, h - r);
    s.quadraticCurveTo(w, h, w - r, h);
    s.lineTo(-w + r, h);
    s.quadraticCurveTo(-w, h, -w, h - r);
    s.lineTo(-w, -h + r);
    s.quadraticCurveTo(-w, -h, -w + r, -h);

    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.44,
      bevelEnabled: true,
      bevelThickness: 0.22,
      bevelSize: 0.16,
      bevelSegments: 10,
      curveSegments: 16,
    });
    geo.center();

    const body = new THREE.Mesh(geo, mat);
    body.position.set(0, 0.86, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.botId = botId;
    bodyGroup.add(body);
    hitMeshes.push(body);

    return { bodyGroup, hitMeshes, eyeY: 0.94, eyeZ: 0.44, eyeSpread: 0.23 };
  }

  createBotAvatar(bot) {
    const group = new THREE.Group();
    group.userData.botId = bot.id;

    const baseHex = bot.avatarColor || "#3b93f0";
    const primaryColor = new THREE.Color(baseHex);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.28,
      metalness: 0.12,
      emissive: primaryColor,
      emissiveIntensity: 0.12,
    });

    const rig = new THREE.Group();
    group.add(rig);

    const { bodyGroup, hitMeshes, eyeY, eyeZ, eyeSpread } = this.buildGrokBodyMesh(bodyMat, bot.id);
    rig.add(bodyGroup);

    // Big Iconic Expressive Grok Bot Eyes
    const faceGroup = new THREE.Group();
    faceGroup.position.set(0, eyeY, eyeZ);
    rig.add(faceGroup);

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0.02 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x090a0f, roughness: 0.1, metalness: 0.15 });
    const catchMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lidMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.3 });

    const makeEye = (side) => {
      const eyeWrap = new THREE.Group();
      eyeWrap.position.set(side * eyeSpread, 0, 0);

      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 16), whiteMat);
      sclera.scale.set(0.92, 1.18, 0.45);
      eyeWrap.add(sclera);

      const pupilGroup = new THREE.Group();
      pupilGroup.position.set(0, 0, 0.068);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), pupilMat);
      pupil.scale.set(0.94, 1.1, 0.45);
      const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), catchMat);
      sparkle.position.set(0.034, 0.042, 0.036);
      pupilGroup.add(pupil, sparkle);
      eyeWrap.add(pupilGroup);

      const upperLid = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.16), lidMat);
      upperLid.position.set(0, 0.22, 0.04);
      upperLid.visible = false;
      eyeWrap.add(upperLid);

      const lowerLid = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.16), lidMat);
      lowerLid.position.set(0, -0.2, 0.04);
      lowerLid.visible = false;
      eyeWrap.add(lowerLid);

      return { eyeWrap, pupilGroup, upperLid, lowerLid };
    };

    const leftEye = makeEye(-1);
    const rightEye = makeEye(1);
    faceGroup.add(leftEye.eyeWrap, rightEye.eyeWrap);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.7, 28),
      new THREE.MeshBasicMaterial({
        color: STATUS_HEX[bot.status] || "#10b981",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.14;
    group.add(halo);

    const orbitRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.028, 8, 32),
      new THREE.MeshBasicMaterial({
        color: primaryColor,
        transparent: true,
        opacity: 0.78,
      })
    );
    orbitRing.position.y = 0.88;
    orbitRing.rotation.x = Math.PI / 2.6;
    orbitRing.visible = bot.status === "working";
    group.add(orbitRing);

    const thinkGroup = new THREE.Group();
    thinkGroup.position.set(0, 1.9, 0);
    const thinkDots = [-0.22, 0, 0.22].map((dx) => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.068, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xf8fafc })
      );
      dot.position.x = dx;
      thinkGroup.add(dot);
      return dot;
    });
    thinkGroup.visible = bot.status === "working" || bot.status === "meeting";
    group.add(thinkGroup);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.6,
        roughness: 0.2,
      })
    );
    beacon.position.set(0.46, 1.82, 0.18);
    beacon.visible = bot.status === "waiting" || bot.status === "error";
    group.add(beacon);

    this.scene.add(group);

    // Synced Argon Name + Role Floating Name Tag
    const labelEl = document.createElement("div");
    labelEl.className = "bot-3d-label";
    labelEl.innerHTML =
      `<div class="lbl-top"><span class="lbl-dot"></span><span class="lbl-name"></span></div>` +
      `<div class="lbl-role"></div>`;
    labelEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectBot(bot.id);
    });
    this.labelLayer.appendChild(labelEl);
    this.labelEls.set(bot.id, labelEl);

    return {
      group,
      rig,
      leftEye,
      rightEye,
      hitMeshes,
      halo,
      orbitRing,
      thinkGroup,
      thinkDots,
      beacon,
      waypoints: [],
      targetRotY: 0,
      zone: bot.status,
      nextRoamAt: performance.now() + 5000 + Math.random() * 6000,
      nextBlinkAt: performance.now() + 1400 + Math.random() * 3800,
      lookOffsetX: 0,
      lookOffsetY: 0,
      nextLookAt: performance.now() + 1500 + Math.random() * 2500,
    };
  }

  getRoomSpotForBot(bot, stateIndex) {
    if (bot.status === "waiting") {
      const spot = WAITING_SPOTS[stateIndex % WAITING_SPOTS.length];
      return { pos: new THREE.Vector3(spot.x, 0.28, spot.z), rotY: 0 };
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
    const desk = WORKFLOOR_DESKS[stateIndex % WORKFLOOR_DESKS.length];
    return { pos: new THREE.Vector3(desk.x, 0.04, desk.z + 0.94), rotY: Math.PI * 0.82 };
  }

  buildHallwayPath(fromPos, toPos, fromZone, toZone) {
    if (fromZone === toZone) {
      return [toPos.clone()];
    }
    return [
      new THREE.Vector3(fromPos.x, 0.04, 0.2),
      new THREE.Vector3(toPos.x, 0.04, 0.2),
      toPos.clone(),
    ];
  }

  updateBots(bots, usageSummary) {
    this.bots = bots;
    const slotCounters = { working: 0, waiting: 0, error: 0, meeting: 0, idle: 0, no_report: 0 };
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

      const hex = STATUS_HEX[bot.status] || "#10b981";
      entry.halo.material.color.set(hex);
      entry.orbitRing.visible = bot.status === "working";
      entry.thinkGroup.visible = bot.status === "working" || bot.status === "meeting";

      entry.beacon.visible = bot.status === "waiting" || bot.status === "error";
      if (entry.beacon.visible) {
        const bCol = bot.status === "error" ? "#f43f5e" : "#f59e0b";
        entry.beacon.material.color.set(bCol);
        entry.beacon.material.emissive.set(bCol);
      }

      const setExpression = (lTop, rTop, lBot, rBot, lRot = 0, rRot = 0) => {
        entry.leftEye.upperLid.visible = lTop !== null;
        entry.rightEye.upperLid.visible = rTop !== null;
        entry.leftEye.lowerLid.visible = lBot !== null;
        entry.rightEye.lowerLid.visible = rBot !== null;
        if (lTop !== null) {
          entry.leftEye.upperLid.position.y = lTop;
          entry.leftEye.upperLid.rotation.z = lRot;
        }
        if (rTop !== null) {
          entry.rightEye.upperLid.position.y = rTop;
          entry.rightEye.upperLid.rotation.z = rRot;
        }
        if (lBot !== null) entry.leftEye.lowerLid.position.y = lBot;
        if (rBot !== null) entry.rightEye.lowerLid.position.y = rBot;
      };

      if (bot.status === "error") setExpression(0.14, 0.14, null, null, -0.35, 0.35);
      else if (bot.status === "waiting") setExpression(null, null, null, null);
      else if (bot.status === "meeting") setExpression(null, null, -0.15, -0.15);
      else if (bot.status === "idle") setExpression(0.18, 0.18, -0.17, -0.17);
      else if (bot.status === "no_report") setExpression(0.06, 0.06, -0.09, -0.09);
      else setExpression(0.21, 0.21, null, null, -0.06, 0.06);

      const labelEl = this.labelEls.get(bot.id);
      if (labelEl) {
        labelEl.querySelector(".lbl-name").textContent = bot.name;
        const roleEl = labelEl.querySelector(".lbl-role");
        if (roleEl) roleEl.textContent = bot.role || "Grok Bot";
        const dot = labelEl.querySelector(".lbl-dot");
        dot.style.background = bot.status === "no_report" ? "transparent" : hex;
        dot.style.border = bot.status === "no_report" ? `1.5px solid ${hex}` : "none";
        dot.style.boxShadow = bot.status === "no_report" ? "none" : `0 0 8px ${hex}`;
        labelEl.dataset.status = bot.status;
        labelEl.classList.toggle("selected", this.selectedBotId === bot.id);
        labelEl.classList.toggle("urgent", bot.status === "waiting" || bot.status === "error");
      }
    });

    this.roomCounts = slotCounters;
    const activeCount = (slotCounters.working || 0) + (slotCounters.meeting || 0);
    this.updateWallScreen(
      usageSummary?.usageRemainingPct ?? 100,
      activeCount,
      slotCounters.waiting || 0,
      slotCounters.error || 0
    );

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
    const p = LIGHTING_PRESETS[resolved] || LIGHTING_PRESETS.night;
    this.scene.fog.color.setHex(p.fog);
    if (this.skyMat.map) this.skyMat.map.dispose();
    this.skyMat.map = makeSkyGradientTexture(p.skyTop, p.skyMid, p.skyHorizon);
    this.skyMat.needsUpdate = true;
    this.starsMat.opacity = p.starsOpacity;
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
    this.bloomPass.strength = p.bloomStrength;
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
    this.composer.setSize(w, h);
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
          `<div class="tt-role">${esc(bot.role || "Grok Bot")}</div>` +
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

    if (this.camLerpTarget) {
      this.camera.position.lerp(this.camLerpTarget.pos, 0.08);
      this.controls.target.lerp(this.camLerpTarget.target, 0.08);
      this.camLerpTarget.frames--;
      if (this.camLerpTarget.frames <= 0) this.camLerpTarget = null;
    }

    // Live-Synced War Room 3D Hologram Globe (spins faster when bots are meeting)
    if (this.holoGroup) {
      const meetingBoost = (this.roomCounts.meeting || 0) > 0 ? 1.65 : 0.7;
      this.holoGroup.rotation.y = elapsed * meetingBoost;
      this.holoGroup.position.y = 1.72 + Math.sin(elapsed * 2.4) * 0.09;
    }

    // Live-Synced Approval Desk & Repair Bay Holographic Screen Pulse
    if (this.waitScreenMat) {
      const hasWait = (this.roomCounts.waiting || 0) > 0;
      this.waitScreenMat.emissiveIntensity = hasWait
        ? 1.15 + Math.sin(elapsed * 5.0) * 0.45
        : 0.75;
    }
    if (this.errScreenMat) {
      const hasErr = (this.roomCounts.error || 0) > 0;
      this.errScreenMat.emissiveIntensity = hasErr
        ? 1.25 + Math.sin(elapsed * 7.5) * 0.55
        : 0.8;
    }

    // Blinking Repair Bay Mainframe LEDs & Skyscraper Beacons
    this.serverLeds.forEach((led, i) => {
      led.visible = Math.sin(elapsed * 5 + i * 1.6) > -0.3;
    });
    this.skyBeacons.forEach((b, i) => {
      b.visible = Math.sin(elapsed * 2.4 + i) > 0;
    });
    this.standbyRings.forEach((r, i) => {
      r.material.opacity = 0.35 + (Math.sin(elapsed * 2.2 + i) + 1) * 0.22;
    });

    // Distant Flying Traffic Streaks
    this.skyTraffic.forEach((t) => {
      t.mesh.position.x += t.speed;
      if (t.mesh.position.x > 75) t.mesh.position.x = -75;
      if (t.mesh.position.x < -75) t.mesh.position.x = 75;
    });

    // Rising Coffee Espresso Steam
    this.steamPuffs.forEach((s) => {
      const cycle = ((elapsed * 0.65 + s.offset) % 1.8) / 1.8;
      s.mesh.position.y = 1.75 + cycle * 1.4;
      s.mesh.scale.setScalar(0.6 + cycle * 0.9);
      s.mesh.material.opacity = (1 - cycle) * 0.38;
    });

    // Live-Synced Data Packets arcing from Workfloor desks to Telemetry Jumbotron
    const workCount = this.roomCounts.working || 0;
    const speedMult = 1 + Math.min(workCount, 6) * 0.18;
    this.dataPackets.forEach((p, idx) => {
      p.mesh.visible = workCount > 0 && idx < Math.max(2, workCount + 1);
      if (!p.mesh.visible) return;
      p.t = (p.t + p.speed * speedMult) % 1;
      p.mesh.position.lerpVectors(p.start, p.end, p.t);
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 2.15;
    });

    // Wandering Office Cat ("Zelda")
    if (this.cat) {
      if (now > this.cat.nextMoveAt) {
        const spots = [
          [0.5, 0.4],
          [3.2, 5.2],
          [-2.6, 3.8],
          [1.6, 8.2],
          [0.8, 15.2],
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

    // Playful Squash-and-Stretch Grok Bot Animations
    this.bots.forEach((bot, idx) => {
      const entry = this.botMeshes.get(bot.id);
      if (!entry) return;

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
          const step = Math.min(dist, 0.115);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          pos.y += (wp.y - pos.y) * 0.12;
          entry.group.rotation.y = Math.atan2(dx, dz);

          const hop = Math.abs(Math.sin(elapsed * 9.5 + idx));
          entry.rig.position.y = hop * 0.42;
          entry.rig.scale.set(1.08 - hop * 0.14, 0.88 + hop * 0.22, 1.08 - hop * 0.14);
          entry.rig.rotation.z = Math.sin(elapsed * 9.5 + idx) * 0.08;
        }
      } else {
        entry.group.rotation.y += (entry.targetRotY - entry.group.rotation.y) * 0.08;

        if (bot.status === "working") {
          const breath = Math.sin(elapsed * 3.8 + idx);
          entry.rig.position.y = 0.06 + breath * 0.06;
          entry.rig.scale.set(1 - breath * 0.03, 1 + breath * 0.04, 1 - breath * 0.03);
          entry.rig.rotation.set(0, 0, Math.sin(elapsed * 2 + idx) * 0.04);
          entry.orbitRing.rotation.z = elapsed * 1.9 + idx;
          entry.orbitRing.rotation.y = elapsed * 0.8;
        } else if (bot.status === "waiting") {
          const bounce = Math.abs(Math.sin(elapsed * 5.2 + idx));
          entry.rig.position.y = bounce * 0.28;
          entry.rig.scale.set(1.06 - bounce * 0.1, 0.92 + bounce * 0.14, 1.06 - bounce * 0.1);
          entry.rig.rotation.set(0, 0, 0);
        } else if (bot.status === "error") {
          entry.rig.position.y = 0.04;
          entry.rig.scale.set(1.04, 0.96, 1.04);
          entry.rig.rotation.set(0, 0, Math.sin(elapsed * 18) * 0.12);
        } else if (bot.status === "meeting") {
          const bob = Math.sin(elapsed * 4.6 + idx);
          entry.rig.position.y = Math.max(0, bob) * 0.16;
          entry.rig.scale.set(1.03 - Math.max(0, bob) * 0.05, 0.97 + Math.max(0, bob) * 0.07, 1.03);
          entry.rig.rotation.set(0, 0, bob * 0.07);
        } else if (bot.status === "no_report") {
          const snore = Math.sin(elapsed * 1.3 + idx);
          entry.rig.position.y = 0;
          entry.rig.scale.set(1.06 + snore * 0.02, 0.88 - snore * 0.02, 1.06);
          entry.rig.rotation.set(0.14, 0, 0.08);
        } else {
          const chill = Math.sin(elapsed * 2.2 + idx);
          entry.rig.position.y = 0.08 + chill * 0.07;
          entry.rig.scale.set(1, 1 + chill * 0.025, 1);
          entry.rig.rotation.set(0, 0, chill * 0.05);
        }
      }

      if (bot.status !== "no_report") {
        if (now > entry.nextLookAt) {
          entry.lookOffsetX = (Math.random() - 0.5) * 0.07;
          entry.lookOffsetY = (Math.random() - 0.5) * 0.05;
          entry.nextLookAt = now + 1800 + Math.random() * 2800;
        }
        entry.leftEye.pupilGroup.position.x += (entry.lookOffsetX - entry.leftEye.pupilGroup.position.x) * 0.12;
        entry.rightEye.pupilGroup.position.x += (entry.lookOffsetX - entry.rightEye.pupilGroup.position.x) * 0.12;
        entry.leftEye.pupilGroup.position.y += (entry.lookOffsetY - entry.leftEye.pupilGroup.position.y) * 0.12;
        entry.rightEye.pupilGroup.position.y += (entry.lookOffsetY - entry.rightEye.pupilGroup.position.y) * 0.12;

        if (now > entry.nextBlinkAt) {
          entry.leftEye.eyeWrap.scale.y = 0.12;
          entry.rightEye.eyeWrap.scale.y = 0.12;
          if (now > entry.nextBlinkAt + 120) {
            entry.leftEye.eyeWrap.scale.y = 1;
            entry.rightEye.eyeWrap.scale.y = 1;
            entry.nextBlinkAt = now + 2400 + Math.random() * 4000;
          }
        }
      }

      if (entry.thinkGroup.visible) {
        entry.thinkGroup.lookAt(this.camera.position);
        entry.thinkDots.forEach((d, di) => {
          d.position.y = Math.sin(elapsed * 6 - di * 0.7) * 0.07;
        });
      }

      if (entry.beacon.visible) {
        entry.beacon.position.y = 1.8 + Math.sin(elapsed * 5.5) * 0.12;
      }

      const lbl = this.labelEls.get(bot.id);
      if (lbl) {
        const show =
          this.showAllLabels ||
          this.selectedBotId === bot.id ||
          this.hoveredBotId === bot.id ||
          bot.status === "waiting" ||
          bot.status === "error";
        proj.set(pos.x, pos.y + 2.18, pos.z);
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
    this.composer.render();
  }
}

window.Office3D = Office3D;
