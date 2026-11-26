/**
 * Grok Bot HQ: 2D pixel-art office (top-down, handheld-RPG style).
 * Original procedural art, drawn with canvas rectangles. No external images.
 *
 * Same public API the dashboard used for the 3D office:
 *   new Office2D(container, labelLayer, tooltipEl, onSelectBot)
 *   updateBots(bots, usage) · setPaused(b) · handleResize() · focusRoom(key) · resetView()
 *   selectBot(id) · setLighting(mode) · setCameraMode(mode) · showAllLabels (get/set)
 */

const T = 16; // tile size in art pixels
const MAP_W = 38;
const MAP_H = 24;
const W = MAP_W * T;
const H = MAP_H * T;

const INK = "#1d1a22";

// ---------------------------------------------------------------- layout
const ROOMS = {
  working: { name: "WORK FLOOR", x0: 1, y0: 1, x1: 13, y1: 9, floor: "wood" },
  waiting: { name: "APPROVALS", x0: 15, y0: 1, x1: 23, y1: 9, floor: "checker" },
  error: { name: "REPAIR BAY", x0: 25, y0: 1, x1: 36, y1: 9, floor: "grate" },
  meeting: { name: "WAR ROOM", x0: 1, y0: 14, x1: 11, y1: 22, floor: "blue" },
  idle: { name: "LOUNGE", x0: 13, y0: 14, x1: 24, y1: 22, floor: "red" },
  no_report: { name: "STANDBY", x0: 26, y0: 14, x1: 36, y1: 22, floor: "mint" },
};
const CORRIDOR = { x0: 1, y0: 11, x1: 36, y1: 12 };
const DOORS = [
  [6, 10], [7, 10], [19, 10], [20, 10], [30, 10], [31, 10],
  [5, 13], [6, 13], [18, 13], [19, 13], [30, 13], [31, 13],
];
const SIGNS = [
  ["working", 7, 10, "top"], ["waiting", 20, 10, "top"], ["error", 31, 10, "top"],
  ["meeting", 6, 13, "bottom"], ["idle", 19, 13, "bottom"], ["no_report", 31, 13, "bottom"],
];
const LAMPS = [[7, 5], [19, 5], [30, 5], [6, 18], [18, 18], [31, 18], [10, 12], [20, 12], [28, 12]];
const SPAWN = { x: 2, y: 12, face: "right" };

// Furniture: [kind, tileX, tileY, wTiles, hTiles]
const FURNITURE = [];
const SLOTS = { working: [], waiting: [], error: [], meeting: [], idle: [], no_report: [] };

(function buildLayout() {
  // Work floor: three rows of desks, seat below each desk.
  for (const y of [2, 5, 8]) {
    for (const x of [2, 6, 10]) {
      FURNITURE.push(["desk", x, y, 2, 1]);
      SLOTS.working.push({ x, y: y + 1, face: "up", sit: true, desk: [x, y] });
    }
  }
  FURNITURE.push(["shelf", 4, 1, 2, 1], ["shelf", 8, 1, 2, 1], ["plant", 1, 1, 1, 1], ["plant", 13, 1, 1, 1], ["cooler", 13, 5, 1, 1]);

  // Approvals: reception counter, two queue rows facing it, benches.
  FURNITURE.push(["counter", 16, 2, 6, 1], ["plant", 15, 1, 1, 1], ["plant", 23, 1, 1, 1], ["bench", 15, 9, 2, 1], ["bench", 22, 9, 2, 1]);
  for (const y of [4, 6]) for (const x of [16, 17, 18, 19, 20, 21]) SLOTS.waiting.push({ x, y, face: "up" });

  // Repair bay: tool benches with a spot in front, diagnostic pads, racks.
  for (const x of [26, 30, 34]) {
    FURNITURE.push(["bench_tools", x, 3, 3, 1]);
    SLOTS.error.push({ x: x + 1, y: 4, face: "up" });
  }
  for (const x of [26, 29, 32, 35]) SLOTS.error.push({ x, y: 7, face: "down", pad: true });
  FURNITURE.push(["rack", 25, 1, 1, 1], ["rack", 26, 1, 1, 1], ["rack", 35, 1, 1, 1], ["rack", 36, 1, 1, 1]);

  // War room: long table with seats on both sides, whiteboard.
  FURNITURE.push(["table", 3, 16, 6, 3], ["board", 3, 14, 6, 1], ["plant", 1, 14, 1, 1], ["plant", 11, 22, 1, 1]);
  for (let x = 3; x <= 8; x++) {
    SLOTS.meeting.push({ x, y: 15, face: "down" });
    SLOTS.meeting.push({ x, y: 19, face: "up" });
  }

  // Lounge: rug, two sofas, coffee table, coffee bar, arcade cabinet.
  FURNITURE.push(
    ["rug", 14, 16, 6, 5],
    ["sofa", 15, 15, 4, 1],
    ["sofa", 15, 21, 4, 1],
    ["coffee_table", 16, 18, 2, 1],
    ["coffee_bar", 21, 14, 4, 1],
    ["arcade", 24, 20, 1, 2],
    ["plant", 13, 14, 1, 1],
    ["plant", 13, 22, 1, 1]
  );
  for (const x of [15, 16, 17, 18]) SLOTS.idle.push({ x, y: 16, face: "up" });
  for (const x of [15, 16, 17, 18]) SLOTS.idle.push({ x, y: 20, face: "down" });
  for (const x of [21, 22, 23, 24]) SLOTS.idle.push({ x, y: 15, face: "up" });

  // Standby: charging pods.
  for (const y of [16, 20]) for (const x of [27, 30, 33, 36]) SLOTS.no_report.push({ x, y, face: "down", pod: true });
  FURNITURE.push(["plant", 26, 14, 1, 1], ["plant", 36, 14, 1, 1]);
})();

// Walkability grid
const BLOCK = new Uint8Array(MAP_W * MAP_H).fill(1);
(function buildGrid() {
  const open = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) BLOCK[y * MAP_W + x] = 0;
  };
  for (const r of Object.values(ROOMS)) open(r.x0, r.y0, r.x1, r.y1);
  open(CORRIDOR.x0, CORRIDOR.y0, CORRIDOR.x1, CORRIDOR.y1);
  for (const [x, y] of DOORS) BLOCK[y * MAP_W + x] = 0;
  for (const [kind, x, y, w, h] of FURNITURE) {
    if (kind === "rug") continue;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) BLOCK[(y + j) * MAP_W + x + i] = 1;
  }
})();
const walkable = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && BLOCK[y * MAP_W + x] === 0;

function bfs(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
  const start = sy * MAP_W + sx;
  const goal = ty * MAP_W + tx;
  prev[start] = start;
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    if (cur === goal) break;
    const cx = cur % MAP_W;
    const cy = (cur / MAP_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const ni = ny * MAP_W + nx;
      if ((walkable(nx, ny) || ni === goal) && prev[ni] === -1) {
        prev[ni] = cur;
        q.push(ni);
      }
    }
  }
  if (prev[goal] === -1) return [];
  const path = [];
  for (let c = goal; c !== start; c = prev[c]) path.push([c % MAP_W, (c / MAP_W) | 0]);
  return path.reverse();
}

// ---------------------------------------------------------------- color helpers
function hexToRgb(hex) {
  const h = String(hex || "#ffb547").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ---------------------------------------------------------------- static background art
function drawFloor(g, kind, x0, y0, x1, y1) {
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const x = tx * T;
      const y = ty * T;
      if (kind === "wood") {
        g.fillStyle = "#b8743c";
        g.fillRect(x, y, T, T);
        g.fillStyle = "#a6652f";
        for (let r = 0; r < 4; r++) g.fillRect(x, y + r * 4 + 3, T, 1);
        g.fillStyle = "#c4824a";
        g.fillRect(x + ((ty * 5 + tx * 3) % 12), y + 1 + ((tx + ty) % 3) * 4, 3, 1);
        g.fillStyle = "#9b5c29";
        g.fillRect(x + (((tx + ty) % 2) * 8), y + (((tx + ty) % 4)) * 4, 1, 3);
      } else if (kind === "checker") {
        for (let i = 0; i < 2; i++)
          for (let j = 0; j < 2; j++) {
            g.fillStyle = (i + j + tx + ty) % 2 ? "#eadcbc" : "#d9c59c";
            g.fillRect(x + i * 8, y + j * 8, 8, 8);
          }
      } else if (kind === "grate") {
        g.fillStyle = "#59647a";
        g.fillRect(x, y, T, T);
        g.fillStyle = "#4a5367";
        g.fillRect(x, y + 15, T, 1);
        g.fillRect(x + 15, y, 1, T);
        g.fillStyle = "#6b778f";
        g.fillRect(x + 3, y + 3, 1, 1);
        g.fillRect(x + 11, y + 11, 1, 1);
        g.fillRect(x + 11, y + 3, 1, 1);
        g.fillRect(x + 3, y + 11, 1, 1);
      } else if (kind === "blue") {
        g.fillStyle = "#38457a";
        g.fillRect(x, y, T, T);
        g.fillStyle = "#425189";
        for (let i = 0; i < 16; i += 4) for (let j = (i / 4) % 2 ? 2 : 0; j < 16; j += 4) g.fillRect(x + i, y + j, 1, 1);
      } else if (kind === "red") {
        g.fillStyle = "#7d3434";
        g.fillRect(x, y, T, T);
        g.fillStyle = "#8c3d3d";
        for (let i = 0; i < 16; i += 4) for (let j = (i / 4) % 2 ? 2 : 0; j < 16; j += 4) g.fillRect(x + i, y + j, 1, 1);
      } else if (kind === "mint") {
        for (let i = 0; i < 2; i++)
          for (let j = 0; j < 2; j++) {
            g.fillStyle = (i + j) % 2 ? "#a7d6c0" : "#9acab4";
            g.fillRect(x + i * 8, y + j * 8, 8, 8);
          }
      } else {
        g.fillStyle = "#d8cbb0";
        g.fillRect(x, y, T, T);
        g.fillStyle = "#c9bb9d";
        g.fillRect(x, y + 15, T, 1);
        g.fillRect(x + ((ty % 2) ? 7 : 15), y, 1, T);
      }
    }
  }
}

function drawWall(g, tx, ty, horizontal) {
  const x = tx * T;
  const y = ty * T;
  if (horizontal) {
    g.fillStyle = "#3b3242";
    g.fillRect(x, y, T, 6);
    g.fillStyle = "#4d4257";
    g.fillRect(x, y, T, 1);
    g.fillStyle = "#efe2c6";
    g.fillRect(x, y + 6, T, 8);
    g.fillStyle = "#dccaa6";
    g.fillRect(x, y + 10, T, 1);
    g.fillStyle = "#7a5233";
    g.fillRect(x, y + 14, T, 2);
  } else {
    g.fillStyle = "#3b3242";
    g.fillRect(x, y, T, T);
    g.fillStyle = "#4d4257";
    g.fillRect(x + 1, y, 2, T);
  }
}

function box(g, x, y, w, h, fill, outline = INK) {
  g.fillStyle = outline;
  g.fillRect(x, y, w, h);
  g.fillStyle = fill;
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
}

function drawFurniture(g, kind, tx, ty, tw, th) {
  const x = tx * T;
  const y = ty * T;
  const w = tw * T;
  const h = th * T;
  switch (kind) {
    case "desk": {
      box(g, x, y + 4, w, 11, "#8a5a2e");
      g.fillStyle = "#a8703b";
      g.fillRect(x + 1, y + 5, w - 2, 2);
      g.fillStyle = "#6e4523";
      g.fillRect(x + 2, y + 14, 2, 2);
      g.fillRect(x + w - 4, y + 14, 2, 2);
      box(g, x + 9, y - 3, 14, 10, "#2a2d36");
      g.fillStyle = "#1a2b2a";
      g.fillRect(x + 11, y - 1, 10, 6);
      g.fillStyle = "#3a3d46";
      g.fillRect(x + 15, y + 7, 2, 2);
      g.fillStyle = "#e9e4d8";
      g.fillRect(x + 4, y + 8, 4, 3);
      break;
    }
    case "shelf": {
      box(g, x, y, w, h, "#7b4c27");
      const books = ["#c4453c", "#3f6fb5", "#e0a93a", "#4f9a6a", "#8a5fbf", "#d97a3a"];
      for (let i = 0; i < 7; i++) {
        g.fillStyle = books[i % books.length];
        g.fillRect(x + 2 + i * 4, y + 3, 3, 5);
        g.fillStyle = books[(i + 3) % books.length];
        g.fillRect(x + 2 + i * 4, y + 9, 3, 5);
      }
      break;
    }
    case "plant": {
      box(g, x + 4, y + 9, 8, 7, "#b0623a");
      g.fillStyle = "#2f7a4a";
      g.fillRect(x + 3, y + 3, 10, 7);
      g.fillStyle = "#3f9a5c";
      g.fillRect(x + 5, y + 1, 6, 5);
      g.fillRect(x + 2, y + 5, 3, 3);
      g.fillRect(x + 11, y + 5, 3, 3);
      g.fillStyle = "#59b874";
      g.fillRect(x + 6, y + 2, 2, 2);
      break;
    }
    case "cooler": {
      box(g, x + 4, y + 6, 8, 10, "#dfe6ee");
      box(g, x + 5, y, 6, 7, "#7cc4e8");
      g.fillStyle = "#b5e3f7";
      g.fillRect(x + 6, y + 1, 2, 3);
      break;
    }
    case "counter": {
      box(g, x, y + 2, w, 13, "#9b6a3c");
      g.fillStyle = "#b98451";
      g.fillRect(x + 1, y + 3, w - 2, 3);
      g.fillStyle = "#f4ecd8";
      g.fillRect(x + 10, y + 3, 8, 3);
      g.fillRect(x + 40, y + 3, 10, 3);
      box(g, x + 70, y - 2, 6, 6, "#e0b13a");
      g.fillStyle = "#ffb547";
      g.fillRect(x + 28, y - 4, 4, 6);
      g.fillStyle = "#ffe2a8";
      g.fillRect(x + 29, y - 4, 2, 2);
      break;
    }
    case "bench": {
      box(g, x, y + 5, w, 7, "#7b5a3a");
      g.fillStyle = "#94704c";
      g.fillRect(x + 1, y + 6, w - 2, 2);
      break;
    }
    case "bench_tools": {
      box(g, x, y + 3, w, 12, "#7d8796");
      g.fillStyle = "#96a1b0";
      g.fillRect(x + 1, y + 4, w - 2, 2);
      g.fillStyle = "#e0b13a";
      g.fillRect(x + 6, y + 7, 7, 2);
      g.fillStyle = "#c4453c";
      g.fillRect(x + 18, y + 6, 3, 4);
      g.fillStyle = "#2a2d36";
      g.fillRect(x + 28, y + 6, 10, 6);
      g.fillStyle = "#ff6b5e";
      g.fillRect(x + 30, y + 8, 2, 2);
      break;
    }
    case "rack": {
      box(g, x + 1, y - 6, 14, 22, "#2a2d36");
      g.fillStyle = "#3a3e4a";
      for (let i = 0; i < 4; i++) g.fillRect(x + 3, y - 4 + i * 5, 10, 3);
      break;
    }
    case "table": {
      box(g, x + 2, y + 2, w - 4, h - 4, "#6e4a2a");
      g.fillStyle = "#86592f";
      g.fillRect(x + 4, y + 4, w - 8, 3);
      g.fillStyle = "#f4ecd8";
      for (let i = 0; i < 5; i++) g.fillRect(x + 12 + i * 22, y + 18, 8, 6);
      g.fillStyle = "#4fd1b5";
      g.fillRect(x + w / 2 - 6, y + h / 2 - 3, 12, 6);
      break;
    }
    case "board": {
      box(g, x, y + 2, w, 12, "#f5f2ea");
      g.fillStyle = "#3f6fb5";
      g.fillRect(x + 6, y + 5, 24, 1);
      g.fillRect(x + 6, y + 8, 16, 1);
      g.fillStyle = "#c4453c";
      g.fillRect(x + 40, y + 5, 2, 6);
      g.fillRect(x + 44, y + 7, 2, 4);
      g.fillRect(x + 48, y + 4, 2, 7);
      g.fillStyle = "#4f9a6a";
      g.fillRect(x + 60, y + 6, 20, 1);
      g.fillRect(x + 60, y + 9, 26, 1);
      break;
    }
    case "rug": {
      g.fillStyle = "#c9a15a";
      g.fillRect(x, y, w, h);
      g.fillStyle = "#a8463c";
      g.fillRect(x + 3, y + 3, w - 6, h - 6);
      g.fillStyle = "#c9a15a";
      g.fillRect(x + 6, y + 6, w - 12, h - 12);
      g.fillStyle = "#3f6f6a";
      g.fillRect(x + 9, y + 9, w - 18, h - 18);
      break;
    }
    case "sofa": {
      box(g, x, y, w, 15, "#3f7a74");
      g.fillStyle = "#4f948d";
      g.fillRect(x + 1, y + 1, w - 2, 5);
      g.fillStyle = "#366a65";
      for (let i = 1; i < tw; i++) g.fillRect(x + i * T, y + 6, 1, 8);
      g.fillStyle = "#ffb547";
      g.fillRect(x + 4, y + 7, 5, 4);
      g.fillStyle = "#f4ecd8";
      g.fillRect(x + w - 10, y + 7, 5, 4);
      break;
    }
    case "coffee_table": {
      box(g, x + 2, y + 3, w - 4, 10, "#6e4a2a");
      g.fillStyle = "#f4ecd8";
      g.fillRect(x + 8, y + 5, 4, 3);
      g.fillStyle = "#c4453c";
      g.fillRect(x + 18, y + 6, 3, 3);
      break;
    }
    case "coffee_bar": {
      box(g, x, y + 2, w, 13, "#5a3a24");
      g.fillStyle = "#7a5233";
      g.fillRect(x + 1, y + 3, w - 2, 3);
      box(g, x + 6, y - 6, 12, 12, "#c8ccd4");
      g.fillStyle = "#2a2d36";
      g.fillRect(x + 9, y - 3, 6, 4);
      g.fillStyle = "#f4ecd8";
      g.fillRect(x + 28, y + 4, 4, 4);
      g.fillRect(x + 36, y + 4, 4, 4);
      break;
    }
    case "arcade": {
      box(g, x + 1, y - 4, 14, h + 4, "#5b3a8a");
      box(g, x + 3, y - 1, 10, 8, "#1a1b24");
      g.fillStyle = "#ffb547";
      g.fillRect(x + 4, y + 10, 2, 2);
      g.fillStyle = "#ff6b5e";
      g.fillRect(x + 9, y + 10, 2, 2);
      break;
    }
    default:
      break;
  }
}

function drawPad(g, tx, ty) {
  const x = tx * T;
  const y = ty * T;
  g.fillStyle = "#3a3e4a";
  g.fillRect(x + 1, y + 10, 14, 5);
  g.fillStyle = "#5b6577";
  g.fillRect(x + 2, y + 11, 12, 3);
}

function drawPodBase(g, tx, ty) {
  const x = tx * T;
  const y = ty * T;
  box(g, x - 1, y + 9, 18, 7, "#d9e6e1");
  g.fillStyle = "#4fd1b5";
  g.fillRect(x + 2, y + 11, 12, 2);
}

function drawSign(g, label, cx, y) {
  const w = label.length * 4 + 8;
  const x = Math.round(cx - w / 2);
  box(g, x, y, w, 9, "#2b2433", "#15121a");
  g.fillStyle = "#ffb547";
  // 3x5 pixel font for room signs
  let px = x + 4;
  for (const ch of label) {
    const glyph = FONT[ch] || FONT[" "];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) if (glyph[r] & (4 >> c)) g.fillRect(px + c, y + 2 + r, 1, 1);
    px += 4;
  }
}

// 3x5 bitmap font (bits: 4=left, 2=middle, 1=right)
const FONT = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4],
  R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2],
  W: [5, 5, 7, 7, 5], Y: [5, 5, 2, 2, 2], " ": [0, 0, 0, 0, 0],
};

function buildBackground() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#15121a";
  g.fillRect(0, 0, W, H);
  drawFloor(g, "corridor", CORRIDOR.x0, CORRIDOR.y0, CORRIDOR.x1, CORRIDOR.y1);
  for (const r of Object.values(ROOMS)) drawFloor(g, r.floor, r.x0, r.y0, r.x1, r.y1);
  for (const [x, y] of DOORS) drawFloor(g, "corridor", x, y, x, y);
  // Walls on every blocked tile that touches open floor
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!isStructuralWall(tx, ty)) continue;
      const below = ty + 1 < MAP_H && isFloor(tx, ty + 1);
      drawWall(g, tx, ty, below);
    }
  }
  // Elevator in the corridor's west end
  box(g, 1 * T, 11 * T - 10, 2 * T, 12, "#8a919c");
  g.fillStyle = "#5c636e";
  g.fillRect(1 * T + 15, 11 * T - 9, 2, 10);
  g.fillStyle = "#ffb547";
  g.fillRect(1 * T + 14, 11 * T - 14, 4, 2);
  // Furniture (sorted top to bottom so overlaps read right)
  for (const s of SLOTS.error) if (s.pad) drawPad(g, s.x, s.y);
  for (const s of SLOTS.no_report) if (s.pod) drawPodBase(g, s.x, s.y);
  [...FURNITURE].sort((a, b) => a[2] - b[2]).forEach((f) => drawFurniture(g, ...f));
  // Room signs over each doorway
  for (const [key, dx, dy, where] of SIGNS) drawSign(g, ROOMS[key].name, (dx + 1) * T, where === "top" ? dy * T - 1 : dy * T + 4);
  return c;
}

function isFloor(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  for (const r of Object.values(ROOMS)) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  if (x >= CORRIDOR.x0 && x <= CORRIDOR.x1 && y >= CORRIDOR.y0 && y <= CORRIDOR.y1) return true;
  return DOORS.some(([dx, dy]) => dx === x && dy === y);
}
function isStructuralWall(x, y) {
  if (isFloor(x, y)) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(x + dx, y + dy)) return true;
  return false;
}

// ---------------------------------------------------------------- bot sprite
function drawBot(g, b, t) {
  const x = Math.round(b.px);
  const y = Math.round(b.py);
  const walking = b.path.length > 0;
  const frame = walking ? Math.floor(t * 8) % 2 : 0;
  const bob = walking ? frame : b.sitting ? 2 : Math.round(Math.sin(t * 2 + b.seed) * 0.6);
  const body = b.color;
  const dark = shade(body, -0.35);
  const light = shade(body, 0.35);
  // shadow
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(x + 3, y + 14, 10, 2);
  // feet
  if (!b.sitting) {
    g.fillStyle = INK;
    if (walking && frame) {
      g.fillRect(x + 4, y + 13, 3, 2);
      g.fillRect(x + 9, y + 12, 3, 2);
    } else {
      g.fillRect(x + 4, y + 12 + (walking ? 0 : 1), 3, 2);
      g.fillRect(x + 9, y + 13, 3, 2);
    }
  }
  const by = y + bob;
  // antenna
  g.fillStyle = INK;
  g.fillRect(x + 7, by, 2, 3);
  g.fillStyle = b.status === "working" && Math.floor(t * 3) % 2 ? "#ffb547" : light;
  g.fillRect(x + 6, by - 1, 4, 2);
  // body
  g.fillStyle = INK;
  g.fillRect(x + 2, by + 3, 12, 10);
  g.fillRect(x + 3, by + 2, 10, 12);
  g.fillStyle = body;
  g.fillRect(x + 3, by + 3, 10, 10);
  g.fillStyle = light;
  g.fillRect(x + 4, by + 3, 6, 1);
  g.fillStyle = dark;
  g.fillRect(x + 3, by + 11, 10, 2);
  // face
  if (b.dir !== "up") {
    g.fillStyle = "#f4f1ea";
    const off = b.dir === "left" ? -1 : b.dir === "right" ? 1 : 0;
    g.fillRect(x + 4 + off, by + 5, 8, 5);
    g.fillStyle = INK;
    const blink = Math.floor(t * 0.7 + b.seed) % 5 === 0 && (t * 10) % 10 < 1.4;
    if (blink) {
      g.fillRect(x + 5 + off, by + 7, 2, 1);
      g.fillRect(x + 9 + off, by + 7, 2, 1);
    } else {
      g.fillRect(x + 5 + off + (off > 0 ? 1 : 0), by + 6, 2, 3);
      g.fillRect(x + 9 + off + (off > 0 ? 1 : 0) - (off < 0 ? 1 : 0), by + 6, 2, 3);
    }
  } else {
    g.fillStyle = dark;
    g.fillRect(x + 5, by + 5, 6, 4);
  }
}

function drawBubble(g, b, t) {
  const x = Math.round(b.px) + 8;
  const y = Math.round(b.py) - 9 + Math.round(Math.sin(t * 4 + b.seed) * 1);
  const s = b.status;
  if (b.placeholder) return;
  if (s === "waiting" || s === "error") {
    const red = s === "error";
    if (red && Math.floor(t * 3) % 2) return;
    box(g, x - 4, y - 7, 9, 9, red ? "#ff6b5e" : "#fff7e6");
    g.fillStyle = red ? "#fff7e6" : "#e07a1f";
    g.fillRect(x, y - 5, 1, 3);
    g.fillRect(x, y - 1, 1, 1);
    g.fillStyle = INK;
    g.fillRect(x - 1, y + 2, 2, 1);
  } else if (s === "working" || s === "meeting") {
    box(g, x - 6, y - 5, 13, 7, "#fff7e6");
    g.fillStyle = INK;
    const n = Math.floor(t * 3) % 4;
    for (let i = 0; i < 3; i++) if (i < n || s === "meeting") g.fillRect(x - 3 + i * 3, y - 2, 2, 1);
    g.fillRect(x - 3, y + 2, 2, 1);
  } else if (s === "no_report") {
    const p = (t * 0.6 + b.seed) % 1;
    g.globalAlpha = 1 - p;
    g.fillStyle = "#e9f4ff";
    const zx = x + 2 + Math.round(p * 4);
    const zy = y - Math.round(p * 8);
    g.fillRect(zx, zy - 4, 4, 1);
    g.fillRect(zx + 2, zy - 3, 1, 1);
    g.fillRect(zx + 1, zy - 2, 1, 1);
    g.fillRect(zx, zy - 1, 4, 1);
    g.globalAlpha = 1;
  } else if (s === "idle" && Math.floor(t / 4 + b.seed) % 3 === 0) {
    g.fillStyle = "#f4ecd8";
    g.fillRect(x - 2, y - 4, 5, 4);
    g.fillRect(x + 3, y - 3, 1, 2);
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.fillRect(x - 1, y - 7 + (Math.floor(t * 2) % 2), 1, 2);
    g.fillRect(x + 1, y - 8 + (Math.floor(t * 2 + 1) % 2), 1, 2);
  }
}

// ---------------------------------------------------------------- the office
const ROOM_KEYS = ["working", "waiting", "error", "meeting", "idle", "no_report"];

class Office2D {
  constructor(container, labelLayer, tooltipEl, onSelectBot) {
    this.container = container;
    this.labelLayer = labelLayer;
    this.tooltipEl = tooltipEl;
    this.onSelectBot = onSelectBot || (() => {});
    this._showAllLabels = true;
    this.paused = false;
    this.lighting = "night";
    this.bots = new Map();
    this.selectedId = null;
    this.hoverId = null;
    this.firstLoad = true;
    this.reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    this.bg = buildBackground();
    this.canvas = document.createElement("canvas");
    this.canvas.className = "office2d-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Pixel office showing each agent in the room for its current status");
    this.ctx = this.canvas.getContext("2d");
    if (labelLayer) labelLayer.innerHTML = "";
    container.innerHTML = "";
    container.appendChild(this.canvas);

    this.view = { x: 0, y: 0, w: W, h: H };
    this.viewTarget = { x: 0, y: 0, w: W, h: H };
    this.t = 0;
    this.last = performance.now();

    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverId = null;
      this.tooltipEl?.classList.add("hidden");
      this.canvas.style.cursor = "default";
    });
    this.canvas.addEventListener("click", (e) => this.onClick(e));
    this.ro = new ResizeObserver(() => this.handleResize());
    this.ro.observe(container);
    this.handleResize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---- public API
  get showAllLabels() {
    return this._showAllLabels;
  }
  set showAllLabels(v) {
    this._showAllLabels = Boolean(v);
  }
  setPaused(p) {
    const was = this.paused;
    this.paused = Boolean(p);
    if (was && !this.paused) {
      this.last = performance.now();
      requestAnimationFrame(this.loop);
    }
  }
  setCameraMode() {}
  setLighting(mode) {
    this.lighting = mode || "night";
  }
  handleResize() {
    const r = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.dpr = dpr;
  }
  resetView() {
    this.viewTarget = { x: 0, y: 0, w: W, h: H };
  }
  focusRoom(key) {
    if (!key || key === "all" || !ROOMS[key]) return this.resetView();
    const r = ROOMS[key];
    const pad = 2;
    this.viewTarget = {
      x: (r.x0 - pad) * T,
      y: (r.y0 - pad) * T,
      w: (r.x1 - r.x0 + 1 + pad * 2) * T,
      h: (r.y1 - r.y0 + 1 + pad * 2) * T,
    };
  }
  selectBot(id) {
    this.selectedId = id;
    const b = this.bots.get(id);
    if (b) {
      const span = 14 * T;
      this.viewTarget = { x: b.px + 8 - span / 2, y: b.py + 8 - (span * 0.6) / 2, w: span, h: span * 0.6 };
    }
    this.onSelectBot(id);
  }

  updateBots(list) {
    const seen = new Set();
    const byRoom = {};
    ROOM_KEYS.forEach((k) => (byRoom[k] = []));
    (list || []).forEach((b) => {
      const room = ROOMS[b.status] ? b.status : "idle";
      byRoom[room].push(b);
    });
    for (const room of ROOM_KEYS) {
      byRoom[room].sort((a, b) => (a.deskIndex ?? 0) - (b.deskIndex ?? 0) || String(a.id).localeCompare(String(b.id)));
      byRoom[room].forEach((src, i) => {
        seen.add(src.id);
        const slot = this.slotFor(room, i);
        let b = this.bots.get(src.id);
        if (!b) {
          const spawn = this.firstLoad ? slot : SPAWN;
          b = {
            id: src.id,
            tx: spawn.x,
            ty: spawn.y,
            px: spawn.x * T,
            py: spawn.y * T,
            path: [],
            dir: spawn.face || "down",
            seed: Math.random() * 10,
            wanderAt: 0,
          };
          this.bots.set(src.id, b);
        }
        b.name = src.name;
        b.color = src.avatarColor || "#ffb547";
        b.status = room;
        b.task = src.task || "";
        b.role = src.orgTitle || src.role || "";
        b.placeholder = Boolean(src.placeholder);
        const changed = !b.slot || b.slot.x !== slot.x || b.slot.y !== slot.y;
        b.slot = slot;
        if (changed) this.walkTo(b, slot.x, slot.y);
      });
    }
    for (const id of [...this.bots.keys()]) if (!seen.has(id)) this.bots.delete(id);
    this.firstLoad = false;
  }

  slotFor(room, i) {
    const slots = SLOTS[room];
    if (i < slots.length) return slots[i];
    // Overflow: spread over free tiles in the room
    const r = ROOMS[room];
    const taken = new Set(slots.map((s) => `${s.x},${s.y}`));
    const free = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (walkable(x, y) && !taken.has(`${x},${y}`)) free.push({ x, y, face: "down" });
    return free[(i - slots.length) % Math.max(1, free.length)] || slots[0];
  }

  walkTo(b, x, y) {
    if (this.reduceMotion) {
      b.tx = x;
      b.ty = y;
      b.px = x * T;
      b.py = y * T;
      b.path = [];
      return;
    }
    b.path = bfs(b.tx, b.ty, x, y);
    if (!b.path.length && (b.tx !== x || b.ty !== y)) {
      b.tx = x;
      b.ty = y;
      b.px = x * T;
      b.py = y * T;
    }
  }

  // ---- frame
  loop(now) {
    if (this.paused) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop);
  }

  update(dt) {
    const speed = 3.2 * T;
    for (const b of this.bots.values()) {
      if (b.path.length) {
        const [nx, ny] = b.path[0];
        const tx = nx * T;
        const ty = ny * T;
        const dx = tx - b.px;
        const dy = ty - b.py;
        b.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        const dist = Math.hypot(dx, dy);
        const step = speed * dt;
        if (dist <= step) {
          b.px = tx;
          b.py = ty;
          b.tx = nx;
          b.ty = ny;
          b.path.shift();
        } else {
          b.px += (dx / dist) * step;
          b.py += (dy / dist) * step;
        }
        b.sitting = false;
      } else {
        const atSlot = b.slot && b.tx === b.slot.x && b.ty === b.slot.y;
        if (atSlot) {
          b.dir = b.slot.face || "down";
          b.sitting = Boolean(b.slot.sit);
        }
        // Idle agents get up and wander the lounge now and then.
        if (b.status === "idle" && !this.reduceMotion && this.t > b.wanderAt) {
          b.wanderAt = this.t + 6 + ((b.seed * 7) % 8);
          const r = ROOMS.idle;
          if (atSlot) {
            for (let tries = 0; tries < 20; tries++) {
              const x = r.x0 + Math.floor(Math.random() * (r.x1 - r.x0 + 1));
              const y = r.y0 + Math.floor(Math.random() * (r.y1 - r.y0 + 1));
              if (walkable(x, y)) {
                this.walkTo(b, x, y);
                break;
              }
            }
          } else if (b.slot) {
            this.walkTo(b, b.slot.x, b.slot.y);
          }
        }
      }
    }
    // camera ease
    const k = this.reduceMotion ? 1 : 1 - Math.pow(0.002, dt);
    for (const key of ["x", "y", "w", "h"]) this.view[key] += (this.viewTarget[key] - this.view[key]) * k;
  }

  transform() {
    const v = this.view;
    const scale = Math.min(this.cssW / v.w, this.cssH / v.h);
    const ox = (this.cssW - v.w * scale) / 2 - v.x * scale;
    const oy = (this.cssH - v.h * scale) / 2 - v.y * scale;
    return { scale, ox, oy };
  }

  render() {
    const g = this.ctx;
    const { scale, ox, oy } = this.transform();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#0b0a0e";
    g.fillRect(0, 0, this.cssW, this.cssH);
    g.save();
    g.translate(ox, oy);
    g.scale(scale, scale);
    g.drawImage(this.bg, 0, 0);
    this.drawDynamicProps(g);

    const sorted = [...this.bots.values()].sort((a, b) => a.py - b.py);
    // selection marker under the bot
    const sel = this.selectedId && this.bots.get(this.selectedId);
    if (sel) {
      const p = 0.5 + 0.5 * Math.sin(this.t * 5);
      g.fillStyle = `rgba(255,181,71,${0.35 + p * 0.35})`;
      g.fillRect(Math.round(sel.px) + 1, Math.round(sel.py) + 13, 14, 3);
    }
    for (const b of sorted) {
      if (b.slot?.sit && !b.path.length) this.drawChair(g, b);
      drawBot(g, b, this.t);
      if (b.slot?.pod && !b.path.length) this.drawPodGlass(g, b);
    }
    for (const b of sorted) drawBubble(g, b, this.t);
    this.drawLighting(g);
    g.restore();
    this.drawLabels(g, sorted, scale, ox, oy);
  }

  drawChair(g, b) {
    const x = Math.round(b.px);
    const y = Math.round(b.py);
    box(g, x + 3, y + 9, 10, 7, "#3a3e4a");
    g.fillStyle = "#4a4f5c";
    g.fillRect(x + 4, y + 10, 8, 2);
  }

  drawPodGlass(g, b) {
    const x = Math.round(b.px);
    const y = Math.round(b.py);
    g.fillStyle = "rgba(170, 235, 220, 0.18)";
    g.fillRect(x - 1, y - 2, 18, 13);
    g.fillStyle = "rgba(220, 255, 245, 0.5)";
    g.fillRect(x, y - 1, 1, 10);
  }

  drawDynamicProps(g) {
    const t = this.t;
    // Monitors light up when someone is working at that desk
    const busy = new Set();
    for (const b of this.bots.values()) if (b.status === "working" && b.slot?.desk && !b.path.length) busy.add(b.slot.desk.join(","));
    for (const s of SLOTS.working) {
      const [dx, dy] = s.desk;
      const x = dx * T;
      const y = dy * T;
      if (busy.has(`${dx},${dy}`)) {
        g.fillStyle = "#4fd1b5";
        g.fillRect(x + 11, y - 1, 10, 6);
        g.fillStyle = "#1a4a42";
        const scroll = Math.floor(t * 4) % 3;
        for (let i = 0; i < 3; i++) g.fillRect(x + 12, y + ((i + scroll) % 3) * 2, 3 + ((i * 5 + dx) % 6), 1);
      }
    }
    // Server rack lights
    for (const [kind, rx, ry] of FURNITURE) {
      if (kind !== "rack") continue;
      for (let i = 0; i < 4; i++) {
        const on = Math.floor(t * 3 + i * 1.7 + rx) % 3 !== 0;
        g.fillStyle = on ? (i % 2 ? "#4fd1b5" : "#ffb547") : "#22252e";
        g.fillRect(rx * T + 11, ry * T - 3 + i * 5, 1, 1);
      }
    }
    // Coffee steam
    const cx = 21 * T + 12;
    const cy = 14 * T - 8;
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.fillRect(cx + (Math.floor(t * 2) % 2), cy - (Math.floor(t * 4) % 4), 1, 2);
    // Arcade screen
    g.fillStyle = ["#ffb547", "#4fd1b5", "#ff6b5e", "#9b8cff"][Math.floor(t * 2) % 4];
    g.fillRect(24 * T + 5, 20 * T, 6, 5);
  }

  drawLighting(g) {
    let mode = this.lighting;
    if (mode === "now") {
      const h = new Date().getHours();
      mode = h >= 7 && h < 17 ? "day" : h >= 17 && h < 20 ? "evening" : "night";
    }
    if (mode === "day") return;
    const night = mode === "night";
    g.fillStyle = night ? "rgba(14, 16, 44, 0.42)" : "rgba(80, 30, 10, 0.18)";
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    for (const [lx, ly] of LAMPS) {
      const x = lx * T;
      const y = ly * T;
      const grad = g.createRadialGradient(x, y, 0, x, y, 7 * T);
      grad.addColorStop(0, night ? "rgba(255, 190, 110, 0.20)" : "rgba(255, 170, 90, 0.10)");
      grad.addColorStop(1, "rgba(255, 190, 110, 0)");
      g.fillStyle = grad;
      g.fillRect(x - 7 * T, y - 7 * T, 14 * T, 14 * T);
    }
    // Screens glow
    for (const b of this.bots.values()) {
      if (b.status !== "working" || !b.slot?.desk || b.path.length) continue;
      const x = b.slot.desk[0] * T + 16;
      const y = b.slot.desk[1] * T + 2;
      const grad = g.createRadialGradient(x, y, 0, x, y, 2 * T);
      grad.addColorStop(0, "rgba(79, 209, 181, 0.22)");
      grad.addColorStop(1, "rgba(79, 209, 181, 0)");
      g.fillStyle = grad;
      g.fillRect(x - 2 * T, y - 2 * T, 4 * T, 4 * T);
    }
    g.globalCompositeOperation = "source-over";
  }

  drawLabels(g, sorted, scale, ox, oy) {
    const size = Math.max(9, Math.min(13, Math.round(scale * 5)));
    g.font = `${size}px "Silkscreen", "Geist Mono", monospace`;
    g.textBaseline = "middle";
    g.textAlign = "center";
    for (const b of sorted) {
      const show =
        this._showAllLabels || b.id === this.selectedId || b.id === this.hoverId || b.status === "waiting" || b.status === "error";
      if (!show) continue;
      const cx = (b.px + 8) * scale + ox;
      const cy = (b.py + 19) * scale + oy + size * 0.6;
      const text = b.name || b.id;
      const w = g.measureText(text).width + 10;
      const h = size + 6;
      g.fillStyle = b.id === this.selectedId ? "rgba(255, 181, 71, 0.95)" : "rgba(16, 14, 20, 0.82)";
      g.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), h);
      g.fillStyle = b.id === this.selectedId ? "#1a1206" : "#f4ecd8";
      g.fillText(text, Math.round(cx), Math.round(cy) + 1);
    }
  }

  // ---- input
  toMap(e) {
    const r = this.canvas.getBoundingClientRect();
    const { scale, ox, oy } = this.transform();
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  }
  botAt(m) {
    let hit = null;
    for (const b of this.bots.values()) {
      if (m.x >= b.px && m.x <= b.px + 16 && m.y >= b.py - 2 && m.y <= b.py + 16) {
        if (!hit || b.py > hit.py) hit = b;
      }
    }
    return hit;
  }
  onPointerMove(e) {
    const b = this.botAt(this.toMap(e));
    this.hoverId = b ? b.id : null;
    this.canvas.style.cursor = b ? "pointer" : "default";
    if (!this.tooltipEl) return;
    if (!b) {
      this.tooltipEl.classList.add("hidden");
      return;
    }
    const roomName = ROOMS[b.status]?.name || "";
    const safe = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    this.tooltipEl.innerHTML = `<strong>${safe(b.name)}</strong>${b.role ? ` · ${safe(b.role)}` : ""}<br><span>${safe(roomName)}${b.task ? ` · ${safe(b.task)}` : ""}</span>`;
    const r = this.container.getBoundingClientRect();
    this.tooltipEl.style.left = `${e.clientX - r.left + 14}px`;
    this.tooltipEl.style.top = `${e.clientY - r.top + 14}px`;
    this.tooltipEl.classList.remove("hidden");
  }
  onClick(e) {
    const b = this.botAt(this.toMap(e));
    if (b) {
      this.selectedId = b.id;
      this.onSelectBot(b.id);
    }
  }
}

window.Office2D = Office2D;
