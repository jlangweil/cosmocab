// Cosmo Cab - main game engine
'use strict';

/* =============================== utils =============================== */
const CELL = 40;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function dist2seg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = x1 + dx * t, cy = y1 + dy * t;
  return Math.hypot(px - cx, py - cy);
}

function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < r * r;
}

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ============================= persistence ============================= */
const SAVE_KEY = 'spacetaxi_remastered';
function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (d && typeof d === 'object') return d;
  } catch (e) { /* corrupt save */ }
  return {};
}
const DEFAULT_SETTINGS = { master: 0.8, music: 0.5, sfx: 0.9, scale: 1, difficulty: 'easy', keys: {} };
const save = Object.assign({
  unlocked: 1,
  highscores: [],
  settings: Object.assign({}, DEFAULT_SETTINGS),
}, loadSave());
save.settings = Object.assign({}, DEFAULT_SETTINGS, save.settings);
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ }
}

/* ============================== difficulty ============================== */
// Three feels for the flight model. MEDIUM reproduces the original tuning
// exactly; EASY is gentler and more forgiving, HARD heavier and stricter.
//   grav      downward accel (px/s^2)      thrust    engine accel (px/s^2)
//   rot       turn rate (rad/s)            rotBurn   fuel/s while turning
//   burn      fuel/s at full thrust        dragX/Y   velocity damping (higher=stops sooner)
//   landVy/Vx/Ang  crash thresholds        smoothVy/Vx  gentle-landing bonus window
//   haz       hazard-strength multiplier for the Outer Rim obstacles (wind,
//             magnets, tractor beams, black holes, meteors, mines, creatures):
//             <1 gentler, >1 stronger. Lets the same board scale with skill.
const DIFFICULTY = {
  easy:   { grav: 130, thrust: 480, rot: 3.6, rotBurn: 0.30, burn: 2.4, dragX: 0.14, dragY: 0.09, landVy: 195, landVx: 120, landAng: 0.50, smoothVy: 80, smoothVx: 48, haz: 0.72 },
  medium: { grav: 175, thrust: 470, rot: 3.3, rotBurn: 0.42, burn: 2.8, dragX: 0.06, dragY: 0.03, landVy: 135, landVx: 85,  landAng: 0.32, smoothVy: 55, smoothVx: 30, haz: 1.00 },
  hard:   { grav: 225, thrust: 465, rot: 3.0, rotBurn: 0.52, burn: 3.1, dragX: 0.03, dragY: 0.015, landVy: 100, landVx: 55, landAng: 0.22, smoothVy: 44, smoothVx: 22, haz: 1.40 },
};
let DIFF = DIFFICULTY[save.settings.difficulty] || DIFFICULTY.medium;
function setDifficulty(name) {
  if (!DIFFICULTY[name]) name = 'medium';
  save.settings.difficulty = name;
  DIFF = DIFFICULTY[name];
  persist();
}

/* =============================== input =============================== */
const ACTIONS = ['thrust', 'left', 'right', 'horn'];
const DEFAULT_KEYS = {
  thrust: ['KeyW', 'ArrowUp'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  horn: ['Space'],
};
const keysDown = new Set();
const pressedQueue = [];
let remapTarget = null;

function bindingsFor(action) {
  const custom = save.settings.keys[action];
  return custom ? [custom, ...DEFAULT_KEYS[action]] : DEFAULT_KEYS[action];
}

window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (remapTarget) {
    if (e.code !== 'Escape') {
      save.settings.keys[remapTarget] = e.code;
      persist();
    }
    remapTarget = null;
    AudioSys.sfx.menuSelect();
    return;
  }
  if (!keysDown.has(e.code)) pressedQueue.push(e.code);
  keysDown.add(e.code);
  AudioSys.init();
});
window.addEventListener('keyup', e => keysDown.delete(e.code));
window.addEventListener('blur', () => keysDown.clear());

// Gamepad
const pad = {
  thrust: false, left: false, right: false, buttons: {}, pressed: {},
  axisL: false, axisR: false, axisU: false, axisD: false,
  fL: false, fR: false, trig: false,
};

// Native gamepad bridge: on Xbox the UWP shell reads the controller with
// Windows.Gaming.Input and forwards it via PostWebMessageAsString — much more
// responsive than the WebView's Gamepad API and immune to its mouse emulation.
let nativePad = null, nativePadMs = 0;
if (window.chrome && window.chrome.webview && window.chrome.webview.addEventListener) {
  try {
    window.chrome.webview.addEventListener('message', e => {
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
      if (d && d.t === 'pad') { nativePad = d; nativePadMs = performance.now(); }
    });
  } catch (e) { /* bridge unavailable */ }
}

// Quit the app. On Xbox/UWP the WebView can't close its own host window, so we
// ask the native shell to exit to the dashboard; in a plain browser we fall
// back to window.close().
function requestExit() {
  try {
    if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
      window.chrome.webview.postMessage(JSON.stringify({ t: 'exit' }));
      return;
    }
  } catch (e) { /* fall through to browser close */ }
  try { window.close(); } catch (e) { /* ignore */ }
}

// Normalized controller snapshots from whichever source is live.
// The native bridge only posts on state change plus a ~7/s heartbeat, so the
// staleness window sits well above that interval — the native path stays live
// (and never briefly drops to the laggy browser-gamepad fallback) between beats.
function padSnapshots() {
  if (nativePad && performance.now() - nativePadMs < 450) {
    const n = nativePad;
    return [{
      native: true,
      ax: n.lx || 0, ay: -(n.ly || 0),
      trig: Math.max(n.rt || 0, n.lt || 0),
      b: {
        a: !!n.a, back: !!n.b, horn: !!n.x, restart: !!n.y,
        du: !!n.du, dd: !!n.dd, dl: !!n.dl, dr: !!n.dr, menu: !!n.menu,
      },
    }];
  }
  const snaps = [];
  let gps = [];
  try {
    gps = navigator.getGamepads ? navigator.getGamepads() : [];
  } catch (e) {
    gps = []; // blocked by permissions policy (e.g. embedded preview iframe)
  }
  for (const gp of gps) {
    // Only standard-mapped controllers: flight sticks, wheels, and throttle axes
    // that rest off-center would otherwise spam navigation every frame.
    if (!gp || !gp.connected || gp.mapping !== 'standard') continue;
    const btn = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    snaps.push({
      ax: gp.axes[0] || 0, ay: gp.axes[1] || 0,
      trig: gp.buttons[7] ? gp.buttons[7].value : 0,
      b: {
        a: btn(0), back: btn(1), horn: btn(2), restart: btn(3),
        du: btn(12), dd: btn(13), dl: btn(14), dr: btn(15), menu: btn(9),
      },
    });
  }
  return snaps;
}

function pollGamepad() {
  pad.thrust = pad.left = pad.right = false;
  const newPressed = {};
  for (const s of padSnapshots()) {
    // Flight rotation deadzone: the native Xbox bridge delivers clean readings,
    // so it gets a light threshold for immediate steering. Browser Gamepad API
    // devices keep the stiff 0.6 threshold that protects against stick drift.
    const eng = s.native ? 0.33 : 0.6;
    const rel = s.native ? 0.24 : 0.35;
    pad.fL = pad.fL ? s.ax < -rel : s.ax < -eng;
    pad.fR = pad.fR ? s.ax > rel : s.ax > eng;
    // menu navigation latch: deliberately stiffer so stick drift can't spam menus
    pad.axisL = pad.axisL ? s.ax < -0.35 : s.ax < -0.6;
    pad.axisR = pad.axisR ? s.ax > 0.35 : s.ax > 0.6;
    pad.axisU = pad.axisU ? s.ay < -0.35 : s.ay < -0.6;
    pad.axisD = pad.axisD ? s.ay > 0.35 : s.ay > 0.6;
    pad.trig = pad.trig ? s.trig > 0.16 : s.trig > 0.3;
    pad.left = pad.left || pad.fL || s.b.dl;
    pad.right = pad.right || pad.fR || s.b.dr;
    pad.thrust = pad.thrust || s.b.a || pad.trig;
    const state = {
      horn: s.b.horn,
      pause: s.b.menu,
      back: s.b.back,
      up: s.b.du || pad.axisU,
      down: s.b.dd || pad.axisD,
      left: s.b.dl || pad.axisL,
      right: s.b.dr || pad.axisR,
      a: s.b.a,
      restart: s.b.restart,
    };
    for (const k in state) {
      if (state[k] && !pad.buttons[k]) newPressed[k] = true;
      pad.buttons[k] = state[k];
    }
  }
  pad.pressed = newPressed;
  // Controller presses are not DOM gestures, so nudge the audio context here
  // for controller-only play (a no-op once it is running).
  for (const k in newPressed) { AudioSys.ensureRunning(); break; }
}

const input = {
  get thrust() { return bindingsFor('thrust').some(k => keysDown.has(k)) || pad.thrust; },
  get left() { return bindingsFor('left').some(k => keysDown.has(k)) || pad.left; },
  get right() { return bindingsFor('right').some(k => keysDown.has(k)) || pad.right; },
};
function wasPressed(codes) {
  return pressedQueue.some(c => codes.includes(c));
}
function actionPressed(action) {
  return wasPressed(bindingsFor(action)) || (action === 'horn' && pad.pressed.horn);
}

/* =============================== canvas =============================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VIEW_W = 1280, VIEW_H = 720;
// TV-safe-area inset: keeps HUD and footer text inside ~95% title-safe zone
// so nothing clips under TV overscan on Xbox.
const TV_X = 34, TV_Y = 26;
function applyScale() {
  const s = save.settings.scale || 1;
  canvas.width = Math.round(VIEW_W * s);
  canvas.height = Math.round(VIEW_H * s);
}
applyScale();

/* ============================== particles ============================== */
const particles = [];
function spawnParticle(p) { if (particles.length < 900) particles.push(p); }
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += (p.grav || 0) * dt;
    p.vx *= 1 - (p.drag || 0) * dt;
    p.vy *= 1 - (p.drag || 0) * dt;
  }
}
function drawParticles(c) {
  for (const p of particles) {
    const a = clamp(p.life / p.maxLife, 0, 1);
    c.globalAlpha = a * (p.alpha || 1);
    c.fillStyle = p.color;
    const s = p.size * (p.shrink ? a : 1);
    if (p.glow) {
      c.shadowColor = p.color; c.shadowBlur = 12;
    }
    c.beginPath();
    c.arc(p.x, p.y, Math.max(0.5, s), 0, TAU);
    c.fill();
    c.shadowBlur = 0;
  }
  c.globalAlpha = 1;
}
function explosion(x, y) {
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * TAU, sp = 40 + Math.random() * 320;
    spawnParticle({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      life: 0.5 + Math.random() * 1.1, maxLife: 1.2, size: 2 + Math.random() * 5,
      color: ['#ffdd55', '#ff8833', '#ff4422', '#ffffff', '#888888'][i % 5],
      grav: 260, drag: 1.2, glow: i % 3 === 0, shrink: true,
    });
  }
}

/* ============================ level parsing ============================ */
function parseLevel(def) {
  const raw = def.map;
  let w = 0;
  for (const r of raw) w = Math.max(w, r.length);
  const inner = raw.map(r => r.padEnd(w, '.'));
  const W = w + 2, H = inner.length + 2;
  const grid = [];
  grid.push('#'.repeat(W));
  for (const r of inner) grid.push('#' + r.replace(/ /g, '.') + '#');
  grid.push('#'.repeat(W));

  const walls = [], pads = [], fuels = [];
  let spawn = { x: W * CELL / 2, y: H * CELL / 2 };
  const isWall = ch => ch === '#';
  const isPad = ch => ch >= 'A' && ch <= 'E';

  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const ch = grid[y][x];
      if (isWall(ch)) {
        let x2 = x;
        while (x2 < W && isWall(grid[y][x2])) x2++;
        walls.push({ x: x * CELL, y: y * CELL, w: (x2 - x) * CELL, h: CELL });
        x = x2;
      } else if (isPad(ch)) {
        let x2 = x;
        while (x2 < W && grid[y][x2] === ch) x2++;
        pads.push({ label: ch, x: x * CELL, y: y * CELL, w: (x2 - x) * CELL, h: CELL });
        x = x2;
      } else {
        if (ch === '*') fuels.push({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL, taken: false, bob: Math.random() * TAU });
        if (ch === 'S') spawn = { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL };
        x++;
      }
    }
  }

  // merge vertically adjacent identical wall rects (fewer rects, nicer rendering)
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i], b = walls[j];
        if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) {
          a.y = Math.min(a.y, b.y); a.h = a.h + b.h;
          walls.splice(j, 1); merged = true; break;
        }
      }
      if (merged) break;
    }
  }

  const hazards = (def.hazards || []).map(h => {
    const c = Object.assign({}, h);
    if (c.a) c.a = [(c.a[0] + 1) * CELL + CELL / 2 - CELL / 2, (c.a[1] + 1) * CELL];
    if (c.b) c.b = [(c.b[0] + 1) * CELL + CELL / 2 - CELL / 2, (c.b[1] + 1) * CELL];
    if (c.c) c.c = [(c.c[0] + 1) * CELL, (c.c[1] + 1) * CELL];
    if (c.p) c.p = [(c.p[0] + 1) * CELL, (c.p[1] + 1) * CELL];
    if (c.t === 'rocks' || c.t === 'meteors') { c.x0 = (c.x0 + 1) * CELL; c.x1 = (c.x1 + 1) * CELL; }
    if (c.r) c.r = c.r * CELL;
    return c;
  });

  // pad modifiers (moving / collapsing / ice / conveyor), keyed by pad label
  if (def.padMods) {
    for (const pad of pads) {
      const m = def.padMods[pad.label];
      if (!m) continue;
      if (m.ice) pad.ice = true;
      if (m.conveyor) pad.conveyor = m.conveyor; // signed px/s drift
      if (m.collapse) pad.collapse = m.collapse; // seconds after landing
      if (m.move) {
        pad.baseX = pad.x; pad.baseY = pad.y;
        pad.move = { axis: m.move.axis || 'x', range: (m.move.range || 4) * CELL,
          sp: m.move.sp || 0.6, ph: m.move.ph || 0, stop: m.move.stop || 0, accel: m.move.accel || 0, t: 0 };
      }
    }
  }

  const fares = def.fares.map(s => {
    const [from, to] = s.split('>');
    return { from, to };
  });

  return {
    name: def.name, dark: !!def.dark, sandstorm: !!def.sandstorm,
    startFuel: def.fuel || 100,
    W: W * CELL, H: H * CELL,
    walls, pads, fuels, hazards, spawn, fares,
  };
}

/* =============================== hazards =============================== */
class Beam {
  constructor(h, style) {
    this.a = h.a; this.b = h.b;
    this.on = h.on; this.off = h.off; this.ph = h.ph || 0;
    this.style = style; // 'laser' | 'zap'
    this.t = this.ph;
  }
  update(dt) { this.t += dt; }
  get phase() { return this.t % (this.on + this.off); }
  get active() { return this.phase < this.on; }
  get warming() { return !this.active && (this.on + this.off - this.phase) < 0.4; }
  hits(x, y, r) {
    return this.active && dist2seg(x, y, this.a[0], this.a[1], this.b[0], this.b[1]) < r + 2;
  }
  draw(c, time) {
    const [x1, y1] = this.a, [x2, y2] = this.b;
    const col = this.style === 'laser' ? '#ff3355' : '#55ccff';
    // emitters
    for (const [ex, ey] of [this.a, this.b]) {
      c.fillStyle = '#39404f';
      roundRect(c, ex - 8, ey - 8, 16, 16, 4); c.fill();
      c.fillStyle = this.active ? col : '#666';
      c.beginPath(); c.arc(ex, ey, 4, 0, TAU); c.fill();
    }
    if (this.active) {
      c.save();
      c.strokeStyle = col;
      c.shadowColor = col; c.shadowBlur = 16;
      if (this.style === 'laser') {
        c.lineWidth = 3 + Math.sin(time * 30) * 1;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        c.globalAlpha = 0.35; c.lineWidth = 9; c.stroke();
      } else {
        // jagged electric arc
        c.lineWidth = 2.5;
        const segs = Math.max(4, (Math.hypot(x2 - x1, y2 - y1) / 24) | 0);
        c.beginPath(); c.moveTo(x1, y1);
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          const nx = -(y2 - y1), ny = (x2 - x1);
          const nl = Math.hypot(nx, ny) || 1;
          const off = (Math.sin(time * 40 + i * 7.3) + Math.sin(time * 23 + i * 3.1)) * 6;
          c.lineTo(lerp(x1, x2, t) + nx / nl * off, lerp(y1, y2, t) + ny / nl * off);
        }
        c.lineTo(x2, y2); c.stroke();
        c.globalAlpha = 0.3; c.lineWidth = 7;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      }
      c.restore();
    } else if (this.warming) {
      c.save();
      c.globalAlpha = 0.25 + 0.2 * Math.sin(time * 40);
      c.strokeStyle = col; c.lineWidth = 1.5;
      c.setLineDash([6, 8]);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.restore();
    }
  }
}

class Fan {
  constructor(h) { this.x = h.c[0]; this.y = h.c[1]; this.r = h.r; this.sp = h.sp; this.ang = 0; }
  update(dt) { this.ang += this.sp * dt; }
  hits(x, y, r) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d > this.r + r) return false;
    if (d < 18 + r) return true; // hub
    for (let k = 0; k < 3; k++) {
      const a = this.ang + k * TAU / 3;
      const bx = this.x + Math.cos(a) * this.r, by = this.y + Math.sin(a) * this.r;
      if (dist2seg(x, y, this.x, this.y, bx, by) < r + 7) return true;
    }
    return false;
  }
  draw(c) {
    c.save();
    c.translate(this.x, this.y);
    c.rotate(this.ang);
    c.fillStyle = '#c8ccd8';
    c.shadowColor = '#8899ff'; c.shadowBlur = 8;
    for (let k = 0; k < 3; k++) {
      c.rotate(TAU / 3);
      c.beginPath();
      c.moveTo(0, -5);
      c.quadraticCurveTo(this.r * 0.55, -this.r * 0.22, this.r, -4);
      c.lineTo(this.r, 4);
      c.quadraticCurveTo(this.r * 0.55, this.r * 0.22, 0, 5);
      c.closePath();
      c.fill();
    }
    c.shadowBlur = 0;
    c.fillStyle = '#39404f';
    c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.fill();
    c.fillStyle = '#ffcc44';
    c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
    c.restore();
  }
}

class Mover {
  constructor(h) {
    this.bx = h.p[0]; this.by = h.p[1];
    this.w = h.w * CELL; this.h = h.h * CELL;
    this.axis = h.axis; this.range = h.range * CELL;
    this.sp = h.sp; this.ph = h.ph || 0; this.t = 0;
    this.x = this.bx; this.y = this.by;
  }
  update(dt) {
    this.t += dt;
    const off = this.range * 0.5 * (1 + Math.sin(this.t * this.sp + this.ph));
    this.x = this.bx + (this.axis === 'x' ? off : 0);
    this.y = this.by + (this.axis === 'y' ? off : 0);
  }
  hits(x, y, r) { return circleRect(x, y, r, this.x, this.y, this.w, this.h); }
  draw(c, time) {
    const g = c.createLinearGradient(this.x, this.y, this.x, this.y + this.h);
    g.addColorStop(0, '#5a6377'); g.addColorStop(1, '#343b4c');
    c.fillStyle = g;
    roundRect(c, this.x, this.y, this.w, this.h, 6); c.fill();
    c.strokeStyle = '#ffb347'; c.lineWidth = 2;
    c.setLineDash([8, 6]); c.lineDashOffset = -time * 40;
    roundRect(c, this.x + 3, this.y + 3, this.w - 6, this.h - 6, 4); c.stroke();
    c.setLineDash([]);
    c.fillStyle = `rgba(255,180,70,${0.6 + 0.4 * Math.sin(time * 6)})`;
    c.beginPath(); c.arc(this.x + this.w / 2, this.y + this.h / 2, 4, 0, TAU); c.fill();
  }
}

class RockSpawner {
  constructor(h) { this.x0 = h.x0; this.x1 = h.x1; this.iv = h.iv; this.timer = Math.random() * h.iv; this.rocks = []; }
  update(dt, game) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer += this.iv * (0.7 + Math.random() * 0.6);
      this.rocks.push({
        x: this.x0 + Math.random() * (this.x1 - this.x0),
        y: CELL + 10, vy: 20 + Math.random() * 40,
        r: 9 + Math.random() * 9, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 4,
        seed: Math.random() * 1000,
      });
    }
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const rk = this.rocks[i];
      rk.vy += 150 * dt;
      rk.y += rk.vy * dt;
      rk.rot += rk.vr * dt;
      let dead = rk.y > game.level.H + 40;
      if (!dead) {
        for (const w of game.level.walls.concat(game.level.pads)) {
          if (circleRect(rk.x, rk.y, rk.r, w.x, w.y, w.w, w.h)) { dead = true; break; }
        }
      }
      if (dead) {
        for (let k = 0; k < 8; k++) {
          spawnParticle({
            x: rk.x, y: rk.y, vx: (Math.random() - 0.5) * 140, vy: -Math.random() * 120,
            life: 0.5, maxLife: 0.5, size: 2.5, color: '#9a8b7a', grav: 300, shrink: true,
          });
        }
        this.rocks.splice(i, 1);
      }
    }
  }
  hits(x, y, r) {
    return this.rocks.some(rk => Math.hypot(rk.x - x, rk.y - y) < rk.r + r - 2);
  }
  draw(c) {
    for (const rk of this.rocks) {
      c.save();
      c.translate(rk.x, rk.y); c.rotate(rk.rot);
      c.fillStyle = '#8d7f6d';
      c.beginPath();
      const rnd = mulberry(rk.seed * 10000 | 0);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU;
        const rr = rk.r * (0.75 + rnd() * 0.4);
        if (k === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.beginPath(); c.arc(-rk.r * 0.25, -rk.r * 0.3, rk.r * 0.35, 0, TAU); c.fill();
      c.restore();
    }
  }
}

/* ---- Outer Rim hazards ---------------------------------------------------
   Force fields expose force(ship, dt); everything still supports update/hits/
   draw. Coordinates are pre-scaled by parseLevel (c/p in px, r in px). ------ */

// Fan-driven wind: a rectangular zone that pushes the cab (fx,fy px/s^2).
class Wind {
  constructor(h) {
    this.type = 'wind';
    this.x = h.p[0]; this.y = h.p[1];
    this.w = (h.w || 4) * CELL; this.h = (h.h || 4) * CELL;
    this.fx = h.fx || 0; this.fy = h.fy || 0;
    this.gust = h.gust || 0; this.t = Math.random() * 6;
  }
  update(dt) { this.t += dt; }
  force(ship, dt) {
    if (ship.dead || ship.landed) return;
    if (ship.x < this.x || ship.x > this.x + this.w || ship.y < this.y || ship.y > this.y + this.h) return;
    const g = (this.gust ? 0.55 + 0.45 * Math.sin(this.t * this.gust) : 1) * DIFF.haz;
    ship.vx += this.fx * g * dt; ship.vy += this.fy * g * dt;
  }
  hits() { return false; }
  draw(c, time) {
    const dir = Math.atan2(this.fy, this.fx);
    c.save();
    c.strokeStyle = 'rgba(150,200,255,0.28)'; c.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const px = this.x + ((i * 53 + time * (120 + (this.fx > 0 || this.fy > 0 ? 60 : 40))) % this.w);
      const py = this.y + ((i * 71) % this.h);
      c.beginPath(); c.moveTo(px, py);
      c.lineTo(px - Math.cos(dir) * 18, py - Math.sin(dir) * 18); c.stroke();
    }
    c.restore();
  }
}

// Magnetic zone: blue pulls the cab in, red pushes it away (radial, stronger near center).
class Magnet {
  constructor(h) {
    this.type = 'magnet';
    this.x = h.c[0]; this.y = h.c[1]; this.r = h.r;
    this.mode = h.mode || 'pull'; this.str = h.str || 300;
  }
  update() {}
  force(ship, dt) {
    if (ship.dead || ship.landed) return;
    const dx = this.x - ship.x, dy = this.y - ship.y, d = Math.hypot(dx, dy);
    if (d > this.r || d < 1) return;
    const f = this.str * DIFF.haz * (1 - d / this.r) * (this.mode === 'pull' ? 1 : -1);
    ship.vx += (dx / d) * f * dt; ship.vy += (dy / d) * f * dt;
  }
  hits() { return false; }
  draw(c, time) {
    const col = this.mode === 'pull' ? '80,150,255' : '255,80,90';
    c.save();
    for (let k = 0; k < 3; k++) {
      const rr = this.r * (0.4 + 0.3 * k) + (this.mode === 'pull' ? -1 : 1) * ((time * 40 + k * 30) % (this.r * 0.3));
      c.strokeStyle = `rgba(${col},${0.35 - k * 0.08})`; c.lineWidth = 2;
      c.beginPath(); c.arc(this.x, this.y, Math.max(6, rr), 0, TAU); c.stroke();
    }
    c.fillStyle = `rgba(${col},0.9)`; c.shadowColor = `rgb(${col})`; c.shadowBlur = 16;
    c.beginPath(); c.arc(this.x, this.y, 9, 0, TAU); c.fill();
    c.shadowBlur = 0; c.restore();
  }
}

// Tractor beam: a steady pull toward a docking point, escapable at full thrust.
class Tractor {
  constructor(h) {
    this.type = 'tractor';
    this.x = h.c[0]; this.y = h.c[1]; this.r = h.r; this.str = h.str || 330;
  }
  update() {}
  force(ship, dt) {
    if (ship.dead || ship.landed) return;
    const dx = this.x - ship.x, dy = this.y - ship.y, d = Math.hypot(dx, dy);
    if (d > this.r || d < 1) return;
    const s = this.str * DIFF.haz;
    ship.vx += (dx / d) * s * dt; ship.vy += (dy / d) * s * dt;
  }
  hits() { return false; }
  draw(c, time) {
    c.save();
    c.translate(this.x, this.y);
    const grad = c.createRadialGradient(0, 0, 6, 0, 0, this.r);
    grad.addColorStop(0, 'rgba(120,255,210,0.28)'); grad.addColorStop(1, 'rgba(120,255,210,0)');
    c.fillStyle = grad; c.beginPath(); c.arc(0, 0, this.r, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(120,255,210,0.5)'; c.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const rr = ((time * 50 + k * (this.r / 4)) % this.r);
      c.globalAlpha = 1 - rr / this.r;
      c.beginPath(); c.arc(0, 0, rr, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
    c.fillStyle = '#39404f'; c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.fill();
    c.fillStyle = '#7cffd2'; c.beginPath(); c.arc(0, 0, 6, 0, TAU); c.fill();
    c.restore();
  }
}

// Black hole: pull grows sharply near the core; the core itself is fatal.
class BlackHole {
  constructor(h) {
    this.type = 'blackhole';
    this.x = h.c[0]; this.y = h.c[1]; this.r = h.r; this.core = 24; this.spin = 0;
  }
  update(dt) { this.spin += dt * 2.4; }
  force(ship, dt) {
    if (ship.dead || ship.landed) return;
    const dx = this.x - ship.x, dy = this.y - ship.y, d = Math.hypot(dx, dy);
    if (d > this.r || d < 1) return;
    // inverse-square pull, now strong enough to be felt from well out and to
    // out-muscle the engine near the core; scales hard with difficulty.
    const pull = clamp(1.5e6 * DIFF.haz / (d * d), 0, 2600 * DIFF.haz);
    ship.vx += (dx / d) * pull * dt; ship.vy += (dy / d) * pull * dt;
    // a little swirl so it feels like an accretion spin
    ship.vx += (-dy / d) * pull * 0.25 * dt; ship.vy += (dx / d) * pull * 0.25 * dt;
  }
  hits(x, y, r) { return Math.hypot(x - this.x, y - this.y) < this.core + r; }
  draw(c, time) {
    c.save(); c.translate(this.x, this.y);
    const halo = c.createRadialGradient(0, 0, this.core, 0, 0, this.r);
    halo.addColorStop(0, 'rgba(120,60,180,0.30)'); halo.addColorStop(1, 'rgba(120,60,180,0)');
    c.fillStyle = halo; c.beginPath(); c.arc(0, 0, this.r, 0, TAU); c.fill();
    c.rotate(this.spin);
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = `rgba(200,150,255,${0.5 - k * 0.15})`; c.lineWidth = 3 - k;
      c.beginPath(); c.ellipse(0, 0, this.core + 10 + k * 12, this.core * 0.5 + k * 6, k * 1.1, 0, TAU); c.stroke();
    }
    c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, this.core, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(190,140,255,0.9)'; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, this.core, 0, TAU); c.stroke();
    c.restore();
  }
}

// Meteors: fast diagonal strikes from the top with a glowing trail.
class MeteorSpawner {
  constructor(h) {
    this.type = 'meteors';
    this.x0 = h.x0; this.x1 = h.x1; this.iv = h.iv;
    this.vx = (h.ang || 0) * 60; this.timer = Math.random() * h.iv;
    this.rocks = []; this.nextId = 1;
  }
  update(dt, core) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer += this.iv * (0.6 + Math.random() * 0.7) / DIFF.haz;
      this.rocks.push({ id: this.nextId++, x: this.x0 + Math.random() * (this.x1 - this.x0), y: CELL,
        vx: this.vx + (Math.random() - 0.5) * 30, vy: 190 + Math.random() * 90, r: 8 + Math.random() * 7, rot: 0, vr: (Math.random() - 0.5) * 6 });
    }
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const rk = this.rocks[i];
      rk.vy += 120 * dt; rk.x += rk.vx * dt; rk.y += rk.vy * dt; rk.rot += rk.vr * dt;
      spawnParticle({ x: rk.x, y: rk.y, vx: -rk.vx * 0.3, vy: -rk.vy * 0.2, life: 0.35, maxLife: 0.35, size: rk.r * 0.5, color: ['#ffce7a', '#ff8a3d', '#ff5522'][i % 3], glow: true, shrink: true });
      let dead = rk.y > core.level.H + 40 || rk.x < -40 || rk.x > core.level.W + 40;
      if (!dead) for (const w of core.level.walls) { if (circleRect(rk.x, rk.y, rk.r, w.x, w.y, w.w, w.h)) { dead = true; break; } }
      if (dead) { core.emit && 0; explosion(rk.x, rk.y); this.rocks.splice(i, 1); }
    }
  }
  hits(x, y, r) { return this.rocks.some(rk => Math.hypot(rk.x - x, rk.y - y) < rk.r + r - 2); }
  draw(c) {
    for (const rk of this.rocks) {
      c.save(); c.translate(rk.x, rk.y); c.rotate(rk.rot);
      c.fillStyle = '#c8632a'; c.shadowColor = '#ff7a2a'; c.shadowBlur = 14;
      c.beginPath(); c.arc(0, 0, rk.r, 0, TAU); c.fill(); c.shadowBlur = 0;
      c.fillStyle = 'rgba(255,220,150,0.5)'; c.beginPath(); c.arc(-rk.r * 0.3, -rk.r * 0.3, rk.r * 0.4, 0, TAU); c.fill();
      c.restore();
    }
  }
}

// Proximity mine: arms when the cab is near, short fuse, then a lethal blast.
class Mine {
  constructor(h) {
    this.type = 'mine';
    this.x = h.c[0]; this.y = h.c[1];
    this.trigR = (h.r || 88) * (0.85 + 0.15 * DIFF.haz); this.blastR = 74 * DIFF.haz;
    this.state = 'idle'; this.fuse = 0; this.blastT = 0; this.blink = 0;
  }
  update(dt, core) {
    const ship = core.ship;
    this.blink += dt;
    if (this.state === 'idle') {
      if (!ship.dead && Math.hypot(ship.x - this.x, ship.y - this.y) < this.trigR) { this.state = 'armed'; this.fuse = 0.85 / DIFF.haz; AudioSys.sfx.mine && AudioSys.sfx.mine(); }
    } else if (this.state === 'armed') {
      this.fuse -= dt;
      if (this.fuse <= 0) { this.state = 'boom'; this.blastT = 0.35; explosion(this.x, this.y); AudioSys.sfx.explosion(); }
    } else if (this.state === 'boom') { this.blastT -= dt; if (this.blastT <= 0) this.state = 'done'; }
  }
  hits(x, y, r) { return this.state === 'boom' && Math.hypot(x - this.x, y - this.y) < this.blastR + r; }
  draw(c, time) {
    if (this.state === 'done') return;
    c.save(); c.translate(this.x, this.y);
    if (this.state === 'boom') {
      const a = clamp(this.blastT / 0.35, 0, 1);
      c.globalAlpha = a; c.fillStyle = 'rgba(255,180,60,0.5)';
      c.beginPath(); c.arc(0, 0, this.blastR * (1.4 - a * 0.4), 0, TAU); c.fill(); c.globalAlpha = 1;
      c.restore(); return;
    }
    const armed = this.state === 'armed';
    const lit = armed ? (Math.sin(this.blink * 24) > 0) : (Math.sin(this.blink * 3) > 0);
    c.fillStyle = '#39404f'; c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.fill();
    for (let k = 0; k < 8; k++) { c.save(); c.rotate(k * TAU / 8); c.fillStyle = '#4a5163'; c.fillRect(10, -2, 6, 4); c.restore(); }
    c.fillStyle = lit ? (armed ? '#ff4455' : '#ffcf3f') : '#5b2530';
    if (lit) { c.shadowColor = armed ? '#ff4455' : '#ffcf3f'; c.shadowBlur = 12; }
    c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill(); c.shadowBlur = 0;
    c.restore();
  }
}

// Alien creature: a large body patrolling a line; deadly to touch, safe to avoid.
class Creature {
  constructor(h) {
    this.type = 'creature';
    this.bx = h.p[0]; this.by = h.p[1];
    this.w = (h.w || 3) * CELL; this.h = (h.h || 2) * CELL;
    this.axis = h.axis || 'x'; this.range = (h.range || 6) * CELL;
    this.sp = h.sp || 0.5; this.ph = h.ph || 0; this.t = 0; this.x = this.bx; this.y = this.by;
    this.hue = h.hue || 150;
  }
  update(dt) {
    this.t += dt;
    const off = this.range * 0.5 * (1 + Math.sin(this.t * this.sp * DIFF.haz + this.ph));
    this.x = this.bx + (this.axis === 'x' || this.axis === 'd' ? off : 0);
    this.y = this.by + (this.axis === 'y' || this.axis === 'd' ? off : 0);
  }
  hits(x, y, r) { return circleRect(x, y, r - 3, this.x + 4, this.y + 4, this.w - 8, this.h - 8); }
  draw(c, time) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    c.save(); c.translate(cx, cy);
    const wob = Math.sin(time * 3 + this.ph) * 3;
    c.fillStyle = `hsl(${this.hue},55%,40%)`;
    c.shadowColor = `hsl(${this.hue},70%,50%)`; c.shadowBlur = 12;
    c.beginPath(); c.ellipse(0, 0, this.w / 2, this.h / 2 + wob, 0, 0, TAU); c.fill(); c.shadowBlur = 0;
    // eyes
    c.fillStyle = '#fff';
    for (const ex of [-this.w * 0.16, this.w * 0.16]) { c.beginPath(); c.arc(ex, -this.h * 0.1, 6, 0, TAU); c.fill(); }
    c.fillStyle = '#101018';
    for (const ex of [-this.w * 0.16, this.w * 0.16]) { c.beginPath(); c.arc(ex + Math.sin(time * 2) * 2, -this.h * 0.1, 3, 0, TAU); c.fill(); }
    // tentacles
    c.strokeStyle = `hsl(${this.hue},55%,35%)`; c.lineWidth = 4; c.lineCap = 'round';
    for (let k = -2; k <= 2; k++) {
      c.beginPath(); c.moveTo(k * this.w * 0.16, this.h * 0.35);
      c.lineTo(k * this.w * 0.16 + Math.sin(time * 4 + k) * 5, this.h * 0.55 + wob); c.stroke();
    }
    c.restore();
  }
}

// Teleport gate pair: fly into one, pop out the other (short cooldown so you
// don't ping-pong).
class Teleport {
  constructor(h) {
    this.type = 'teleport';
    this.a = h.a; this.b = h.b; this.r = 24; this.cool = 0;
  }
  update(dt, core) {
    if (this.cool > 0) { this.cool -= dt; return; }
    const ship = core.ship; if (ship.dead || ship.landed) return;
    const port = (from, to) => { ship.x = to[0]; ship.y = to[1]; this.cool = 0.9; AudioSys.sfx.warp && AudioSys.sfx.warp();
      for (let i = 0; i < 16; i++) { const ang = Math.random() * TAU; spawnParticle({ x: to[0], y: to[1], vx: Math.cos(ang) * 120, vy: Math.sin(ang) * 120, life: 0.4, maxLife: 0.4, size: 3, color: '#b98cff', glow: true, shrink: true }); } };
    if (Math.hypot(ship.x - this.a[0], ship.y - this.a[1]) < this.r) port(this.a, this.b);
    else if (Math.hypot(ship.x - this.b[0], ship.y - this.b[1]) < this.r) port(this.b, this.a);
  }
  hits() { return false; }
  draw(c, time) {
    for (const [gx, gy, hue] of [[this.a[0], this.a[1], 275], [this.b[0], this.b[1], 190]]) {
      c.save(); c.translate(gx, gy); c.rotate(time * 1.5);
      for (let k = 0; k < 3; k++) {
        c.strokeStyle = `hsla(${hue},80%,65%,${0.7 - k * 0.2})`; c.lineWidth = 3;
        c.beginPath(); c.ellipse(0, 0, this.r + 3, this.r * 0.5 + k * 4, k * 1.0, 0, TAU); c.stroke();
      }
      c.fillStyle = `hsla(${hue},80%,55%,0.35)`; c.beginPath(); c.arc(0, 0, this.r, 0, TAU); c.fill();
      c.restore();
    }
  }
}

function buildHazard(h) {
  switch (h.t) {
    case 'laser': return new Beam(h, 'laser');
    case 'zap': return new Beam(h, 'zap');
    case 'fan': return new Fan(h);
    case 'mover': return new Mover(h);
    case 'rocks': return new RockSpawner(h);
    case 'wind': return new Wind(h);
    case 'magnet': return new Magnet(h);
    case 'tractor': return new Tractor(h);
    case 'blackhole': return new BlackHole(h);
    case 'meteors': return new MeteorSpawner(h);
    case 'mine': return new Mine(h);
    case 'creature': return new Creature(h);
    case 'teleport': return new Teleport(h);
  }
  return null;
}

/* =============================== passenger =============================== */
// Funny hails a waiting fare shouts to flag you down (plain spelling so the
// text-to-speech voices pronounce them cleanly).
const CALLOUTS = [
  "YO! SPACE CAB!",
  "I'M LOSING OXYGEN OVER HERE!",
  "COME ON, CAPTAIN!",
  "DON'T MAKE ME SPACEWALK!",
  "I'M STANDING ON AN ASTEROID HERE!",
  "I'M FREEZING OVER HERE!",
  "HEY! DOWN HERE, FLYBOY!",
  "MY METER'S RUNNING, PAL!",
  "ANY CENTURY NOW, BUDDY!",
  "LOOK ALIVE UP THERE!",
  "I GOT PLACES TO BE, CAPTAIN!",
  "WHAT'S THE MATTER, YOU BLIND?",
  "OVER HERE, GENIUS!",
  "I'M WAVING RIGHT HERE!",
  "THIS ROCK ISN'T COMFY!",
  "HELLO? PAYING CUSTOMER!",
];
// Short reliefs a fare blurts when the cab finally sets down for them.
const BOARD_CALLS = ["FINALLY!", "ABOUT TIME!", "THERE HE IS!", "YES! OVER HERE!", "NOW WE'RE TALKING!", "MY HERO!"];
const pickLine = arr => arr[(Math.random() * arr.length) | 0];

// Voice personalities: each fare picks one so their lines stay consistent, and
// different fares sound clearly distinct. Ranges are [pitch, rate] bands.
const VOICE_PROFILES = [
  { pitch: [1.7, 2.0], rate: [1.25, 1.45] }, // squeaky, excitable
  { pitch: [0.6, 0.8], rate: [0.82, 0.98] }, // gruff, low grumbler
  { pitch: [1.4, 1.65], rate: [1.05, 1.25] }, // nasal, whiny
  { pitch: [0.8, 1.0], rate: [0.9, 1.05] },  // booming, deep
  { pitch: [1.3, 1.55], rate: [1.35, 1.55] }, // chipper motormouth
  { pitch: [1.0, 1.2], rate: [0.8, 0.92] },  // slow, deadpan drawl
  { pitch: [1.55, 1.8], rate: [1.4, 1.6] },  // frantic, panicky
];
function makeVoice() {
  const p = VOICE_PROFILES[(Math.random() * VOICE_PROFILES.length) | 0];
  const span = (a, b) => a + (b - a) * Math.random();
  // vi selects a distinct installed system voice; pitch/rate shape it further
  return { pitch: span(p.pitch[0], p.pitch[1]), rate: span(p.rate[0], p.rate[1]), vi: (Math.random() * 1000) | 0 };
}

class Passenger {
  constructor(pad, destLabel) {
    this.pad = pad;
    this.dest = destLabel;
    this.x = pad.x + pad.w / 2 + (Math.random() - 0.5) * pad.w * 0.4;
    this.y = pad.y;
    this.state = 'waiting'; // waiting -> walking -> boarding -> riding -> exiting -> gone
    this.walkT = 0;
    this.hue = (Math.random() * 360) | 0;
    this.voice = makeVoice();           // this fare's consistent personality
    this.shout = 0.8 + Math.random() * 0.9; // first hail comes promptly
    this.hurried = false;
  }
  update(dt, game) {
    const ship = game.ship;
    this.walkT += dt;
    if (this.state === 'waiting') {
      this.shout -= dt;
      if (this.shout < 0) {
        this.shout = 5 + Math.random() * 6;
        // a waiting fare hollers so the player can find them
        const line = pickLine(CALLOUTS);
        game.floatText(this.x, this.y - 46, line, '#ffe066');
        AudioSys.say(line, this.voice);
      }
      if (ship.landedPad === this.pad && ship.landed) {
        this.state = 'walking';
        AudioSys.say(pickLine(BOARD_CALLS), this.voice);
      }
    } else if (this.state === 'walking') {
      if (!ship.landed || ship.landedPad !== this.pad) { this.state = 'waiting'; return; }
      const spd = this.hurried ? 130 : 70;
      const dx = ship.x - this.x;
      this.x += clamp(dx, -spd * dt, spd * dt);
      if (Math.abs(dx) < 20) {
        this.state = 'riding';
        game.onPickup(this);
      }
    } else if (this.state === 'riding') {
      this.x = ship.x; this.y = ship.y;
    } else if (this.state === 'exiting') {
      this.x += this.exitDir * 70 * dt;
      // never walk past the pad edge — stop at it and wait to be cleared
      if (this.exitPad) {
        this.x = clamp(this.x, this.exitPad.x + 12, this.exitPad.x + this.exitPad.w - 12);
      }
      this.exitT -= dt;
      if (this.exitT <= 0) this.state = 'gone';
    }
  }
  draw(c, time) {
    if (this.state === 'riding' || this.state === 'gone') return;
    const walking = this.state === 'walking' || this.state === 'exiting';
    const bob = walking ? Math.abs(Math.sin(this.walkT * 10)) * 3 : 0;
    const x = this.x, y = this.y - bob;
    c.save();
    // legs
    c.strokeStyle = '#2b2f3d'; c.lineWidth = 3; c.lineCap = 'round';
    const legSwing = walking ? Math.sin(this.walkT * 10) * 5 : 0;
    c.beginPath(); c.moveTo(x - 3, y - 12); c.lineTo(x - 3 - legSwing, y); c.stroke();
    c.beginPath(); c.moveTo(x + 3, y - 12); c.lineTo(x + 3 + legSwing, y); c.stroke();
    // body
    c.fillStyle = `hsl(${this.hue},60%,55%)`;
    roundRect(c, x - 6, y - 24, 12, 14, 4); c.fill();
    // head
    c.fillStyle = '#ffd9b3';
    c.beginPath(); c.arc(x, y - 30, 6, 0, TAU); c.fill();
    // waving arm when waiting
    if (this.state === 'waiting') {
      const wave = Math.sin(time * 8) * 0.6;
      c.strokeStyle = `hsl(${this.hue},60%,45%)`;
      c.beginPath(); c.moveTo(x + 5, y - 20);
      c.lineTo(x + 12, y - 30 - wave * 6); c.stroke();
    }
    c.restore();
  }
}

/* ================================= ship ================================= */
const SHIP_R = 15;
class Ship {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.fuel = 100;
    this.landed = false;
    this.landedPad = null;
    this.dead = false;
    this.thrustLevel = 0;
    this.airTime = 0;         // seconds since last takeoff
    this.tookOffFrom = null;  // pad we last lifted off from
  }
  skids() {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const pt = (lx, ly) => ({ x: this.x + lx * cos - ly * sin, y: this.y + lx * sin + ly * cos });
    return [pt(-13, 19), pt(13, 19)];
  }
  update(dt, game) {
    if (this.dead) return;
    const thrusting = input.thrust && this.fuel > 0;
    const rotating = (input.left || input.right) && this.fuel > 0;

    if (rotating) {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (this.landed) {
        // can't rotate while parked
      } else {
        this.angle += dir * DIFF.rot * dt;
        this.angle = clamp(this.angle, -Math.PI * 0.9, Math.PI * 0.9);
        this.fuel -= DIFF.rotBurn * dt;
      }
    }
    this.thrustLevel = lerp(this.thrustLevel, thrusting ? 1 : 0, clamp(dt * 12, 0, 1));

    if (thrusting) {
      const ax = Math.sin(this.angle) * DIFF.thrust;
      const ay = -Math.cos(this.angle) * DIFF.thrust;
      this.vx += ax * dt;
      this.vy += ay * dt;
      this.fuel -= DIFF.burn * dt;
      if (this.landed) {
        this.tookOffFrom = this.landedPad;
        this.airTime = 0;
        this.landed = false;
        this.landedPad = null;
      }
      // flame particles
      for (let i = 0; i < 3; i++) {
        const back = this.angle + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        spawnParticle({
          x: this.x - Math.sin(this.angle) * 18 + (Math.random() - 0.5) * 6,
          y: this.y + Math.cos(this.angle) * 18,
          vx: -Math.sin(this.angle) * (120 + Math.random() * 80) + this.vx * 0.5 + (Math.random() - 0.5) * 50,
          vy: Math.cos(this.angle) * (120 + Math.random() * 80) + this.vy * 0.5 + (Math.random() - 0.5) * 50,
          life: 0.25 + Math.random() * 0.2, maxLife: 0.4,
          size: 3 + Math.random() * 3,
          color: ['#ffdd66', '#ff9944', '#ff5522'][i % 3],
          glow: true, shrink: true, drag: 2,
        });
      }
    }
    if (rotating && !this.landed) {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const side = this.angle + (dir > 0 ? Math.PI : 0);
      spawnParticle({
        x: this.x + Math.cos(side) * 16, y: this.y + Math.sin(side) * 16,
        vx: Math.cos(side) * 90 + this.vx * 0.5, vy: Math.sin(side) * 90 + this.vy * 0.5,
        life: 0.18, maxLife: 0.18, size: 2, color: '#aaccff', glow: true, shrink: true,
      });
    }
    this.fuel = Math.max(0, this.fuel);
    AudioSys.setEngine(thrusting ? this.thrustLevel : 0, rotating && !this.landed);

    if (!this.landed) {
      this.airTime += dt;
      this.vy += DIFF.grav * dt; // gravity
      this.vx *= 1 - DIFF.dragX * dt;
      this.vy *= 1 - DIFF.dragY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      // settle angle toward level slowly when not rotating
      if (!rotating) this.angle *= 1 - 1.2 * dt;
    } else {
      // landed. Ice keeps you sliding (slow decel); conveyors drag you sideways;
      // otherwise you're parked. If you slide off the pad edge, you drop.
      const pad = this.landedPad;
      if (pad && pad.ice && !thrusting) {
        this.vx *= 1 - 1.6 * dt; this.vy = 0; this.x += this.vx * dt;
      } else if (pad && pad.conveyor && !thrusting) {
        this.vx = pad.conveyor; this.vy = 0; this.x += this.vx * dt;
      } else {
        this.vx = 0; this.vy = 0;
      }
      if (pad && (pad.ice || pad.conveyor) && (this.x < pad.x + 6 || this.x > pad.x + pad.w - 6)) {
        this.landed = false; this.landedPad = null; // slid off the edge
      }
      this.angle *= 1 - 8 * dt;
    }
  }
  draw(c, time) {
    if (this.dead) return;
    c.save();
    c.translate(this.x, this.y);
    c.rotate(this.angle);

    // engine glow under ship
    if (this.thrustLevel > 0.05) {
      const g = c.createRadialGradient(0, 22, 2, 0, 22, 34);
      g.addColorStop(0, `rgba(255,190,80,${0.7 * this.thrustLevel})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 22, 34, 0, TAU); c.fill();
      // flame
      const fl = 10 + this.thrustLevel * (12 + Math.sin(time * 60) * 4);
      const fg = c.createLinearGradient(0, 14, 0, 14 + fl);
      fg.addColorStop(0, '#fff6cc'); fg.addColorStop(0.5, '#ffaa33'); fg.addColorStop(1, 'rgba(255,60,20,0)');
      c.fillStyle = fg;
      c.beginPath();
      c.moveTo(-6, 14); c.quadraticCurveTo(0, 14 + fl * 1.6, 6, 14); c.closePath();
      c.fill();
    }

    // landing skids
    c.strokeStyle = '#9aa3b5'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-10, 10); c.lineTo(-13, 19); c.stroke();
    c.beginPath(); c.moveTo(10, 10); c.lineTo(13, 19); c.stroke();
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(-17, 19); c.lineTo(-9, 19); c.stroke();
    c.beginPath(); c.moveTo(9, 19); c.lineTo(17, 19); c.stroke();

    // body
    const bg = c.createLinearGradient(0, -16, 0, 14);
    bg.addColorStop(0, '#ffd94d'); bg.addColorStop(0.6, '#ffb521'); bg.addColorStop(1, '#e08a00');
    c.fillStyle = bg;
    roundRect(c, -18, -12, 36, 26, 11); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.5;
    roundRect(c, -18, -12, 36, 26, 11); c.stroke();

    // checker taxi stripe
    c.fillStyle = '#20242f';
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) c.fillRect(-16 + i * 5.4, 4, 5.4, 5);
    }

    // cockpit window
    const wg = c.createLinearGradient(-6, -12, 8, 0);
    wg.addColorStop(0, '#cfefff'); wg.addColorStop(1, '#5cb3e6');
    c.fillStyle = wg;
    roundRect(c, 0, -10, 15, 12, 6); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(c, 3, -8, 6, 4, 2); c.fill();

    // roof sign
    c.fillStyle = '#20242f';
    roundRect(c, -9, -19, 18, 8, 3); c.fill();
    c.fillStyle = `rgba(255,230,100,${0.75 + 0.25 * Math.sin(time * 4)})`;
    c.font = 'bold 6px monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TAXI', 0, -14.5);

    // main engine nozzle
    c.fillStyle = '#4a5163';
    roundRect(c, -7, 12, 14, 5, 2); c.fill();
    c.restore();
  }
}

/* ============================== campaigns ============================== */
// Two level sets. The original is "Cosmo Cab"; "Outer Rim" is a harder second
// campaign built on a whole new hazard suite (force fields, moving/collapsing/
// ice pads, meteors, mines, teleport gates, black holes, ...).
// CAMPAIGNS + OUTER_LEVELS come from levels.js.
function campaignCount() { return typeof CAMPAIGNS !== 'undefined' ? CAMPAIGNS.length : 1; }
function campaignLevels(ci) {
  if (typeof CAMPAIGNS !== 'undefined') return CAMPAIGNS[ci].levels;
  return LEVELS; // fallback if levels.js predates campaigns
}
function campaignId(ci) { return typeof CAMPAIGNS !== 'undefined' ? CAMPAIGNS[ci].id : 'cosmo'; }
function campaignName(ci) { return typeof CAMPAIGNS !== 'undefined' ? CAMPAIGNS[ci].name : 'COSMO CAB'; }
// per-campaign unlock progress, migrating the old single number if present
function ensureUnlockObj() {
  if (typeof save.unlocked === 'number') save.unlocked = { cosmo: save.unlocked };
  else if (!save.unlocked || typeof save.unlocked !== 'object') save.unlocked = {};
}
function unlockedIn(ci) { ensureUnlockObj(); return save.unlocked[campaignId(ci)] || 1; }
function setUnlocked(ci, n) {
  ensureUnlockObj();
  const id = campaignId(ci);
  save.unlocked[id] = Math.max(save.unlocked[id] || 1, n);
}

/* ================================ game ================================ */
const ST = { MENU: 0, LEVELS: 1, SCORES: 2, SETTINGS: 3, GAME: 4, COSMOS: 5 };
let state = ST.MENU;
let menuIndex = 0;
let settingsIndex = 0;
let levelSelIndex = 0;
let levelSelCampaign = 0; // which cosmos (campaign) the level grid is showing
let cosmosIndex = 0;      // selection on the cosmos-picker screen
let settingsReturn = ST.MENU;

const G = {
  campaign: 0,        // active campaign index
  levelIndex: 0,
  level: null,
  ship: null,
  hazardObjs: [],
  passenger: null,
  fareIndex: 0,
  score: 0,
  levelScore: 0,
  fareTimer: 0,
  parTime: 30,
  saidHurry: false,
  cam: { x: 0, y: 0 },
  shake: 0,
  msg: null, msgT: 0,
  floats: [],
  introT: 99,
  pendingFare: 0, // sim-time countdown to the next passenger spawn
  exitGate: null, // final step: fly out through an opened border section
  sub: 'play', // play | dead | fuelout | complete | paused | winall
  deathReason: '',
  completeT: 0,
  pauseIndex: 0,
  time: 0,

  floatText(x, y, text, color) {
    this.floats.push({ x, y, text, color, life: 1.4, maxLife: 1.4 });
  },
  showMsg(text, dur) {
    this.msg = text; this.msgT = dur || 2;
  },

  startLevel(idx, campaign) {
    if (campaign !== undefined) this.campaign = campaign;
    this.levelIndex = idx;
    this.level = parseLevel(campaignLevels(this.campaign)[idx]);
    this.ship = new Ship(this.level.spawn.x, this.level.spawn.y);
    this.ship.fuel = this.level.startFuel; // fuel-challenge levels start low
    this.hazardObjs = this.level.hazards.map(buildHazard).filter(Boolean);
    this.fareIndex = 0;
    this.levelScore = 0;
    this.sub = 'play';
    this.passenger = null;
    this.floats = [];
    particles.length = 0;
    this.time = 0;
    this.introT = 0; // animated board-title card plays until INTRO_DUR
    this.pendingFare = 0;
    this.exitGate = null;
    this.cam.x = this.ship.x - VIEW_W / 2;
    this.cam.y = this.ship.y - VIEW_H / 2;
    this.spawnFare();
    this.sub = 'intro'; // standalone board-title screen before play begins
    AudioSys.playMusic(61 + idx % 3); // intro jingle, distinct from board music
    state = ST.GAME;
  },

  beginPlay() {
    if (this.sub !== 'intro') return;
    this.sub = 'play';
    this.introT = 99;
    AudioSys.playMusic(this.levelIndex + 1);
  },

  padByLabel(l) { return this.level.pads.find(p => p.label === l); },

  spawnFare() {
    const fare = this.level.fares[this.fareIndex];
    if (!fare) return;
    const fromPad = this.padByLabel(fare.from);
    this.passenger = new Passenger(fromPad, fare.to);
    // If the cab is already at this pad (parked on it, or descending onto it at
    // the start of the board), place the fare at the far edge — opposite the
    // cab — so you always watch them walk the length of the pad and climb in.
    const ship = this.ship;
    const overX = ship.x > fromPad.x - 8 && ship.x < fromPad.x + fromPad.w + 8;
    const atPad = (ship.landed && ship.landedPad === fromPad) ||
                  (!ship.landed && overX && ship.y < fromPad.y + 40);
    if (atPad) {
      const onLeft = ship.x < fromPad.x + fromPad.w / 2;
      this.passenger.x = onLeft ? fromPad.x + fromPad.w - 16 : fromPad.x + 16;
      this.passenger.y = fromPad.y;
    }
    const d = Math.hypot(
      (this.padByLabel(fare.to).x - fromPad.x),
      (this.padByLabel(fare.to).y - fromPad.y));
    this.parTime = 18 + d / 60;
    this.fareTimer = 0;
    this.saidHurry = false;
  },

  onPickup(pass) {
    this.score += 100;
    this.floatText(this.ship.x, this.ship.y - 50, '+100', '#7cff9a');
    AudioSys.sfx.pickup();
    this.fareTimer = 0;
    this.saidHurry = false;
    if (this.fareIndex >= this.level.fares.length - 1) {
      // last fare: once aboard, this passenger calls the exit direction and
      // rides out through the wall — no pad destination for the final fare
      this.score += 200;
      this.floatText(this.ship.x, this.ship.y - 68, '+200', '#7cff9a');
      this.openExit();
    } else {
      this.showMsg(`TAKE ME TO PAD ${pass.dest}!`, 2.5);
      AudioSys.say('Pad ' + pass.dest + ', and step on it!', pass.voice);
    }
  },

  onDeliver() {
    let pts = 200;
    const fast = this.fareTimer < this.parTime;
    if (fast) pts += 100;
    this.score += pts;
    this.floatText(this.ship.x, this.ship.y - 50, '+' + pts, '#7cff9a');
    // the fare pays for gas — a fuel top-up per delivery that scales the
    // budget with board length (more fares on longer boards = more refuel)
    const before = this.ship.fuel;
    this.ship.fuel = Math.min(100, this.ship.fuel + 16);
    if (this.ship.fuel - before > 1) {
      this.floatText(this.ship.x, this.ship.y - 28, '+FUEL', '#66ffcc');
    }
    AudioSys.sfx.dropoff();
    const pass = this.passenger;
    this.fareIndex++;
    if (this.fareIndex >= this.level.fares.length) {
      // final step: the last passenger stays aboard and calls the exit —
      // a section of the border wall opens and you fly the cab out
      this.openExit();
      return;
    }
    this.showMsg(fast ? 'DELIVERED! FAST BONUS!' : 'DELIVERED!', 2);
    AudioSys.say(pickLine(["Thanks a million, pal!", "You're a lifesaver!", "Keep the change, captain!", "Now that's a ride!", "You did good, flyboy!"]), pass.voice);
    const dropPad = this.ship.landedPad;
    pass.state = 'exiting';
    // step off toward the roomier side, but stay ON the pad (don't walk off
    // the edge into space when the cab leaves for a different pad)
    pass.exitDir = (this.ship.x - (dropPad.x + dropPad.w / 2)) < 0 ? 1 : -1;
    pass.exitT = 1.4;
    pass.exitPad = dropPad;
    pass.x = this.ship.x; pass.y = dropPad.y;
    // If the next fare waits on the very pad we're parked on, give a longer
    // beat so the pad clears before they stroll on (see spawnFare for placement).
    const nextFare = this.level.fares[this.fareIndex];
    const samePad = nextFare && nextFare.from === dropPad.label;
    this.pendingFare = samePad ? 3 + Math.random() : 0.9;
  },

  // choose a border section with clear interior approach for the exit opening
  pickExit() {
    const GW = 100, L = this.level;
    const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    const solids = L.walls.concat(L.pads);
    const clearOfWalls = r => !solids.some(w => overlap(r, w));
    // static footprint of a hazard (blink state ignored — for placement we
    // avoid anywhere a hazard can occupy, so exits steer clear of lasers,
    // fans, patrolling blocks, and rock-fall columns)
    const hazBlocks = r => this.hazardObjs.some(h => {
      if (h instanceof Beam) {
        for (let t = 0; t <= 1; t += 0.05) {
          const x = h.a[0] + (h.b[0] - h.a[0]) * t, y = h.a[1] + (h.b[1] - h.a[1]) * t;
          if (x >= r.x - 8 && x <= r.x + r.w + 8 && y >= r.y - 8 && y <= r.y + r.h + 8) return true;
        }
        return false;
      }
      if (h instanceof Fan) {
        const nx = clamp(h.x, r.x, r.x + r.w), ny = clamp(h.y, r.y, r.y + r.h);
        return Math.hypot(h.x - nx, h.y - ny) < h.r + 8;
      }
      if (h instanceof Mover) {
        let minx = h.bx, maxx = h.bx + h.w, miny = h.by, maxy = h.by + h.h;
        if (h.axis === 'x') { minx = Math.min(h.bx, h.bx + h.range); maxx = Math.max(h.bx, h.bx + h.range) + h.w; }
        else { miny = Math.min(h.by, h.by + h.range); maxy = Math.max(h.by, h.by + h.range) + h.h; }
        return overlap(r, { x: minx, y: miny, w: maxx - minx, h: maxy - miny });
      }
      if (h instanceof RockSpawner) return !(r.x + r.w <= h.x0 || h.x1 <= r.x); // full fall column
      return false;
    });
    const clear = r => clearOfWalls(r) && !hazBlocks(r);
    // how far the clear channel extends inward from an opening (deeper = more
    // open runway to line up the exit, i.e. away from obstacles)
    const channelDepth = (cx, edge) => {
      let d = 44;
      const cap = L.H * 0.6;
      while (d < cap) {
        const r = edge === 'up'
          ? { x: cx - GW / 2, y: d, w: GW, h: 20 }
          : { x: cx - GW / 2, y: L.H - d - 20, w: GW, h: 20 };
        if (!clear(r)) break;
        d += 20;
      }
      return d;
    };
    // Exits are only ever up or down, placed near the horizontal center. Score
    // rewards a deep clear channel and penalizes distance from center, so the
    // opening lands as centered as possible on whichever edge is most open.
    const cands = [];
    for (let cx = 140; cx <= L.W - 140; cx += 20) {
      for (const edge of ['up', 'down']) {
        const probe = edge === 'up'
          ? { x: cx - GW / 2, y: 44, w: GW, h: 112 }
          : { x: cx - GW / 2, y: L.H - 156, w: GW, h: 112 };
        if (!clear(probe)) continue;
        const depth = channelDepth(cx, edge);
        const centerDist = Math.abs(cx - L.W / 2);
        cands.push({ edge, cx, cy: edge === 'up' ? 0 : L.H, score: depth * 0.6 - centerDist });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const pick = cands[0] || { edge: 'up', cx: L.W / 2, cy: 0 };
    // The pass-through corridor must reach far enough INSIDE the border that
    // the ship enters it before its hull (radius SHIP_R) touches the wall's
    // inner face at CELL. CELL(40) + SHIP_R(15) = 55, so a 70px inner lip
    // gives 15px of margin. It stays within the 112px zone verified clear above.
    const IN = 70, OUT = 70;
    const rect = pick.edge === 'up'
      ? { x: pick.cx - GW / 2, y: -OUT, w: GW, h: OUT + IN }
      : { x: pick.cx - GW / 2, y: L.H - IN, w: GW, h: OUT + IN };
    return Object.assign(pick, { rect, openT: 0, GW });
  },

  inExitCorridor(x, y) {
    const g = this.exitGate;
    if (!g || g.openT < 0.65) return false;
    const r = g.rect;
    return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  },

  openExit() {
    this.exitGate = this.pickExit();
    this.saidHurry = true; // no HURRY nag during the exit run
    const word = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }[this.exitGate.edge];
    this.showMsg(word + ' PLEASE!', 3.5);
    const voice = this.passenger && this.passenger.voice;
    AudioSys.say(word.charAt(0) + word.slice(1).toLowerCase() + ', please!', voice);
    if (AudioSys.sfx.gate) AudioSys.sfx.gate();
  },

  completeLevel() {
    this.sub = 'complete';
    this.completeT = 0;
    const fuelBonus = Math.round(this.ship.fuel);
    this.score += fuelBonus;
    this.levelScore = fuelBonus;
    AudioSys.setEngine(0, false);
    AudioSys.sfx.bonus();
    if (this.levelIndex + 1 < campaignLevels(this.campaign).length) {
      setUnlocked(this.campaign, this.levelIndex + 2);
      persist();
    }
  },

  crash(reason) {
    if (this.ship.dead) return;
    this.ship.dead = true;
    this.sub = 'dead';
    this.deathReason = reason;
    this.score = Math.max(0, this.score - 100);
    explosion(this.ship.x, this.ship.y);
    this.shake = 1;
    AudioSys.setEngine(0, false);
    AudioSys.sfx.explosion();
  },

  outOfFuel() {
    if (this.sub !== 'play') return;
    this.sub = 'fuelout';
    this.score = Math.max(0, this.score - 50);
    AudioSys.setEngine(0, false);
    this.showMsg('OUT OF FUEL!', 3);
  },

  saveScore() {
    if (this.score <= 0) return;
    save.highscores.push({ score: this.score, level: this.levelIndex + 1, campaign: campaignName(this.campaign), date: new Date().toISOString().slice(0, 10) });
    save.highscores.sort((a, b) => b.score - a.score);
    save.highscores = save.highscores.slice(0, 10);
    persist();
  },

  // Moving / collapsing platforms. Moving pads carry the parked cab and any
  // waiting fare; collapsing pads vanish a few seconds after you land.
  updatePads(dt) {
    const ship = this.ship, pass = this.passenger;
    for (const pad of this.level.pads) {
      if (pad.gone) continue;
      if (pad.move) {
        const mv = pad.move;
        // accel: speed ramps up over time; stop: dwell at the ends (clip the wave)
        mv.t += dt * (1 + (mv.accel || 0) * mv.t * 0.03);
        let s = Math.sin(mv.t * mv.sp + mv.ph);
        if (mv.stop) s = clamp(s * (1 + mv.stop), -1, 1);
        const off = mv.range * 0.5 * (1 + s);
        const nx = pad.baseX + (mv.axis === 'x' || mv.axis === 'd' ? off : 0);
        const ny = pad.baseY + (mv.axis === 'y' || mv.axis === 'd' ? off : 0);
        const ddx = nx - pad.x, ddy = ny - pad.y;
        pad.x = nx; pad.y = ny;
        if (ship.landed && ship.landedPad === pad) { ship.x += ddx; ship.y += ddy; }
        if (pass && pass.pad === pad && (pass.state === 'waiting' || pass.state === 'walking' || pass.state === 'exiting')) {
          pass.x += ddx; pass.y = pad.y;
        }
      }
      if (pad.collapse && pad.collapseT !== undefined && pad.collapseT > 0) {
        pad.collapseT -= dt;
        if (pad.collapseT <= 0) {
          pad.gone = true;
          if (ship.landedPad === pad) { ship.landed = false; ship.landedPad = null; }
        }
      }
    }
  },

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg = null; }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt; f.y -= 30 * dt;
      if (f.life <= 0) this.floats.splice(i, 1);
    }
    updateParticles(dt);

    if (this.sub === 'paused') return;

    // board-title screen: the world is hidden and frozen until it ends
    if (this.sub === 'intro') {
      this.introT += dt;
      if (this.introT >= INTRO_DUR) this.beginPlay();
      return;
    }

    for (const h of this.hazardObjs) h.update(dt, this);

    if (this.sub === 'complete') {
      this.completeT += dt;
      if (this.passenger) this.passenger.update(dt, this);
      return;
    }
    if (this.sub === 'dead' || this.sub === 'fuelout' || this.sub === 'winall') return;

    const ship = this.ship;
    const wasLanded = ship.landed;
    ship.update(dt, this);
    // force fields (wind / magnets / tractor beams / black holes) push the cab
    for (const h of this.hazardObjs) if (h.force) h.force(ship, dt);
    // sandstorm: a global wind that drifts and swings direction over time
    if (this.level.sandstorm && !ship.landed && !ship.dead) {
      const a = Math.sin(this.time * 0.35) * 1.4;
      ship.vx += Math.cos(a) * 95 * DIFF.haz * dt;
      ship.vy += Math.sin(a) * 45 * DIFF.haz * dt;
    }
    this.updatePads(dt);
    this.fareTimer += dt;
    if (this.pendingFare > 0) {
      this.pendingFare -= dt;
      if (this.pendingFare <= 0) this.spawnFare();
    }
    if (this.exitGate && this.exitGate.openT < 1) {
      this.exitGate.openT = Math.min(1, this.exitGate.openT + dt / 0.9);
    }

    // hurry message
    if (this.passenger && this.passenger.state === 'riding' && !this.saidHurry && this.fareTimer > this.parTime * 0.65) {
      this.saidHurry = true;
      this.showMsg('HURRY!', 1.6);
      AudioSys.sfx.hurry();
      AudioSys.say(pickLine(["Come on, come on!", "Any day now!", "Step on it, pal!", "I'm not getting younger!"]),
        this.passenger && this.passenger.voice);
    }

    if (ship.fuel <= 0 && !ship.landed && this.sub === 'play') {
      // engines dead; if we're falling and it's hopeless we still let physics play out,
      // but flag the failure once the ship is slow/landed or crashes.
    }

    // --- landing & collision ---
    if (!ship.landed) {
      const [sl, sr] = ship.skids();
      let handled = false;
      for (const pad of this.level.pads) {
        if (pad.gone) continue; // collapsed platform — nothing to land on
        const top = pad.y;
        const inX = sl.x > pad.x - 2 && sr.x < pad.x + pad.w + 2;
        const nearTop = Math.max(sl.y, sr.y) > top - 4 && Math.max(sl.y, sr.y) < top + 14;
        if (inX && nearTop && ship.vy >= 0) {
          if (ship.vy < DIFF.landVy && Math.abs(ship.vx) < DIFF.landVx && Math.abs(ship.angle) < DIFF.landAng) {
            // touchdown
            ship.landed = true;
            ship.landedPad = pad;
            ship.y = top - 19;
            const smooth = ship.vy < DIFF.smoothVy && Math.abs(ship.vx) < DIFF.smoothVx;
            // no bonus for hopping in place: a smooth landing only pays when
            // it followed a real flight (different pad, or airborne a while)
            const rehop = pad === ship.tookOffFrom && ship.airTime < 1.5;
            // the board-start descent onto the spawn pad isn't an earned landing
            const spawnDrop = ship.tookOffFrom === null;
            // ice keeps horizontal momentum (you slide); everything else stops dead
            if (pad.ice) ship.vy = 0; else { ship.vx = 0; ship.vy = 0; }
            // collapsing pad starts its countdown the moment you touch down
            if (pad.collapse && pad.collapseT === undefined) pad.collapseT = pad.collapse;
            AudioSys.sfx.land();
            if (smooth && !rehop && !spawnDrop) {
              this.score += 50;
              this.floatText(ship.x, ship.y - 40, 'SMOOTH +50', '#8ecbff');
            }
            if (ship.fuel <= 0) { this.outOfFuel(); return; }
            // delivery? (never once the exit gate is open — the final fare
            // rides out, it must not re-trigger by re-landing on its pad)
            if (!this.exitGate && this.passenger && this.passenger.state === 'riding' && pad.label === this.passenger.dest) {
              this.onDeliver();
            }
            handled = true;
          } else {
            this.crash(ship.vy >= DIFF.landVy ? 'CAME IN TOO HOT!' : Math.abs(ship.angle) >= DIFF.landAng ? 'LANDED CROOKED!' : 'TOO MUCH DRIFT!');
            return;
          }
          break;
        }
      }
      if (!handled && !ship.landed) {
        const inGate = this.inExitCorridor(ship.x, ship.y);
        // wall collisions (pads act as walls when not landing on top)
        for (const w of this.level.walls) {
          if (circleRect(ship.x, ship.y, SHIP_R, w.x, w.y, w.w, w.h)) {
            if (inGate) continue; // passing through the opened border section
            this.crash('CRASHED!'); return;
          }
        }
        for (const pad of this.level.pads) {
          if (pad.gone) continue;
          if (circleRect(ship.x, ship.y, SHIP_R - 2, pad.x, pad.y + 6, pad.w, pad.h - 6)) { this.crash('CRASHED!'); return; }
        }
        if (inGate) {
          const g = this.exitGate;
          const out =
            g.edge === 'up' ? ship.y < -20 :
            g.edge === 'down' ? ship.y > this.level.H + 20 :
            g.edge === 'left' ? ship.x < -20 :
            ship.x > this.level.W + 20;
          if (out) { this.completeLevel(); return; }
        } else if (ship.x < CELL * 0.5 || ship.x > this.level.W - CELL * 0.5 || ship.y < CELL * 0.5 || ship.y > this.level.H - CELL * 0.5) {
          this.crash('CRASHED!');
          return;
        }
      }
    }

    // hazards kill
    for (const h of this.hazardObjs) {
      if (h.hits(ship.x, ship.y, SHIP_R)) {
        if (h instanceof Beam) AudioSys.sfx.zap();
        const reason =
          h instanceof Beam ? 'ZAPPED!' :
          h instanceof Fan ? 'SHREDDED!' :
          h instanceof RockSpawner ? 'SQUASHED BY A ROCK!' :
          h instanceof MeteorSpawner ? 'METEOR STRIKE!' :
          h instanceof BlackHole ? 'SPAGHETTIFIED!' :
          h instanceof Mine ? 'MINED!' :
          h instanceof Creature ? 'EATEN ALIVE!' : 'CRUSHED!';
        this.crash(reason);
        return;
      }
    }

    // fuel pickups
    for (const f of this.level.fuels) {
      if (!f.taken && Math.hypot(f.x - ship.x, f.y - ship.y) < 30) {
        f.taken = true;
        ship.fuel = Math.min(100, ship.fuel + 35);
        AudioSys.sfx.fuel();
        this.floatText(f.x, f.y - 20, '+FUEL', '#66ffcc');
        for (let i = 0; i < 14; i++) {
          spawnParticle({
            x: f.x, y: f.y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160,
            life: 0.5, maxLife: 0.5, size: 2.5, color: '#66ffcc', glow: true, shrink: true,
          });
        }
      }
    }

    // fuel exhaustion while airborne: fail once ship crashes (handled) or comes to rest
    if (ship.fuel <= 0 && ship.landed && this.sub === 'play') this.outOfFuel();

    // passenger
    if (this.passenger) this.passenger.update(dt, this);

    // camera
    const tx = clamp(ship.x - VIEW_W / 2, 0, Math.max(0, this.level.W - VIEW_W));
    const ty = clamp(ship.y - VIEW_H / 2, 0, Math.max(0, this.level.H - VIEW_H));
    const k = clamp(dt * 4.5, 0, 1);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);

    if (wasLanded && !ship.landed) { /* lifted off */ }
  },
};

/* ============================ input handling ============================ */
function handleGameInput() {
  const escPressed = wasPressed(['Escape']) || pad.pressed.pause || pad.pressed.back;
  const enterPressed = wasPressed(['Enter', 'NumpadEnter']) || pad.pressed.a;
  const rPressed = wasPressed(['KeyR']) || pad.pressed.restart;
  const upP = wasPressed(['ArrowUp', 'KeyW']) || pad.pressed.up;
  const downP = wasPressed(['ArrowDown', 'KeyS']) || pad.pressed.down;

  if (G.sub === 'intro') {
    if (enterPressed || escPressed || rPressed ||
        wasPressed(bindingsFor('thrust')) || actionPressed('horn')) {
      G.beginPlay();
    }
    return;
  }

  if (G.sub === 'play') {
    if (actionPressed('horn')) {
      AudioSys.sfx.horn();
      if (G.passenger && (G.passenger.state === 'waiting' || G.passenger.state === 'walking')) {
        G.passenger.hurried = true;
      }
    }
    if (escPressed) { G.sub = 'paused'; G.pauseIndex = 0; AudioSys.setEngine(0, false); }
    if (rPressed) G.startLevel(G.levelIndex);
  } else if (G.sub === 'paused') {
    const items = 4;
    const nav = navGate(upP || downP);
    if (upP && nav) { G.pauseIndex = (G.pauseIndex + items - 1) % items; AudioSys.sfx.menuMove(); }
    if (downP && nav) { G.pauseIndex = (G.pauseIndex + 1) % items; AudioSys.sfx.menuMove(); }
    if (escPressed) G.sub = 'play';
    if (enterPressed) {
      AudioSys.sfx.menuSelect();
      switch (G.pauseIndex) {
        case 0: G.sub = 'play'; break;
        case 1: G.startLevel(G.levelIndex); break;
        case 2: settingsReturn = ST.GAME; settingsIndex = 0; state = ST.SETTINGS; break;
        case 3:
          G.saveScore();
          state = ST.MENU; menuIndex = 0;
          AudioSys.playMusic(0);
          break;
      }
    }
  } else if (G.sub === 'dead' || G.sub === 'fuelout') {
    if (rPressed || enterPressed) G.startLevel(G.levelIndex);
    if (escPressed) {
      G.saveScore();
      state = ST.MENU; menuIndex = 0;
      AudioSys.playMusic(0);
    }
  } else if (G.sub === 'complete') {
    if (enterPressed && G.completeT > 0.8) {
      if (G.levelIndex + 1 < campaignLevels(G.campaign).length) {
        G.startLevel(G.levelIndex + 1);
      } else {
        G.sub = 'winall';
        G.saveScore();
      }
    }
  } else if (G.sub === 'winall') {
    if (enterPressed || escPressed) {
      state = ST.MENU; menuIndex = 0;
      AudioSys.playMusic(0);
    }
  }
}

/* ========================= menu definitions ========================= */
const MAIN_ITEMS = ['WORLD/LEVEL SELECT', 'HIGH SCORES', 'SETTINGS', 'EXIT'];

// Rate-limit menu navigation so no input source can spam it faster than ~7/s.
// Starts at -Infinity so the very first input after page load is never eaten.
let lastNavMs = -Infinity;
function navGate(active) {
  if (!active) return false;
  const t = performance.now();
  if (t - lastNavMs < 140) return false;
  lastNavMs = t;
  return true;
}

function settingsItems() {
  const s = save.settings;
  // Controller-only build: no keyboard remapping entries.
  const diffs = ['easy', 'medium', 'hard'];
  return [
    { label: 'DIFFICULTY', value: (s.difficulty || 'medium').toUpperCase(), adjust: d => {
        let i = diffs.indexOf(s.difficulty || 'medium'); if (i < 0) i = 1;
        setDifficulty(diffs[clamp(i + d, 0, diffs.length - 1)]);
      } },
    { label: 'MASTER VOLUME', value: Math.round(s.master * 100) + '%', adjust: d => { s.master = clamp(s.master + d * 0.1, 0, 1); } },
    { label: 'MUSIC VOLUME', value: Math.round(s.music * 100) + '%', adjust: d => { s.music = clamp(s.music + d * 0.1, 0, 1); } },
    { label: 'SFX VOLUME', value: Math.round(s.sfx * 100) + '%', adjust: d => { s.sfx = clamp(s.sfx + d * 0.1, 0, 1); } },
    { label: 'FULLSCREEN', value: document.fullscreenElement ? 'ON' : 'OFF', select: () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      } },
    { label: 'RENDER SCALE', value: Math.round((s.scale || 1) * 100) + '%', adjust: d => {
        const opts = [0.5, 0.75, 1, 1.5];
        let i = opts.indexOf(s.scale || 1); if (i < 0) i = 2;
        s.scale = opts[clamp(i + d, 0, opts.length - 1)];
        applyScale();
      } },
    { label: 'BACK', select: () => { state = settingsReturn; persist(); } },
  ];
}

function handleMenuInput() {
  const upP = wasPressed(['ArrowUp', 'KeyW']) || pad.pressed.up;
  const downP = wasPressed(['ArrowDown', 'KeyS']) || pad.pressed.down;
  const leftP = wasPressed(['ArrowLeft', 'KeyA']) || pad.pressed.left;
  const rightP = wasPressed(['ArrowRight', 'KeyD']) || pad.pressed.right;
  const enterP = wasPressed(['Enter', 'NumpadEnter', 'Space']) || pad.pressed.a;
  const escP = wasPressed(['Escape']) || pad.pressed.pause || pad.pressed.back;

  const nav = navGate(upP || downP || leftP || rightP);

  if (state === ST.MENU) {
    if (upP && nav) { menuIndex = (menuIndex + MAIN_ITEMS.length - 1) % MAIN_ITEMS.length; AudioSys.sfx.menuMove(); }
    if (downP && nav) { menuIndex = (menuIndex + 1) % MAIN_ITEMS.length; AudioSys.sfx.menuMove(); }
    if (enterP) {
      AudioSys.sfx.menuSelect();
      switch (menuIndex) {
        case 0: cosmosIndex = G.campaign; state = ST.COSMOS; break;
        case 1: state = ST.SCORES; break;
        case 2: settingsReturn = ST.MENU; settingsIndex = 0; state = ST.SETTINGS; break;
        case 3: requestExit(); break;
      }
    }
  } else if (state === ST.COSMOS) {
    // pick which cosmos (campaign) to fly, then drop into its level grid
    const n = campaignCount();
    if (upP && nav) { cosmosIndex = (cosmosIndex + n - 1) % n; AudioSys.sfx.menuMove(); }
    if (downP && nav) { cosmosIndex = (cosmosIndex + 1) % n; AudioSys.sfx.menuMove(); }
    if (enterP) { AudioSys.sfx.menuSelect(); levelSelCampaign = cosmosIndex; levelSelIndex = 0; state = ST.LEVELS; }
    if (escP) state = ST.MENU;
  } else if (state === ST.LEVELS) {
    const cols = 6;
    const max = Math.min(unlockedIn(levelSelCampaign), campaignLevels(levelSelCampaign).length);
    if (leftP && nav) { levelSelIndex = Math.max(0, levelSelIndex - 1); AudioSys.sfx.menuMove(); }
    if (rightP && nav) { levelSelIndex = Math.min(max - 1, levelSelIndex + 1); AudioSys.sfx.menuMove(); }
    if (upP && nav) { levelSelIndex = Math.max(0, levelSelIndex - cols); AudioSys.sfx.menuMove(); }
    if (downP && nav) { levelSelIndex = Math.min(max - 1, levelSelIndex + cols); AudioSys.sfx.menuMove(); }
    if (enterP) { AudioSys.sfx.menuSelect(); G.score = 0; G.startLevel(levelSelIndex, levelSelCampaign); }
    if (escP) state = campaignCount() > 1 ? ST.COSMOS : ST.MENU;
  } else if (state === ST.SCORES) {
    if (enterP || escP) state = ST.MENU;
  } else if (state === ST.SETTINGS) {
    if (remapTarget) return; // absorbing next key
    const items = settingsItems();
    if (upP && nav) { settingsIndex = (settingsIndex + items.length - 1) % items.length; AudioSys.sfx.menuMove(); }
    if (downP && nav) { settingsIndex = (settingsIndex + 1) % items.length; AudioSys.sfx.menuMove(); }
    const it = items[settingsIndex];
    if ((leftP || rightP) && nav && it.adjust) {
      it.adjust(rightP ? 1 : -1);
      AudioSys.setVolumes(save.settings);
      AudioSys.sfx.menuMove();
      persist();
    }
    if (enterP && it.select) { AudioSys.sfx.menuSelect(); it.select(); }
    if (escP) { state = settingsReturn; persist(); }
  }
}

/* ============================== rendering ============================== */
function themeFor(idx) {
  const lv = campaignLevels(G.campaign)[idx];
  return THEMES[lv && lv.theme] || THEMES.training;
}

// Theme ambience: lightweight screen-space particles, fully stateless
// (positions derive from index + time, so nothing to update or store).
function drawDeco(c, theme, time, camX, camY) {
  const kind = theme.deco;
  if (!kind) return;
  const rnd = mulberry(4242);
  c.save();
  for (let i = 0; i < 44; i++) {
    const seedX = rnd() * (VIEW_W + 60), ph = rnd() * 997, sp = 18 + rnd() * 46, sz = 1 + rnd() * 2.4;
    const wrap = (v, span) => ((v % span) + span) % span;
    if (kind === 'snow') {
      const x = wrap(seedX + Math.sin(time * 0.7 + ph) * 40 - camX * 0.15, VIEW_W + 40) - 20;
      const y = wrap(ph * 13 + time * sp - camY * 0.15, VIEW_H + 30) - 15;
      c.globalAlpha = 0.5;
      c.fillStyle = '#e8f4ff';
      c.beginPath(); c.arc(x, y, sz, 0, TAU); c.fill();
    } else if (kind === 'dust') {
      const x = wrap(seedX + Math.sin(time * 0.4 + ph) * 15 - camX * 0.1, VIEW_W + 40) - 20;
      const y = wrap(ph * 13 + time * sp * 0.4 - camY * 0.1, VIEW_H + 30) - 15;
      c.globalAlpha = 0.28;
      c.fillStyle = '#d8b98a';
      c.fillRect(x, y, sz, sz);
    } else if (kind === 'embers') {
      const x = wrap(seedX + Math.sin(time * 1.1 + ph) * 26 - camX * 0.15, VIEW_W + 40) - 20;
      const y = VIEW_H - (wrap(ph * 13 + time * sp * 1.2, VIEW_H + 60) - 30);
      c.globalAlpha = 0.35 + 0.3 * Math.sin(time * 6 + ph);
      c.fillStyle = i % 3 ? '#ff8a3d' : '#ffd27a';
      c.beginPath(); c.arc(x, y, sz * 0.9, 0, TAU); c.fill();
    } else if (kind === 'sparks') {
      const flick = Math.sin(time * 2.2 + ph * 7.7);
      if (flick > 0.93) {
        const x = wrap(seedX - camX * 0.2, VIEW_W + 40) - 20;
        const y = wrap(ph * 29 - camY * 0.2, VIEW_H);
        c.globalAlpha = (flick - 0.93) * 12;
        c.fillStyle = '#ffe9a8';
        c.fillRect(x, y, 2.5, 2.5);
      }
    } else if (kind === 'spores') {
      const x = wrap(seedX + time * sp * 0.5 - camX * 0.12, VIEW_W + 40) - 20;
      const y = wrap(ph * 13 + Math.sin(time * 0.8 + ph) * 30 - camY * 0.12, VIEW_H + 30) - 15;
      c.globalAlpha = 0.3 + 0.2 * Math.sin(time * 3 + ph);
      c.fillStyle = '#9dffb0';
      c.beginPath(); c.arc(x, y, sz * 0.8, 0, TAU); c.fill();
    } else if (kind === 'confetti') {
      const x = wrap(seedX + Math.sin(time * 1.4 + ph) * 34 - camX * 0.15, VIEW_W + 40) - 20;
      const y = wrap(ph * 13 + time * sp * 0.9 - camY * 0.15, VIEW_H + 30) - 15;
      c.globalAlpha = 0.55;
      c.fillStyle = ['#ff7ad9', '#ffd166', '#66e0ff', '#9dffb0'][i % 4];
      c.save();
      c.translate(x, y);
      c.rotate(time * 2 + ph);
      c.fillRect(-2.5, -1.5, 5, 3);
      c.restore();
    }
  }
  c.restore();
  c.globalAlpha = 1;
}

const starCache = {};
function getStars(seed, n) {
  if (!starCache[seed]) {
    const rnd = mulberry(seed * 7919 + 13);
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({ x: rnd(), y: rnd(), s: 0.5 + rnd() * 1.8, tw: rnd() * TAU, layer: rnd() < 0.4 ? 0.2 : rnd() < 0.7 ? 0.45 : 0.8 });
    }
    starCache[seed] = arr;
  }
  return starCache[seed];
}

function drawBackground(c, theme, camX, camY, worldW, worldH, time, dark) {
  const g = c.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, theme.bgTop);
  g.addColorStop(1, theme.bgBot);
  c.fillStyle = g;
  c.fillRect(0, 0, VIEW_W, VIEW_H);

  const stars = getStars(theme.wallH | 0, theme.starBoost ? 260 : 130);
  for (const s of stars) {
    const sx = ((s.x * 2600 - camX * s.layer) % (VIEW_W + 40) + VIEW_W + 40) % (VIEW_W + 40) - 20;
    const sy = ((s.y * 1600 - camY * s.layer) % (VIEW_H + 40) + VIEW_H + 40) % (VIEW_H + 40) - 20;
    const tw = 0.5 + 0.5 * Math.sin(time * 2 + s.tw);
    c.globalAlpha = (dark ? 0.25 : 0.5) * tw + 0.15;
    c.fillStyle = '#dfe8ff';
    c.beginPath(); c.arc(sx, sy, s.s, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;

  // planets
  const ph = theme.planetH;
  const px = ((theme.wallH * 13 + ph * 3) % 900) - camX * 0.12;
  const py = 90 + ((theme.wallH * 7) % 200) - camY * 0.12;
  const pr = (40 + (ph % 50)) * (theme.bigPlanet ? 2.2 : 1);
  const pg = c.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
  pg.addColorStop(0, `hsla(${ph}, 55%, ${dark ? 30 : 55}%, 0.9)`);
  pg.addColorStop(1, `hsla(${ph}, 55%, ${dark ? 8 : 18}%, 0.9)`);
  c.fillStyle = pg;
  c.beginPath(); c.arc(px, py, pr, 0, TAU); c.fill();
  // ring
  c.save();
  c.translate(px, py); c.rotate(-0.4);
  c.strokeStyle = `hsla(${ph}, 60%, 60%, 0.35)`;
  c.lineWidth = 5;
  c.beginPath(); c.ellipse(0, 0, pr * 1.6, pr * 0.4, 0, 0, TAU); c.stroke();
  c.restore();

  drawDeco(c, theme, time, camX, camY);
}

function drawWalls(c, level, theme, time) {
  for (const w of level.walls) {
    const g = c.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
    g.addColorStop(0, `hsl(${theme.wallH}, ${theme.wallS}%, 34%)`);
    g.addColorStop(1, `hsl(${theme.wallH}, ${theme.wallS + 3}%, 20%)`);
    c.fillStyle = g;
    c.fillRect(w.x, w.y, w.w, w.h);
    // top edge highlight
    c.fillStyle = `hsla(${theme.wallH}, ${Math.min(100, theme.wallS + 23)}%, 60%, 0.5)`;
    c.fillRect(w.x, w.y, w.w, 3);
    // panel lines
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = 1;
    for (let x = w.x + CELL; x < w.x + w.w; x += CELL) {
      c.beginPath(); c.moveTo(x, w.y); c.lineTo(x, w.y + w.h); c.stroke();
    }
    for (let y = w.y + CELL; y < w.y + w.h; y += CELL) {
      c.beginPath(); c.moveTo(w.x, y); c.lineTo(w.x + w.w, y); c.stroke();
    }
  }
}

// The opened border section: doors slide apart revealing a void with
// accent-colored chevrons marching outward toward the next board.
function drawExitGate(c, gate, theme, time) {
  const open = 1 - Math.pow(1 - Math.min(1, gate.openT), 3);
  const GW = gate.GW;
  const horiz = gate.edge === 'up' || gate.edge === 'down';
  // border band the gate occupies
  const band = horiz
    ? { x: gate.cx - GW / 2, y: gate.edge === 'up' ? 0 : G.level.H - CELL, w: GW, h: CELL }
    : { x: gate.edge === 'left' ? 0 : G.level.W - CELL, y: gate.cy - GW / 2, w: CELL, h: GW };

  // void behind the doors
  c.fillStyle = '#03040a';
  c.fillRect(band.x, band.y, band.w, band.h);

  // marching chevrons pointing outward
  const phase = (time * 30) % 16;
  c.save();
  c.beginPath(); c.rect(band.x, band.y, band.w, band.h); c.clip();
  c.strokeStyle = theme.accent;
  c.lineWidth = 3;
  c.lineJoin = 'round';
  for (let k = 0; k < 4; k++) {
    const d = k * 16 + phase;
    c.globalAlpha = open * Math.max(0.15, 0.75 - k * 0.18);
    c.beginPath();
    if (gate.edge === 'up') {
      const y = band.y + band.h - d;
      c.moveTo(gate.cx - 14, y + 7); c.lineTo(gate.cx, y - 7); c.lineTo(gate.cx + 14, y + 7);
    } else if (gate.edge === 'down') {
      const y = band.y + d;
      c.moveTo(gate.cx - 14, y - 7); c.lineTo(gate.cx, y + 7); c.lineTo(gate.cx + 14, y - 7);
    } else if (gate.edge === 'left') {
      const x = band.x + band.w - d;
      c.moveTo(x + 7, gate.cy - 14); c.lineTo(x - 7, gate.cy); c.lineTo(x + 7, gate.cy + 14);
    } else {
      const x = band.x + d;
      c.moveTo(x - 7, gate.cy - 14); c.lineTo(x + 7, gate.cy); c.lineTo(x - 7, gate.cy + 14);
    }
    c.stroke();
  }
  c.globalAlpha = 1;

  // sliding door halves (wall-colored), retracting from the center
  const cov = (GW / 2) * (1 - open);
  c.fillStyle = `hsl(${theme.wallH}, ${theme.wallS}%, 30%)`;
  if (horiz) {
    c.fillRect(band.x, band.y, cov, band.h);
    c.fillRect(band.x + band.w - cov, band.y, cov, band.h);
  } else {
    c.fillRect(band.x, band.y, band.w, cov);
    c.fillRect(band.x, band.y + band.h - cov, band.w, cov);
  }
  c.restore();

  // pulsing accent frame around the opening
  c.save();
  c.strokeStyle = theme.accent;
  c.shadowColor = theme.accent;
  c.shadowBlur = 14;
  c.globalAlpha = open * (0.6 + 0.4 * Math.sin(time * 6));
  c.lineWidth = 2.5;
  c.strokeRect(band.x, band.y, band.w, band.h);
  c.restore();
  c.globalAlpha = 1;
}

function drawPads(c, level, time, activePassenger, ship) {
  for (const pad of level.pads) {
    if (pad.gone) continue; // collapsed platform
    c.save();
    // a collapsing pad shakes and fades in its final second
    if (pad.collapse && pad.collapseT !== undefined && pad.collapseT > 0) {
      c.globalAlpha = clamp(0.35 + pad.collapseT / pad.collapse, 0, 1);
      if (pad.collapseT < 1) c.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    }
    // platform body (ice pads read cold/blue)
    const g = c.createLinearGradient(pad.x, pad.y, pad.x, pad.y + pad.h);
    if (pad.ice) { g.addColorStop(0, '#8fd0e8'); g.addColorStop(1, '#3c6a86'); }
    else { g.addColorStop(0, '#4d5568'); g.addColorStop(1, '#2c3140'); }
    c.fillStyle = g;
    roundRect(c, pad.x, pad.y, pad.w, pad.h, 5); c.fill();

    // landing surface
    c.fillStyle = pad.ice ? '#dff2ff' : '#788299';
    c.fillRect(pad.x + 2, pad.y, pad.w - 4, 4);

    // conveyor arrows show the drift direction
    if (pad.conveyor) {
      c.fillStyle = 'rgba(255,207,63,0.8)';
      const dir = Math.sign(pad.conveyor), off = (time * 40) % 24;
      for (let ax = pad.x + 6; ax < pad.x + pad.w - 6; ax += 24) {
        const bx = ax + (dir > 0 ? off : -off);
        c.beginPath();
        c.moveTo(bx, pad.y + 3); c.lineTo(bx + dir * 7, pad.y + 7); c.lineTo(bx, pad.y + 11);
        c.closePath(); c.fill();
      }
    }

    // hazard stripes on edge
    c.save();
    c.beginPath(); c.rect(pad.x, pad.y + 5, pad.w, 6); c.clip();
    for (let x = pad.x - 12; x < pad.x + pad.w + 12; x += 12) {
      c.fillStyle = ((x / 12) | 0) % 2 ? '#ffcf3f' : '#20242f';
      c.beginPath();
      c.moveTo(x, pad.y + 11); c.lineTo(x + 6, pad.y + 5); c.lineTo(x + 12, pad.y + 5); c.lineTo(x + 6, pad.y + 11);
      c.closePath(); c.fill();
    }
    c.restore();

    // beacon lights
    const isDest = activePassenger && activePassenger.state === 'riding' && pad.label === activePassenger.dest;
    const blink = Math.sin(time * (isDest ? 10 : 3)) > 0;
    for (const bx of [pad.x + 6, pad.x + pad.w - 6]) {
      c.fillStyle = blink ? (isDest ? '#7cff9a' : '#ffcf3f') : '#554';
      if (blink) { c.shadowColor = isDest ? '#7cff9a' : '#ffcf3f'; c.shadowBlur = 10; }
      c.beginPath(); c.arc(bx, pad.y - 3, 3, 0, TAU); c.fill();
      c.shadowBlur = 0;
    }

    // label sign
    c.fillStyle = '#1a1e28';
    roundRect(c, pad.x + pad.w / 2 - 13, pad.y + 16, 26, 20, 4); c.fill();
    c.strokeStyle = isDest ? '#7cff9a' : '#5b667f'; c.lineWidth = 1.5;
    roundRect(c, pad.x + pad.w / 2 - 13, pad.y + 16, 26, 20, 4); c.stroke();
    c.fillStyle = isDest ? '#7cff9a' : '#dfe6f5';
    c.font = 'bold 15px "Segoe UI", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (isDest) { c.shadowColor = '#7cff9a'; c.shadowBlur = 8; }
    c.fillText(pad.label, pad.x + pad.w / 2, pad.y + 26);
    c.shadowBlur = 0;
    c.restore();
  }
}

function drawFuels(c, level, time) {
  for (const f of level.fuels) {
    if (f.taken) continue;
    const bob = Math.sin(time * 2 + f.bob) * 5;
    c.save();
    c.translate(f.x, f.y + bob);
    c.shadowColor = '#66ffcc'; c.shadowBlur = 14;
    c.fillStyle = '#0f3f33';
    roundRect(c, -10, -14, 20, 28, 5); c.fill();
    c.strokeStyle = '#66ffcc'; c.lineWidth = 2;
    roundRect(c, -10, -14, 20, 28, 5); c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = '#66ffcc';
    c.font = 'bold 12px "Segoe UI", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('F', 0, 0);
    c.restore();
  }
}

/* --------------------------- board-title intro --------------------------- */
// A standalone screen shown before each board: theme backdrop, board title,
// and the cab lazily looping a figure-eight. Its own music plays; the board
// itself stays hidden and frozen until this ends (or the player skips).
const INTRO_DUR = 3.4;
const introShip = new Ship(0, 0);

function drawIntro(c, time) {
  const t = G.introT;
  const th = themeFor(G.levelIndex);
  drawBackground(c, th, time * 40, 0, 4000, 2000, time, false);

  // roaming cab on a figure-eight around the title
  const a1 = t * 1.05 + 1.1;
  const sx = VIEW_W / 2 + Math.cos(a1) * 430;
  const sy = VIEW_H / 2 + Math.sin(a1 * 2) * 185;
  const vx = -Math.sin(a1);
  c.save();
  c.translate(sx, sy);
  c.rotate(clamp(vx * -0.55, -0.6, 0.6));
  c.scale(1.5, 1.5);
  introShip.x = 0; introShip.y = 0; introShip.angle = 0;
  introShip.thrustLevel = 0.7 + Math.sin(time * 9) * 0.3;
  introShip.draw(c, time);
  c.restore();

  // title block
  const inA = clamp(t / 0.35, 0, 1);
  const ease = 1 - Math.pow(1 - inA, 3);
  const bandH = 200;
  const y0 = VIEW_H / 2 - bandH / 2;
  c.globalAlpha = 0.8;
  c.fillStyle = 'rgba(8, 10, 20, 0.85)';
  c.fillRect(0, y0, VIEW_W, bandH);
  c.globalAlpha = 1;
  c.strokeStyle = th.accent;
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(VIEW_W * (1 - ease), y0); c.lineTo(VIEW_W, y0); c.stroke();
  c.beginPath(); c.moveTo(0, y0 + bandH); c.lineTo(VIEW_W * ease, y0 + bandH); c.stroke();

  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const pop = 0.92 + 0.08 * ease;
  c.save();
  c.translate(VIEW_W / 2, y0 + 88);
  c.scale(pop, pop);
  c.font = 'bold 54px "Segoe UI", sans-serif';
  c.fillStyle = th.accent;
  c.shadowColor = th.accent;
  c.shadowBlur = 26;
  c.fillText(th.name, 0, 0);
  c.shadowBlur = 0;
  c.restore();

  c.globalAlpha = clamp((t - 0.35) / 0.4, 0, 1);
  c.font = '600 24px "Segoe UI", sans-serif';
  c.fillStyle = '#c9d4ea';
  c.fillText(`LEVEL ${G.levelIndex + 1}  ·  ${G.level.name.toUpperCase()}`, VIEW_W / 2, y0 + 138);

  c.globalAlpha = 0.6 + 0.3 * Math.sin(time * 4);
  c.font = '16px "Segoe UI", sans-serif';
  c.fillStyle = '#8b98b8';
  c.fillText('Ⓐ / ENTER · SKIP', VIEW_W / 2, VIEW_H - TV_Y - 14);
  c.globalAlpha = 1;

  // fade from black on entry, to black just before the board appears
  const fade = Math.max(clamp(1 - t / 0.45, 0, 1), clamp((t - (INTRO_DUR - 0.3)) / 0.3, 0, 1));
  if (fade > 0) {
    c.globalAlpha = fade;
    c.fillStyle = '#000';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.globalAlpha = 1;
  }
}

function drawHUDPanel(c, x, y, w, h) {
  c.fillStyle = 'rgba(10, 14, 24, 0.72)';
  roundRect(c, x, y, w, h, 10); c.fill();
  c.strokeStyle = 'rgba(120, 150, 210, 0.35)'; c.lineWidth = 1;
  roundRect(c, x, y, w, h, 10); c.stroke();
}

function drawHUD(c) {
  const ship = G.ship;
  // top-left: score & fuel (shifted into the TV-safe zone)
  c.save();
  c.translate(TV_X, TV_Y);
  drawHUDPanel(c, 14, 14, 230, 74);
  c.fillStyle = '#9fb4d8';
  c.font = '600 12px "Segoe UI", sans-serif';
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillText('SCORE', 28, 34);
  c.fillStyle = '#ffffff';
  c.font = 'bold 20px "Segoe UI", sans-serif';
  c.fillText(String(G.score).padStart(6, '0'), 90, 36);

  c.fillStyle = '#9fb4d8';
  c.font = '600 12px "Segoe UI", sans-serif';
  c.fillText('FUEL', 28, 66);
  // fuel bar
  const fw = 140, fx = 90, fy = 56;
  c.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(c, fx, fy, fw, 12, 6); c.fill();
  const pct = ship.fuel / 100;
  const low = pct < 0.25;
  c.fillStyle = low ? (Math.sin(G.time * 10) > 0 ? '#ff4455' : '#992233') : pct < 0.5 ? '#ffcf3f' : '#7cff9a';
  if (pct > 0) { roundRect(c, fx, fy, Math.max(8, fw * pct), 12, 6); c.fill(); }
  c.restore();

  // top-right: passenger / destination (shifted into the TV-safe zone)
  c.save();
  c.translate(-TV_X, TV_Y);
  drawHUDPanel(c, VIEW_W - 258, 14, 244, 74);
  c.fillStyle = '#9fb4d8';
  c.font = '600 12px "Segoe UI", sans-serif';
  c.fillText('PASSENGER', VIEW_W - 200, 34);
  c.fillText('DESTINATION', VIEW_W - 200, 66);
  const p = G.passenger;
  let pText = '—', dText = '—';
  if (G.exitGate) {
    pText = 'ON BOARD';
    dText = 'EXIT ' + ({ up: '↑', down: '↓', left: '←', right: '→' }[G.exitGate.edge]);
  } else if (p && p.state !== 'gone') {
    pText = p.state === 'riding' ? 'ON BOARD' : p.state === 'exiting' ? 'DELIVERED' : `WAITING AT PAD ${p.pad.label}`;
    // destination stays hidden until the fare is actually aboard
    dText = p.state === 'riding' ? 'PAD ' + p.dest : '—';
  }
  // values centered in the space right of the labels
  c.textAlign = 'center';
  const valX = VIEW_W - 87;
  c.fillStyle = '#ffffff';
  c.font = 'bold 14px "Segoe UI", sans-serif';
  c.fillText(pText, valX, 36);
  c.fillStyle = p && p.state === 'riding' ? '#7cff9a' : '#ffffff';
  c.font = 'bold 15px "Segoe UI", sans-serif';
  c.fillText(dText, valX, 68);
  c.textAlign = 'left';
  c.restore();

  // fares progress dots
  c.textAlign = 'center';
  const total = G.level.fares.length;
  for (let i = 0; i < total; i++) {
    c.fillStyle = i < G.fareIndex ? '#7cff9a' : 'rgba(255,255,255,0.25)';
    c.beginPath(); c.arc(VIEW_W / 2 - (total - 1) * 9 + i * 18, 26 + TV_Y, 5, 0, TAU); c.fill();
  }

  // center message
  if (G.msg) {
    const a = clamp(G.msgT / 0.4, 0, 1);
    c.globalAlpha = a;
    c.font = 'bold 34px "Segoe UI", sans-serif';
    c.fillStyle = '#ffffff';
    c.shadowColor = '#4488ff'; c.shadowBlur = 18;
    c.fillText(G.msg, VIEW_W / 2, 150);
    c.shadowBlur = 0;
    c.globalAlpha = 1;
  }
}

function drawCenteredOverlay(c, lines) {
  c.fillStyle = 'rgba(5, 8, 16, 0.72)';
  c.fillRect(0, 0, VIEW_W, VIEW_H);
  c.textAlign = 'center';
  let y = VIEW_H / 2 - (lines.length - 1) * 26;
  for (const ln of lines) {
    c.font = ln.font || 'bold 24px "Segoe UI", sans-serif';
    c.fillStyle = ln.color || '#fff';
    if (ln.glow) { c.shadowColor = ln.color || '#fff'; c.shadowBlur = 20; }
    c.fillText(ln.text, VIEW_W / 2, y);
    c.shadowBlur = 0;
    y += ln.gap || 52;
  }
}

function drawGame(c, time) {
  if (G.sub === 'intro') {
    drawIntro(c, time);
    return;
  }
  const theme = themeFor(G.levelIndex);
  const shakeX = G.shake > 0 ? (Math.random() - 0.5) * 18 * G.shake : 0;
  const shakeY = G.shake > 0 ? (Math.random() - 0.5) * 18 * G.shake : 0;

  drawBackground(c, theme, G.cam.x, G.cam.y, G.level.W, G.level.H, time, G.level.dark);

  c.save();
  c.translate(-G.cam.x + shakeX, -G.cam.y + shakeY);

  drawWalls(c, G.level, theme, time);
  if (G.exitGate) drawExitGate(c, G.exitGate, theme, time);
  drawPads(c, G.level, time, G.passenger, G.ship);
  drawFuels(c, G.level, time);
  for (const h of G.hazardObjs) h.draw(c, time);
  if (G.passenger) G.passenger.draw(c, time);
  G.ship.draw(c, time);

  // destination bubble above taxi
  if (G.passenger && G.passenger.state === 'riding' && !G.ship.dead) {
    const bx = G.ship.x, by = G.ship.y - 44;
    c.fillStyle = 'rgba(12, 18, 30, 0.85)';
    roundRect(c, bx - 42, by - 14, 84, 24, 12); c.fill();
    c.strokeStyle = '#7cff9a'; c.lineWidth = 1.5;
    roundRect(c, bx - 42, by - 14, 84, 24, 12); c.stroke();
    c.fillStyle = '#7cff9a';
    c.font = 'bold 13px "Segoe UI", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('→ PAD ' + G.passenger.dest, bx, by - 1);
  }

  drawParticles(c);

  // floating score texts
  for (const f of G.floats) {
    c.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    c.font = 'bold 16px "Segoe UI", sans-serif';
    c.fillStyle = f.color;
    c.textAlign = 'center';
    c.shadowColor = f.color; c.shadowBlur = 8;
    c.fillText(f.text, f.x, f.y);
    c.shadowBlur = 0;
  }
  c.globalAlpha = 1;

  // darkness + ship light for dark levels
  if (G.level.dark && !G.ship.dead) {
    c.save();
    c.globalCompositeOperation = 'multiply';
    // A tight pool of light around the cab; everything beyond ~190px falls to
    // near-black, so you can only see a reasonable distance from the ship.
    const R = 190;
    const lg = c.createRadialGradient(G.ship.x, G.ship.y, 34, G.ship.x, G.ship.y, R);
    lg.addColorStop(0, 'rgba(255,255,255,1)');
    lg.addColorStop(0.5, 'rgba(120,128,150,1)');
    lg.addColorStop(0.82, 'rgba(24,28,40,1)');
    lg.addColorStop(1, 'rgba(3,4,8,1)');
    c.fillStyle = lg;
    c.fillRect(G.cam.x - 20, G.cam.y - 20, VIEW_W + 40, VIEW_H + 40);
    c.restore();

    // faint forward "headlight" cone so the direction you point reads a bit farther
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.translate(G.ship.x, G.ship.y);
    c.rotate(G.ship.angle);
    const cone = c.createLinearGradient(0, 0, 0, -230);
    cone.addColorStop(0, 'rgba(150,170,210,0.16)');
    cone.addColorStop(1, 'rgba(150,170,210,0)');
    c.fillStyle = cone;
    c.beginPath(); c.moveTo(-10, 0); c.lineTo(-70, -230); c.lineTo(70, -230); c.lineTo(10, 0); c.closePath(); c.fill();
    c.restore();
  }

  // sandstorm: haze that thins near the cab, plus streaking sand
  if (G.level.sandstorm && !G.ship.dead) {
    c.save();
    const sg = c.createRadialGradient(G.ship.x, G.ship.y, 90, G.ship.x, G.ship.y, 340);
    sg.addColorStop(0, 'rgba(200,160,90,0)');
    sg.addColorStop(1, 'rgba(190,150,85,0.55)');
    c.fillStyle = sg;
    c.fillRect(G.cam.x - 20, G.cam.y - 20, VIEW_W + 40, VIEW_H + 40);
    c.strokeStyle = 'rgba(220,190,120,0.35)'; c.lineWidth = 2;
    const drift = Math.cos(Math.sin(time * 0.35) * 1.4);
    for (let i = 0; i < 40; i++) {
      const x = G.cam.x + ((i * 137 + time * 320) % (VIEW_W + 40)) - 20;
      const y = G.cam.y + ((i * 83) % VIEW_H);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - drift * 26, y - 4); c.stroke();
    }
    c.restore();
  }

  c.restore();

  drawHUD(c);

  if (G.sub === 'paused') {
    const items = ['RESUME', 'RESTART LEVEL', 'SETTINGS', 'QUIT TO MENU'];
    drawCenteredOverlay(c, [
      { text: 'PAUSED', font: 'bold 44px "Segoe UI", sans-serif', color: '#ffcf3f', glow: true, gap: 70 },
      ...items.map((t, i) => ({
        text: (i === G.pauseIndex ? '▸ ' : '') + t,
        color: i === G.pauseIndex ? '#ffffff' : '#8b98b8',
        font: (i === G.pauseIndex ? 'bold ' : '') + '22px "Segoe UI", sans-serif',
        gap: 42,
      })),
    ]);
  } else if (G.sub === 'dead') {
    drawCenteredOverlay(c, [
      { text: G.deathReason, font: 'bold 44px "Segoe UI", sans-serif', color: '#ff5566', glow: true, gap: 60 },
      { text: '-100 POINTS', color: '#ff8899', gap: 60 },
      { text: 'Ⓨ RESTART   ·   Ⓑ MENU', color: '#9fb4d8', font: '18px "Segoe UI", sans-serif' },
    ]);
  } else if (G.sub === 'fuelout') {
    drawCenteredOverlay(c, [
      { text: 'OUT OF FUEL', font: 'bold 44px "Segoe UI", sans-serif', color: '#ffcf3f', glow: true, gap: 60 },
      { text: 'THE METER\'S RUN DRY...', color: '#d8c48a', gap: 60 },
      { text: 'Ⓨ RESTART   ·   Ⓑ MENU', color: '#9fb4d8', font: '18px "Segoe UI", sans-serif' },
    ]);
  } else if (G.sub === 'complete') {
    drawCenteredOverlay(c, [
      { text: 'LEVEL COMPLETE!', font: 'bold 44px "Segoe UI", sans-serif', color: '#7cff9a', glow: true, gap: 60 },
      { text: `FUEL BONUS +${G.levelScore}`, color: '#aaffcc', gap: 46 },
      { text: `SCORE ${G.score}`, color: '#ffffff', gap: 66 },
      { text: G.levelIndex + 1 < campaignLevels(G.campaign).length ? 'PRESS Ⓐ FOR NEXT FARE' : 'PRESS Ⓐ', color: '#9fb4d8', font: '18px "Segoe UI", sans-serif' },
    ]);
  } else if (G.sub === 'winall') {
    drawCenteredOverlay(c, [
      { text: 'SHIFT COMPLETE!', font: 'bold 48px "Segoe UI", sans-serif', color: '#ffcf3f', glow: true, gap: 64 },
      { text: 'YOU DELIVERED EVERY PASSENGER IN THE GALAXY', color: '#ffffff', gap: 50 },
      { text: `FINAL SCORE ${G.score}`, font: 'bold 30px "Segoe UI", sans-serif', color: '#7cff9a', glow: true, gap: 64 },
      { text: 'PRESS Ⓐ FOR MENU', color: '#9fb4d8', font: '18px "Segoe UI", sans-serif' },
    ]);
  }
}

/* ------------------------- menu screens ------------------------- */
let menuShipT = 0;
function drawMenuBackdrop(c, time) {
  drawBackground(c, THEMES.megacity, time * 20, 0, 4000, 2000, time, false);
  // drifting taxi
  menuShipT = time;
  const mx = VIEW_W / 2 + Math.sin(time * 0.5) * 300;
  const my = 190 + Math.sin(time * 0.8) * 30;
  c.save();
  c.translate(mx, my);
  c.rotate(Math.sin(time * 0.6) * 0.1);
  c.scale(1.4, 1.4);
  const fake = new Ship(0, 0);
  fake.thrustLevel = 0.6 + Math.sin(time * 3) * 0.3;
  fake.draw(c, time);
  c.restore();
}

function drawTitle(c, time) {
  c.textAlign = 'center';
  c.font = 'bold 76px "Segoe UI", sans-serif';
  const grad = c.createLinearGradient(0, 60, 0, 140);
  grad.addColorStop(0, '#ffe066'); grad.addColorStop(1, '#ff9922');
  c.fillStyle = grad;
  c.shadowColor = '#ff9922'; c.shadowBlur = 26;
  c.fillText('COSMO CAB', VIEW_W / 2, 120);
  c.shadowBlur = 0;
  c.font = '600 20px "Segoe UI", sans-serif';
  c.fillStyle = '#8b98b8';
  c.fillText('P I C K  U P  ·  D E L I V E R  ·  S U R V I V E', VIEW_W / 2, 152);
}

function drawMenu(c, time) {
  drawMenuBackdrop(c, time);
  drawTitle(c, time);
  c.textAlign = 'center';
  let y = 330;
  MAIN_ITEMS.forEach((item, i) => {
    const sel = i === menuIndex;
    c.font = (sel ? 'bold 28px' : '24px') + ' "Segoe UI", sans-serif';
    c.fillStyle = sel ? '#ffffff' : '#8b98b8';
    if (sel) {
      c.shadowColor = '#ffcf3f'; c.shadowBlur = 14;
      c.fillText('▸ ' + item + ' ◂', VIEW_W / 2, y);
      c.shadowBlur = 0;
    } else {
      c.fillText(item, VIEW_W / 2, y);
    }
    y += 56;
  });
  drawNewWorldBanner(c, time);
  c.font = '14px "Segoe UI", sans-serif';
  c.fillStyle = '#5b667f';
  c.fillText('Ⓐ THRUST · STICK / D-PAD ROTATE · Ⓧ HORN · MENU PAUSE · Ⓨ RESTART', VIEW_W / 2, VIEW_H - TV_Y - 30);
  c.fillText('D-PAD TO NAVIGATE · Ⓐ TO SELECT', VIEW_W / 2, VIEW_H - TV_Y - 10);
}

// "New world" promo pill advertising the Outer Rim cosmos on the main menu.
// Only shows once a second cosmos actually exists.
function drawNewWorldBanner(c, time) {
  if (campaignCount() < 2) return;
  const outer = CAMPAIGNS[1];
  const nLevels = outer.levels.length;
  const cx = VIEW_W / 2, cy = 588;
  const w = 560, h = 70, x = cx - w / 2, yy = cy - h / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);

  c.save();
  c.textAlign = 'left';
  // glowing pill
  c.shadowColor = 'rgba(210,110,255,0.9)'; c.shadowBlur = 16 + 12 * pulse;
  const g = c.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(78,34,120,0.95)');
  g.addColorStop(1, 'rgba(150,44,110,0.95)');
  c.fillStyle = g;
  roundRect(c, x, yy, w, h, 18); c.fill();
  c.shadowBlur = 0;
  c.lineWidth = 2; c.strokeStyle = `rgba(255,200,255,${0.5 + 0.4 * pulse})`;
  roundRect(c, x, yy, w, h, 18); c.stroke();

  // "NEW" starburst badge on the left
  const bx = x + 52, by = cy;
  c.save(); c.translate(bx, by); c.rotate(time * 0.6);
  c.fillStyle = '#ffcf3f'; c.shadowColor = '#ffcf3f'; c.shadowBlur = 10;
  c.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12, rr = i % 2 ? 16 : 26;
    c[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath(); c.fill(); c.restore();
  c.fillStyle = '#3a1030'; c.font = 'bold 13px "Segoe UI", sans-serif';
  c.textAlign = 'center';
  c.fillText('NEW', bx, by + 4);

  // headline + subline
  c.textAlign = 'left';
  const tx = x + 96;
  c.fillStyle = '#ffffff';
  c.font = 'bold 24px "Segoe UI", sans-serif';
  c.shadowColor = 'rgba(255,140,220,0.8)'; c.shadowBlur = 8;
  c.fillText('NEW WORLD:  ' + outer.name, tx, cy - 6);
  c.shadowBlur = 0;
  c.fillStyle = '#ffd6f2';
  c.font = '600 14px "Segoe UI", sans-serif';
  c.fillText(nLevels + ' NEW LEVELS · BLACK HOLES, WIND, MINES & MORE', tx, cy + 17);

  // little "▸ LEVEL SELECT" nudge on the far right
  c.textAlign = 'right';
  c.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * pulse})`;
  c.font = '600 13px "Segoe UI", sans-serif';
  c.fillText('▸ LEVEL SELECT', x + w - 20, cy + 4);
  c.restore();
}

function drawLevelSelect(c, time) {
  drawMenuBackdrop(c, time);
  c.textAlign = 'center';
  c.font = 'bold 40px "Segoe UI", sans-serif';
  c.fillStyle = '#ffcf3f';
  c.shadowColor = '#ffcf3f'; c.shadowBlur = 16;
  c.fillText('LEVEL SELECT', VIEW_W / 2, 74);
  c.shadowBlur = 0;

  // which cosmos these levels belong to
  const levels = campaignLevels(levelSelCampaign);
  const unlockedMax = unlockedIn(levelSelCampaign);
  c.font = '600 22px "Segoe UI", sans-serif';
  c.fillStyle = '#c9d4ea';
  c.fillText(campaignName(levelSelCampaign), VIEW_W / 2, 108);

  const cols = 6, cw = 150, chh = 82;
  const ox = VIEW_W / 2 - cols * cw / 2 + cw / 2;
  for (let i = 0; i < levels.length; i++) {
    const col = i % cols, row = (i / cols) | 0;
    const x = ox + col * cw, y = 168 + row * chh;
    const unlocked = i < unlockedMax;
    const sel = i === levelSelIndex;
    c.fillStyle = sel ? 'rgba(255, 207, 63, 0.18)' : 'rgba(12, 18, 32, 0.7)';
    roundRect(c, x - 64, y - 26, 128, 64, 10); c.fill();
    c.strokeStyle = sel ? '#ffcf3f' : unlocked ? 'rgba(120,150,210,0.4)' : 'rgba(80,90,110,0.3)';
    c.lineWidth = sel ? 2 : 1;
    roundRect(c, x - 64, y - 26, 128, 64, 10); c.stroke();
    c.fillStyle = unlocked ? (sel ? '#ffffff' : '#c9d4ea') : '#4a5163';
    c.font = 'bold 22px "Segoe UI", sans-serif';
    c.fillText(unlocked ? String(i + 1) : '🔒', x, y + 2);
    c.font = '11px "Segoe UI", sans-serif';
    c.fillStyle = unlocked ? '#8b98b8' : '#3c4356';
    c.fillText(unlocked ? levels[i].name.toUpperCase() : 'LOCKED', x, y + 24);
  }
  c.font = '15px "Segoe UI", sans-serif';
  c.fillStyle = '#5b667f';
  const hint = campaignCount() > 1 ? 'Ⓐ PLAY · Ⓑ CHANGE COSMOS' : 'Ⓐ PLAY · Ⓑ BACK';
  c.fillText(hint, VIEW_W / 2, VIEW_H - TV_Y - 10);
}

// Cosmos picker: choose which world (campaign) before its level grid.
function drawCosmosSelect(c, time) {
  drawMenuBackdrop(c, time);
  c.textAlign = 'center';
  c.font = 'bold 40px "Segoe UI", sans-serif';
  c.fillStyle = '#ffcf3f';
  c.shadowColor = '#ffcf3f'; c.shadowBlur = 16;
  c.fillText('SELECT COSMOS', VIEW_W / 2, 120);
  c.shadowBlur = 0;

  const n = campaignCount();
  const y0 = 250, gap = Math.min(120, (VIEW_H - 360) / Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const sel = i === cosmosIndex;
    const y = y0 + i * gap;
    const done = unlockedIn(i) - 1, total = campaignLevels(i).length;
    c.fillStyle = sel ? 'rgba(255,207,63,0.16)' : 'rgba(12,18,32,0.7)';
    roundRect(c, VIEW_W / 2 - 300, y - 36, 600, 72, 12); c.fill();
    c.strokeStyle = sel ? '#ffcf3f' : 'rgba(120,150,210,0.35)'; c.lineWidth = sel ? 2 : 1;
    roundRect(c, VIEW_W / 2 - 300, y - 36, 600, 72, 12); c.stroke();
    c.font = 'bold 30px "Segoe UI", sans-serif';
    c.fillStyle = sel ? '#ffffff' : '#c9d4ea';
    if (sel) { c.shadowColor = '#ffcf3f'; c.shadowBlur = 10; }
    c.fillText((sel ? '▸ ' : '') + campaignName(i) + (sel ? ' ◂' : ''), VIEW_W / 2, y - 2);
    c.shadowBlur = 0;
    c.font = '14px "Segoe UI", sans-serif';
    c.fillStyle = '#8b98b8';
    c.fillText(clamp(done, 0, total) + ' / ' + total + ' CLEARED', VIEW_W / 2, y + 22);
  }
  c.font = '15px "Segoe UI", sans-serif';
  c.fillStyle = '#5b667f';
  c.fillText('Ⓐ SELECT · Ⓑ BACK', VIEW_W / 2, VIEW_H - TV_Y - 10);
}

function drawScores(c, time) {
  drawMenuBackdrop(c, time);
  c.textAlign = 'center';
  c.font = 'bold 40px "Segoe UI", sans-serif';
  c.fillStyle = '#ffcf3f';
  c.shadowColor = '#ffcf3f'; c.shadowBlur = 16;
  c.fillText('HIGH SCORES', VIEW_W / 2, 100);
  c.shadowBlur = 0;
  const hs = save.highscores;
  if (!hs.length) {
    c.font = '20px "Segoe UI", sans-serif';
    c.fillStyle = '#8b98b8';
    c.fillText('NO FARES LOGGED YET — GET FLYING!', VIEW_W / 2, 300);
  } else {
    c.font = '600 18px "Segoe UI", sans-serif';
    hs.forEach((h, i) => {
      const y = 180 + i * 44;
      c.fillStyle = i === 0 ? '#ffe066' : '#c9d4ea';
      c.textAlign = 'right';
      c.fillText(`${i + 1}.`, VIEW_W / 2 - 170, y);
      c.fillText(String(h.score).padStart(6, '0'), VIEW_W / 2 + 20, y);
      c.textAlign = 'left';
      c.fillStyle = '#8b98b8';
      c.fillText(`LEVEL ${h.level}`, VIEW_W / 2 + 70, y);
      c.fillText(h.date, VIEW_W / 2 + 190, y);
    });
  }
  c.textAlign = 'center';
  c.font = '15px "Segoe UI", sans-serif';
  c.fillStyle = '#5b667f';
  c.fillText('Ⓑ BACK', VIEW_W / 2, VIEW_H - TV_Y - 10);
}

function drawSettings(c, time) {
  if (settingsReturn === ST.GAME) {
    drawGame(c, time);
    c.fillStyle = 'rgba(5,8,16,0.85)';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
  } else {
    drawMenuBackdrop(c, time);
  }
  c.textAlign = 'center';
  c.font = 'bold 40px "Segoe UI", sans-serif';
  c.fillStyle = '#ffcf3f';
  c.shadowColor = '#ffcf3f'; c.shadowBlur = 16;
  c.fillText('SETTINGS', VIEW_W / 2, 90);
  c.shadowBlur = 0;

  const items = settingsItems();
  items.forEach((it, i) => {
    const y = 160 + i * 47;
    const sel = i === settingsIndex;
    c.font = (sel ? 'bold ' : '') + '20px "Segoe UI", sans-serif';
    c.fillStyle = sel ? '#ffffff' : '#8b98b8';
    c.textAlign = 'right';
    c.fillText((sel ? '▸ ' : '') + it.label, VIEW_W / 2 - 20, y);
    if (it.value !== undefined) {
      c.textAlign = 'left';
      c.fillStyle = sel ? '#ffcf3f' : '#6b7894';
      c.fillText(it.value, VIEW_W / 2 + 30, y);
    }
  });
  c.textAlign = 'center';
  c.font = '15px "Segoe UI", sans-serif';
  c.fillStyle = '#5b667f';
  c.fillText('D-PAD ←/→ ADJUST · Ⓐ SELECT · Ⓑ BACK', VIEW_W / 2, VIEW_H - TV_Y - 10);
}

/* ============================== main loop ============================== */
let lastT = performance.now();
let acc = 0;
let lastResumeTry = 0;
let lastFrameMs = 0;
let rafQueued = false;
const STEP = 1 / 120;
const MAX_STEPS = 6; // most physics ticks allowed to run in one rendered frame

function scheduleFrame() {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(ts => { rafQueued = false; frame(ts); });
}

function frame(now) {
  scheduleFrame();
  lastFrameMs = performance.now();
  // Cap the frame delta hard: a slow frame (Xbox WebView warming up) must never
  // pile up a burst of physics substeps, or a held thrust applies many times at
  // once and the ship lurches. 0.05s = at most MAX_STEPS ticks per frame.
  const rawDt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const time = now / 1000;

  pollGamepad();

  // Keep trying to bring the audio context up so title music starts as early
  // as the platform allows (immediately in the packaged Xbox app).
  if (now - lastResumeTry > 500) { lastResumeTry = now; AudioSys.ensureRunning(); }

  if (state === ST.GAME) {
    handleGameInput();
    acc += rawDt;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      G.update(STEP);
      acc -= STEP;
      steps++;
      if (state !== ST.GAME) { acc = 0; break; }
    }
    // hit the cap (a real hitch) — shed the backlog instead of catching up in a
    // lurch on the next frame; a hair of slow-motion beats a jump
    if (steps >= MAX_STEPS) acc = 0;
  } else {
    handleMenuInput();
    updateParticles(rawDt);
    if (AudioSys.ready) AudioSys.playMusic(0);
    AudioSys.setEngine(0, false);
  }

  const s = save.settings.scale || 1;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.textBaseline = 'alphabetic';

  switch (state) {
    case ST.MENU: drawMenu(ctx, time); break;
    case ST.COSMOS: drawCosmosSelect(ctx, time); break;
    case ST.LEVELS: drawLevelSelect(ctx, time); break;
    case ST.SCORES: drawScores(ctx, time); break;
    case ST.SETTINGS: drawSettings(ctx, time); break;
    case ST.GAME: drawGame(ctx, time); break;
  }

  pressedQueue.length = 0;
}

AudioSys.setVolumes(save.settings);

// Start the title music as soon as the page loads. Browsers that enforce the
// autoplay policy create the context suspended; the first click or keypress
// resumes it (init() resumes an existing suspended context), so the menu
// theme begins on the very first interaction of any kind.
try { AudioSys.init(); } catch (e) { /* audio unavailable */ }
window.addEventListener('pointerdown', () => AudioSys.init());

// debug/testing: ?cosmo=N&level=M jumps into cosmos N (1-indexed), level M
// (1-indexed). e.g. ?cosmo=2&level=3 = Outer Rim board 3. (&camp=0|1 is the
// legacy 0-indexed form.) &play=1 skips the intro, &exit=1 opens the exit gate.
{
  const m = typeof location !== 'undefined' && location.search.match(/level=(\d+)/);
  if (m) {
    const cm = location.search.match(/cosmo=(\d+)/);
    const km = location.search.match(/camp=(\d+)/);
    const ci = cm ? clamp(parseInt(cm[1], 10) - 1, 0, campaignCount() - 1)
             : km ? clamp(parseInt(km[1], 10), 0, campaignCount() - 1) : 0;
    const idx = clamp(parseInt(m[1], 10) - 1, 0, campaignLevels(ci).length - 1);
    G.score = 0;
    G.startLevel(idx, ci);
    if (/play=1/.test(location.search)) { G.sub = 'play'; G.introT = 99; }
    const ex = location.search.match(/exit=(1|up|down|left|right)/);
    if (ex) {
      G.sub = 'play';
      G.introT = 99;
      G.fareIndex = G.level.fares.length;
      G.openExit();
      for (let i = 0; i < 80 && ex[1] !== '1' && G.exitGate.edge !== ex[1]; i++) {
        G.exitGate = G.pickExit();
      }
    }
  }
}

// Warm the physics + particle hot paths at load so the very first thrust on
// Xbox doesn't stall while the WebView JIT-compiles them (which is what made
// the initial liftoff jerky). Runs a throwaway thrusting ship offscreen.
function warmup() {
  try {
    const dummy = new Ship(400, 300);
    keysDown.add('KeyW');
    for (let i = 0; i < 45; i++) dummy.update(STEP); // thrust: forces + flame particles + engine ramp
    keysDown.delete('KeyW');
    explosion(400, 300);                             // explosion allocator
    for (let i = 0; i < 45; i++) updateParticles(STEP);
    particles.length = 0;                            // discard the warmup particles
    AudioSys.setEngine(0, false);
  } catch (e) { /* warmup is best-effort */ }
}
warmup();

scheduleFrame();

// Some hosts (the Xbox WebView before it receives focus) throttle
// requestAnimationFrame to a standstill, leaving a blank screen until the
// first button press. This watchdog keeps frames flowing until real vsync
// ticks take over; the scheduleFrame guard prevents double-pumping after.
setInterval(() => {
  if (performance.now() - lastFrameMs > 400) frame(performance.now());
}, 250);
