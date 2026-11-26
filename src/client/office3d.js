import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { roomLabel } from "../roomLabel.ts";

const STATUS_HEX = {
  working: "#10b981",
  waiting: "#f59e0b",
  error: "#f43f5e",
  idle: "#4fd1b5",
  meeting: "#818cf8",
  no_report: "#64748b",
};

/* ---------- Expanded Zero-Overlap Seating Coordinates (16+ slots in key rooms) ---------- */
const WORKFLOOR_DESKS = [
  { x: -17.0, z: -10.4 },
  { x: -11.2, z: -10.4 },
  { x: -17.0, z: -6.0 },
  { x: -11.2, z: -6.0 },
  { x: -17.0, z: -1.6 },
  { x: -11.2, z: -1.6 },
  { x: -17.0, z: 2.4 },
  { x: -11.2, z: 2.4 },
  // Overflow focus pods along east/west workfloor aisles
  { x: -14.1, z: -8.2 },
  { x: -14.1, z: -3.8 },
  { x: -14.1, z: 0.4 },
  { x: -8.6, z: -8.4 },
  { x: -8.6, z: -4.0 },
  { x: -8.6, z: 0.2 },
  { x: -19.2, z: -8.2 },
  { x: -19.2, z: -3.8 },
];

const WAITING_SPOTS = [
  { x: -3.2, z: -8.6 },
  { x: -0.4, z: -8.6 },
  { x: 2.4, z: -8.6 },
  { x: -2.0, z: -6.4 },
  { x: 1.2, z: -6.4 },
  { x: -4.2, z: -6.6 },
  { x: 3.4, z: -6.6 },
  { x: -0.4, z: -4.8 },
  { x: -3.2, z: -4.6 },
  { x: 2.4, z: -4.6 },
];

const ERROR_BAY_SPOTS = [
  { x: 9.8, z: -9.6 },
  { x: 13.6, z: -9.6 },
  { x: 16.4, z: -9.6 },
  { x: 9.8, z: -6.0 },
  { x: 13.6, z: -6.0 },
  { x: 16.4, z: -6.0 },
  { x: 11.7, z: -7.8 },
  { x: 15.0, z: -7.8 },
];

const WAR_ROOM_SPOTS = [
  { x: -16.4, z: 7.2 },
  { x: -12.0, z: 7.2 },
  { x: -16.4, z: 10.6 },
  { x: -12.0, z: 10.6 },
  { x: -14.2, z: 6.1 },
  { x: -14.2, z: 11.7 },
  { x: -17.4, z: 8.9 },
  { x: -11.0, z: 8.9 },
  { x: -15.6, z: 12.2 },
  { x: -12.8, z: 12.2 },
];

// 16 generously spaced spots across Cyber Lounge, Espresso Bar, Concourse Lounge & Sky-Terrace
const LOUNGE_SPOTS = [
  { x: -4.8, z: 5.0 },
  { x: -1.8, z: 4.8 },
  { x: 1.2, z: 5.0 },
  { x: 4.1, z: 5.0 },
  { x: -4.8, z: 8.2 },
  { x: -1.8, z: 8.0 },
  { x: 1.4, z: 8.2 },
  { x: 4.1, z: 7.8 },
  { x: -4.6, z: 11.2 },
  { x: -1.4, z: 11.4 },
  { x: 1.8, z: 11.2 },
  { x: 4.4, z: 10.6 },
  // Outdoor Sky-Terrace panoramic spots
  { x: -3.2, z: 15.6 },
  { x: 0.4, z: 15.4 },
  { x: 4.2, z: 15.6 },
  { x: 8.4, z: 15.8 },
];

const STANDBY_PADS = [
  { x: 10.6, z: 5.6 },
  { x: 14.4, z: 5.6 },
  { x: 18.0, z: 5.6 },
  { x: 10.6, z: 9.4 },
  { x: 14.4, z: 9.4 },
  { x: 18.0, z: 9.4 },
  { x: 12.5, z: 12.2 },
  { x: 16.3, z: 12.2 },
];

const ROOM_CAMERA_TARGETS = {
  all: { pos: [-24.4, 22.8, 29.2], target: [-0.6, 0.7, 1.0] },
  working: { pos: [-23.5, 14.5, 8.5], target: [-14.0, 0.8, -4.5] },
  waiting: { pos: [-1.5, 12.5, 4.5], target: [-0.4, 0.9, -8.2] },
  error: { pos: [19.5, 13.0, 4.5], target: [13.2, 0.8, -8.0] },
  meeting: { pos: [-20.5, 13.0, 18.0], target: [-14.2, 0.8, 8.9] },
  idle: { pos: [-1.2, 14.0, 22.8], target: [0.2, 0.8, 9.2] },
  no_report: { pos: [20.5, 13.5, 18.5], target: [14.2, 0.8, 8.5] },
};

/* ---------- Refined Architectural Lighting Presets (Blade Runner 2049 / Nordic Glass / Obsidian Night) ---------- */
const LIGHTING_PRESETS = {
  night: {
    // Night shift: lamplit interiors, warm city glow on the horizon, cool moonlight key
    skyTop: "#05060b",
    skyMid: "#12101b",
    skyHorizon: "#4a2c18",
    fog: 0x0d0b0f,
    fogDensity: 0.0050,
    ambient: 0xffe6c7,
    ambientInt: 0.4,
    hemiSky: 0x8f8296,
    hemiGround: 0x0c0a0b,
    hemiInt: 0.5,
    sun: 0xb9c6ff,
    sunInt: 0.78,
    sunPos: [20, 34, -18],
    fill: 0xffb547,
    fillInt: 0.46,
    lampInt: 2.05,
    envInt: 0.5,
    bloomStrength: 0.34,
    starsOpacity: 0.55,
  },
  evening: {
    // Blade Runner 2049 warm burnt-amber dusk atmosphere
    skyTop: "#0b0709",
    skyMid: "#231210",
    skyHorizon: "#7c3419",
    fog: 0x160c0b,
    fogDensity: 0.0058,
    ambient: 0xfde68a,
    ambientInt: 0.46,
    hemiSky: 0xfb923c,
    hemiGround: 0x110c0f,
    hemiInt: 0.55,
    sun: 0xffb547,
    sunInt: 1.15,
    sunPos: [-28, 16, 22],
    fill: 0x4fd1b5,
    fillInt: 0.34,
    lampInt: 1.45,
    envInt: 0.48,
    bloomStrength: 0.22,
    starsOpacity: 0.25,
  },
  day: {
    // High-altitude crisp architectural glass tower daylight
    skyTop: "#162233",
    skyMid: "#2d4059",
    skyHorizon: "#64748b",
    fog: 0x1d293a,
    fogDensity: 0.0042,
    ambient: 0xf1f5f9,
    ambientInt: 0.85,
    hemiSky: 0xe2e8f0,
    hemiGround: 0x1e293b,
    hemiInt: 0.72,
    sun: 0xfff8eb,
    sunInt: 1.38,
    sunPos: [24, 38, 22],
    fill: 0x9fe8d6,
    fillInt: 0.45,
    lampInt: 0.78,
    envInt: 0.72,
    bloomStrength: 0.12,
    starsOpacity: 0.04,
  },
};

/* ---------- Procedural Architectural Materials (Zero Laser-Tag Hex Grids) ---------- */
function makeObsidianStoneTexture(baseHex = "#10141e", jointHex = "rgba(255,255,255,0.045)", tileSize = 128) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle architectural stone slab tonal variation
  let s = 4219;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let x = 0; x < 512; x += tileSize) {
    for (let y = 0; y < 512; y += tileSize) {
      const shade = rand() > 0.5 ? `rgba(255,255,255,${(rand() * 0.026).toFixed(3)})` : `rgba(0,0,0,${(rand() * 0.08).toFixed(3)})`;
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, tileSize, tileSize);
    }
  }
  // Fine brushed concrete grain
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.014)" : "rgba(0,0,0,0.03)";
    ctx.fillRect(rand() * 512, rand() * 512, 2 + rand() * 5, 1);
  }
  // Crisp hairline expansion joints
  ctx.strokeStyle = jointHex;
  ctx.lineWidth = 1.2;
  for (let i = 0; i <= 512; i += tileSize) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSmokedWalnutTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#221a15";
  ctx.fillRect(0, 0, 512, 512);

  const plankH = 32;
  let s = 881;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let row = 0; row < 512 / plankH; row++) {
    const y = row * plankH;
    const tone = rand();
    ctx.fillStyle = tone > 0.5 ? `rgba(255,220,185,${(tone * 0.045).toFixed(3)})` : `rgba(0,0,0,${(tone * 0.14).toFixed(3)})`;
    ctx.fillRect(0, y, 512, plankH);

    // Subtle wood grain fibers
    ctx.fillStyle = "rgba(0,0,0,0.09)";
    for (let g = 0; g < 4; g++) {
      ctx.fillRect(0, y + 4 + g * 7, 512, 1);
    }

    // Plank seam
    ctx.fillStyle = "#110c09";
    ctx.fillRect(0, y, 512, 1.4);
    const stagger = ((row * 137) % 360) + 60;
    ctx.fillRect(stagger, y, 1.4, plankH);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeAcousticWeaveTexture(baseHex = "#161a24") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < 256; y += 6) ctx.fillRect(0, y, 256, 1.5);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let x = 0; x < 256; x += 6) ctx.fillRect(x, 0, 1.5, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeContactShadowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
  g.addColorStop(0, "rgba(0,0,0,0.68)");
  g.addColorStop(0.55, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeArchitecturalCityGround() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#04060c";
  ctx.fillRect(0, 0, 512, 512);

  // Subtle distant dark avenues (warm sodium-amber & faint slate, zero neon rainbow)
  for (let i = 0; i <= 512; i += 64) {
    const major = i % 128 === 0;
    ctx.strokeStyle = major ? "rgba(251, 191, 36, 0.16)" : "rgba(148, 163, 184, 0.07)";
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

/* ---------- Restrained Architectural Glass Skyscraper Facades (Zero Pink/Neon Polka Dots!) ---------- */
function makeArchitecturalGlassFacade(seed = 1) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#060911";
  ctx.fillRect(0, 0, 256, 512);

  // Clean structural curtain-wall mullions
  ctx.fillStyle = "#0c1220";
  for (let x = 0; x < 256; x += 32) ctx.fillRect(x, 0, 2, 512);
  ctx.fillStyle = "#090d18";
  for (let y = 0; y < 512; y += 20) ctx.fillRect(0, y, 256, 5);

  let s = seed * 2971;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  // Sparse, realistic warm-office & cool-slate horizontal ribbon bands
  for (let y = 7; y < 504; y += 20) {
    const floorOccupied = rand() > 0.62;
    if (!floorOccupied) continue;
    const warmFloor = rand() > 0.28;
    const startBay = Math.floor(rand() * 4);
    const spanBays = 2 + Math.floor(rand() * 5);
    for (let b = startBay; b < Math.min(8, startBay + spanBays); b++) {
      if (rand() < 0.22) continue;
      const alpha = 0.22 + rand() * 0.45;
      ctx.fillStyle = warmFloor
        ? `rgba(255, 196, 120, ${alpha.toFixed(2)})`
        : `rgba(214, 224, 255, ${(alpha * 0.6).toFixed(2)})`;
      ctx.fillRect(b * 32 + 4, y, 24, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let lightPoolTexture = null;
function makeLightPoolTexture() {
  if (lightPoolTexture) return lightPoolTexture;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(0.7, "rgba(255,255,255,0.08)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  lightPoolTexture = new THREE.CanvasTexture(c);
  lightPoolTexture.colorSpace = THREE.SRGBColorSpace;
  return lightPoolTexture;
}

function makeSkyGradientTexture(top, mid, horizon) {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(0.48, mid);
  g.addColorStop(0.75, horizon);
  g.addColorStop(0.9, "#0b0908");
  g.addColorStop(1, "#050507");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 256);
  return new THREE.CanvasTexture(c);
}

function makeMinimalTelemetryScreen(accent = "#4fd1b5", titleText = "SYS // LIVE") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#080b12";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, 0, 256, 22);
  ctx.fillStyle = accent;
  ctx.font = "700 11px Inter, sans-serif";
  ctx.fillText(titleText, 10, 15);

  // Clean muted telemetry rows
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i === 0 ? accent : "rgba(148,163,184,0.34)";
    ctx.fillRect(10, 34 + i * 16, 48 + ((i * 43) % 92), 4);
  }
  // Minimal right-hand signal bars
  for (let b = 0; b < 6; b++) {
    const bh = 16 + ((b * 17) % 48);
    ctx.fillStyle = b === 5 ? accent : "rgba(148,163,184,0.28)";
    ctx.fillRect(172 + b * 12, 112 - bh, 7, bh);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeArchitecturalSignTexture(title, subtitle, accentHex) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b0e16";
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 504, 120);
  // Crisp thin left vertical accent bar
  ctx.fillStyle = accentHex;
  ctx.fillRect(20, 26, 6, 76);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "700 36px Inter, sans-serif";
  ctx.fillText(title, 44, 62);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 19px Inter, sans-serif";
  ctx.fillText(subtitle, 44, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFloorStamp(text, color) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "700 38px Inter, sans-serif";
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
    this.contactShadowTex = makeContactShadowTexture();

    this.isPaused = false;
    this.rafId = null;

    this.initScene();
    this.buildSkyAndCity();
    this.buildCommandPenthouse();
    this.buildOfficeCat();
    this.bindEvents();
    this.setLighting("night");
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
      } else if (!this.isPaused && this.rafId === null) {
        this.clock.getDelta();
        this.scheduleNextFrame();
      }
    });
    this.scheduleNextFrame();
  }

  scheduleNextFrame() {
    if (this.isPaused || document.hidden || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.animate();
    });
  }

  setPaused(paused) {
    this.isPaused = Boolean(paused);
    if (this.isPaused) {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    } else if (!document.hidden) {
      this.handleResize();
      this.clock.getDelta();
      this.scheduleNextFrame();
    }
  }

  initScene() {
    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0d0b0f, 0.005);

    // Closer cinematic architectural camera framing so bots & interior own ~75% of viewport
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.5, 420);
    this.defaultCamPos = new THREE.Vector3(...ROOM_CAMERA_TARGETS.all.pos);
    this.defaultTarget = new THREE.Vector3(...ROOM_CAMERA_TARGETS.all.target);
    this.camera.position.copy(this.defaultCamPos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    // Studio IBL Reflections via PMREMGenerator + RoomEnvironment (deferred so initial load never blocks!)
    setTimeout(() => {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
        this.scene.environment = this.envRT.texture;
        const p = LIGHTING_PRESETS[this.lightingMode] || LIGHTING_PRESETS.night;
        this.scene.environmentIntensity = p.envInt;
        pmrem.dispose();
      } catch {
        // Fallback gracefully if PMREM is unavailable
      }
    }, 80);

    // Selective Subtle Bloom (threshold 0.90 so surfaces stay razor-sharp, never fuzzy neon soup)
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.34, 0.5, 0.8);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.22;
    this.controls.minPolarAngle = Math.PI / 7;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 64;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.22;

    // 3-Point Architectural Studio Lighting
    this.ambientLight = new THREE.AmbientLight(0xcbd5e1, 0.42);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x64748b, 0x0b0e16, 0.55);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0x93c5fd, 0.92);
    this.sunLight.position.set(20, 34, -18);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.left = -28;
    this.sunLight.shadow.camera.right = 28;
    this.sunLight.shadow.camera.top = 26;
    this.sunLight.shadow.camera.bottom = -26;
    this.sunLight.shadow.bias = -0.00045;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0xffb547, 0.28);
    this.fillLight.position.set(-22, 16, 24);
    this.scene.add(this.fillLight);

    // Warm Tungsten + Cool Ice-Cyan Architectural Practical Pools
    [
      [-14.0, 5.2, -4.5, 0xffe2b8, 24, 1.45],  // Workfloor crisp neutral-cool task light
      [-0.4, 4.8, -8.4, 0xfde68a, 18, 1.45],  // Approval Desk warm tungsten hospitality glow
      [13.4, 4.8, -8.2, 0xffa89c, 17, 1.15],   // Repair Bay restrained diagnostic accent
      [-14.2, 4.8, 8.9, 0xd4ccff, 18, 1.2],  // War Room cool studio pendant
      [0.2, 5.0, 8.2, 0xfef3c7, 22, 1.55],    // Lounge warm amber architectural glow
      [14.2, 4.8, 8.5, 0xcfc6ba, 18, 1.05],    // Standby Dock calm neutral slate light
      [2.6, 4.0, 15.8, 0xffb547, 16, 1.6],    // Outdoor Sky-Terrace warm hearth glow
    ].forEach(([lx, ly, lz, color, dist, baseMult]) => {
      const lamp = new THREE.PointLight(color, 1.4 * baseMult, dist);
      lamp.position.set(lx, ly, lz);
      lamp.userData.baseMult = baseMult;
      this.scene.add(lamp);
      this.interiorLamps.push(lamp);

      // Soft pool of lamplight on the floor under each practical light
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(dist * 0.62, dist * 0.62),
        new THREE.MeshBasicMaterial({
          map: makeLightPoolTexture(),
          color,
          transparent: true,
          opacity: 0.32 * baseMult,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(lx, 0.16, lz);
      pool.renderOrder = 2;
      pool.userData.baseOpacity = 0.32 * baseMult;
      this.scene.add(pool);
      this.lightPools = this.lightPools || [];
      this.lightPools.push(pool);
    });
  }

  addBox(w, h, d, colorOrMat, x, y, z, opts = {}) {
    const geo = opts.radius
      ? new RoundedBoxGeometry(w, h, d, opts.segments ?? 2, opts.radius)
      : new THREE.BoxGeometry(w, h, d);
    const mat =
      Array.isArray(colorOrMat) || colorOrMat instanceof THREE.Material
        ? colorOrMat
        : new THREE.MeshStandardMaterial({
            color: colorOrMat,
            roughness: opts.roughness ?? 0.36,
            metalness: opts.metalness ?? 0.25,
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

  // Restrained architectural hairline light strip (replaces thick neon tubes)
  addLightLine(w, h, d, hexColor, x, y, z, intensity = 0.95, rotY = 0) {
    return this.addBox(w, h, d, hexColor, x, y, z, {
      emissive: hexColor,
      emissiveIntensity: intensity,
      roughness: 0.2,
      metalness: 0.1,
      castShadow: false,
      receiveShadow: false,
      rotY,
    });
  }

  // Subtle recessed architectural room inlay (only on the two front-facing edges or ultra-thin perimeter)
  addZoneInlay(cx, cz, w, d, hexColor, y = 0.125) {
    const t = 0.036;
    const h = 0.015;
    this.addLightLine(w, h, t, hexColor, cx, y, cz - d / 2, 0.85);
    this.addLightLine(w, h, t, hexColor, cx, y, cz + d / 2, 0.85);
    this.addLightLine(t, h, d, hexColor, cx - w / 2, y, cz, 0.85);
    this.addLightLine(t, h, d, hexColor, cx + w / 2, y, cz, 0.85);
  }

  /* ---------- 1. Atmospheric Obsidian Monolith Skyline (Blade Runner 2049 Mist) ---------- */
  buildSkyAndCity() {
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
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(280, 32, 24), this.skyMat));

    const cityGround = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshBasicMaterial({ map: makeArchitecturalCityGround() })
    );
    cityGround.rotation.x = -Math.PI / 2;
    cityGround.position.y = -95;
    this.scene.add(cityGround);

    // Subtle upper-sky starfield
    const starCount = 260;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * (Math.PI * 0.4);
      const r = 230;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) + 16;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.starsMat = new THREE.PointsMaterial({ color: 0xe2e8f0, size: 0.85, transparent: true, opacity: 0.65, fog: false });
    this.scene.add(new THREE.Points(starGeo, this.starsMat));

    // Penthouse Architectural Tower Shaft (Monolithic dark concrete & brushed gunmetal ribs)
    const shaftH = 94;
    const shaftY = -1.2 - shaftH / 2;
    this.addBox(39.6, shaftH, 27.6, 0x090c14, 0, shaftY, 0.2, { roughness: 0.45, metalness: 0.55, castShadow: false });
    [
      [-20.1, -13.7],
      [20.1, -13.7],
      [-20.1, 14.1],
      [20.1, 14.1],
    ].forEach(([cx, cz]) => {
      this.addBox(2.0, shaftH, 2.0, 0x111622, cx, shaftY, cz, { roughness: 0.35, metalness: 0.65, castShadow: false });
    });
    [-4.5, -14.0, -28.0].forEach((by) => {
      this.addBox(40.8, 0.6, 28.8, 0x141a28, 0, by, 0.2, { castShadow: false, metalness: 0.6, roughness: 0.35 });
    });
    [-4.0, 1.6, 7.2, 12.8, 18.4].forEach((rx) => {
      this.addBox(0.55, 2.2, 4.8, 0x141a26, rx, -1.7, 15.6, { roughness: 0.35, metalness: 0.65, castShadow: false });
    });

    // Restrained Dark Architectural Glass Monoliths (54 sculpted towers instead of 94 loud neon boxes)
    const facadeTextures = [1, 2, 3, 4].map((seed) => makeArchitecturalGlassFacade(seed));
    const roofCapMat = new THREE.MeshStandardMaterial({
      color: 0x05070d,
      roughness: 0.94,
      metalness: 0.05,
      envMapIntensity: 0.08,
    });
    const yBase = -95;
    const towers = [];

    const inForeground = (x, z, dist) => z > 12 && dist < 88;

    // Tier 1: Low-rise urban blocks deep below penthouse
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2 + 0.14;
      const dist = 42 + (i % 3) * 12;
      towers.push({
        x: Math.cos(angle) * dist * 1.24,
        z: Math.sin(angle) * dist * 1.04,
        w: 9 + (i % 3) * 2.5,
        d: 9 + ((i + 1) % 3) * 2.5,
        topY: -42 + (i % 4) * 5,
        tier: 1,
        idx: i,
      });
    }

    // Tier 2: Mid-rise architectural monoliths framing back & sides
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const dist = 64 + (i % 3) * 14;
      const bx = Math.cos(angle) * dist * 1.28;
      const bz = Math.sin(angle) * dist * 1.02;
      if (inForeground(bx, bz, dist)) continue;
      towers.push({
        x: bx,
        z: bz,
        w: 10 + (i % 4) * 2.6,
        d: 10 + ((i + 2) % 4) * 2.6,
        topY: -10 + (i % 5) * 4.8,
        tier: 2,
        idx: i,
      });
    }

    // Tier 3: Tall distant Blade Runner megastructures along rear horizon (dissolved by mist)
    for (let i = 0; i < 14; i++) {
      const frac = i / 13;
      const angle = Math.PI * (0.95 + frac * 1.1);
      const dist = 102 + (i % 3) * 18;
      towers.push({
        x: Math.cos(angle) * dist * 1.32,
        z: Math.sin(angle) * dist * 0.96,
        w: 14 + (i % 4) * 3.5,
        d: 14 + ((i + 1) % 4) * 3.5,
        topY: 16 + (i % 5) * 9,
        tier: 3,
        idx: i,
      });
    }

    // Reusable spire geometry via InstancedMesh for lean draw calls
    const spireMatrices = [];
    const dummy = new THREE.Object3D();

    towers.forEach((t) => {
      const h = Math.max(18, t.topY - yBase);
      const baseTex = facadeTextures[t.idx % facadeTextures.length];
      const sideTex = baseTex.clone();
      sideTex.needsUpdate = true;
      sideTex.repeat.set(Math.max(1, Math.round(t.w / 9)), Math.max(2, Math.round(h / 22)));

      const facadeMat = new THREE.MeshStandardMaterial({
        color: 0x0b0f18,
        map: sideTex,
        emissive: 0xffffff,
        emissiveMap: sideTex,
        emissiveIntensity: t.tier === 3 ? 0.38 : 0.46,
        roughness: 0.34,
        metalness: 0.58,
      });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(t.w, h, t.d),
        [facadeMat, facadeMat, roofCapMat, roofCapMat, facadeMat, facadeMat]
      );
      mesh.position.set(t.x, yBase + h / 2, t.z);
      this.scene.add(mesh);

      // Subtle matte obsidian parapet cap
      this.addBox(t.w - 0.6, 0.5, t.d - 0.6, roofCapMat, t.x, t.topY + 0.25, t.z, {
        castShadow: false,
      });

      if (t.tier >= 2 && t.idx % 2 === 0) {
        this.addBox(t.w * 0.42, 2.0, t.d * 0.42, 0x111622, t.x, t.topY + 1.3, t.z, { castShadow: false });
        dummy.position.set(t.x, t.topY + 4.8, t.z);
        dummy.updateMatrix();
        spireMatrices.push(dummy.matrix.clone());

        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff6b5e })
        );
        beacon.position.set(t.x, t.topY + 7.5, t.z);
        this.scene.add(beacon);
        this.skyBeacons.push(beacon);
      }
    });

    if (spireMatrices.length > 0) {
      const spireInst = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.06, 0.12, 5.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.35 }),
        spireMatrices.length
      );
      spireMatrices.forEach((m, i) => spireInst.setMatrixAt(i, m));
      spireInst.instanceMatrix.needsUpdate = true;
      this.scene.add(spireInst);
    }

    // Restrained distant aerial traffic specks (warm amber & soft white, zero bright pink lasers)
    for (let i = 0; i < 10; i++) {
      const col = i % 2 === 0 ? 0xfde68a : 0xffe2b8;
      const streak = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.1, 0.12),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65 })
      );
      const laneZ = -28 - (i % 5) * 11;
      const laneY = -16 + (i % 4) * 8;
      streak.position.set((Math.random() - 0.5) * 140, laneY, laneZ);
      this.scene.add(streak);
      this.skyTraffic.push({
        mesh: streak,
        speed: (i % 2 === 0 ? 1 : -1) * (0.11 + Math.random() * 0.1),
      });
    }
  }

  /* ---------- Architectural Glass Curtain Walls & Wood Slats ---------- */
  addGlassWall(w, h, d, x, y, z, accentHex = null) {
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      roughness: 0.08,
      metalness: 0.1,
      transmission: 0.0,
      transparent: true,
      opacity: 0.22,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
    });
    this.addBox(w, h, d, glassMat, x, y, z, { castShadow: false, receiveShadow: false });
    // Brushed dark anodized titanium top & base tracks
    this.addBox(w + 0.06, 0.09, d + 0.08, 0x1e2533, x, y + h / 2, z, { castShadow: false, metalness: 0.75, roughness: 0.3 });
    this.addBox(w + 0.06, 0.14, d + 0.08, 0x161c28, x, 0.13, z, { castShadow: false, metalness: 0.7, roughness: 0.35 });

    if (accentHex) {
      this.addLightLine(
        w > d ? w - 0.4 : 0.03,
        0.024,
        d >= w ? d - 0.4 : 0.03,
        accentHex,
        x,
        y + h / 2 + 0.045,
        z,
        0.75
      );
    }

    const count = Math.max(2, Math.round(Math.max(w, d) / 4.2));
    for (let i = 0; i <= count; i++) {
      const frac = i / count - 0.5;
      const px = w > d ? x + frac * w : x;
      const pz = d >= w ? z + frac * d : z;
      this.addBox(0.08, h, 0.08, 0x263042, px, y, pz, { castShadow: false, metalness: 0.72, roughness: 0.32 });
    }
  }

  addWalnutSlatWall(w, h, d, x, y, z) {
    this.addBox(w, h, d, 0x121620, x, y, z, { roughness: 0.55, metalness: 0.2 });
    const isHorizontal = w > d;
    const len = isHorizontal ? w : d;
    const slats = Math.floor(len / 0.55);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x453024, roughness: 0.52, metalness: 0.08 });
    for (let i = 0; i < slats; i++) {
      const offset = -len / 2 + 0.3 + i * 0.55;
      if (isHorizontal) {
        this.addBox(0.14, h - 0.14, 0.07, woodMat, x + offset, y, z + d / 2 + 0.035, { castShadow: false });
      } else {
        this.addBox(0.07, h - 0.14, 0.14, woodMat, x + (x < 0 ? w / 2 + 0.035 : -w / 2 - 0.035), y, z + offset, { castShadow: false });
      }
    }
    // Matte gunmetal top cap (no neon bar!)
    this.addBox(isHorizontal ? w + 0.06 : d + 0.12, 0.08, isHorizontal ? d + 0.12 : w + 0.06, 0x1e2533, x, y + h / 2 + 0.04, z, {
      castShadow: false,
      metalness: 0.72,
      roughness: 0.32,
    });
  }

  addArchitecturalSign(title, subtitle, accentHex, x, y, z, rotY = 0) {
    const tex = makeArchitecturalSignTexture(title, subtitle, accentHex);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.55,
      roughness: 0.25,
    });
    this.addBox(4.3, 1.08, 0.12, 0x0d111a, x, y, z, { rotY, castShadow: false, radius: 0.04 });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 0.94), mat);
    front.position.set(x, y, z);
    front.rotation.y = rotY;
    front.translateZ(0.068);
    this.scene.add(front);
  }

  addFloorStamp(text, x, z, w, h, color) {
    const tex = makeFloorStamp(text, color);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, 0.142, z);
    this.scene.add(plane);
  }

  addArchitecturalPendant(w, x, y, z, hex = 0xfef3c7, rotY = 0) {
    this.addBox(w, 0.07, 0.14, 0x181e2b, x, y, z, { rotY, castShadow: false, metalness: 0.75, roughness: 0.28, radius: 0.02 });
    this.addBox(w - 0.16, 0.032, 0.08, hex, x, y - 0.036, z, {
      rotY,
      emissive: hex,
      emissiveIntensity: 1.35,
      castShadow: false,
    });
  }

  /* ---------- 2. Refined Obsidian Penthouse Command Deck ---------- */
  buildCommandPenthouse() {
    // Structural Penthouse Slab (Matte dark architectural basalt + brushed titanium coping)
    this.addBox(43.4, 1.35, 33.8, 0x100e0d, 0, -0.68, 1.7, {
      castShadow: false,
      roughness: 0.44,
      metalness: 0.42,
    });
    // Crisp brushed gunmetal perimeter coping (replaces thick cyan/purple exterior neon bars)
    this.addBox(43.6, 0.12, 0.22, 0x3a3129, 0, 0.02, -15.2, { castShadow: false, metalness: 0.72, roughness: 0.3 });
    this.addBox(43.6, 0.12, 0.22, 0x3a3129, 0, 0.02, 18.6, { castShadow: false, metalness: 0.72, roughness: 0.3 });

    // Main Honed Obsidian Slate Floor Concourse
    const matConcourse = new THREE.MeshStandardMaterial({
      map: makeObsidianStoneTexture("#1a1713", "rgba(255,214,160,0.05)", 128),
      roughness: 0.3,
      metalness: 0.22,
    });
    this.addBox(41.4, 0.14, 28.4, matConcourse, 0, 0.01, 0, { castShadow: false });

    // Subtle hairline recessed guide strip down central concourse
    this.addLightLine(36.0, 0.014, 0.035, 0x4fd1b5, 0, 0.09, 0.2, 0.65);

    // --- ZONE 1: ACTIVE WORKFLOOR (Honed Dark Slate + Thin Emerald Inlay) ---
    const matWork = new THREE.MeshStandardMaterial({
      map: makeObsidianStoneTexture("#151a17", "rgba(79,209,181,0.06)", 128),
      roughness: 0.26,
      metalness: 0.24,
    });
    this.addBox(13.2, 0.16, 18.2, matWork, -13.8, 0.03, -4.9, { castShadow: false });
    this.addZoneInlay(-13.8, -4.9, 13.0, 18.0, 0x4fd1b5);
    this.addFloorStamp("WORKFLOOR", -14.2, 3.25, 6.8, 1.1, "rgba(148,163,184,0.28)");

    // --- ZONE 2: APPROVAL & WAITING DAIS (Dark Acoustic Weave + Warm Amber Step Light) ---
    const matWaiting = new THREE.MeshStandardMaterial({
      map: makeAcousticWeaveTexture("#191716"),
      roughness: 0.72,
      metalness: 0.06,
    });
    this.addBox(11.6, 0.34, 10.6, matWaiting, -0.4, 0.13, -8.6, { castShadow: false });
    this.addZoneInlay(-0.4, -8.6, 11.4, 10.4, 0xffb547, 0.31);
    this.addBox(4.8, 0.16, 0.85, 0x1f2533, -0.4, 0.08, -2.9, { castShadow: false, radius: 0.03 });
    this.addLightLine(4.6, 0.02, 0.035, 0xffb547, -0.4, 0.17, -2.48, 0.95);
    this.addFloorStamp("APPROVAL DESK", -0.4, -4.4, 6.6, 1.1, "rgba(251,191,36,0.32)");

    // --- ZONE 3: REPAIR BAY (Matte Basalt Concrete + Thin Crimson Inlay) ---
    const matError = new THREE.MeshStandardMaterial({
      map: makeObsidianStoneTexture("#1b1413", "rgba(255,107,94,0.065)", 128),
      roughness: 0.34,
      metalness: 0.22,
    });
    this.addBox(13.8, 0.16, 11.5, matError, 13.5, 0.03, -8.2, { castShadow: false });
    this.addZoneInlay(13.5, -8.2, 13.6, 11.3, 0xff6b5e);
    this.addFloorStamp("REPAIR BAY", 13.5, -3.4, 6.4, 1.1, "rgba(244,63,94,0.30)");

    // --- ZONE 4: WAR ROOM (Charcoal Acoustic Carpet + Soft Indigo-Slate Inlay) ---
    const matWar = new THREE.MeshStandardMaterial({
      map: makeAcousticWeaveTexture("#151624"),
      roughness: 0.74,
      metalness: 0.06,
    });
    this.addBox(13.2, 0.16, 8.9, matWar, -13.8, 0.03, 9.4, { castShadow: false });
    this.addZoneInlay(-13.8, 9.4, 13.0, 8.7, 0x9b8cff);
    this.addFloorStamp("WAR ROOM", -14.2, 13.0, 5.8, 1.1, "rgba(165,180,252,0.28)");

    // --- ZONE 5: ARCHITECTURAL LOUNGE (Smoked Dark Walnut Planks — Warm & Inviting!) ---
    const matWalnut = new THREE.MeshStandardMaterial({
      map: makeSmokedWalnutTexture(),
      roughness: 0.44,
      metalness: 0.1,
    });
    this.addBox(14.8, 0.16, 11.8, matWalnut, 0.4, 0.03, 8.2, { castShadow: false });
    this.addFloorStamp("LOUNGE", 0.4, 13.1, 5.6, 1.1, "rgba(226,232,240,0.22)");

    // --- ZONE 6: STANDBY DOCK (Brushed Obsidian Concrete + Subtle Slate Inlay) ---
    const matStandby = new THREE.MeshStandardMaterial({
      map: makeObsidianStoneTexture("#171615", "rgba(207,198,186,0.05)", 128),
      roughness: 0.3,
      metalness: 0.25,
    });
    this.addBox(11.8, 0.16, 11.6, matStandby, 14.5, 0.03, 8.1, { castShadow: false });
    this.addZoneInlay(14.5, 8.1, 11.6, 11.4, 0x64748b);
    this.addFloorStamp("STANDBY DOCK", 14.5, 13.0, 6.4, 1.1, "rgba(148,163,184,0.24)");

    // --- ZONE 7: OUTDOOR SKY-TERRACE (Smoked Walnut + Smoked Glass Balustrades + Ember Hearth) ---
    this.addBox(26.4, 0.16, 4.4, matWalnut, 7.2, 0.02, 16.2, { castShadow: false });
    this.addGlassWall(26.4, 1.15, 0.08, 7.2, 0.62, 18.3, null);
    this.addGlassWall(0.08, 1.15, 4.4, -5.95, 0.62, 16.2, null);
    this.addGlassWall(0.08, 1.15, 4.4, 20.35, 0.62, 16.2, null);

    // Sculpted Architectural Terrace Planters
    [-4.4, 5.2, 12.8, 18.4].forEach((tx) => this.buildArchitecturalPlanter(tx, 17.1));

    // Low-Profile Designer Outdoor Lounge Chairs + Warm Ember Fire-Table
    [-1.6, 2.2].forEach((cx) => {
      this.addBox(1.35, 0.34, 1.12, 0x222734, cx, 0.26, 16.0, { roughness: 0.68, metalness: 0.05, radius: 0.09 });
      this.addBox(1.35, 0.56, 0.24, 0x2c3242, cx, 0.56, 16.46, { roughness: 0.68, metalness: 0.05, radius: 0.08 });
    });
    // Minimalist Obsidian Ember Hearth Table
    this.addBox(1.5, 0.42, 0.92, 0x161b26, 0.3, 0.25, 16.1, { metalness: 0.35, roughness: 0.38, radius: 0.06 });
    this.addBox(1.0, 0.05, 0.44, 0xffb547, 0.3, 0.47, 16.1, {
      emissive: 0xffb547,
      emissiveIntensity: 1.5,
      castShadow: false,
    });

    // --- PERIMETER PANORAMIC GLASS CURTAIN WALLS ---
    const winH = 3.2;
    this.addGlassWall(41.4, winH, 0.14, 0, winH / 2, -14.1, null);
    this.addGlassWall(0.14, winH, 28.4, -20.5, winH / 2, 0, null);
    this.addGlassWall(0.14, winH, 28.4, 20.5, winH / 2, 0, null);

    // Interior Architectural Dividers (Clean Smoked Glass + Walnut Slats)
    const divH = 2.35;
    this.addGlassWall(0.12, divH, 9.6, -7.0, divH / 2, -9.2, null);
    this.addWalnutSlatWall(11.4, divH, 0.26, -14.6, divH / 2, 4.8);
    this.addGlassWall(0.12, divH, 9.6, 5.7, divH / 2, -9.2, null);
    this.addWalnutSlatWall(11.0, divH, 0.26, 14.8, divH / 2, -2.3);
    this.addGlassWall(0.12, divH, 7.6, -7.0, divH / 2, 10.0, null);
    this.addGlassWall(0.12, divH, 8.2, 8.2, divH / 2, 9.8, null);

    // Perimeter Recessed Architectural Cove Lights (clean sightlines — zero floating rods blocking bots!)
    this.addArchitecturalPendant(5.6, -14.2, 3.25, -13.9, 0xfff1dc);
    this.addArchitecturalPendant(4.2, -0.4, 3.25, -13.9, 0xfef3c7);
    this.addArchitecturalPendant(4.0, 13.6, 3.25, -13.9, 0xffb3a8);
    this.addArchitecturalPendant(3.8, 6.2, 3.1, 6.8, 0xfde68a, Math.PI / 2);

    // --- TELEMETRY COMMAND WALL (Workfloor Back Wall) ---
    this.usageCanvas = document.createElement("canvas");
    this.usageCanvas.width = 512;
    this.usageCanvas.height = 170;
    this.usageTex = new THREE.CanvasTexture(this.usageCanvas);
    this.usageTex.colorSpace = THREE.SRGBColorSpace;
    this.addBox(6.3, 2.02, 0.14, 0x0d111a, -14.2, 2.0, -13.85, { roughness: 0.25, metalness: 0.6, radius: 0.05 });
    const screenMat = new THREE.MeshStandardMaterial({
      map: this.usageTex,
      emissive: 0xffffff,
      emissiveMap: this.usageTex,
      emissiveIntensity: 0.62,
      roughness: 0.18,
    });
    const screenMesh = new THREE.Mesh(new THREE.BoxGeometry(5.96, 1.76, 0.08), screenMat);
    screenMesh.position.set(-14.2, 2.0, -13.76);
    this.scene.add(screenMesh);
    this.updateWallScreen(100, 0);

    // Clean Architectural Room Header Plaques
    this.addArchitecturalSign("APPROVAL DESK", "HUMAN REVIEW QUEUE", "#f59e0b", -0.4, 2.05, -13.8, 0);
    this.addArchitecturalSign("REPAIR BAY", "DIAGNOSTICS & RECOVERY", "#f43f5e", 13.6, 2.05, -13.8, 0);
    this.addArchitecturalSign("STANDBY DOCK", "IDLE > 24H // SLEEP", "#64748b", 20.1, 2.0, 8.2, -Math.PI / 2);

    // --- ROOM 1: SCULPTED WORKFLOOR DESKS (8 Primary Dual-Screen Monoliths) ---
    const deskScreenTex = makeMinimalTelemetryScreen("#4fd1b5", "GROK // ACTIVE");
    this.codeScreenMat = new THREE.MeshStandardMaterial({
      map: deskScreenTex,
      emissive: 0xffffff,
      emissiveMap: deskScreenTex,
      emissiveIntensity: 0.55,
      roughness: 0.16,
    });
    WORKFLOOR_DESKS.slice(0, 8).forEach((d, idx) => this.buildMonolithDesk(d.x, d.z, idx));

    // Subtle telemetry pulse orbs arcing when bots are actively working
    WORKFLOOR_DESKS.slice(0, 6).forEach((d, idx) => {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x4fd1b5 })
      );
      this.scene.add(orb);
      this.dataPackets.push({
        mesh: orb,
        start: new THREE.Vector3(d.x, 1.45, d.z - 0.3),
        end: new THREE.Vector3(-14.2 + (idx - 2.5) * 0.7, 2.0, -13.6),
        t: idx / 6,
        speed: 0.0045 + (idx % 3) * 0.0012,
      });
    });

    // --- ROOM 2: APPROVAL & WAITING DESK (Sculpted Stone Monolith + Warm Cove Lip) ---
    this.addBox(5.4, 1.04, 1.1, 0x1a1f2b, -0.4, 0.84, -10.8, { roughness: 0.32, metalness: 0.45, radius: 0.06 });
    this.addBox(5.65, 0.09, 1.28, 0x2b3242, -0.4, 1.38, -10.8, { roughness: 0.22, metalness: 0.4, radius: 0.03 });
    this.addLightLine(5.1, 0.03, 0.04, 0xffb547, -0.4, 1.3, -10.22, 1.15);

    const waitTex = makeMinimalTelemetryScreen("#f59e0b", "APPROVAL QUEUE");
    this.waitScreenMat = new THREE.MeshStandardMaterial({
      map: waitTex,
      emissive: 0xffffff,
      emissiveMap: waitTex,
      emissiveIntensity: 0.62,
      transparent: true,
      opacity: 0.94,
    });
    this.waitScreenMesh = this.addBox(2.25, 0.84, 0.05, this.waitScreenMat, -0.4, 1.9, -10.72, { castShadow: false, radius: 0.02 });

    // Sculpted Waiting Bench
    this.addBox(3.8, 0.44, 0.88, 0x232936, -0.4, 0.54, -5.2, { roughness: 0.62, metalness: 0.08, radius: 0.08 });

    // --- ROOM 3: REPAIR BAY (Brushed Gunmetal Server Monoliths) ---
    [18.8, 18.8, 18.8].forEach((sx, idx) => {
      const sz = -11.4 + idx * 2.5;
      this.addBox(1.18, 2.56, 1.76, 0x141924, sx, 1.32, sz, { roughness: 0.3, metalness: 0.65, radius: 0.05 });
      for (let r = 0; r < 6; r++) {
        this.addBox(0.05, 0.2, 1.36, 0x1e2534, sx - 0.59, 0.46 + r * 0.34, sz, { castShadow: false });
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.04, 0.14),
          new THREE.MeshBasicMaterial({ color: r % 3 === 0 ? 0xff6b5e : 0x4fd1b5 })
        );
        led.position.set(sx - 0.62, 0.46 + r * 0.34, sz - 0.4 + (r % 3) * 0.24);
        this.scene.add(led);
        this.serverLeds.push(led);
      }
    });
    this.addBox(3.45, 0.92, 1.2, 0x1a202d, 11.8, 0.49, -11.4, { metalness: 0.5, roughness: 0.34, radius: 0.05 });
    const errTex = makeMinimalTelemetryScreen("#f43f5e", "DIAGNOSTICS");
    this.errScreenMat = new THREE.MeshStandardMaterial({
      map: errTex,
      emissive: 0xffffff,
      emissiveMap: errTex,
      emissiveIntensity: 0.62,
    });
    this.errScreenMesh = this.addBox(1.95, 0.82, 0.06, this.errScreenMat, 11.8, 1.42, -11.64, { radius: 0.02 });

    // --- ROOM 4: WAR ROOM (Smoked-Glass Round Table + Minimal Wireframe Holo Sphere) ---
    const confBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.25, 2.25, 0.1, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0x1b2232,
        roughness: 0.1,
        metalness: 0.25,
        clearcoat: 0.95,
        transparent: true,
        opacity: 0.86,
      })
    );
    confBase.position.set(-14.2, 0.92, 8.9);
    confBase.castShadow = true;
    confBase.receiveShadow = true;
    this.scene.add(confBase);

    const tableRim = new THREE.Mesh(
      new THREE.TorusGeometry(2.25, 0.025, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85, roughness: 0.2 })
    );
    tableRim.rotation.x = Math.PI / 2;
    tableRim.position.set(-14.2, 0.93, 8.9);
    this.scene.add(tableRim);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.62, 0.86, 24),
      new THREE.MeshStandardMaterial({ color: 0x161b26, metalness: 0.7, roughness: 0.3 })
    );
    pedestal.position.set(-14.2, 0.45, 8.9);
    this.scene.add(pedestal);

    // Refined Minimalist Holo Sphere (Cyan + Ivory hairline rings)
    this.holoGroup = new THREE.Group();
    this.holoGroup.position.set(-14.2, 1.72, 8.9);
    const globe = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.52, 1),
      new THREE.MeshBasicMaterial({ color: 0x4fd1b5, wireframe: true, transparent: true, opacity: 0.55 })
    );
    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.015, 10, 48),
      new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.45 })
    );
    ring1.rotation.x = Math.PI / 2.2;
    this.holoGroup.add(globe, ring1);
    this.scene.add(this.holoGroup);

    WAR_ROOM_SPOTS.slice(0, 4).forEach((s) => this.buildSculptedChair(s.x, s.z, 0x2a3142));

    // --- ROOM 5: ARCHITECTURAL LOUNGE (Warm Minimalist Sectionals + Brushed Steel Espresso Bar) ---
    this.buildLoungeCluster(-1.8, 6.2, 0x1d222e, 0x282f3e, 0xd98a2b);
    this.buildLoungeCluster(-1.8, 10.6, 0x1d222e, 0x262c3a, 0x94a3b8);

    // Brushed Steel & Dark Stone Espresso Bar (Zero bright orange/cyan neon strips!)
    this.addBox(1.28, 1.04, 4.9, 0x181d28, 6.2, 0.56, 6.8, { roughness: 0.36, metalness: 0.48, radius: 0.05 });
    this.addBox(1.44, 0.09, 5.06, 0x333c4e, 6.2, 1.09, 6.8, { roughness: 0.22, metalness: 0.42, radius: 0.03 });
    this.addLightLine(0.03, 0.03, 4.6, 0xfde68a, 5.56, 1.01, 6.8, 0.9);

    // Brushed Chrome Espresso Machine
    this.addBox(0.68, 0.64, 0.92, 0x475569, 6.2, 1.44, 5.4, { metalness: 0.85, roughness: 0.18, radius: 0.05 });

    // Subtle Rising Espresso Steam
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.22 })
      );
      puff.position.set(6.15 + (i % 3) * 0.07, 1.78 + i * 0.16, 5.4);
      this.scene.add(puff);
      this.steamPuffs.push({ mesh: puff, offset: i * 0.5 });
    }

    // Minimalist Bar Stools (Warm Cognac Leather + Brushed Steel)
    [5.2, 6.6, 8.0].forEach((sz) => {
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.28, 0.1, 20),
        new THREE.MeshStandardMaterial({ color: 0x854d27, roughness: 0.52, metalness: 0.08 })
      );
      seat.position.set(4.85, 0.74, sz);
      seat.castShadow = true;
      this.scene.add(seat);
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.7, 12),
        new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.25 })
      );
      leg.position.set(4.85, 0.36, sz);
      this.scene.add(leg);
    });

    // --- ROOM 6: STANDBY DOCK (Sculpted Matte-Gunmetal Inductive Pads) ---
    STANDBY_PADS.slice(0, 6).forEach((pad) => {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.02, 1.14, 0.13, 32),
        new THREE.MeshStandardMaterial({ color: 0x171c28, roughness: 0.32, metalness: 0.65 })
      );
      base.position.set(pad.x, 0.11, pad.z);
      base.receiveShadow = true;
      this.scene.add(base);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 0.87, 32),
        new THREE.MeshBasicMaterial({ color: 0x4fd1b5, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pad.x, 0.185, pad.z);
      this.scene.add(ring);
      this.standbyRings.push(ring);
    });

    // Sculpted Architectural Botanical Planters
    [
      [-5.6, -12.6],
      [4.6, -12.6],
      [-5.6, 3.2],
      [7.1, 3.2],
      [-19.4, 5.8],
      [-8.2, 12.6],
    ].forEach(([px, pz]) => this.buildArchitecturalPlanter(px, pz));
  }

  buildMonolithDesk(x, z) {
    // Sleek Rounded Dark Anodized Aluminum Desk (Zero RGB strips!)
    this.addBox(2.9, 0.09, 1.32, 0x1b212e, x, 0.91, z, { roughness: 0.32, metalness: 0.48, radius: 0.03 });
    this.addBox(0.09, 0.86, 1.12, 0x262e3f, x - 1.28, 0.45, z, { metalness: 0.68, roughness: 0.32, radius: 0.02 });
    this.addBox(0.09, 0.86, 1.12, 0x262e3f, x + 1.28, 0.45, z, { metalness: 0.68, roughness: 0.32, radius: 0.02 });

    // Dual Minimalist Curved Matte Monitors
    [-0.58, 0.58].forEach((ox, mIdx) => {
      const rot = mIdx === 0 ? 0.18 : -0.18;
      this.addBox(1.06, 0.62, 0.05, 0x0d111a, x + ox, 1.4, z - 0.34, { rotY: rot, radius: 0.02 });
      this.addBox(0.98, 0.54, 0.03, this.codeScreenMat, x + ox, 1.4, z - 0.31, { rotY: rot, castShadow: false });
      this.addBox(0.07, 0.28, 0.07, 0x334155, x + ox, 1.07, z - 0.36, { metalness: 0.75 });
    });

    // Minimalist Matte Keyboard
    this.addBox(0.82, 0.024, 0.24, 0x111622, x - 0.06, 0.97, z + 0.14, { castShadow: false, radius: 0.008 });
    this.buildSculptedChair(x, z + 0.94, 0x242b3a);
  }

  buildSculptedChair(x, z, accent = 0x242b3a) {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.25 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.04, 18), steelMat);
    base.position.set(x, 0.06, z);
    this.scene.add(base);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 12), steelMat);
    stem.position.set(x, 0.24, z);
    this.scene.add(stem);
    this.addBox(0.7, 0.12, 0.64, 0x1b202c, x, 0.44, z, { roughness: 0.55, radius: 0.045 });
    this.addBox(0.64, 0.76, 0.12, accent, x, 0.85, z + 0.28, { roughness: 0.52, radius: 0.05 });
  }

  buildLoungeCluster(x, z, rugHex, sofaHex, cushionHex) {
    // Soft woven area rug (NO neon borders!)
    this.addBox(5.6, 0.035, 3.55, rugHex, x, 0.12, z, { castShadow: false, roughness: 0.9, metalness: 0.02, radius: 0.015 });

    // Sculpted Low-Profile Designer Sectional Sofa
    this.addBox(3.55, 0.42, 1.16, sofaHex, x, 0.34, z - 1.05, { roughness: 0.72, metalness: 0.04, radius: 0.1 });
    this.addBox(3.55, 0.62, 0.28, sofaHex, x, 0.73, z - 1.5, { roughness: 0.72, metalness: 0.04, radius: 0.09 });
    [-1.66, 1.66].forEach((ax) => {
      this.addBox(0.26, 0.56, 1.14, sofaHex, x + ax, 0.56, z - 1.05, { roughness: 0.72, radius: 0.08 });
    });

    // Subtle Accent Throw Cushions (Matte fabric, zero emissive glow)
    [-1.08, 1.08].forEach((px) => {
      this.addBox(0.46, 0.36, 0.16, cushionHex, x + px, 0.7, z - 1.24, {
        rotY: px < 0 ? 0.2 : -0.2,
        roughness: 0.82,
        metalness: 0.02,
        radius: 0.06,
      });
    });

    // Smoked-Glass & Brushed-Bronze Coffee Table
    const glassTop = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      roughness: 0.08,
      metalness: 0.15,
      clearcoat: 0.95,
      transparent: true,
      opacity: 0.65,
    });
    this.addBox(2.0, 0.06, 0.98, glassTop, x, 0.46, z + 0.28, { radius: 0.02 });
    [
      [-0.8, -0.08],
      [0.8, -0.08],
      [-0.8, 0.64],
      [0.8, 0.64],
    ].forEach(([ox, oz]) => {
      this.addBox(0.06, 0.4, 0.06, 0x475569, x + ox, 0.23, z + oz, { metalness: 0.8, roughness: 0.25 });
    });
  }

  // Real Sculpted Architectural Foliage (Tapered Ceramic Planter + Layered Botanical Fronds)
  buildArchitecturalPlanter(x, z) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.36, 0.66, 20),
      new THREE.MeshStandardMaterial({ color: 0x1c212d, roughness: 0.58, metalness: 0.18 })
    );
    pot.position.set(x, 0.35, z);
    pot.castShadow = true;
    pot.receiveShadow = true;
    this.scene.add(pot);

    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x1b1512, roughness: 0.95 })
    );
    soil.position.set(x, 0.67, z);
    this.scene.add(soil);

    const leafPalette = [0x1f4e3d, 0x29634d, 0x357a5e];
    const frondGeo = new THREE.SphereGeometry(0.32, 10, 8);
    frondGeo.scale(0.38, 1.55, 0.14);

    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2 + (i % 2) * 0.2;
      const tier = i % 3;
      const leafMat = new THREE.MeshStandardMaterial({
        color: leafPalette[tier],
        roughness: 0.55,
        metalness: 0.05,
      });
      const frond = new THREE.Mesh(frondGeo, leafMat);
      const tilt = 0.26 + tier * 0.24;
      const hOff = 0.95 + (2 - tier) * 0.22;
      frond.position.set(x + Math.cos(ang) * (0.14 + tier * 0.08), hOff, z + Math.sin(ang) * (0.14 + tier * 0.08));
      frond.rotation.y = -ang + Math.PI / 2;
      frond.rotation.x = tilt;
      frond.castShadow = true;
      this.scene.add(frond);
    }
  }

  buildOfficeCat() {
    const cat = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0xc27834, roughness: 0.7 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.4, 8, 12), furMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.27;
    body.castShadow = true;
    cat.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 14), furMat);
    head.position.set(0, 0.41, 0.33);
    head.castShadow = true;
    cat.add(head);

    [-0.095, 0.095].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.13, 6), furMat);
      ear.position.set(ex, 0.58, 0.33);
      cat.add(ear);
    });

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), whiteMat);
    chest.position.set(0, 0.27, 0.21);
    cat.add(chest);

    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.34, 6, 10), furMat);
    tail.position.set(0, 0.4, -0.33);
    tail.rotation.x = -0.65;
    cat.add(tail);

    cat.position.set(1.2, 0.1, 1.0);
    this.scene.add(cat);
    this.cat = { group: cat, tail, target: new THREE.Vector3(2.8, 0.1, 4.2), nextMoveAt: 2000 };
  }

  /* ---------- 3. Live Telemetry Wall Screen ---------- */
  updateWallScreen(remainingPct, activeCount, waitingCount = 0, errorCount = 0) {
    const c = this.usageCanvas;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#080b12";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0, 0, c.width, 40);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 15px Inter, sans-serif";
    ctx.fillText("GROK BOT HQ  //  LIVE TELEMETRY", 22, 26);

    ctx.fillStyle = remainingPct > 25 ? "#f8fafc" : "#fb7185";
    ctx.font = "700 54px Inter, sans-serif";
    ctx.fillText(`${remainingPct}%`, 22, 102);

    ctx.fillStyle = "#10b981";
    ctx.font = "700 20px Inter, sans-serif";
    ctx.fillText(`${activeCount} ACTIVE`, 230, 78);

    ctx.fillStyle = waitingCount > 0 ? "#fbbf24" : "#64748b";
    ctx.font = "600 16px Inter, sans-serif";
    ctx.fillText(`${waitingCount} WAITING`, 230, 104);

    ctx.fillStyle = errorCount > 0 ? "#f43f5e" : "#64748b";
    ctx.fillText(`${errorCount} ALERTS`, 365, 104);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(22, 128, 468, 14);
    ctx.fillStyle = remainingPct > 25 ? "#4fd1b5" : "#f43f5e";
    ctx.fillRect(22, 128, Math.max(8, (468 * remainingPct) / 100), 14);
    this.usageTex.needsUpdate = true;
  }

  /* ---------- 4. Glossy Designer-Toy 3D Grok Bot Characters ---------- */
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

    // Glossy Vinyl Designer-Toy Clearcoat Material (gleams under RoomEnvironment IBL!)
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: primaryColor,
      roughness: 0.22,
      metalness: 0.06,
      clearcoat: 0.88,
      clearcoatRoughness: 0.12,
      emissive: primaryColor,
      emissiveIntensity: 0.05,
    });

    const rig = new THREE.Group();
    group.add(rig);

    const { bodyGroup, hitMeshes, eyeY, eyeZ, eyeSpread } = this.buildGrokBodyMesh(bodyMat, bot.id);
    rig.add(bodyGroup);

    // Expressive Glossy Eyes with Smooth Curved Eyelids
    const faceGroup = new THREE.Group();
    faceGroup.position.set(0, eyeY, eyeZ);
    rig.add(faceGroup);

    const whiteMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, clearcoat: 0.9 });
    const pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x07090e, roughness: 0.08, clearcoat: 1.0 });
    const catchMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lidMat = new THREE.MeshPhysicalMaterial({ color: primaryColor, roughness: 0.26, clearcoat: 0.7 });

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

      // Smooth rounded capsule eyelids instead of flat boxes
      const upperLid = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.48), lidMat);
      upperLid.scale.set(0.95, 1.15, 0.55);
      upperLid.position.set(0, 0.04, 0.02);
      upperLid.visible = false;
      eyeWrap.add(upperLid);

      const lowerLid = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 10, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.44), lidMat);
      lowerLid.scale.set(0.95, 1.1, 0.55);
      lowerLid.position.set(0, -0.05, 0.02);
      lowerLid.visible = false;
      eyeWrap.add(lowerLid);

      return { eyeWrap, pupilGroup, upperLid, lowerLid };
    };

    const leftEye = makeEye(-1);
    const rightEye = makeEye(1);
    faceGroup.add(leftEye.eyeWrap, rightEye.eyeWrap);

    // Grounded Soft Contact Shadow Disc (plants every bot physically on the floor)
    const shadowDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(1.65, 1.65),
      new THREE.MeshBasicMaterial({ map: this.contactShadowTex, transparent: true, depthWrite: false, opacity: 0.78 })
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.09;
    group.add(shadowDisc);

    // Razor-Thin Floor Status Ring
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.62, 32),
      new THREE.MeshBasicMaterial({
        color: STATUS_HEX[bot.status] || "#10b981",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.135;
    group.add(halo);

    const orbitRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.84, 0.02, 8, 36),
      new THREE.MeshBasicMaterial({ color: primaryColor, transparent: true, opacity: 0.65 })
    );
    orbitRing.position.y = 0.88;
    orbitRing.rotation.x = Math.PI / 2.6;
    orbitRing.visible = bot.status === "working";
    group.add(orbitRing);

    const thinkGroup = new THREE.Group();
    thinkGroup.position.set(0, 1.88, 0);
    const thinkDots = [-0.2, 0, 0.2].map((dx) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }));
      dot.position.x = dx;
      thinkGroup.add(dot);
      return dot;
    });
    thinkGroup.visible = bot.status === "working" || bot.status === "meeting";
    group.add(thinkGroup);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffb547, emissive: 0xffb547, emissiveIntensity: 1.5, roughness: 0.2 })
    );
    beacon.position.set(0.45, 1.8, 0.18);
    beacon.visible = bot.status === "waiting" || bot.status === "error";
    group.add(beacon);

    this.scene.add(group);

    // Compact Frosted Nameplate (Name-only at overview zoom; expands Role on hover/select/close zoom)
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
      slotIdx: 0,
      nextRoamAt: performance.now() + 8000 + Math.random() * 8000,
      nextBlinkAt: performance.now() + 1400 + Math.random() * 3800,
      lookOffsetX: 0,
      lookOffsetY: 0,
      nextLookAt: performance.now() + 1500 + Math.random() * 2500,
    };
  }

  getRoomSpotForBot(bot, stateIndex) {
    // Helper adds deterministic radial offset ONLY if bots ever exceed the 16+ preset spots (strict zero-overlap!)
    const resolveSpot = (arr, y, baseRotY = 0, deskOffsetZ = 0) => {
      const base = arr[stateIndex % arr.length];
      const overflowTier = Math.floor(stateIndex / arr.length);
      let ox = 0;
      let oz = 0;
      if (overflowTier > 0) {
        const ang = (stateIndex * 2.39996) % (Math.PI * 2);
        const rad = 1.45 * overflowTier;
        ox = Math.cos(ang) * rad;
        oz = Math.sin(ang) * rad;
      }
      return { pos: new THREE.Vector3(base.x + ox, y, base.z + deskOffsetZ + oz), rotY: baseRotY };
    };

    if (bot.status === "waiting") return resolveSpot(WAITING_SPOTS, 0.28, 0);
    if (bot.status === "error") return resolveSpot(ERROR_BAY_SPOTS, 0.04, 0);
    if (bot.status === "meeting") {
      const res = resolveSpot(WAR_ROOM_SPOTS, 0.04, 0);
      res.rotY = Math.atan2(-14.2 - res.pos.x, 8.9 - res.pos.z);
      return res;
    }
    if (bot.status === "idle") return resolveSpot(LOUNGE_SPOTS, 0.04, 0);
    if (bot.status === "no_report") return resolveSpot(STANDBY_PADS, 0.14, 0);
    return resolveSpot(WORKFLOOR_DESKS, 0.04, Math.PI * 0.82, stateIndex < 8 ? 0.94 : 0);
  }

  buildHallwayPath(fromPos, toPos, fromZone, toZone) {
    if (fromZone === toZone) return [toPos.clone()];
    return [new THREE.Vector3(fromPos.x, 0.04, 0.2), new THREE.Vector3(toPos.x, 0.04, 0.2), toPos.clone()];
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
        entry.slotIdx = slotIdx;
        this.botMeshes.set(bot.id, entry);
      } else {
        entry.slotIdx = slotIdx;
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

      // Expressive smooth eyelids
      const showUpper = bot.status === "error" || bot.status === "idle" || bot.status === "no_report";
      const showLower = bot.status === "meeting" || bot.status === "idle" || bot.status === "no_report";
      entry.leftEye.upperLid.visible = showUpper;
      entry.rightEye.upperLid.visible = showUpper;
      entry.leftEye.lowerLid.visible = showLower;
      entry.rightEye.lowerLid.visible = showLower;
      if (bot.status === "error") {
        entry.leftEye.upperLid.rotation.z = -0.32;
        entry.rightEye.upperLid.rotation.z = 0.32;
      } else {
        entry.leftEye.upperLid.rotation.z = 0;
        entry.rightEye.upperLid.rotation.z = 0;
      }

      const labelEl = this.labelEls.get(bot.id);
      if (labelEl) {
        labelEl.querySelector(".lbl-name").textContent = bot.name;
        const roleEl = labelEl.querySelector(".lbl-role");
        if (roleEl) roleEl.textContent = bot.role || "Grok Bot";
        const dot = labelEl.querySelector(".lbl-dot");
        dot.style.background = bot.status === "no_report" ? "transparent" : hex;
        dot.style.border = bot.status === "no_report" ? `1.5px solid ${hex}` : "none";
        labelEl.dataset.status = bot.status;
        labelEl.classList.toggle("selected", this.selectedBotId === bot.id);
        labelEl.classList.toggle("urgent", bot.status === "waiting" || bot.status === "error");
      }
    });

    this.roomCounts = slotCounters;
    const activeCount = (slotCounters.working || 0) + (slotCounters.meeting || 0);
    this.updateWallScreen(usageSummary?.usageRemainingPct ?? 100, activeCount, slotCounters.waiting || 0, slotCounters.error || 0);

    for (const [id, entry] of this.botMeshes.entries()) {
      if (!seenIds.has(id)) {
        this.scene.remove(entry.group);
        this.disposeBotGroup(entry.group);
        this.botMeshes.delete(id);
        const lbl = this.labelEls.get(id);
        if (lbl) lbl.remove();
        this.labelEls.delete(id);
      }
    }
  }

  disposeBotGroup(group) {
    const disposedMats = new Set();
    group.traverse((child) => {
      if (child.geometry && typeof child.geometry.dispose === "function") {
        child.geometry.dispose();
      }
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (mat && !disposedMats.has(mat) && typeof mat.dispose === "function") {
            disposedMats.add(mat);
            mat.dispose();
          }
        });
      }
    });
  }

  focusRoom(roomKey) {
    const preset = ROOM_CAMERA_TARGETS[roomKey] || ROOM_CAMERA_TARGETS.all;
    this.camLerpTarget = {
      pos: new THREE.Vector3(...preset.pos),
      target: new THREE.Vector3(...preset.target),
      frames: 42,
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
    this.scene.fog.density = p.fogDensity;
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
    this.scene.environmentIntensity = p.envInt;
    this.interiorLamps.forEach((l) => (l.intensity = p.lampInt * (l.userData.baseMult || 1)));
    (this.lightPools || []).forEach((m) => (m.material.opacity = m.userData.baseOpacity * Math.min(1.2, p.lampInt / 1.6)));
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
      this.controls.autoRotate = !this.prefersReducedMotion();
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
      if (this.hoveredBotId) this.selectBot(this.hoveredBotId);
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
    for (const entry of this.botMeshes.values()) meshes.push(...entry.hitMeshes);
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
          `<div class="tt-head"><strong>${esc(bot.name)}</strong><span class="tt-pill st-${esc(bot.status)}">${esc(roomLabel(bot.status))}</span></div>` +
          `<div class="tt-role">${esc(bot.role || "Grok Bot")}</div>` +
          `<div class="tt-task">${esc(bot.task || "Standing by")}</div>`;
        return;
      }
    }
    this.hoveredBotId = null;
    this.renderer.domElement.style.cursor = "grab";
    this.tooltip.classList.add("hidden");
  }

  prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  animate() {
    if (this.isPaused || document.hidden) return;
    const elapsed = this.clock.getElapsedTime();
    const now = performance.now();
    const reduceMotion = this.prefersReducedMotion();
    if (reduceMotion) this.controls.autoRotate = false;

    const w = this.container.clientWidth || 960;
    const h = this.container.clientHeight || 600;
    const proj = new THREE.Vector3();

    if (this.camLerpTarget) {
      this.camera.position.lerp(this.camLerpTarget.pos, 0.085);
      this.controls.target.lerp(this.camLerpTarget.target, 0.085);
      this.camLerpTarget.frames--;
      if (this.camLerpTarget.frames <= 0) this.camLerpTarget = null;
    }

    if (this.holoGroup && !reduceMotion) {
      const boost = (this.roomCounts.meeting || 0) > 0 ? 1.4 : 0.45;
      this.holoGroup.rotation.y = elapsed * boost;
      this.holoGroup.position.y = 1.72 + Math.sin(elapsed * 2.0) * 0.07;
    }

    if (this.waitScreenMat) {
      const hasWait = (this.roomCounts.waiting || 0) > 0;
      this.waitScreenMat.emissiveIntensity = hasWait ? 0.8 + Math.sin(elapsed * 4.0) * 0.25 : 0.55;
    }
    if (this.errScreenMat) {
      const hasErr = (this.roomCounts.error || 0) > 0;
      this.errScreenMat.emissiveIntensity = hasErr ? 0.85 + Math.sin(elapsed * 6.0) * 0.3 : 0.55;
    }

    if (!reduceMotion) {
      this.serverLeds.forEach((led, i) => {
        led.visible = Math.sin(elapsed * 4.5 + i * 1.6) > -0.35;
      });
      this.skyBeacons.forEach((b, i) => {
        b.visible = Math.sin(elapsed * 2.1 + i) > 0.1;
      });
    }
    this.standbyRings.forEach((r, i) => {
      r.material.opacity = 0.25 + (Math.sin(elapsed * 1.8 + i) + 1) * 0.15;
    });

    if (!reduceMotion) {
      this.skyTraffic.forEach((t) => {
        t.mesh.position.x += t.speed;
        if (t.mesh.position.x > 75) t.mesh.position.x = -75;
        if (t.mesh.position.x < -75) t.mesh.position.x = 75;
      });

      this.steamPuffs.forEach((s) => {
        const cycle = ((elapsed * 0.55 + s.offset) % 1.8) / 1.8;
        s.mesh.position.y = 1.75 + cycle * 1.25;
        s.mesh.scale.setScalar(0.55 + cycle * 0.8);
        s.mesh.material.opacity = (1 - cycle) * 0.22;
      });
    }

    const workCount = this.roomCounts.working || 0;
    const speedMult = 1 + Math.min(workCount, 6) * 0.15;
    this.dataPackets.forEach((p, idx) => {
      p.mesh.visible = workCount > 0 && idx < Math.max(2, workCount + 1);
      if (!p.mesh.visible) return;
      p.t = (p.t + p.speed * speedMult) % 1;
      p.mesh.position.lerpVectors(p.start, p.end, p.t);
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 2.0;
    });

    if (this.cat && !reduceMotion) {
      if (now > this.cat.nextMoveAt) {
        const spots = [[0.5, 0.4], [3.2, 5.2], [-2.6, 3.8], [1.6, 8.2], [0.8, 15.2], [6.8, 0.4]];
        const pick = spots[Math.floor(Math.random() * spots.length)];
        this.cat.target.set(pick[0], 0.1, pick[1]);
        this.cat.nextMoveAt = now + 5500 + Math.random() * 5500;
      }
      const cp = this.cat.group.position;
      const cdx = this.cat.target.x - cp.x;
      const cdz = this.cat.target.z - cp.z;
      const cdist = Math.hypot(cdx, cdz);
      if (cdist > 0.06) {
        cp.x += (cdx / cdist) * 0.028;
        cp.z += (cdz / cdist) * 0.028;
        this.cat.group.rotation.y = Math.atan2(cdx, cdz);
      }
      this.cat.tail.rotation.z = Math.sin(elapsed * 5.0) * 0.32;
    }

    const camDist = this.camera.position.distanceTo(this.controls.target);
    const isCloseZoom = camDist < 24;
    const projectedLabels = [];

    this.bots.forEach((bot, idx) => {
      const entry = this.botMeshes.get(bot.id);
      if (!entry) return;

      const pos = entry.group.position;
      if (reduceMotion && entry.waypoints.length > 0) {
        const wp = entry.waypoints[entry.waypoints.length - 1];
        pos.set(wp.x, wp.y, wp.z);
        entry.waypoints.length = 0;
        entry.group.rotation.y = entry.targetRotY;
        entry.rig.position.y = 0;
        entry.rig.scale.set(1, 1, 1);
        entry.rig.rotation.set(0, 0, 0);
      } else if (entry.waypoints.length > 0) {
        const wp = entry.waypoints[0];
        const dx = wp.x - pos.x;
        const dz = wp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.12) {
          pos.set(wp.x, wp.y, wp.z);
          entry.waypoints.shift();
        } else {
          const step = Math.min(dist, 0.115);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          pos.y += (wp.y - pos.y) * 0.12;
          entry.group.rotation.y = Math.atan2(dx, dz);
          const hop = Math.abs(Math.sin(elapsed * 9.0 + idx));
          entry.rig.position.y = hop * 0.36;
          entry.rig.scale.set(1.06 - hop * 0.11, 0.9 + hop * 0.18, 1.06 - hop * 0.11);
          entry.rig.rotation.z = Math.sin(elapsed * 9.0 + idx) * 0.07;
        }
      } else {
        if (!(reduceMotion && bot.status === "idle")) {
          entry.group.rotation.y += (entry.targetRotY - entry.group.rotation.y) * 0.08;
        }
        if (bot.status === "working") {
          const breath = Math.sin(elapsed * 3.4 + idx);
          entry.rig.position.y = 0.05 + breath * 0.05;
          entry.rig.scale.set(1 - breath * 0.025, 1 + breath * 0.035, 1 - breath * 0.025);
          entry.rig.rotation.set(0, 0, Math.sin(elapsed * 1.8 + idx) * 0.035);
          entry.orbitRing.rotation.z = elapsed * 1.6 + idx;
          entry.orbitRing.rotation.y = elapsed * 0.7;
        } else if (bot.status === "waiting") {
          const bounce = Math.abs(Math.sin(elapsed * 4.8 + idx));
          entry.rig.position.y = bounce * 0.24;
          entry.rig.scale.set(1.05 - bounce * 0.08, 0.93 + bounce * 0.12, 1.05 - bounce * 0.08);
          entry.rig.rotation.set(0, 0, 0);
        } else if (bot.status === "error") {
          entry.rig.position.y = 0.04;
          entry.rig.scale.set(1.03, 0.97, 1.03);
          entry.rig.rotation.set(0, 0, Math.sin(elapsed * 16) * 0.1);
        } else if (bot.status === "meeting") {
          const bob = Math.sin(elapsed * 4.2 + idx);
          entry.rig.position.y = Math.max(0, bob) * 0.14;
          entry.rig.scale.set(1.02, 0.98 + Math.max(0, bob) * 0.05, 1.02);
          entry.rig.rotation.set(0, 0, bob * 0.05);
        } else if (bot.status === "no_report") {
          const snore = Math.sin(elapsed * 1.2 + idx);
          entry.rig.position.y = 0;
          entry.rig.scale.set(1.04 + snore * 0.02, 0.9 - snore * 0.02, 1.04);
          entry.rig.rotation.set(0.12, 0, 0.06);
        } else if (!reduceMotion) {
          const chill = Math.sin(elapsed * 2.0 + idx);
          entry.rig.position.y = 0.06 + chill * 0.05;
          entry.rig.scale.set(1, 1 + chill * 0.02, 1);
          entry.rig.rotation.set(0, 0, chill * 0.035);
        } else {
          entry.rig.position.y = 0;
          entry.rig.scale.set(1, 1, 1);
          entry.rig.rotation.set(0, 0, 0);
        }
      }

      if (bot.status !== "no_report" && !(reduceMotion && bot.status === "idle")) {
        if (now > entry.nextLookAt) {
          entry.lookOffsetX = (Math.random() - 0.5) * 0.065;
          entry.lookOffsetY = (Math.random() - 0.5) * 0.045;
          entry.nextLookAt = now + 2000 + Math.random() * 2800;
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
            entry.nextBlinkAt = now + 2400 + Math.random() * 4200;
          }
        }
      }

      if (entry.thinkGroup.visible) {
        entry.thinkGroup.lookAt(this.camera.position);
        entry.thinkDots.forEach((d, di) => {
          d.position.y = Math.sin(elapsed * 5.5 - di * 0.7) * 0.06;
        });
      }
      if (entry.beacon.visible) {
        entry.beacon.position.y = 1.78 + Math.sin(elapsed * 5.0) * 0.1;
      }

      const lbl = this.labelEls.get(bot.id);
      if (lbl) {
        const isFocus = this.selectedBotId === bot.id || this.hoveredBotId === bot.id;
        const show = this.showAllLabels || isFocus || bot.status === "waiting" || bot.status === "error";
        lbl.classList.toggle("compact", !isCloseZoom && !isFocus);
        proj.set(pos.x, pos.y + 2.08, pos.z);
        proj.project(this.camera);
        if (show && proj.z < 1) {
          projectedLabels.push({
            lbl,
            sx: (proj.x * 0.5 + 0.5) * w,
            sy: (-proj.y * 0.5 + 0.5) * h,
            priority: isFocus ? 2 : bot.status === "waiting" || bot.status === "error" ? 1 : 0,
          });
        } else {
          lbl.style.opacity = "0";
          lbl.style.pointerEvents = "none";
        }
      }
    });

    // Lightweight 2D Screen-Space Label Declustering Pass (Prevents unreadable Lounge pileups!)
    projectedLabels.sort((a, b) => a.sy - b.sy);
    for (let i = 0; i < projectedLabels.length; i++) {
      for (let j = 0; j < i; j++) {
        const cur = projectedLabels[i];
        const prev = projectedLabels[j];
        const dx = Math.abs(cur.sx - prev.sx);
        const dy = cur.sy - prev.sy;
        const minW = 94;
        const minH = 26;
        if (dx < minW && Math.abs(dy) < minH) {
          cur.sy = prev.sy + minH;
        }
      }
    }
    projectedLabels.forEach(({ lbl, sx, sy }) => {
      const clampedX = Math.max(76, Math.min(w - 76, sx));
      const clampedY = Math.max(72, Math.min(h - 78, sy));
      lbl.style.transform = `translate(-50%, -100%) translate(${clampedX.toFixed(1)}px, ${clampedY.toFixed(1)}px)`;
      lbl.style.opacity = "1";
      lbl.style.pointerEvents = "auto";
    });

    this.controls.update();
    this.composer.render();
    this.scheduleNextFrame();
  }
}

window.Office3D = Office3D;
