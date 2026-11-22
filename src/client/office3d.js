import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const STATUS_HEX = {
  working: "#22c55e",
  waiting: "#f59e0b",
  error: "#ef4444",
  idle: "#38bdf8",
  meeting: "#c084fc",
  no_report: "#64748b",
};

// 6 Functional State-Mapped Cyberpunk Penthouse Zones
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
  { x: 0.4, z: 14.8 }, // Outdoor sky-terrace!
];

const STANDBY_PADS = [
  { x: 11.2, z: 6.6 },
  { x: 14.8, z: 6.6 },
  { x: 11.2, z: 10.4 },
  { x: 14.8, z: 10.4 },
  { x: 18.0, z: 8.5 },
];

const ROOM_CAMERA_TARGETS = {
  all: { pos: [-26, 28, 33], target: [0, 0.8, 0.5] },
  working: { pos: [-25, 18, 10], target: [-14.2, 0.8, -4.5] },
  waiting: { pos: [-2, 15, 6], target: [-0.4, 0.9, -8.5] },
  error: { pos: [21, 15, 6], target: [13.2, 0.8, -8.2] },
  meeting: { pos: [-22, 15, 20], target: [-14.2, 0.8, 9.0] },
  idle: { pos: [0, 16, 24], target: [0.6, 0.8, 8.2] },
  no_report: { pos: [22, 15, 20], target: [14.2, 0.8, 8.5] },
};

const LIGHTING_PRESETS = {
  day: {
    skyTop: "#0f294a",
    skyMid: "#1e4b7a",
    skyHorizon: "#67b7e1",
    fog: 0x10223b,
    ambient: 0xdbeafe,
    ambientInt: 0.72,
    hemiSky: 0xbae6fd,
    hemiGround: 0x171c2b,
    hemiInt: 0.62,
    sun: 0xfff8eb,
    sunInt: 1.3,
    sunPos: [26, 38, 24],
    fill: 0x38bdf8,
    fillInt: 0.45,
    lampInt: 0.65,
    bloomStrength: 0.32,
    starsOpacity: 0.0,
  },
  evening: {
    skyTop: "#13092b",
    skyMid: "#4c1d57",
    skyHorizon: "#ec4899",
    fog: 0x180f2b,
    ambient: 0xf0abfc,
    ambientInt: 0.48,
    hemiSky: 0xf472b6,
    hemiGround: 0x120c21,
    hemiInt: 0.5,
    sun: 0xfb923c,
    sunInt: 1.15,
    sunPos: [-28, 16, 22],
    fill: 0x38bdf8,
    fillInt: 0.55,
    lampInt: 1.45,
    bloomStrength: 0.48,
    starsOpacity: 0.35,
  },
  night: {
    skyTop: "#030611",
    skyMid: "#081229",
    skyHorizon: "#162a52",
    fog: 0x050a18,
    ambient: 0x7dd3fc,
    ambientInt: 0.4,
    hemiSky: 0x38bdf8,
    hemiGround: 0x090d1a,
    hemiInt: 0.45,
    sun: 0x818cf8,
    sunInt: 0.68,
    sunPos: [18, 32, -20],
    fill: 0xe879f9,
    fillInt: 0.42,
    lampInt: 1.95,
    bloomStrength: 0.52,
    starsOpacity: 0.85,
  },
};

/* ---------- Procedural High-Tech Cyberpunk Textures ---------- */
function makeTechGridFloor(baseHex, gridHex, accentDot = null) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  // Subtle brushed texture
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 256, 1);

  ctx.strokeStyle = gridHex;
  ctx.lineWidth = 1.5;
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
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function makeHexTechFloor(baseHex, lineHex) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 1.6;
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
  tex.repeat.set(4, 4);
  return tex;
}

function makeDarkWalnutTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2b1d17";
  ctx.fillRect(0, 0, 256, 256);
  const h = 32;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,200,150,0.035)" : "rgba(0,0,0,0.12)";
    ctx.fillRect(0, i * h, 256, h);
    ctx.fillStyle = "#140d0a";
    ctx.fillRect(0, i * h, 256, 1.5);
    ctx.fillRect(((i * 97) % 210) + 22, i * h, 1.5, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function makeBuildingWindowTexture(accentColor) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#080e1d";
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 248; y += 14) {
    for (let x = 8; x < 120; x += 16) {
      const r = Math.random();
      if (r > 0.45) {
        ctx.fillStyle =
          r > 0.88 ? accentColor : r > 0.72 ? "#bae6fd" : r > 0.58 ? "#fde68a" : "#334155";
        ctx.fillRect(x, y, 10, 7);
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
  g.addColorStop(0.52, mid);
  g.addColorStop(0.85, horizon);
  g.addColorStop(1, "#050914");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 256);
  return new THREE.CanvasTexture(c);
}

function makeCyberScreenTexture(accent = "#38bdf8") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#040a18";
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
  ctx.fillRect(10, 10, 62, 6);
  // Waveform / code bars
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 3 === 0 ? accent : i % 2 === 0 ? "#a855f7" : "#475569";
    ctx.fillRect(12 + (i % 2) * 8, 26 + i * 11, 44 + ((i * 37) % 110), 5);
  }
  // Mini bar chart right side
  for (let b = 0; b < 5; b++) {
    const bh = 22 + ((b * 19) % 52);
    ctx.fillStyle = accent;
    ctx.fillRect(178 + b * 14, 112 - bh, 9, bh);
  }
  return new THREE.CanvasTexture(c);
}

function makeNeonSignTexture(title, subtitle, accentHex) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#050a16";
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
    this.scene.fog = new THREE.FogExp2(0x050a18, 0.0082);

    this.camera = new THREE.PerspectiveCamera(37, w / h, 0.5, 280);
    this.defaultCamPos = new THREE.Vector3(-26, 28, 33);
    this.defaultTarget = new THREE.Vector3(0, 0.8, 0.5);
    this.camera.position.copy(this.defaultCamPos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.container.appendChild(this.renderer.domElement);

    // Post-processing UnrealBloom + OutputPass for crisp ACES tone-mapped neon & screen glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.52, 0.45, 0.78);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.22;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 68;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.28;

    // Studio & Cyberpunk Accent Lighting
    this.ambientLight = new THREE.AmbientLight(0x7dd3fc, 0.4);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x090d1a, 0.45);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0x818cf8, 0.75);
    this.sunLight.position.set(18, 32, -20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -28;
    this.sunLight.shadow.camera.right = 28;
    this.sunLight.shadow.camera.top = 26;
    this.sunLight.shadow.camera.bottom = -26;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0xe879f9, 0.42);
    this.fillLight.position.set(-24, 18, 22);
    this.scene.add(this.fillLight);

    [
      [-14.2, 4.8, -4.5, 0x22d3ee, 20], // Workfloor cyan glow
      [-0.4, 4.6, -8.5, 0xfbbf24, 16],  // Approval Desk warm amber
      [13.5, 4.6, -8.2, 0xf43f5e, 16],  // Repair Bay crimson
      [-14.2, 4.6, 9.0, 0xc084fc, 16],  // War Room violet holo
      [0.6, 4.8, 8.0, 0xfb923c, 18],    // Coffee Lounge warm amber
      [14.2, 4.4, 8.5, 0x38bdf8, 16],   // Standby Dock cool cyan
    ].forEach(([lx, ly, lz, color, dist]) => {
      const lamp = new THREE.PointLight(color, 1.5, dist);
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
            roughness: opts.roughness ?? 0.48,
            metalness: opts.metalness ?? 0.25,
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

  addNeonStrip(w, h, d, hex, x, y, z, intensity = 1.6) {
    return this.addBox(w, h, d, hex, x, y, z, {
      emissive: hex,
      emissiveIntensity: intensity,
      roughness: 0.2,
      castShadow: false,
      receiveShadow: false,
    });
  }

  /* ---------- Skyscraper Skyline, Animated Sky Dome & Flying Traffic ---------- */
  buildSkyAndCity() {
    // Gradient Sky Dome
    this.skyMat = new THREE.MeshBasicMaterial({
      map: makeSkyGradientTexture("#030611", "#081229", "#162a52"),
      side: THREE.BackSide,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(140, 24, 16), this.skyMat);
    this.scene.add(dome);

    // Starfield
    const starPositions = [];
    for (let i = 0; i < 420; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      const r = 115 + Math.random() * 15;
      starPositions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    this.starsMat = new THREE.PointsMaterial({ color: 0xe0f2fe, size: 0.75, transparent: true, opacity: 0.85, fog: false });
    this.scene.add(new THREE.Points(starGeo, this.starsMat));

    // Surrounding Cyberpunk Skyscrapers
    const accents = ["#38bdf8", "#ec4899", "#a855f7", "#f59e0b", "#22d3ee"];
    const winTextures = accents.map((c) => makeBuildingWindowTexture(c));

    const towers = [];
    for (let i = 0; i < 42; i++) {
      const angle = (i / 42) * Math.PI * 2;
      const dist = 34 + (i % 3) * 14 + Math.random() * 10;
      const bx = Math.cos(angle) * dist * 1.25;
      const bz = Math.sin(angle) * dist * 0.95;
      // Keep camera sightline on front-left slightly lower so penthouse stays unobstructed
      if (bx < -10 && bz > 18 && dist < 44) continue;
      towers.push({
        x: bx,
        z: bz,
        w: 4.5 + Math.random() * 5.5,
        d: 4.5 + Math.random() * 5.5,
        h: 22 + Math.random() * 32,
        idx: i,
      });
    }

    towers.forEach((t) => {
      const tex = winTextures[t.idx % winTextures.length];
      const accentHex = accents[t.idx % accents.length];
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0b1326,
        map: tex,
        emissive: new THREE.Color(accentHex),
        emissiveMap: tex,
        emissiveIntensity: 0.65,
        roughness: 0.45,
        metalness: 0.4,
      });
      const yBottom = -26;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), mat);
      mesh.position.set(t.x, yBottom + t.h / 2, t.z);
      this.scene.add(mesh);

      // Rooftop neon crown trim on select towers
      if (t.idx % 3 === 0) {
        this.addNeonStrip(t.w + 0.12, 0.22, t.d + 0.12, new THREE.Color(accentHex).getHex(), t.x, yBottom + t.h + 0.1, t.z, 1.5);
      }
      // Blinking aviation beacon
      if (t.idx % 4 === 0) {
        const b = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xf43f5e })
        );
        b.position.set(t.x, yBottom + t.h + 1.1, t.z);
        this.scene.add(b);
        this.skyBeacons.push(b);
      }
    });

    // Distant Flying Cyber Traffic Light Streaks
    for (let i = 0; i < 12; i++) {
      const col = i % 2 === 0 ? 0x38bdf8 : 0xf43f5e;
      const streak = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.12, 0.14),
        new THREE.MeshBasicMaterial({ color: col })
      );
      const laneZ = -22 - (i % 5) * 6.5;
      const laneY = 2.5 + (i % 4) * 3.8;
      streak.position.set((Math.random() - 0.5) * 90, laneY, laneZ);
      this.scene.add(streak);
      this.skyTraffic.push({
        mesh: streak,
        speed: (i % 2 === 0 ? 1 : -1) * (0.14 + Math.random() * 0.14),
      });
    }
  }

  addGlassWall(w, h, d, x, y, z, neonHex = 0x38bdf8) {
    // Tinted cyber glass + dark titanium mullions + neon top hairline
    this.addBox(w, h, d, 0x38bdf8, x, y, z, {
      transparent: true,
      opacity: 0.16,
      roughness: 0.1,
      metalness: 0.35,
      castShadow: false,
    });
    this.addBox(w + 0.06, 0.12, d + 0.08, 0x0f172a, x, y + h / 2, z, { castShadow: false });
    this.addBox(w + 0.06, 0.16, d + 0.08, 0x0f172a, x, 0.14, z, { castShadow: false });
    this.addNeonStrip(
      w > d ? w : 0.06,
      0.045,
      d >= w ? d : 0.06,
      neonHex,
      x,
      y + h / 2 + 0.06,
      z,
      1.35
    );
    const count = Math.max(2, Math.round(Math.max(w, d) / 3.2));
    for (let i = 0; i <= count; i++) {
      const frac = i / count - 0.5;
      const px = w > d ? x + frac * w : x;
      const pz = d >= w ? z + frac * d : z;
      this.addBox(0.1, h, 0.1, 0x1e293b, px, y, pz, { castShadow: false });
    }
  }

  addSlattedFeatureWall(w, h, d, x, y, z, neonHex = 0x38bdf8) {
    this.addBox(w, h, d, 0x0f172a, x, y, z, { roughness: 0.55, metalness: 0.35 });
    // Architectural dark walnut vertical slats + recessed LED channels
    const isHorizontal = w > d;
    const len = isHorizontal ? w : d;
    const slats = Math.floor(len / 0.65);
    for (let i = 0; i < slats; i++) {
      const offset = -len / 2 + 0.35 + i * 0.65;
      if (isHorizontal) {
        this.addBox(0.16, h - 0.2, 0.08, 0x3b271e, x + offset, y, z + d / 2 + 0.04, { castShadow: false });
      } else {
        this.addBox(0.08, h - 0.2, 0.16, 0x3b271e, x + (x < 0 ? w / 2 + 0.04 : -w / 2 - 0.04), y, z + offset, { castShadow: false });
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
      1.45
    );
  }

  addNeonSign(title, subtitle, accentHex, x, y, z, rotY = 0) {
    const tex = makeNeonSignTexture(title, subtitle, accentHex);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(accentHex),
      emissiveMap: tex,
      emissiveIntensity: 1.05,
      roughness: 0.2,
    });
    this.addBox(4.4, 1.15, 0.14, 0x070d1c, x, y, z, { rotY, castShadow: false });
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
    plane.position.set(x, 0.14, z);
    this.scene.add(plane);
  }

  addPendantBar(w, x, y, z, hex = 0x38bdf8, rotY = 0) {
    // Sleek architectural suspended neon light bar
    this.addBox(w, 0.08, 0.16, 0x1e293b, x, y, z, { rotY, castShadow: false });
    this.addBox(w - 0.12, 0.05, 0.1, hex, x, y - 0.04, z, {
      rotY,
      emissive: hex,
      emissiveIntensity: 1.7,
      castShadow: false,
    });
  }

  /* ---------- Cyberpunk Skyscraper Penthouse Command Center ---------- */
  buildCyberPenthouse() {
    // Skyscraper Penthouse Structural Floor Slab + Glowing Exterior Edge Trim
    this.addBox(43.2, 1.2, 33.4, 0x090f1e, 0, -0.62, 1.6, { castShadow: false, roughness: 0.6, metalness: 0.4 });
    this.addNeonStrip(43.4, 0.08, 0.08, 0x38bdf8, 0, -0.02, -15.1, 1.4);
    this.addNeonStrip(43.4, 0.08, 0.08, 0xa855f7, 0, -0.02, 18.3, 1.4);

    // Central Obsidian Tech Concourse Spine
    const matConcourse = new THREE.MeshStandardMaterial({
      map: makeTechGridFloor("#0e1628", "#1c2b48", "#38bdf8"),
      roughness: 0.35,
      metalness: 0.45,
    });
    this.addBox(41.4, 0.14, 28.4, matConcourse, 0, 0.01, 0, { castShadow: false });

    // Glowing Cyan Guide Strips along the Central Hallway
    this.addNeonStrip(38.0, 0.03, 0.08, 0x38bdf8, 0, 0.1, 0.2, 1.3);

    // --- 1. ACTIVE WORKFLOOR (West Wing: working) ---
    const matWork = new THREE.MeshStandardMaterial({
      map: makeHexTechFloor("#0b2430", "#134759"),
      roughness: 0.42,
      metalness: 0.3,
    });
    this.addBox(13.2, 0.16, 18.2, matWork, -13.8, 0.03, -4.9, { castShadow: false });
    this.addNeonStrip(13.2, 0.035, 0.07, 0x22c55e, -13.8, 0.12, 4.15, 1.4);
    this.addFloorStamp("WORKFLOOR", -14.2, 3.25, 7.6, 1.3, "rgba(34,197,94,0.38)");

    // --- 2. APPROVAL & WAITING ROOM (Top-Center: waiting) ---
    const matWaiting = new THREE.MeshStandardMaterial({
      map: makeTechGridFloor("#1c1714", "#453319", "#f59e0b"),
      roughness: 0.38,
      metalness: 0.35,
    });
    this.addBox(11.6, 0.36, 10.6, matWaiting, -0.4, 0.14, -8.6, { castShadow: false });
    this.addNeonStrip(11.6, 0.05, 0.08, 0xf59e0b, -0.4, 0.33, -3.3, 1.7);
    this.addBox(4.8, 0.18, 0.85, 0x1e293b, -0.4, 0.08, -2.9, { castShadow: false });
    this.addFloorStamp("WAITING FOR YOU", -0.4, -4.4, 7.2, 1.3, "rgba(251,191,36,0.45)");

    // --- 3. INCIDENT / REPAIR BAY (Top-Right: error) ---
    const matError = new THREE.MeshStandardMaterial({
      map: makeHexTechFloor("#260c14", "#5c1628"),
      roughness: 0.45,
      metalness: 0.35,
    });
    this.addBox(13.8, 0.16, 11.5, matError, 13.5, 0.03, -8.2, { castShadow: false });
    this.addNeonStrip(13.8, 0.035, 0.07, 0xef4444, 13.5, 0.12, -2.45, 1.6);
    this.addFloorStamp("REPAIR BAY", 13.5, -3.4, 7.2, 1.3, "rgba(248,113,113,0.42)");

    // --- 4. COLLABORATION WAR ROOM (Bottom-Left: meeting) ---
    const matWar = new THREE.MeshStandardMaterial({
      map: makeHexTechFloor("#1b0f30", "#3e2270"),
      roughness: 0.42,
      metalness: 0.32,
    });
    this.addBox(13.2, 0.16, 8.9, matWar, -13.8, 0.03, 9.4, { castShadow: false });
    this.addNeonStrip(13.2, 0.035, 0.07, 0xc084fc, -13.8, 0.12, 5.0, 1.5);
    this.addFloorStamp("WAR ROOM", -14.2, 13.0, 6.2, 1.3, "rgba(192,132,252,0.4)");

    // --- 5. CYBER COFFEE LOUNGE (Bottom-Center: idle) ---
    const matWalnut = new THREE.MeshStandardMaterial({
      map: makeDarkWalnutTexture(),
      roughness: 0.52,
      metalness: 0.12,
    });
    this.addBox(13.8, 0.16, 11.6, matWalnut, 0.7, 0.03, 8.1, { castShadow: false });
    this.addFloorStamp("CYBER LOUNGE", 0.7, 13.0, 7.2, 1.3, "rgba(56,189,248,0.32)");

    // --- 6. STANDBY DOCK (Bottom-Right: no_report) ---
    const matStandby = new THREE.MeshStandardMaterial({
      map: makeTechGridFloor("#10192b", "#1e3254", "#64748b"),
      roughness: 0.38,
      metalness: 0.45,
    });
    this.addBox(11.8, 0.16, 11.6, matStandby, 14.5, 0.03, 8.1, { castShadow: false });
    this.addFloorStamp("STANDBY DOCK", 14.5, 13.0, 6.8, 1.3, "rgba(148,163,184,0.34)");

    // --- 7. OUTDOOR ROOFTOP SKY-TERRACE (South Balcony off Coffee Lounge!) ---
    this.addBox(26.0, 0.14, 4.0, matWalnut, 7.2, 0.01, 16.0, { castShadow: false });
    // Sleek Glass Balcony Railing + Glowing Cyan Handrail
    this.addGlassWall(26.0, 1.25, 0.1, 7.2, 0.65, 18.0, 0x38bdf8);
    this.addGlassWall(0.1, 1.25, 4.0, -5.8, 0.65, 16.0, 0x38bdf8);
    this.addGlassWall(0.1, 1.25, 4.0, 20.2, 0.65, 16.0, 0x38bdf8);
    // Illuminated Terrace Planters & Cyber-Bonsai Trees
    [-4.2, 4.6, 12.8, 18.4].forEach((tx) => this.buildCyberPlanter(tx, 16.8));
    // Patio Lounge Chairs
    [-1.4, 1.6].forEach((cx) => {
      this.addBox(1.2, 0.32, 1.1, 0x1e293b, cx, 0.24, 15.8);
      this.addBox(1.2, 0.55, 0.18, 0x334155, cx, 0.55, 16.3);
      this.addNeonStrip(1.0, 0.03, 0.04, 0xf59e0b, cx, 0.1, 15.25, 1.3);
    });
    // Overhead Warm Terrace String Lights
    for (let sx = -4.5; sx <= 18.5; sx += 2.3) {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xfde68a })
      );
      bulb.position.set(sx, 2.75 - Math.abs(Math.sin(sx * 0.4)) * 0.22, 17.6);
      this.scene.add(bulb);
    }

    // --- PERIMETER FLOOR-TO-CEILING PANORAMIC GLASS CURTAIN WALLS ---
    const winH = 3.2;
    this.addGlassWall(41.4, winH, 0.18, 0, winH / 2, -14.1, 0x38bdf8);
    this.addGlassWall(0.18, winH, 28.4, -20.5, winH / 2, 0, 0x38bdf8);
    this.addGlassWall(0.18, winH, 28.4, 20.5, winH / 2, 0, 0xc084fc);

    // Architectural Slatted Feature Dividers & Glass Partitions
    const divH = 2.4;
    this.addGlassWall(0.14, divH, 9.6, -7.0, divH / 2, -9.2, 0x22c55e);
    this.addSlattedFeatureWall(11.4, divH, 0.28, -14.6, divH / 2, 4.8, 0xc084fc);
    this.addGlassWall(0.14, divH, 9.6, 5.7, divH / 2, -9.2, 0xf59e0b);
    this.addSlattedFeatureWall(11.0, divH, 0.28, 14.8, divH / 2, -2.3, 0xef4444);
    this.addGlassWall(0.14, divH, 7.6, -7.0, divH / 2, 10.0, 0xc084fc);
    this.addGlassWall(0.14, divH, 8.2, 8.2, divH / 2, 9.8, 0x38bdf8);

    // Suspended Architectural Neon Pendant Bars
    this.addPendantBar(6.0, -14.2, 3.6, -6.2, 0x38bdf8);
    this.addPendantBar(4.2, -0.4, 3.5, -10.5, 0xf59e0b);
    this.addPendantBar(3.6, -14.2, 3.5, 8.9, 0xc084fc);
    this.addPendantBar(4.0, 6.2, 3.5, 6.8, 0xfb923c, Math.PI / 2);

    // --- GIANT TELEMETRY COMMAND JUMBOTRON (Workfloor Back Wall) ---
    this.usageCanvas = document.createElement("canvas");
    this.usageCanvas.width = 512;
    this.usageCanvas.height = 170;
    this.usageTex = new THREE.CanvasTexture(this.usageCanvas);
    this.addBox(6.2, 2.0, 0.16, 0x050914, -14.2, 2.0, -13.85, { roughness: 0.25, metalness: 0.6 });
    this.addNeonStrip(6.3, 0.05, 0.05, 0x38bdf8, -14.2, 3.02, -13.8, 1.7);
    const screenMat = new THREE.MeshStandardMaterial({
      map: this.usageTex,
      emissive: 0x38bdf8,
      emissiveMap: this.usageTex,
      emissiveIntensity: 1.05,
      roughness: 0.2,
    });
    const screenMesh = new THREE.Mesh(new THREE.BoxGeometry(5.9, 1.76, 0.1), screenMat);
    screenMesh.position.set(-14.2, 2.0, -13.75);
    this.scene.add(screenMesh);
    this.updateWallScreen(100, 0);

    // Neon Room Header Signs
    this.addNeonSign("APPROVAL DESK", "WAITING FOR HUMAN", "#f59e0b", -0.4, 2.1, -13.8, 0);
    this.addNeonSign("REPAIR BAY", "DIAGNOSTICS & ERRORS", "#ef4444", 13.6, 2.1, -13.8, 0);
    this.addNeonSign("STANDBY DOCK", "IDLE > 24H // SLEEP", "#38bdf8", 20.1, 2.0, 8.2, -Math.PI / 2);

    // --- ROOM 1: CYBER WORKFLOOR (8 Curved Dual-Monitor Command Desks) ---
    this.codeScreenMat = new THREE.MeshStandardMaterial({
      map: makeCyberScreenTexture("#38bdf8"),
      emissive: 0x38bdf8,
      emissiveMap: makeCyberScreenTexture("#38bdf8"),
      emissiveIntensity: 0.95,
      roughness: 0.2,
    });
    WORKFLOOR_DESKS.forEach((d, idx) => this.buildCyberDesk(d.x, d.z, idx));

    // Glowing Data Packets arcing from active Workfloor desks to the Command Jumbotron!
    WORKFLOOR_DESKS.slice(0, 6).forEach((d, idx) => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 10, 10),
        new THREE.MeshBasicMaterial({ color: idx % 2 === 0 ? 0x38bdf8 : 0x22c55e })
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
    // Curved Dark Obsidian Review Desk + Glowing Amber Halo Strip + Plush Bench
    this.addBox(5.4, 1.05, 1.1, 0x0f172a, -0.4, 0.84, -10.8, { roughness: 0.35, metalness: 0.5 });
    this.addBox(5.6, 0.1, 1.28, 0x1e293b, -0.4, 1.4, -10.8, { roughness: 0.25, metalness: 0.4 });
    this.addNeonStrip(5.0, 0.08, 0.06, 0xf59e0b, -0.4, 1.04, -10.22, 1.8);
    // Holographic Check-in Screen on Desk
    const waitScreenMat = new THREE.MeshStandardMaterial({
      map: makeCyberScreenTexture("#f59e0b"),
      emissive: 0xf59e0b,
      emissiveMap: makeCyberScreenTexture("#f59e0b"),
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.88,
    });
    this.addBox(2.2, 0.85, 0.06, waitScreenMat, -0.4, 1.92, -10.7, { castShadow: false });
    // Sleek waiting bench
    this.addBox(3.8, 0.42, 0.85, 0x1e293b, -0.4, 0.52, -5.2);
    this.addNeonStrip(3.6, 0.04, 0.04, 0xf59e0b, -0.4, 0.32, -4.76, 1.4);

    // --- ROOM 3: INCIDENT / REPAIR BAY (Tall Glowing Mainframe Towers) ---
    [18.8, 18.8, 18.8].forEach((sx, idx) => {
      const sz = -11.4 + idx * 2.5;
      this.addBox(1.15, 2.55, 1.75, 0x090f1d, sx, 1.32, sz, { roughness: 0.3, metalness: 0.65 });
      this.addNeonStrip(0.06, 2.4, 0.06, 0xef4444, sx - 0.59, 1.32, sz - 0.82, 1.5);
      for (let r = 0; r < 6; r++) {
        this.addBox(0.06, 0.22, 1.35, 0x162238, sx - 0.58, 0.46 + r * 0.34, sz, { castShadow: false });
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.07, 0.14),
          new THREE.MeshBasicMaterial({ color: r % 2 === 0 ? 0xf43f5e : 0x38bdf8 })
        );
        led.position.set(sx - 0.62, 0.46 + r * 0.34, sz - 0.42 + (r % 3) * 0.25);
        this.scene.add(led);
        this.serverLeds.push(led);
      }
    });
    // Diagnostic Console
    this.addBox(3.4, 0.92, 1.2, 0x111827, 11.8, 0.5, -11.4, { metalness: 0.55 });
    const errScreenMat = new THREE.MeshStandardMaterial({
      map: makeCyberScreenTexture("#ef4444"),
      emissive: 0xef4444,
      emissiveMap: makeCyberScreenTexture("#ef4444"),
      emissiveIntensity: 1.0,
    });
    this.addBox(1.9, 0.82, 0.08, errScreenMat, 11.8, 1.44, -11.65);

    // --- ROOM 4: WAR ROOM (Glass Table + Rotating 3D Holographic Earth/Data Globe!) ---
    const confBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 0.12, 36),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.18,
        metalness: 0.65,
        transparent: true,
        opacity: 0.86,
      })
    );
    confBase.position.set(-14.2, 0.9, 8.9);
    confBase.castShadow = true;
    confBase.receiveShadow = true;
    this.scene.add(confBase);
    this.addBox(0.6, 0.85, 0.6, 0x0f172a, -14.2, 0.45, 8.9, { metalness: 0.6 });

    // Multi-ring Rotating 3D Holographic Globe above War Room table!
    this.holoGroup = new THREE.Group();
    this.holoGroup.position.set(-14.2, 1.75, 8.9);
    const globe = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      new THREE.MeshBasicMaterial({ color: 0xc084fc, wireframe: true, transparent: true, opacity: 0.85 })
    );
    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.028, 10, 36),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })
    );
    ring1.rotation.x = Math.PI / 2.2;
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.12, 0.022, 10, 36),
      new THREE.MeshBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.7 })
    );
    ring2.rotation.x = Math.PI / 3;
    ring2.rotation.y = Math.PI / 4;
    this.holoGroup.add(globe, ring1, ring2);
    this.scene.add(this.holoGroup);

    WAR_ROOM_SPOTS.slice(0, 4).forEach((s) => this.buildCyberChair(s.x, s.z, 0x7c3aed));

    // --- ROOM 5: CYBER COFFEE LOUNGE & RETRO ARCADE ---
    this.buildCyberLoungeCluster(-1.8, 6.2, 0x1a132b, 0x1e293b, 0x38bdf8);
    this.buildCyberLoungeCluster(-1.8, 10.6, 0x261522, 0x1e293b, 0xf472b6);

    // Cyber Espresso Bar + Marble Top + Glowing Under-Counter Strip + Rising Steam
    this.addBox(1.3, 1.05, 4.9, 0x111827, 6.2, 0.56, 6.8, { roughness: 0.4, metalness: 0.45 });
    this.addBox(1.44, 0.09, 5.05, 0x334155, 6.2, 1.1, 6.8, { roughness: 0.22, metalness: 0.35 });
    this.addNeonStrip(0.06, 0.06, 4.8, 0xfb923c, 5.52, 0.96, 6.8, 1.6);

    // Chrome Espresso Machine
    this.addBox(0.68, 0.65, 0.95, 0x1e293b, 6.2, 1.44, 5.4, { metalness: 0.75, roughness: 0.22 });
    this.addNeonStrip(0.08, 0.14, 0.42, 0x22d3ee, 5.84, 1.56, 5.4, 1.5);

    // Animated Rising Espresso Steam Puffs
    for (let i = 0; i < 8; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.35 })
      );
      puff.position.set(6.15 + (i % 3) * 0.08, 1.8 + i * 0.16, 5.4 + ((i % 2) - 0.5) * 0.12);
      this.scene.add(puff);
      this.steamPuffs.push({ mesh: puff, offset: i * 0.45 });
    }

    // Modern Bar Stools
    [5.2, 6.6, 8.0].forEach((sz) => {
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.28, 0.1, 18),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45 })
      );
      seat.position.set(4.85, 0.74, sz);
      seat.castShadow = true;
      this.scene.add(seat);
      this.addBox(0.08, 0.7, 0.08, 0x64748b, 4.85, 0.36, sz, { metalness: 0.7 });
    });

    // Glowing Cyber-Arcade Cabinet in Lounge Corner
    this.addBox(1.1, 2.0, 0.95, 0x130b2e, 6.4, 1.04, 11.6, { roughness: 0.35, metalness: 0.3 });
    const arcadeTex = makeCyberScreenTexture("#ec4899");
    const arcadeScreenMat = new THREE.MeshStandardMaterial({
      map: arcadeTex,
      emissive: 0xec4899,
      emissiveMap: arcadeTex,
      emissiveIntensity: 1.05,
    });
    this.addBox(0.08, 0.72, 0.76, arcadeScreenMat, 5.84, 1.45, 11.6, { castShadow: false });
    this.addNeonStrip(0.06, 0.08, 0.85, 0x38bdf8, 5.83, 1.98, 11.6, 1.7);

    // --- ROOM 6: STANDBY DOCK (Glowing Inductive Charging Pads) ---
    STANDBY_PADS.forEach((pad) => {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.18, 0.14, 28),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.65 })
      );
      base.position.set(pad.x, 0.12, pad.z);
      base.receiveShadow = true;
      this.scene.add(base);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.76, 0.92, 28),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
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
    // Sleek dark carbon-fiber desk + glowing front LED strip
    this.addBox(2.9, 0.09, 1.34, 0x111827, x, 0.92, z, { roughness: 0.32, metalness: 0.45 });
    this.addNeonStrip(2.8, 0.035, 0.04, idx % 2 === 0 ? 0x38bdf8 : 0x22c55e, x, 0.92, z + 0.68, 1.4);
    this.addBox(0.1, 0.88, 1.14, 0x1e293b, x - 1.3, 0.45, z, { metalness: 0.6 });
    this.addBox(0.1, 0.88, 1.14, 0x1e293b, x + 1.3, 0.45, z, { metalness: 0.6 });

    // Dual Curved Glowing Monitors
    [-0.6, 0.6].forEach((ox, mIdx) => {
      const rot = mIdx === 0 ? 0.2 : -0.2;
      this.addBox(1.08, 0.64, 0.06, 0x090f1e, x + ox, 1.42, z - 0.34, { rotY: rot });
      this.addBox(1.0, 0.56, 0.04, this.codeScreenMat, x + ox, 1.42, z - 0.3, {
        rotY: rot,
        castShadow: false,
      });
      this.addBox(0.09, 0.28, 0.09, 0x334155, x + ox, 1.07, z - 0.36);
    });

    // Glowing RGB Keyboard
    this.addBox(0.88, 0.03, 0.28, 0x0f172a, x - 0.08, 0.985, z + 0.14, { castShadow: false });
    this.addNeonStrip(0.82, 0.015, 0.04, 0x38bdf8, x - 0.08, 1.0, z + 0.27, 1.2);

    this.buildCyberChair(x, z + 0.94, 0x1e293b);
  }

  buildCyberChair(x, z, accent = 0x1e293b) {
    this.addBox(0.64, 0.06, 0.08, 0x475569, x, 0.06, z, { castShadow: false, metalness: 0.7 });
    this.addBox(0.08, 0.06, 0.64, 0x475569, x, 0.06, z, { castShadow: false, metalness: 0.7 });
    this.addBox(0.1, 0.34, 0.1, 0x64748b, x, 0.23, z, { castShadow: false, metalness: 0.7 });
    this.addBox(0.72, 0.12, 0.68, 0x0f172a, x, 0.44, z);
    this.addBox(0.66, 0.78, 0.11, accent, x, 0.85, z + 0.3);
    [-0.36, 0.36].forEach((ax) => {
      this.addBox(0.08, 0.24, 0.48, 0x334155, x + ax, 0.62, z + 0.04, { castShadow: false });
    });
  }

  buildCyberLoungeCluster(x, z, rugHex, sofaHex, neonHex) {
    this.addBox(5.8, 0.04, 3.6, rugHex, x, 0.12, z, { castShadow: false, roughness: 0.9 });
    this.addNeonStrip(5.8, 0.025, 0.05, neonHex, x, 0.13, z + 1.8, 1.1);
    // Curved-feel plush modern sofa with under-glow
    this.addBox(3.5, 0.42, 1.15, sofaHex, x, 0.34, z - 1.05, { roughness: 0.6 });
    this.addNeonStrip(3.2, 0.04, 0.05, neonHex, x, 0.15, z - 0.47, 1.2);
    this.addBox(3.5, 0.62, 0.28, sofaHex, x, 0.74, z - 1.52, { roughness: 0.6 });
    [-1.68, 1.68].forEach((ax) => {
      this.addBox(0.24, 0.56, 1.15, sofaHex, x + ax, 0.58, z - 1.05);
    });
    // Accent Cushions
    [-1.08, 1.08].forEach((px) => {
      this.addBox(0.42, 0.36, 0.16, neonHex, x + px, 0.7, z - 1.24, { rotY: px < 0 ? 0.2 : -0.2 });
    });
    // Glass-top coffee table
    this.addBox(2.0, 0.08, 1.0, 0x38bdf8, x, 0.46, z + 0.28, { transparent: true, opacity: 0.42, roughness: 0.15 });
    [[-0.8, -0.1], [0.8, -0.1], [-0.8, 0.65], [0.8, 0.65]].forEach(([ox, oz]) => {
      this.addBox(0.08, 0.42, 0.08, 0x475569, x + ox, 0.22, z + oz, { metalness: 0.7 });
    });
  }

  buildCyberPlanter(x, z) {
    // Sleek illuminated obsidian planter + lush stylized foliage
    this.addBox(0.86, 0.66, 0.86, 0x0f172a, x, 0.36, z, { roughness: 0.35, metalness: 0.5 });
    this.addNeonStrip(0.9, 0.04, 0.9, 0x22d3ee, x, 0.66, z, 1.1);
    this.addBox(0.1, 0.75, 0.1, 0x4a2e1f, x, 0.86, z, { castShadow: false });
    [
      [0, 1.4, 0, 0.54, 0x10b981],
      [-0.32, 1.15, 0.22, 0.4, 0x059669],
      [0.32, 1.18, -0.18, 0.42, 0x34d399],
    ].forEach(([ox, oy, oz, rad, col]) => {
      const leaf = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rad, 1),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.62 })
      );
      leaf.position.set(x + ox, oy, z + oz);
      leaf.castShadow = true;
      this.scene.add(leaf);
    });
  }

  buildOfficeCat() {
    const cat = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.7 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });

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

    // Glowing cyan cyber-collar
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.028, 8, 18),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
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

  updateWallScreen(remainingPct, activeCount) {
    const c = this.usageCanvas;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#040a18";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "700 18px Inter, sans-serif";
    ctx.fillText("CYBER HQ // DAILY BUDGET REMAINING", 26, 38);

    ctx.fillStyle = remainingPct > 25 ? "#38bdf8" : "#fb7185";
    ctx.font = "800 58px Inter, sans-serif";
    ctx.fillText(`${remainingPct}%`, 26, 106);

    ctx.fillStyle = "#34d399";
    ctx.font = "700 24px Inter, sans-serif";
    ctx.fillText(`${activeCount} ACTIVE`, 326, 98);

    ctx.fillStyle = "#16233d";
    ctx.fillRect(26, 128, 460, 20);
    ctx.fillStyle = remainingPct > 25 ? "#22d3ee" : "#ef4444";
    ctx.fillRect(26, 128, Math.max(10, (460 * remainingPct) / 100), 20);
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
      roughness: 0.34,
      metalness: 0.08,
    });

    const rig = new THREE.Group();
    group.add(rig);

    const { bodyGroup, hitMeshes, eyeY, eyeZ, eyeSpread } = this.buildGrokBodyMesh(bodyMat, bot.id);
    rig.add(bodyGroup);

    // Big Iconic Expressive Grok Bot Eyes
    const faceGroup = new THREE.Group();
    faceGroup.position.set(0, eyeY, eyeZ);
    rig.add(faceGroup);

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.16, metalness: 0.02 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.1, metalness: 0.15 });
    const catchMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lidMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.34 });

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
      new THREE.RingGeometry(0.56, 0.68, 28),
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

    const orbitRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.028, 8, 32),
      new THREE.MeshBasicMaterial({
        color: primaryColor,
        transparent: true,
        opacity: 0.7,
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
        emissiveIntensity: 1.5,
        roughness: 0.2,
      })
    );
    beacon.position.set(0.46, 1.82, 0.18);
    beacon.visible = bot.status === "waiting" || bot.status === "error";
    group.add(beacon);

    this.scene.add(group);

    // Name + Role Floating Name Tag
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
    const activeCount = bots.filter((b) => b.status === "working" || b.status === "meeting").length;
    if (usageSummary) {
      this.updateWallScreen(usageSummary.usageRemainingPct ?? 100, activeCount);
    }

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

      const hex = STATUS_HEX[bot.status] || "#22c55e";
      entry.halo.material.color.set(hex);
      entry.orbitRing.visible = bot.status === "working";
      entry.thinkGroup.visible = bot.status === "working" || bot.status === "meeting";

      entry.beacon.visible = bot.status === "waiting" || bot.status === "error";
      if (entry.beacon.visible) {
        const bCol = bot.status === "error" ? "#ef4444" : "#f59e0b";
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

    // Rotating 3D War Room Hologram Globe
    if (this.holoGroup) {
      this.holoGroup.rotation.y = elapsed * 0.7;
      this.holoGroup.position.y = 1.72 + Math.sin(elapsed * 2.2) * 0.08;
    }

    // Blinking Repair Bay Mainframe LEDs & Skyscraper Beacons
    this.serverLeds.forEach((led, i) => {
      led.visible = Math.sin(elapsed * 5 + i * 1.6) > -0.3;
    });
    this.skyBeacons.forEach((b, i) => {
      b.visible = Math.sin(elapsed * 2.4 + i) > 0;
    });
    this.standbyRings.forEach((r, i) => {
      r.material.opacity = 0.3 + (Math.sin(elapsed * 2.2 + i) + 1) * 0.22;
    });

    // Distant Flying Traffic Streaks
    this.skyTraffic.forEach((t) => {
      t.mesh.position.x += t.speed;
      if (t.mesh.position.x > 65) t.mesh.position.x = -65;
      if (t.mesh.position.x < -65) t.mesh.position.x = 65;
    });

    // Rising Coffee Espresso Steam
    this.steamPuffs.forEach((s) => {
      const cycle = ((elapsed * 0.65 + s.offset) % 1.8) / 1.8;
      s.mesh.position.y = 1.75 + cycle * 1.4;
      s.mesh.scale.setScalar(0.6 + cycle * 0.9);
      s.mesh.material.opacity = (1 - cycle) * 0.35;
    });

    // Animated Data Packets arcing from Workfloor desks to Telemetry Jumbotron
    const hasWorkers = this.bots.some((b) => b.status === "working");
    this.dataPackets.forEach((p) => {
      p.mesh.visible = hasWorkers;
      if (!hasWorkers) return;
      p.t = (p.t + p.speed) % 1;
      p.mesh.position.lerpVectors(p.start, p.end, p.t);
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 2.1;
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
