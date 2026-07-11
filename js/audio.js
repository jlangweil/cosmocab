// Cosmo Cab - audio engine (WebAudio, fully synthesized)
'use strict';

const AudioSys = (() => {
  let ctx = null;
  let master, musicBus, sfxBus;
  let engineGain, engineFilter, engineOsc, engineOscGain, engineOsc2, engineOsc2Gain, thrusterGain;
  let noiseBuf = null;
  let vols = { master: 0.8, music: 0.5, sfx: 0.9 };
  let musicTimer = null;
  let songIndex = -1;
  let step = 0, nextNoteTime = 0;

  function makeNoiseBuffer(c) {
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    noiseBuf = makeNoiseBuffer(ctx);
    applyVolumes();

    // Main engine: a soft, warm hum — gentle low-passed noise underneath
    // a triangle fundamental and a quiet sine an octave up.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf; noise.loop = true;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 260;
    engineFilter.Q.value = 0.4;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    noise.connect(engineFilter).connect(engineGain).connect(sfxBus);
    noise.start();

    engineOsc = ctx.createOscillator();
    engineOsc.type = 'triangle';
    engineOsc.frequency.value = 62;
    engineOscGain = ctx.createGain();
    engineOscGain.gain.value = 0;
    engineOsc.connect(engineOscGain).connect(sfxBus);
    engineOsc.start();

    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sine';
    engineOsc2.frequency.value = 124;
    engineOsc2Gain = ctx.createGain();
    engineOsc2Gain.gain.value = 0;
    engineOsc2.connect(engineOsc2Gain).connect(sfxBus);
    engineOsc2.start();

    // Side thrusters: hissy noise
    const noise2 = ctx.createBufferSource();
    noise2.buffer = noiseBuf; noise2.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    thrusterGain = ctx.createGain();
    thrusterGain.gain.value = 0;
    noise2.connect(hp).connect(thrusterGain).connect(sfxBus);
    noise2.start();
  }

  function applyVolumes() {
    if (!ctx) return;
    master.gain.value = vols.master;
    musicBus.gain.value = vols.music * 0.5;
    sfxBus.gain.value = vols.sfx;
  }

  function setVolumes(v) { vols = Object.assign(vols, v); applyVolumes(); }

  // level: 0..1 main engine intensity
  function setEngine(level, side) {
    if (!ctx) return;
    const t = ctx.currentTime;
    engineGain.gain.setTargetAtTime(level * 0.22, t, 0.09);
    engineFilter.frequency.setTargetAtTime(200 + level * 340, t, 0.09);
    engineOscGain.gain.setTargetAtTime(level * 0.17, t, 0.09);
    engineOsc.frequency.setTargetAtTime(58 + level * 20, t, 0.09);
    engineOsc2Gain.gain.setTargetAtTime(level * 0.08, t, 0.09);
    engineOsc2.frequency.setTargetAtTime(116 + level * 40, t, 0.09);
    thrusterGain.gain.setTargetAtTime(side ? 0.06 : 0, t, 0.05);
  }

  function env(node, t0, a, peak, d, end) {
    node.gain.cancelScheduledValues(t0);
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.linearRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(Math.max(end, 0.0001), t0 + a + d);
  }

  function blip(freq, dur, type, vol, slide) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(slide, 1), t + dur);
    const g = ctx.createGain();
    env(g, t, 0.005, vol || 0.2, dur, 0.001);
    o.connect(g).connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noiseHit(dur, vol, freq, type) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass'; f.frequency.value = freq || 800;
    const g = ctx.createGain();
    env(g, t, 0.005, vol, dur, 0.001);
    src.connect(f).connect(g).connect(sfxBus);
    src.start(t); src.stop(t + dur + 0.1);
  }

  const sfx = {
    horn() {
      blip(520, 0.18, 'square', 0.25);
      setTimeout(() => blip(392, 0.25, 'square', 0.25), 140);
    },
    land() { noiseHit(0.15, 0.3, 500); blip(140, 0.12, 'sine', 0.25, 60); },
    pickup() { blip(660, 0.09, 'square', 0.2); setTimeout(() => blip(880, 0.12, 'square', 0.2), 90); },
    dropoff() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.14, 'triangle', 0.25), i * 100));
    },
    fuel() { blip(300, 0.3, 'sine', 0.22, 900); },
    explosion() {
      noiseHit(0.8, 0.8, 400);
      noiseHit(1.4, 0.5, 120);
      blip(90, 0.6, 'sawtooth', 0.4, 30);
    },
    menuMove() { blip(440, 0.05, 'square', 0.12); },
    menuSelect() { blip(660, 0.08, 'square', 0.16); setTimeout(() => blip(990, 0.1, 'square', 0.16), 70); },
    hurry() { blip(880, 0.1, 'square', 0.2); setTimeout(() => blip(880, 0.1, 'square', 0.2), 160); },
    bonus() { blip(1200, 0.12, 'triangle', 0.2, 1800); },
    zap() { noiseHit(0.2, 0.4, 3000, 'highpass'); blip(2000, 0.15, 'sawtooth', 0.2, 300); },
  };

  // ---- passenger voices ----
  // Radio-chatter chirps: a deterministic per-phrase melody of band-passed
  // blips. Used wherever speech synthesis is unavailable (e.g. the Xbox
  // WebView) so passengers are never silent.
  function chirp(text) {
    if (!ctx) return;
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    const n = 3 + (h % 3);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const f = 480 + ((h >> (i * 4)) % 11) * 85;
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'square';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (1.12 + ((h >> i) % 3) * 0.11), t + 0.07);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.4;
      bp.Q.value = 2;
      const g = ctx.createGain();
      env(g, t, 0.008, 0.16, 0.07, 0.001);
      o.connect(bp).connect(g).connect(sfxBus);
      o.start(t); o.stop(t + 0.13);
      t += 0.085 + ((h >> i) % 2) * 0.03;
    }
  }

  function say(text) {
    // In the UWP shell (Xbox), ask the host to speak the line through
    // Windows.Media.SpeechSynthesis — the WebView itself has no voices.
    if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          t: 'say',
          text: text,
          vol: Math.min(1, vols.sfx * vols.master),
          pitch: 0.8 + Math.random() * 0.7,
          rate: 1.15,
        }));
        return;
      } catch (e) { /* fall through */ }
    }
    try {
      if (window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(text);
        u.volume = Math.min(1, vols.sfx * vols.master);
        u.rate = 1.15;
        u.pitch = 0.8 + Math.random() * 0.7;
        let started = false;
        u.onstart = () => { started = true; };
        window.speechSynthesis.speak(u);
        // if speech never actually starts (no voices installed), chirp instead
        setTimeout(() => { if (!started) chirp(text); }, 450);
        return;
      }
    } catch (e) { /* fall through to chirp */ }
    chirp(text);
  }

  // ---- procedural music ----
  const SCALES = [
    [0, 3, 5, 7, 10],   // minor pentatonic
    [0, 2, 4, 7, 9],    // major pentatonic
    [0, 2, 3, 7, 8],    // exotic
    [0, 3, 5, 6, 7, 10] // blues
  ];

  let song = null;
  function buildSong(idx) {
    let seed = idx * 2654435761 >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const scale = SCALES[idx % SCALES.length];
    const root = 110 * Math.pow(2, (idx % 5) / 12);
    const bpm = 100 + (idx % 4) * 8;
    const arp = [], bass = [];
    for (let i = 0; i < 16; i++) {
      arp.push(rnd() < 0.72 ? scale[(rnd() * scale.length) | 0] + (rnd() < 0.3 ? 12 : 0) : null);
      bass.push(i % 4 === 0 ? scale[0] : (i % 4 === 2 && rnd() < 0.5 ? scale[2 % scale.length] : null));
    }
    return { root, bpm, arp, bass };
  }

  function note(freq, t, dur, type, vol) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    env(g, t, 0.01, vol, dur, 0.001);
    o.connect(g).connect(musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function scheduler() {
    if (!ctx || !song) return;
    const stepDur = 60 / song.bpm / 4;
    // If we fell behind (context was suspended pre-gesture, or the tab was
    // throttled in the background), skip ahead instead of bursting old notes.
    if (nextNoteTime < ctx.currentTime - 0.1) nextNoteTime = ctx.currentTime + 0.05;
    while (nextNoteTime < ctx.currentTime + 0.15) {
      const i = step % 16;
      if (song.arp[i] !== null) note(song.root * 2 * Math.pow(2, song.arp[i] / 12), nextNoteTime, stepDur * 0.9, 'square', 0.10);
      if (song.bass[i] !== null) note(song.root * 0.5 * Math.pow(2, song.bass[i] / 12), nextNoteTime, stepDur * 1.8, 'triangle', 0.20);
      if (i % 2 === 0) { // hat
        const src = ctx.createBufferSource(); src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        const g = ctx.createGain(); env(g, nextNoteTime, 0.002, i % 8 === 4 ? 0.06 : 0.03, 0.04, 0.001);
        src.connect(f).connect(g).connect(musicBus);
        src.start(nextNoteTime); src.stop(nextNoteTime + 0.1);
      }
      nextNoteTime += stepDur;
      step++;
    }
  }

  function playMusic(idx) {
    if (!ctx) return;
    if (idx === songIndex && musicTimer) return;
    stopMusic();
    songIndex = idx;
    song = buildSong(idx);
    step = 0;
    nextNoteTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(scheduler, 50);
  }

  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null; songIndex = -1; song = null;
  }

  // Retry-resume for autoplay-restricted contexts. On Xbox the packaged app
  // allows autoplay, so this brings the music up immediately at the title
  // screen even though controller input never counts as a DOM user gesture.
  function ensureRunning() {
    if (!ctx) { init(); return; }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // Tap the master bus into a MediaStream (used by the trailer recorder to
  // capture music + sfx alongside the canvas video).
  function captureDestination() {
    if (!ctx) init();
    if (!ctx || !ctx.createMediaStreamDestination) return null;
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    return dest.stream;
  }

  return { init, ensureRunning, setVolumes, setEngine, sfx, say, playMusic, stopMusic, captureDestination, get ready() { return !!ctx; } };
})();

if (typeof module !== 'undefined') module.exports = { AudioSys };
