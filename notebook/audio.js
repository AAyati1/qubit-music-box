// Synthesized instruments (no samples) and a player for probability grids P[t][n][i].
// Every outcome in a beat sounds at once; its volume follows its amplitude, sqrt(probability).

const FREQS = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
export const ENSEMBLES = { band: ["piano", "guitar", "flute", "drums"], orch: ["cello", "viola", "flute", "violin"] };
const OCTAVE = { band: [1, 0.5, 2, 1], orch: [0.25, 0.5, 2, 1] };
const LEVEL = { band: [0.75, 0.9, 0.55, 1.1], orch: [1.25, 1.0, 0.75, 0.95] };
const DRUM = (n) => ["kick", "kick", "snare", "snare", "hi-hat", "hi-hat", "tom", "tom"][n];

let ctx = null, current = null;
const cache = new Map();

function bowed(SR, f, bright) { // bowed string: band-limited sawtooth, delayed vibrato, soft attack
  const data = new Float32Array(SR * 2), H = Math.min(14, Math.floor(9000 / f));
  let ph = 0;
  for (let k = 0; k < data.length; k++) {
    const t = k / SR, vib = 1 + 0.006 * Math.min(1, t / 0.25) * Math.sin(2 * Math.PI * 5.6 * t);
    ph += (2 * Math.PI * f * vib) / SR;
    let v = 0;
    for (let h = 1; h <= H; h++) v += (Math.sin(h * ph) / h) * Math.exp(-h / bright);
    data[k] = 0.42 * v * Math.min(1, t / 0.09);
  }
  return data;
}
function pluck(SR, f, decay, mix) { // Karplus-Strong plucked string
  const data = new Float32Array(SR * 2), L = Math.round(SR / f);
  for (let k = 0; k <= L; k++) data[k] = (Math.random() * 2 - 1) * 0.55;
  for (let k = L + 1; k < data.length; k++) data[k] = decay * (mix * data[k - L] + (1 - mix) * data[k - L - 1]);
  return data;
}
function buffer(pal, inst, n, freq) {
  const key = pal + inst + "-" + n + "-" + (freq || "");
  if (cache.has(key)) return cache.get(key);
  const SR = ctx.sampleRate, f = freq || FREQS[n] * OCTAVE[pal][inst];
  let data;
  if (pal === "orch" && inst !== 2) data = bowed(SR, f, [5, 4, 0, 3.2][inst]); // cello, viola, violin
  else if (inst === 1) data = pluck(SR, f, 0.996, 0.5);
  else if (inst === 2) { // flute: breathy sine with vibrato
    data = new Float32Array(SR * 2); let ph = 0, lp = 0;
    for (let k = 0; k < data.length; k++) {
      const t = k / SR; ph += (2 * Math.PI * f * (1 + 0.005 * Math.sin(2 * Math.PI * 5.2 * t))) / SR; lp = 0.9 * lp + 0.1 * (Math.random() * 2 - 1);
      data[k] = (0.5 * Math.sin(ph) + 0.08 * Math.sin(2 * ph) + 0.03 * Math.sin(3 * ph) + 0.12 * lp) * Math.min(1, t / 0.07);
    }
  } else if (inst === 3) { // drums: kick, snare, hi-hat or tom, chosen by the note
    const d = DRUM(n), dur = d === "hi-hat" ? 0.15 : d === "snare" ? 0.3 : 0.5;
    data = new Float32Array(Math.floor(SR * dur)); let ph = 0, prev = 0;
    for (let k = 0; k < data.length; k++) {
      const t = k / SR, w = Math.random() * 2 - 1, hp = w - prev; prev = w;
      if (d === "kick") { ph += (2 * Math.PI * (60 + 140 * Math.exp(-t * 30))) / SR; data[k] = Math.tanh(2.2 * Math.sin(ph) * Math.exp(-t * 7)) * 0.9; }
      else if (d === "tom") { ph += (2 * Math.PI * (150 + 110 * Math.exp(-t * 14))) / SR; data[k] = Math.tanh(1.6 * Math.sin(ph) * Math.exp(-t * 6)) * 0.8; }
      else if (d === "snare") { ph += (2 * Math.PI * 200) / SR; data[k] = 0.75 * hp * Math.exp(-t * 16) + 0.4 * Math.sin(ph) * Math.exp(-t * 22); }
      else data[k] = 0.6 * hp * Math.exp(-t * 40);
    }
  } else { // piano: decaying harmonics
    data = new Float32Array(SR * 2); const amps = [1, 0.5, 0.28, 0.14, 0.07];
    for (let k = 0; k < data.length; k++) {
      const t = k / SR; let v = 0;
      amps.forEach((a, h) => (v += a * Math.sin(2 * Math.PI * f * (h + 1) * 1.0007 ** h * t) * Math.exp(-t * (1.4 + 0.9 * h))));
      data[k] = 0.45 * v * Math.min(1, t / 0.004);
    }
  }
  const b = ctx.createBuffer(1, data.length, SR); b.copyToChannel(data, 0); cache.set(key, b);
  return b;
}

export function stopAll() {
  if (current) { current.stop(); current = null; }
}

/** Play a grid. opts: {T, K, rest (index of a silent note or -1), pal, bpm, loop, onBeat(t), onEnd(),
 *  pitches (optional MIDI number per note index; every voice is then a piano), sustain (beats a note rings),
 *  noteMap / instMap (optional: which scale degree / instrument each binary label stands for)}.
 *  Returns a handle with stop(). Only one grid plays at a time. */
export function play(P, opts) {
  stopAll();
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const pal = opts.pal || "band", B = P.length, beat = 60 / (opts.bpm || 120), timers = [];
  const master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  let alive = true, startAt = 0, raf = 0, last = -1;
  const schedule = () => {
    startAt = ctx.currentTime + 0.08;
    for (let t = 0; t < B; t++) {
      const t0 = startAt + t * beat;
      P[t].forEach((a, n) => a.forEach((p, i) => {
        if (p * B < 0.02 || n === opts.rest) return;
        const custom = !!opts.pitches, inst = custom ? 0 : opts.K ? (opts.instMap ? opts.instMap[i] : i) : 0, src = ctx.createBufferSource(), gn = ctx.createGain();
        const deg = opts.noteMap ? opts.noteMap[n] : n;
        src.buffer = buffer(pal, inst, deg, custom ? 440 * 2 ** ((opts.pitches[n] - 69) / 12) : 0);
        const len = !custom && pal === "band" && inst === 3 ? src.buffer.duration : Math.min(src.buffer.duration, beat * (opts.sustain || 1.1));
        const vol = 0.32 * LEVEL[pal][inst] * Math.min(1, Math.sqrt(p * B));
        gn.gain.setValueAtTime(vol, t0); gn.gain.setValueAtTime(vol, t0 + Math.max(0.02, len - 0.04)); gn.gain.linearRampToValueAtTime(0.0001, t0 + len);
        src.connect(gn).connect(master); src.start(t0); src.stop(t0 + len + 0.02);
      }));
    }
    timers.push(setTimeout(() => { if (!alive) return; if (opts.loop) schedule(); else handle.stop(); }, (B * beat + (opts.loop ? -0.05 : 0.6)) * 1000));
  };
  const tick = () => {
    if (!alive) return;
    const b = Math.floor((ctx.currentTime - startAt) / beat), nb = b >= 0 && b < B ? b : -1;
    if (nb !== last) { last = nb; opts.onBeat && opts.onBeat(nb); }
    raf = requestAnimationFrame(tick);
  };
  const handle = {
    stop() {
      if (!alive) return; alive = false; timers.forEach(clearTimeout); cancelAnimationFrame(raf);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.03); setTimeout(() => master.disconnect(), 300);
      opts.onBeat && opts.onBeat(-1); opts.onEnd && opts.onEnd(); if (current === handle) current = null;
    },
  };
  current = handle; schedule(); raf = requestAnimationFrame(tick);
  return handle;
}

/** Eight measurement shots of two qubits as a stereo duet: left = first qubit, right = second.
 *  0 plays C, 1 plays F#. Agreeing shots sound as an octave, disagreeing ones clash. */
export function duet(dist, onMark) {
  stopAll();
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  const tot = dist.reduce((s, p) => s + p, 0); let t0 = ctx.currentTime + 0.08;
  for (let k = 0; k < 8; k++) {
    let u = Math.random() * tot, o = 0; while (o < 3 && u >= dist[o]) { u -= dist[o]; o++; }
    const a = o & 1, b = (o >> 1) & 1;
    [[a ? 369.99 : 261.63, -0.8], [b ? 739.99 : 523.25, 0.8]].forEach(([f, pan]) => {
      const osc = ctx.createOscillator(), gn = ctx.createGain(), pn = ctx.createStereoPanner();
      osc.type = "triangle"; osc.frequency.value = f; pn.pan.value = pan;
      gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
      osc.connect(gn).connect(pn).connect(ctx.destination); osc.start(t0); osc.stop(t0 + 0.36);
    });
    setTimeout(() => onMark(a === b, k), 80 + 400 * k); t0 += 0.4;
  }
}
