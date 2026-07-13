// Cosmo Cab - trailer director.
// Loads after game.js and takes over its loop: input is disabled, G.update is
// replaced with a timeline of scripted scenes, and drawGame is wrapped to add
// letterbox bars and title cards. With ?record=1 the whole run is captured
// (canvas + synthesized audio) via MediaRecorder and saved as a .webm.
'use strict';

/* ------------------------- take over the game loop ------------------------- */
handleGameInput = function () {};

const _origDrawGame = drawGame;

let T = 0;                 // global trailer clock (seconds)
let sceneStart = 0;
let sceneIdx = -1;
let recorder = null, chunks = [];
let finished = false;

/* ------------------------------ path sampling ------------------------------ */
// Waypoints: [t, x, y] with t relative to scene start. Cosine-eased segments;
// tilt and flame intensity are derived from the path's acceleration so the
// taxi banks and burns exactly the way real physics would demand.
function samplePath(wps, t) {
  if (t <= wps[0][0]) return { x: wps[0][1], y: wps[0][2] };
  const last = wps[wps.length - 1];
  if (t >= last[0]) return { x: last[1], y: last[2] };
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0]);
      const e = 0.5 - 0.5 * Math.cos(u * Math.PI);
      return { x: a[1] + (b[1] - a[1]) * e, y: a[2] + (b[2] - a[2]) * e };
    }
  }
  return { x: last[1], y: last[2] };
}

function flyAlong(wps, t, ship) {
  const h = 0.06;
  const p0 = samplePath(wps, t - h);
  const p1 = samplePath(wps, t);
  const p2 = samplePath(wps, t + h);
  ship.x = p1.x; ship.y = p1.y;
  const vx = (p2.x - p0.x) / (2 * h), vy = (p2.y - p0.y) / (2 * h);
  const ax = (p2.x - 2 * p1.x + p0.x) / (h * h), ay = (p2.y - 2 * p1.y + p0.y) / (h * h);
  ship.vx = vx; ship.vy = vy;
  // thrust must supply path accel minus gravity (225 px/s^2, y down)
  const rx = ax, ry = ay - 225;
  const mag = Math.hypot(rx, ry);
  const target = mag > 30 ? Math.atan2(rx, -ry) : 0;
  ship.angle += (clamp(target, -0.9, 0.9) - ship.angle) * 0.15;
  ship.thrustLevel = clamp(mag / 470, 0, 1);
  return mag;
}

function flameBurst(ship) {
  if (ship.thrustLevel < 0.08) return;
  for (let i = 0; i < 3; i++) {
    spawnParticle({
      x: ship.x - Math.sin(ship.angle) * 18 + (Math.random() - 0.5) * 6,
      y: ship.y + Math.cos(ship.angle) * 18,
      vx: -Math.sin(ship.angle) * (120 + Math.random() * 80) + ship.vx * 0.5 + (Math.random() - 0.5) * 50,
      vy: Math.cos(ship.angle) * (120 + Math.random() * 80) + ship.vy * 0.5 + (Math.random() - 0.5) * 50,
      life: 0.25 + Math.random() * 0.2, maxLife: 0.4,
      size: 3 + Math.random() * 3,
      color: ['#ffdd66', '#ff9944', '#ff5522'][i % 3],
      glow: true, shrink: true, drag: 2,
    });
  }
}

/* --------------------------------- scenes --------------------------------- */
// Each scene: dur, card (fullscreen title card) or level+script.
function loadLevel(idx, song) {
  G.startLevel(idx);
  G.msg = null; G.msgT = 0;          // suppress the level-name banner
  G.introT = 99;                     // and the board-title intro card
  G.sub = 'play';
  AudioSys.playMusic(song !== undefined ? song : idx + 1);
}

function parkShip(padLabel) {
  const pad = G.level.pads.find(p => p.label === padLabel);
  G.ship.x = pad.x + pad.w / 2;
  G.ship.y = pad.y - 19;
  G.ship.vx = G.ship.vy = 0;
  G.ship.landed = true;
  G.ship.landedPad = pad;
  return pad;
}

const SCENES = [

  // --- opening title card ---
  {
    dur: 4.2, card: true,
    setup() { AudioSys.playMusic(0); },
    lines: t => [
      { text: 'EVERYONE  NEEDS  A  RIDE', size: 30, color: '#8b98b8', y: 420, in: 0.8 },
    ],
    logo: true,
  },

  // --- level 1: the fare ---
  {
    dur: 11,
    setup() {
      loadLevel(0, 1);
      parkShip('A');
      G.score = 0;
      G.ship.fuel = 92;
    },
    path: [[3.2, 240, 581], [4.4, 300, 430], [6.0, 640, 300], [7.6, 1050, 235], [8.7, 1200, 235], [9.5, 1240, 256]],
    tick(t) {
      const ship = G.ship;
      if (t < 3.2) {
        // parked: passenger walks over and boards via the real system
        ship.thrustLevel = 0;
      } else if (t < 9.55) {
        ship.landed = false; ship.landedPad = null;
        flyAlong(this.path, t, ship);
      } else if (!this.delivered) {
        this.delivered = true;
        // touch down on B and let the real delivery logic fire
        const pad = parkShip('B');
        ship.angle = 0;
        ship.thrustLevel = 0;
        AudioSys.sfx.land();
        if (G.passenger && G.passenger.state === 'riding') G.onDeliver();
      }
    },
  },

  // --- montage: lasers ---
  {
    dur: 5.5, caption: 'DODGE', noPax: true,
    setup() { loadLevel(6, 8); G.passenger = null; G.score = 1250; },
    path: [[0, 240, 640], [1.4, 560, 500], [2.4, 800, 430], [3.4, 1060, 480], [4.6, 1240, 630], [5.4, 1240, 661]],
    tick(t) {
      G.ship.landed = false;
      flyAlong(this.path, t, G.ship);
    },
  },

  // --- montage: the windmill ---
  {
    dur: 6, caption: 'SURVIVE', noPax: true,
    setup() { loadLevel(14, 8); G.passenger = null; G.score = 2400; },
    path: [[0, 420, 680], [1.2, 450, 460], [2.2, 570, 270], [3.2, 800, 240], [4.2, 1030, 270], [5.2, 1150, 450], [6, 1180, 560]],
    tick(t) {
      G.ship.landed = false;
      flyAlong(this.path, t, G.ship);
    },
  },

  // --- the crash ---
  {
    dur: 4.5, noPax: true,
    setup() { loadLevel(18, 8); G.passenger = null; G.score = 3350; },
    path: [[0, 280, 520], [1.6, 620, 470], [3.0, 900, 490]],
    tick(t) {
      const ship = G.ship;
      // drop a clearly-visible rock that strikes the taxi at the crash moment
      if (t >= 2.2 && !this.rockDropped) {
        this.rockDropped = true;
        const sp = G.hazardObjs.find(h => h.rocks);
        if (sp) sp.rocks.push({ x: 905, y: 290, vy: 160, r: 15, rot: 0.5, vr: 2.2, killer: true });
      }
      // random background rocks must never pass through the taxi undetected —
      // cull any (non-scripted) rock that strays into the ship's space
      if (!ship.dead) {
        for (const sp of G.hazardObjs) {
          if (!sp.rocks) continue;
          for (let i = sp.rocks.length - 1; i >= 0; i--) {
            const rk = sp.rocks[i];
            if (!rk.killer && Math.hypot(rk.x - ship.x, rk.y - ship.y) < 80) sp.rocks.splice(i, 1);
          }
        }
      }
      if (t < 3.0) {
        ship.landed = false;
        flyAlong(this.path, t, ship);
      } else if (!this.boomed) {
        this.boomed = true;
        ship.dead = true;
        explosion(ship.x, ship.y);
        G.shake = 1;
        AudioSys.setEngine(0, false);
        AudioSys.sfx.explosion();
      }
    },
  },

  // --- card: the promise ---
  {
    dur: 3, card: true,
    setup() {},
    lines: t => [
      { text: 'EVERY  LANDING  COUNTS', size: 44, color: '#ffffff', y: 360, in: 0.3, glowColor: '#ff5566' },
    ],
  },

  // --- night shift beauty pass ---
  {
    dur: 6, noPax: true,
    setup() { loadLevel(28, 29); G.passenger = null; G.score = 5120; },
    // routed under the fan and mover lane, then climbing clear of the shelf
    path: [[0, 240, 640], [1.8, 560, 630], [3.2, 900, 615], [4.3, 1030, 480], [5.2, 1110, 340], [6, 1160, 255]],
    tick(t) {
      G.ship.landed = false;
      flyAlong(this.path, t, G.ship);
    },
  },

  // --- card: scale ---
  {
    dur: 3, card: true,
    setup() {},
    lines: t => [
      { text: '30  HANDCRAFTED  LEVELS', size: 44, color: '#ffcf3f', y: 330, in: 0.3, glowColor: '#ffcf3f' },
      { text: 'LASERS · FANS · ROCKS · TUNNELS · NIGHT RUNS', size: 24, color: '#8b98b8', y: 400, in: 0.8 },
    ],
  },

  // --- end card ---
  {
    dur: 6, card: true, logo: true,
    setup() { AudioSys.playMusic(0); setTimeout(() => AudioSys.sfx.horn(), 1500); },
    lines: t => [
      { text: 'PLAY  IT  ON  WINDOWS  ·  XBOX  ·  VR', size: 30, color: '#c9d4ea', y: 460, in: 0.8, glowColor: '#4488ff' },
    ],
    fadeOutAt: 5.0,
  },
];

/* ----------------------------- director update ----------------------------- */
G.update = function (dt) {
  T += dt;
  let t = T - sceneStart;

  // scene transitions
  if (sceneIdx < 0 || (sceneIdx < SCENES.length && t >= SCENES[sceneIdx].dur)) {
    sceneIdx++;
    sceneStart = T;
    t = 0;
    if (sceneIdx < SCENES.length) {
      particles.length = 0;
      G.floats = [];
      SCENES[sceneIdx].setup();
    } else if (!finished) {
      finished = true;
      endTrailer();
    }
  }
  if (sceneIdx >= SCENES.length) return;
  const scene = SCENES[sceneIdx];

  // housekeeping normally done by the real G.update
  this.time = T;
  this.shake = Math.max(0, this.shake - dt * 2.5);
  if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg = null; }
  for (let i = this.floats.length - 1; i >= 0; i--) {
    const f = this.floats[i];
    f.life -= dt; f.y -= 30 * dt;
    if (f.life <= 0) this.floats.splice(i, 1);
  }
  updateParticles(dt);

  if (scene.card) return;

  // world simulation pieces we keep live
  for (const h of this.hazardObjs) h.update(dt, this);
  if (scene.noPax) this.passenger = null; // kill fares leaked by delivery timers
  if (this.passenger) this.passenger.update(dt, this);

  scene.tick(t);

  const ship = this.ship;
  if (!ship.dead) {
    flameBurst(ship);
    AudioSys.setEngine(ship.thrustLevel, false);
    ship.fuel = Math.max(20, ship.fuel - dt * 1.5);
  }

  // camera follow (same as the real game)
  const tx = clamp(ship.x - VIEW_W / 2, 0, Math.max(0, this.level.W - VIEW_W));
  const ty = clamp(ship.y - VIEW_H / 2, 0, Math.max(0, this.level.H - VIEW_H));
  const k = clamp(dt * 4.5, 0, 1);
  this.cam.x = lerp(this.cam.x, tx, k);
  this.cam.y = lerp(this.cam.y, ty, k);
};

/* ------------------------------ draw override ------------------------------ */
drawGame = function (c, time) {
  const scene = SCENES[Math.min(sceneIdx, SCENES.length - 1)];
  const t = T - sceneStart;

  if (scene && scene.card) {
    drawMenuBackdrop(c, time);
    c.fillStyle = 'rgba(4, 5, 12, 0.55)';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    if (scene.logo) drawTitle(c, time);
    c.textAlign = 'center';
    for (const ln of scene.lines(t)) {
      const a = clamp((t - ln.in) / 0.6, 0, 1);
      c.globalAlpha = a;
      c.font = `bold ${ln.size}px "Segoe UI", sans-serif`;
      c.fillStyle = ln.color;
      if (ln.glowColor) { c.shadowColor = ln.glowColor; c.shadowBlur = 20; }
      c.fillText(ln.text, VIEW_W / 2, ln.y);
      c.shadowBlur = 0;
    }
    c.globalAlpha = 1;
  } else {
    _origDrawGame(c, time);
    // caption over gameplay
    if (scene && scene.caption) {
      const a = clamp(t / 0.5, 0, 1) * clamp((scene.dur - t) / 0.5, 0, 1);
      c.globalAlpha = a;
      c.textAlign = 'center';
      c.font = 'bold 54px "Segoe UI", sans-serif';
      c.fillStyle = '#ffffff';
      c.shadowColor = '#4488ff'; c.shadowBlur = 22;
      c.fillText(scene.caption, VIEW_W / 2, VIEW_H - 120);
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    }
  }

  // letterbox bars
  c.fillStyle = '#000';
  c.fillRect(0, 0, VIEW_W, 54);
  c.fillRect(0, VIEW_H - 54, VIEW_W, 54);

  // scene fades
  let fade = 0;
  if (t < 0.5) fade = 1 - t / 0.5;
  if (scene && scene.fadeOutAt !== undefined && t > scene.fadeOutAt) {
    fade = Math.max(fade, (t - scene.fadeOutAt) / (scene.dur - scene.fadeOutAt));
  }
  if (finished) fade = 1;
  if (fade > 0) {
    c.globalAlpha = clamp(fade, 0, 1);
    c.fillStyle = '#000';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.globalAlpha = 1;
  }
};

/* -------------------------------- recording -------------------------------- */
function endTrailer() {
  AudioSys.setEngine(0, false);
  AudioSys.stopMusic();
  if (recorder && recorder.state === 'recording') {
    setTimeout(() => recorder.stop(), 600);
  } else {
    document.title = 'TRAILER DONE';
  }
}

function startRecording() {
  const stream = canvas.captureStream(60);
  const audio = AudioSys.captureDestination && AudioSys.captureDestination();
  if (audio) for (const tr of audio.getAudioTracks()) stream.addTrack(tr);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus' : 'video/webm';
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14000000 });
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    // preferred: hand the video to the local capture server
    if (location.protocol.startsWith('http')) {
      try {
        await fetch('/save-trailer', { method: 'POST', body: blob });
        document.title = 'TRAILER SAVED';
        return;
      } catch (e) { /* fall through to download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cosmocab-trailer.webm';
    document.body.appendChild(a);
    a.click();
    document.title = 'TRAILER SAVED';
  };
  recorder.start();
}

/* --------------------------------- kickoff --------------------------------- */
state = ST.GAME;
G.startLevel(0);
G.msg = null; G.msgT = 0;
sceneIdx = -1;
sceneStart = 0;
T = 0;

// debug/verification: ?jump=N fast-forwards the timeline deterministically
const _jump = parseFloat((location.search.match(/jump=([\d.]+)/) || [])[1] || '0');
if (_jump > 0) {
  for (let s = 0; s < _jump; s += 1 / 120) G.update(1 / 120);
}

window.addEventListener('load', () => {
  AudioSys.init();
  AudioSys.setVolumes({ master: 0.9, music: 0.6, sfx: 0.9 });
  if (location.search.includes('record')) {
    try { startRecording(); } catch (e) { document.title = 'RECORD FAILED: ' + e.message; }
  }
});
