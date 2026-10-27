// Wires up the notebook: playable cells, live figures, the two-qubit duet, the backend run
// and the cost comparison. Every [data-...] placeholder in index.html is filled from here.
import { MiniBox, setEngine, hasEngine, qiskitState } from "./box.js";
import { SONGS, lookup, NOTE_NAMES } from "./songs.js";
import * as sim from "./sim.js";
import * as draw from "./draw.js";
import * as audio from "./audio.js";

const $$ = (sel) => [...document.querySelectorAll(sel)];
const bits = (v) => `${Math.max(0, v).toFixed(2)}`;

const BOXES = {
  silence: { title: "An empty music box", make: () => SONGS.silence() },
  drone: { title: "Hadamards on the time qubits", make: () => SONGS.drone() },
  allnotes: { title: "Hadamards on every qubit", make: () => SONGS.allNotes() },
  doremifa: { title: "do re mi fa: two controlled-X gates", make: () => SONGS.doremifa() },
  odeshots: { title: "Ode to Joy, one shot at a time", make: () => SONGS.ode(), controls: ["shots"] },
  dodorefa: { title: "do do re fa: a Toffoli gate", make: () => SONGS.dodorefa() },
  dial: { title: "Ode to Joy, with a link-strength dial", make: (p) => SONGS.ode(p.dial), controls: ["dial"] },
  copy: { title: "Real circuit or classical copy?", make: () => SONGS.doremifa(), controls: ["classical", "lens"], show: ["ent", "corr", "test"] },
  odetest: { title: "Ode to Joy through both lenses", make: () => SONGS.ode(), controls: ["classical", "lens"], show: ["ent", "corr", "test"] },
  qpe: { title: "A melody built from U and U²", make: () => SONGS.qpeMelody() },
  eigen: { title: "Eigen-chords through the QFT lens", make: (p) => (p.chord === "do" ? SONGS.qpeMelody() : SONGS.eigenChord(p.chord)), controls: ["chord", "lens", "qft"], show: ["ent", "qpe"] },
  canon: { title: "Pachelbel's Canon for four instruments", make: () => SONGS.canon(), show: ["ent"] },
  furelise: { title: "Für Elise: the opening, both hands", make: () => SONGS.furElise(), show: ["ent"], controls: ["shots"] },
};

async function stateOf(spec) {
  if (hasEngine()) { try { return (await qiskitState(spec)).state; } catch (e) { /* fall back */ } }
  return sim.simulate(spec);
}

/** Figure next to the Objective: the whole story at a glance. */
async function overviewFigure(host) {
  const spec = SONGS.doremifa(), st = await stateOf(spec), limit = 2;
  const col = (title, cl) => {
    const d = document.createElement("div"); d.className = "ov-col";
    d.innerHTML = `<h3>${title}</h3>`;
    const c = draw.circuit(spec, { recorder: cl }); c.classList.remove("circuit"); d.appendChild(c);
    for (const [lens, name] of [["N", "measured normally"], ["H", "Hadamard lens"]]) {
      const P = sim.measured(st, spec, lens, cl), corr = sim.correlation(P);
      const f = document.createElement("div"); f.className = "ov-row";
      f.appendChild(draw.mini(P, `${title}, ${name}: correlation ${corr.toFixed(0)} bits`));
      f.insertAdjacentHTML("beforeend", `<span><span class="lbl">${name}</span><br>${corr.toFixed(0)} bits of correlation</span>`);
      d.appendChild(f);
    }
    const tot = sim.correlation(sim.measured(st, spec, "N", cl)) + sim.correlation(sim.measured(st, spec, "H", cl));
    d.insertAdjacentHTML("beforeend", `<p class="ov-verdict ${tot > limit + 1e-6 ? "yes" : "no"}">${tot.toFixed(0)} / ${limit} bits: ${tot > limit + 1e-6 ? "entanglement detected" : "not certified"}</p>`);
    return d;
  };
  host.classList.add("overview");
  host.append(col("Quantum music box", false), col("Classical copy", true));
  host.insertAdjacentHTML("beforeend", `<p class="ov-cap">Both boxes play do re mi fa (top grids). Only the Hadamard lens (bottom grids) tells them apart.</p>`);
}

/** Figure: the gates inside U, controlled-U and controlled-U². */
function uGatesFigure(host) {
  const X = (q) => [q, "X", 0];
  const parts = [
    ["U (+1)", { T: 0, N: 2, K: 0, cols: [{ ctrls: [[0, 1]], gates: [X(1)], u: -1 }, { ctrls: [], gates: [X(0)], u: -1 }] }],
    ["controlled-U (on t0)", { T: 1, N: 2, K: 0, cols: [{ ctrls: [[0, 1], [1, 1]], gates: [X(2)], u: -1 }, { ctrls: [[0, 1]], gates: [X(1)], u: -1 }] }],
    ["controlled-U² (on t1)", { T: 2, N: 2, K: 0, cols: [{ ctrls: [[1, 1]], gates: [X(3)], u: -1 }] }],
  ];
  for (const [title, spec] of parts) {
    const f = document.createElement("figure");
    const c = draw.circuit(spec); c.classList.remove("circuit"); f.appendChild(c);
    f.insertAdjacentHTML("beforeend", `<figcaption>${title}</figcaption>`);
    host.appendChild(f);
  }
}

/** Figure: the overlap table (reduced density matrix of the time qubits) for three songs. */
async function entropyFigure(host) {
  const songs = [["Drone", SONGS.drone()], ["do do re fa", SONGS.dodorefa()], ["do re mi fa", SONGS.doremifa()]];
  host.classList.add("figrow");
  for (const [name, spec] of songs) {
    const st = await stateOf(spec), rho = sim.rhoTime(st, spec.T);
    const mag = rho.re.map((r, i) => [...r].map((v, j) => Math.hypot(v, rho.im[i][j])));
    const ev = sim.eigenvalues(rho).filter((l) => l > 1e-9), S = ev.reduce((s, l) => s - l * Math.log2(l), 0);
    const fig = document.createElement("figure"); fig.className = "entcol";
    // the circuit and the notes it plays, above its overlap table
    const c = draw.circuit(spec); c.classList.remove("circuit"); fig.appendChild(c);
    const P = sim.probs(st, spec);
    const notes = P.map((beat) => beat.map((v, n) => [v.reduce((s, x) => s + x, 0), n]).filter(([p]) => p > 0.01).map(([, n]) => NOTE_NAMES[n]).join("+"));
    fig.insertAdjacentHTML("beforeend", `<p class="entnotes"><span class="lbl">plays</span> ${notes.join(" · ")}</p>`);
    fig.appendChild(draw.mini(P, `${name}: notes on beats 1 to 4: ${notes.join(", ")}`));
    fig.appendChild(draw.heatmap(mag, `Overlap table for ${name}`));
    fig.insertAdjacentHTML("beforeend", `<figcaption><b>${name}</b><br>eigenvalues ${ev.map((l) => l.toFixed(2).replace(/^0/, "")).join(", ")}<br>entanglement <b>${bits(S)} bits</b></figcaption>`);
    host.appendChild(fig);
  }
}

/** Figure: normal + Hadamard correlation for several circuits, against each one's limit. */
async function testFigure(host) {
  const rows = [["do re mi fa", SONGS.doremifa(), false], ["its classical copy", SONGS.doremifa(), true], ["do do re fa", SONGS.dodorefa(), false], ["Ode to Joy", SONGS.ode(), false], ["Canon (orchestra)", SONGS.canon(), false], ["Drone", SONGS.drone(), false]];
  const items = [];
  for (const [label, spec, cl] of rows) {
    const st = await stateOf(spec), v = sim.correlation(sim.measured(st, spec, "N", cl)) + sim.correlation(sim.measured(st, spec, "H", cl));
    const limit = Math.min(spec.T, spec.N + spec.K);
    items.push({ label, value: v, limit, kind: v > limit + 1e-6 ? "yes" : "no" });
  }
  host.appendChild(draw.bars(items, 4.5, "Two-lens test results: bars past their dashed line certify entanglement"));
}

/** The verdict: quantum vs classical music box, same notes, different totals. */
async function verdictFigure(host) {
  const spec = SONGS.doremifa(), st = await stateOf(spec), limit = Math.min(spec.T, spec.N + spec.K);
  host.classList.add("verdicts");
  for (const [name, cl] of [["Quantum music box", false], ["Classical music box", true]]) {
    const v = sim.correlation(sim.measured(st, spec, "N", cl)) + sim.correlation(sim.measured(st, spec, "H", cl)), ok = v > limit + 1e-6;
    host.insertAdjacentHTML("beforeend", `<div class="verdict ${ok ? "yes" : "no"}"><span class="lbl">${name}</span><b>${v.toFixed(0)} / ${limit} bits</b><span>${ok ? "Exceeds the limit: entanglement detected." : "Does not exceed the limit: no entanglement certified."}</span></div>`);
  }
}

/** Two-qubit duet: time qubit t0 and note qubit n0 of the Bell-pair circuit. */
async function pairCell(host) {
  const spec = SONGS.bell(), st = await stateOf(spec);
  const dist = (had, cl) => {
    const P = sim.measured(st, spec, had ? "H" : "N", cl), d = [0, 0, 0, 0];
    P.forEach((row, t) => row.forEach((a, n) => a.forEach((p) => (d[(t & 1) + 2 * (n & 1)] += p))));
    return d;
  };
  host.classList.add("pairgrid");
  for (const [title, cl] of [["Quantum circuit", false], ["Classical copy", true]]) {
    const col = document.createElement("div"); col.className = "paircol";
    col.innerHTML = `<h3>${title}</h3>`;
    for (const [lens, had] of [["Normal measurement", false], ["Hadamard lens", true]]) {
      const d = dist(had, cl), agree = d[0] + d[3], lab = had ? ["+", "−"] : ["0", "1"];
      const card = document.createElement("div"); card.className = "paircard";
      card.innerHTML = `<span class="lbl">${lens}</span>
        <table class="pt"><caption class="sr-only">${title}, ${lens}: probabilities for time qubit t0 and note qubit n0</caption>
        <tr><th></th><th scope="col">n0 = ${lab[0]}</th><th scope="col">n0 = ${lab[1]}</th></tr>
        <tr><th scope="row">t0 = ${lab[0]}</th><td>${Math.round(d[0] * 100)}%</td><td>${Math.round(d[2] * 100)}%</td></tr>
        <tr><th scope="row">t0 = ${lab[1]}</th><td>${Math.round(d[1] * 100)}%</td><td>${Math.round(d[3] * 100)}%</td></tr></table>
        <span>they agree <b>${Math.round(agree * 100)}%</b> of the time</span>
        <div class="row"><button type="button">▶ Hear 8 shots</button><span class="shots" aria-live="polite"></span></div>`;
      const out = card.querySelector(".shots");
      card.querySelector("button").onclick = () => { out.textContent = ""; audio.duet(d, (ok) => (out.textContent += ok ? "✓ " : "✗ ")); };
      col.appendChild(card);
    }
    host.appendChild(col);
  }
}

/** Run on the backend chosen in Qollab: one job, two copies, one per lens. */
function runCell(host, getBackend, engine) {
  const opts = { doremifa: ["do re mi fa", SONGS.doremifa], bell: ["Bell pair", SONGS.bell], dodorefa: ["do do re fa", SONGS.dodorefa], ode: ["Ode to Joy", SONGS.ode] };
  host.innerHTML = `<div class="row">
      <label class="lbl" for="run-song">Song</label><select id="run-song">${Object.entries(opts).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join("")}</select>
      <label class="row" style="gap:4px"><input type="checkbox" id="run-copy"> <span class="lbl">classical copy</span></label>
      <label class="lbl" for="run-shots">Shots</label><select id="run-shots"><option>200</option><option>1000</option><option selected>2000</option><option>4000</option><option>8000</option></select>
      <button type="button" class="primary" id="run-go">Run on the selected backend</button>
    </div>
    <p class="hint" id="run-plan" aria-live="polite"></p>
    <p class="hint" id="run-status" role="status"></p>
    <div id="run-out"></div>`;
  const status = host.querySelector("#run-status"), out = host.querySelector("#run-out"), planEl = host.querySelector("#run-plan");
  const current = () => ({ spec: opts[host.querySelector("#run-song").value][1](), copy: host.querySelector("#run-copy").checked, shots: +host.querySelector("#run-shots").value });
  // before anything is sent: qubits needed vs the backend, and shots needed for a verdict
  const plan = async () => {
    const { spec, copy, shots } = current(), n = spec.T + spec.N + spec.K;
    let p = { qubits: 2 * (n + (copy ? spec.T : 0)) + 2, capacity: null, fits: true, min_shots: 10 * (1 << n), enough_shots: shots >= 10 * (1 << n) };
    if (engine && engine.plan_two_lens) { try { p = JSON.parse(String(await engine.plan_two_lens.callPromising(getBackend(), JSON.stringify(spec), shots, copy))); } catch (e) { /* keep the estimate */ } }
    const cap = p.capacity ? ` (this backend has ${p.capacity})` : "";
    planEl.textContent = !p.fits ? `This run needs ${p.qubits} qubits${cap}, so it cannot run here.`
      : `This run uses ${p.qubits} qubits${cap}. ` + (p.enough_shots ? "Enough shots for a verdict." : `With ${shots.toLocaleString("en")} shots the backend will play the measured music but give no verdict: this circuit needs at least ${p.min_shots.toLocaleString("en")}.`);
    return p;
  };
  ["#run-song", "#run-copy", "#run-shots"].forEach((s) => host.querySelector(s).addEventListener("change", plan));
  plan();
  host.querySelector("#run-go").onclick = async () => {
    const backend = getBackend();
    if (!engine || !backend) { status.textContent = "This runs inside Qollab: press Run there first, with a backend selected."; return; }
    const { spec, copy, shots } = current();
    if (!(await plan()).fits) { status.textContent = "Not sent: the circuit is wider than this backend."; return; }
    const btn = host.querySelector("#run-go"); btn.disabled = true; status.textContent = `Sending one job: ${shots} shots, ${2 * (spec.T + spec.N + spec.K + (copy ? spec.T : 0)) + 2} qubits…`;
    try {
      const d = JSON.parse(String(await engine.run_two_lens.callPromising(backend, JSON.stringify(spec), shots, copy)));
      if (d.error) { status.textContent = "Not run: " + d.error + "."; return; }
      const sum = d.corr_normal + d.corr_hadamard;
      out.innerHTML = `<div class="cstats">
        <div><span class="lbl">Backend</span><b>${d.backend}</b><small>${d.qubits} qubits · ${d.compiled_2q} multi-qubit instructions after compiling for this backend</small></div>
        <div><span class="lbl">Correlation, normal (copy A)</span><b>${bits(d.corr_normal)} bits</b></div>
        <div><span class="lbl">Correlation, Hadamard (copy B)</span><b>${bits(d.corr_hadamard)} bits</b></div>
        <div><span class="lbl">Two-lens test from shots</span><b class="${d.proven ? "yes" : "no"}">${d.proven ? "Entanglement detected" : d.enough_shots ? "Not certified" : "No verdict"}</b><small>${d.enough_shots ? `${sum.toFixed(2)} ± ${d.err.toFixed(2)} bits, approx. 95% lower bound ${d.low95.toFixed(2)}, limit ${d.bound}` : `needs at least ${d.min_shots} shots for this circuit (10 per possible outcome)`}</small></div>
      </div><div class="row"><button type="button" class="primary" id="run-play">▶ Play what the backend measured</button></div>`;
      const B = 1 << spec.T, M = 1 << spec.N, P = [...Array(B)].map(() => [...Array(M)].map(() => new Float64Array(1)));
      let tot = 0; for (const k in d.normal) tot += d.normal[k];
      for (const k in d.normal) { const x = +k; P[x & (B - 1)][(x >> spec.T) & (M - 1)][0] += d.normal[k] / tot; }
      out.querySelector("#run-play").onclick = () => audio.play(P, { T: spec.T, K: 0, rest: -1, bpm: 120 });
      status.textContent = "Done.";
    } catch (e) {
      const m = String(e);
      status.textContent = /one job|already|limit/i.test(m) ? "IonQ takes one job per run: press Run in Qollab again to send another." : "Backend error: " + m.slice(0, 200);
    } finally { btn.disabled = false; }
  };
}

/** Cost comparison with live Qiskit transpiler counts. */
function costCell(host, engine) {
  const rows = [["do re mi fa, lookup table", lookup(2, 2, [0, 1, 2, 3]), 24], ["do re mi fa, as drawn above", SONGS.doremifa(), 2], ["Ode to Joy, lookup table", SONGS.ode(), 324], ["Ode to Joy, algebraic", SONGS.odeAlgebraic(), 172], ["Canon, 4 instruments", SONGS.canon(), 630], ["Für Elise opening, lookup table", SONGS.furEliseLookup(), 5328], ["Für Elise opening, algebraic", SONGS.furElise(), 2454]];
  host.innerHTML = `<table class="data"><caption class="sr-only">CNOT counts after Qiskit's transpiler</caption><thead><tr><th scope="col">Circuit</th><th scope="col">CNOTs (Qiskit transpiler)</th></tr></thead><tbody>${rows.map(([n, , v], i) => `<tr><td>${n}</td><td class="num" id="cost-${i}">${v}</td></tr>`).join("")}</tbody></table>
    <div class="row"><button type="button" id="cost-go">Recount live with Qiskit</button><span class="hint" id="cost-st" aria-live="polite" style="margin:0">Numbers above: Qiskit 2.5 transpiler, basis CNOT + single-qubit, optimisation level 1, two scratch qubits.</span></div>`;
  host.querySelector("#cost-go").onclick = async () => {
    const st = host.querySelector("#cost-st");
    if (!engine) { st.textContent = "Live counting runs inside Qollab."; return; }
    for (let i = 0; i < rows.length; i++) {
      st.textContent = `Transpiling ${rows[i][0]}…`;
      try { const d = JSON.parse(String(await engine.compiled_cost.callPromising(JSON.stringify(rows[i][1])))); host.querySelector(`#cost-${i}`).textContent = d.cx; }
      catch (e) { st.textContent = "Error: " + String(e).slice(0, 120); return; }
    }
    st.textContent = "Recounted live by Qiskit in your browser.";
  };
}

export async function initNotebook(engine, getBackend) {
  setEngine(engine);
  $$("[data-box]").forEach((host) => new MiniBox(host, BOXES[host.dataset.box]));
  const jobs = [];
  $$("[data-fig=entropy]").forEach((h) => jobs.push(entropyFigure(h)));
  $$("[data-fig=overview]").forEach((h) => jobs.push(overviewFigure(h)));
  $$("[data-fig=piano]").forEach((h) => h.appendChild(draw.piano()));
  $$("[data-fig=eigen]").forEach((h) => h.appendChild(draw.eigenChords(1)));
  $$("[data-fig=ugates]").forEach((h) => uGatesFigure(h));
  $$("[data-fig=test]").forEach((h) => jobs.push(testFigure(h)));
  $$("[data-pair]").forEach((h) => jobs.push(pairCell(h)));
  $$("[data-fig=verdict]").forEach((h) => jobs.push(verdictFigure(h)));
  $$("[data-run]").forEach((h) => runCell(h, getBackend, engine && engine.run_two_lens ? engine : null));
  $$("[data-cost]").forEach((h) => costCell(h, engine && engine.compiled_cost ? engine : null));
  await Promise.all(jobs);
}
