// A playable circuit cell: circuit diagram, controls, piano roll, Play, and readouts.
// The state comes from Qiskit (engine.exact_state); the browser simulation in sim.js shows
// a result instantly and checks Qiskit's answer.
import * as sim from "./sim.js";
import * as draw from "./draw.js";
import * as audio from "./audio.js";
import { ENSEMBLES } from "./audio.js";
import { NOTE_NAMES } from "./songs.js";

let engine = null, cellCount = 0;
const cacheQ = new Map();
let queue = Promise.resolve();
export function setEngine(e) { engine = e && e.exact_state ? e : null; }
export const hasEngine = () => !!engine;

/** Exact state from Qiskit, one request at a time, cached by spec. */
export function qiskitState(spec) {
  const key = JSON.stringify(spec);
  if (cacheQ.has(key)) return cacheQ.get(key);
  const p = (queue = queue.then(() => engine.exact_state.callPromising(key)).then((txt) => {
    const d = JSON.parse(String(txt));
    return { ...d, state: { re: Float64Array.from(d.re), im: Float64Array.from(d.im) } };
  }));
  cacheQ.set(key, p);
  p.catch(() => cacheQ.delete(key));
  return p;
}

const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); e.innerHTML = html; return e; };
const bits = (v) => `${Math.max(0, v).toFixed(2)} bit${Math.abs(v - 1) < 0.005 ? "" : "s"}`;

export class MiniBox {
  /** opts: {make(params) -> spec, controls: ["lens","classical","dial","qft"], show: ["ent","corr","test","qpe"],
   *          recorder: draw recorder wires when classical} */
  constructor(host, opts) {
    this.o = { controls: [], show: ["ent"], ...opts };
    this.p = { lens: "N", classical: false, dial: 1, shots: 0, chord: 1 };
    this.sample = null; this.seed = 1;
    this.state = null; this.qk = null; this.handle = null; this.playing = -1;
    this.n = ++cellCount;
    host.classList.add("cell-box");
    host.innerHTML = "";
    const head = el("div", { class: "cell-head" }, `<span class="prompt">In [${this.n}]:</span> <span class="cell-title">${opts.title || ""}</span>`);
    this.status = el("span", { class: "qstatus", "aria-live": "polite" });
    head.appendChild(this.status);
    this.figC = el("div", { class: "scroll circ", tabindex: "0", role: "region", "aria-label": "Circuit diagram; scroll sideways if it is wide" });
    this.ctrl = el("div", { class: "row ctrls" });
    this.figR = el("div", { class: "scroll" });
    this.text = el("ul", { class: "beats" });
    this.stats = el("div", { class: "cstats" });
    const btns = el("div", { class: "row" });
    this.playB = el("button", { type: "button", class: "primary" }, "▶ Play");
    this.stopB = el("button", { type: "button" }, "■ Stop");
    this.playB.onclick = () => this.play(); this.stopB.onclick = () => audio.stopAll();
    btns.append(this.playB, this.stopB);
    this.draw = el("details", { class: "qdraw" }, "<summary>Qiskit's own drawing of this circuit</summary><pre></pre>");
    host.append(head, this.figC, this.ctrl, this.figR, btns, this.text, this.stats, this.draw);
    this.buildControls();
    this.refresh();
  }

  seg(label, options, key) {
    const g = el("div", { class: "seg", role: "group", "aria-label": label });
    options.forEach(([v, text]) => {
      const b = el("button", { type: "button", "aria-pressed": String(this.p[key] === v) }, text);
      b.onclick = () => { this.p[key] = v; if (key === "shots") this.seed++; // every choice of shots measures afresh
        g.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-pressed", String(options[i][0] === v))); this.refresh(); };
      g.appendChild(b);
    });
    return g;
  }
  buildControls() {
    const c = this.o.controls;
    if (c.includes("chord")) this.ctrl.appendChild(this.seg("Starting notes", [[0, "eigen-chord 0"], [1, "eigen-chord 1"], [2, "eigen-chord 2"], [3, "eigen-chord 3"], ["do", "do (not an eigen-chord)"]], "chord"));
    if (c.includes("classical")) this.ctrl.appendChild(this.seg("Source", [[false, "Quantum circuit"], [true, "Classical copy"]], "classical"));
    if (c.includes("lens")) this.ctrl.appendChild(this.seg("How to measure", [["N", "Normal measurement"], ["H", "Hadamard lens"], ...(c.includes("qft") ? [["Q", "QFT lens"]] : [])], "lens"));
    if (c.includes("shots")) {
      this.ctrl.appendChild(this.seg("Shots", [[0, "Exact"], [10, "10 shots"], [100, "100"], [1000, "1,000"], [10000, "10,000"]], "shots"));
      const again = el("button", { type: "button" }, "↻ New shots");
      again.onclick = () => { this.seed++; this.refresh(); };
      this.ctrl.appendChild(again);
    }
    if (c.includes("dial")) {
      const id = `dial-${this.n}`, lab = el("label", { class: "lbl", for: id }, "Link strength");
      const r = el("input", { type: "range", id, min: "0", max: "100", step: "5", value: "100" });
      const v = el("span", { class: "mono" }, "100%");
      r.oninput = () => { this.p.dial = +r.value / 100; v.textContent = r.value + "%"; this.refresh(); };
      this.ctrl.append(lab, r, v);
    }
    this.ctrl.hidden = !c.length;
  }

  spec() { return this.o.make(this.p); }

  refresh() {
    const spec = this.spec(), key = JSON.stringify(spec);
    this.key = key; this.spec_ = spec;
    if (!this.qk || this.qk.key !== key) {
      this.state = sim.simulate(spec);
      this.qk = { key, ok: false };
      if (engine) {
        this.status.textContent = "Qiskit is computing…"; this.status.className = "qstatus";
        qiskitState(spec).then((d) => {
          if (this.key !== key) return;
          let diff = 0; for (let x = 0; x < d.re.length; x++) diff = Math.max(diff, Math.abs(d.re[x] - this.state.re[x]), Math.abs(d.im[x] - this.state.im[x]));
          this.state = d.state; this.qk = { key, ok: true, d, diff };
          this.status.textContent = `Qiskit ${d.qiskit} ✓`; this.status.title = `Qiskit's statevector matches the browser check to ${diff < 1e-12 ? "1e-12" : diff.toExponential(1)}`;
          this.status.className = "qstatus ok"; this.draw.querySelector("pre").textContent = d.drawing; this.render();
        }).catch((e) => { this.status.textContent = "Qiskit error: " + String(e).slice(0, 120); this.status.className = "qstatus warn"; });
      } else { this.status.textContent = "browser preview (Qiskit runs inside Qollab)"; this.status.className = "qstatus warn"; }
    }
    this.render();
  }

  grid() {
    const exact = sim.measured(this.state, this.spec_, this.p.lens, this.p.classical);
    if (!this.p.shots) return exact;
    const want = `${this.key}|${this.p.shots}|${this.seed}`;
    if (this.sample && this.sample.want === want) return this.sample.P;
    this.requestShots(want, exact);
    return this.sample && this.sample.key === this.key ? this.sample.P : exact.map((r) => r.map((a) => a.map(() => 0)));
  }

  /** Measure the circuit p.shots times. Qiskit samples from the state (engine.sample_counts);
   *  without Qiskit the browser samples from the same probabilities. */
  requestShots(want, exact) {
    if (this.pendingShots === want) return;
    this.pendingShots = want;
    const spec = this.spec_, shots = this.p.shots, B = 1 << spec.T, M = 1 << spec.N;
    const toP = (counts) => {
      const P = exact.map((r) => r.map((a) => a.map(() => 0)));
      for (const k in counts) { const x = +k; P[x & (B - 1)][(x >> spec.T) & (M - 1)][x >> (spec.T + spec.N)] += counts[k] / shots; }
      return P;
    };
    const done = (counts) => {
      if (this.pendingShots !== want) return;
      this.sample = { want, key: this.key, P: toP(counts) }; this.pendingShots = null; this.render();
    };
    if (engine && engine.sample_counts) {
      engine.sample_counts.callPromising(JSON.stringify(spec), shots, this.seed).then((t) => done(JSON.parse(String(t)).counts))
        .catch(() => done(sim.sampleCounts(exact, shots)));
    } else done(sim.sampleCounts(exact, shots));
  }

  render() {
    const spec = this.spec_, P = this.grid(), B = P.length;
    this.P = P;
    this.figC.replaceChildren(draw.circuit(spec, { recorder: this.p.classical && this.o.recorder !== false, lens: this.p.lens === "H" || this.p.lens === "Q" ? this.p.lens : null }));
    this.figR.replaceChildren(draw.roll(P, spec, this.playing));
    if (spec.K) { // colour key for the voices / instruments
      const names = spec.voices || ENSEMBLES[spec.pal || "band"];
      this.figR.insertAdjacentHTML("beforeend", `<p class="vkey">${names.slice(0, 1 << spec.K).map((nm, i) => `<span><i style="background:var(--i${i})"></i>${nm}</span>`).join("")}</p>`);
    }
    // the same thing as text, beat by beat
    this.text.innerHTML = P.map((row, t) => {
      let tot = 0; const parts = [];
      row.forEach((a) => a.forEach((p) => (tot += p)));
      // percentages are shares within each voice/instrument, so one note per voice reads without a %
      const layer = row[0].map((_, i) => row.reduce((acc, a) => acc + a[i], 0));
      row.forEach((a, n) => a.forEach((p, i) => { if (n === spec.rest) return; const share = layer[i] > 1e-12 ? p / layer[i] : 0; if (tot > 1e-9 && share > 0.04) parts.push(`${spec.names ? spec.names[n] : NOTE_NAMES[spec.noteMap ? spec.noteMap[n] : n]}${spec.K ? " (" + (spec.voices || ENSEMBLES[spec.pal || "band"])[spec.instMap ? spec.instMap[i] : i] + ")" : ""}${share < 0.96 ? " " + Math.round(100 * share) + "%" : ""}`); }));
      return `<li${t === this.playing ? ' class="now"' : ""}><b>${this.p.lens === "Q" ? "reading " + t : "beat " + (t + 1)}</b> ${tot < 1e-9 || !parts.length ? "silent" : parts.join(" + ")}</li>`;
    }).join("");
    if (this.p.shots && this.sample && this.sample.want === `${this.key}|${this.p.shots}|${this.seed}`) {
      const exact = sim.measured(this.state, spec, this.p.lens, this.p.classical);
      let tv = 0, heard = 0;
      exact.forEach((r, t) => r.forEach((a, n) => a.forEach((p, i) => { const q = P[t][n][i]; tv += Math.abs(p - q) / 2; if (q > 0 && n !== spec.rest) heard++; })));
      this.shotNote = `<div><span class="lbl">After ${this.p.shots.toLocaleString("en")} shots</span><b>${Math.round(tv * 100)}% off</b><small>distance from the exact song (0% = identical); ${heard} different sounds heard</small></div>`;
    } else this.shotNote = this.p.shots ? `<div><span class="lbl">Shots</span><b>measuring…</b><small>Qiskit is sampling ${this.p.shots.toLocaleString("en")} outcomes</small></div>` : "";
    const s = this.o.show, out = [this.shotNote].filter(Boolean), limit = Math.min(spec.T, spec.N + spec.K);
    if (s.includes("ent")) {
      const e = this.p.classical ? 0 : this.qk.ok ? this.qk.d.ent_time : sim.entanglement(this.state, spec.T);
      out.push(`<div><span class="lbl">Entanglement, time ↔ notes</span><b>${bits(e)}</b>${this.p.classical ? "<small>the recorder is ignored, so time and notes are a classical mixture</small>" : ""}</div>`);
    }
    if (s.includes("corr") || s.includes("test")) {
      const cn = sim.correlation(sim.measured(this.state, spec, "N", this.p.classical)), ch = sim.correlation(sim.measured(this.state, spec, "H", this.p.classical));
      if (s.includes("corr")) out.push(`<div><span class="lbl">Correlation, normal measurement</span><b>${bits(cn)}</b></div><div><span class="lbl">Correlation, Hadamard lens</span><b>${bits(ch)}</b></div>`);
      if (s.includes("test")) {
        const ok = cn + ch > limit + 1e-6;
        out.push(`<div><span class="lbl">Two-lens test</span><b class="${ok ? "yes" : "no"}">${ok ? "Entanglement detected" : "No entanglement certified"}</b><small>${bits(cn + ch)} in total; without entanglement at most ${limit}</small></div>`);
      }
    }
    if (s.includes("qpe")) {
      // step 1: the clock's phase at each beat. If the state is (clock) x (notes), every note's amplitude
      // carries the same phase pattern across the beats; read it from the loudest note at beat 1.
      const st = this.state, dim = st.re.length, R = dim / B;
      let k0 = 0; for (let r = 1; r < R; r++) if (st.re[B * r] ** 2 + st.im[B * r] ** 2 > st.re[B * k0] ** 2 + st.im[B * k0] ** 2) k0 = r;
      const a0 = [st.re[B * k0], st.im[B * k0]], m0 = Math.hypot(...a0);
      let angles = m0 > 1e-6 ? [] : null;
      for (let t = 0; angles && t < B; t++) {
        // product check: amplitude(t, r) must equal c_t * amplitude(0, r) for every note r
        const at = [st.re[t + B * k0], st.im[t + B * k0]];
        const cr = (at[0] * a0[0] + at[1] * a0[1]) / (m0 * m0), ci = (at[1] * a0[0] - at[0] * a0[1]) / (m0 * m0);
        if (Math.abs(Math.hypot(cr, ci) - 1) > 1e-6) { angles = null; break; }
        for (let r = 0; r < R && angles; r++) {
          const pr = st.re[B * r], pi = st.im[B * r];
          if (Math.abs(st.re[t + B * r] - (cr * pr - ci * pi)) > 1e-6 || Math.abs(st.im[t + B * r] - (cr * pi + ci * pr)) > 1e-6) angles = null;
        }
        if (angles) angles.push(Math.atan2(ci, cr));
      }
      // step 2: what the clock reads after the inverse QFT
      const probs = sim.measured(st, spec, "Q").map((row) => row.reduce((a, v) => a + v.reduce((x, z) => x + z, 0), 0));
      const top = probs.findIndex((p) => p > 0.99), eig = ["1", "i", "−1", "−i"];
      const frac = (y) => (y === 0 ? "no turn" : `${y}/${B} of a turn`.replace("2/4", "1/2"));
      const verdict = top === 0
        ? `Reading 0 → the clock's phase does not turn from beat to beat → U leaves these notes completely unchanged${B === 4 ? " (its eigenvalue is 1)" : ""}. Phase = reading ÷ ${B} = 0.`
        : top > 0
        ? `Reading ${top} → the clock's phase turns ${frac(top)} per beat → U turns these notes by ${frac(top)}${B === 4 ? ` (its eigenvalue is ${eig[top]})` : ""}. Phase = reading ÷ ${B}.`
        : `The reading is random: these notes are a mix of eigen-chords, so the inverse QFT picks one of them, and measuring the clock collapses the notes onto it.`;
      const panel = document.createElement("div");
      panel.className = "qpe-panel";
      panel.innerHTML = `<span class="lbl">Phase estimation: what the QFT lens does</span>`;
      panel.appendChild(draw.qpePanel(angles, probs));
      panel.insertAdjacentHTML("beforeend", `<small class="qpe-verdict">${verdict}</small>`);
      this._qpePanel = panel;
    } else this._qpePanel = null;
    this.stats.innerHTML = out.join("");
    if (this._qpePanel) this.stats.appendChild(this._qpePanel);
  }

  play() {
    const spec = this.spec_;
    this.playB.disabled = true;
    this.handle = audio.play(this.P, {
      T: spec.T, K: spec.K, rest: spec.rest ?? -1, pal: spec.pal || "band", bpm: spec.bpm || 120, loop: false, pitches: spec.pitches, sustain: spec.sustain, noteMap: spec.noteMap, instMap: spec.instMap,
      onBeat: (t) => { this.playing = t; this.figR.replaceChildren(draw.roll(this.P, spec, t)); this.text.querySelectorAll("li").forEach((li, k) => li.classList.toggle("now", k === t)); },
      onEnd: () => { this.playB.disabled = false; },
    });
  }
}
