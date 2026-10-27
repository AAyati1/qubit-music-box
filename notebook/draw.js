// Figures for the notebook, drawn as inline SVG so they follow the page's light/dark colours.
import { NOTE_NAMES } from "./songs.js";

const NS = "http://www.w3.org/2000/svg";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
export function svg(w, h, body, label) {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", `0 0 ${w} ${h}`); el.setAttribute("width", w); el.setAttribute("role", "img");
  el.setAttribute("aria-label", label); el.classList.add("fig"); el.innerHTML = body;
  return el;
}

/** Circuit diagram. opts: {recorder: bool (classical copy wires), lens: "H" | null} */
export function circuit(spec, opts = {}) {
  const { T, N, K } = spec, n = T + N + K, rec = opts.recorder ? T : 0, rows = n + rec;
  // the starting notes come first: X gates for a starting note, or the eigen-chord preparation
  const start = spec.start || { k: "b", v: 0 }, pre = [];
  if (start.k === "e") pre.push({ startChord: start.v });
  else if (start.v) pre.push({ ctrls: [], gates: [...Array(N).keys()].filter((k) => (start.v >> k) & 1).map((k) => [T + k, "X", 0]), u: -1 });
  const cols = [...pre, ...spec.cols];
  const extra = [];
  if (rec) for (let q = 0; q < T; q++) extra.push({ copy: q });
  if (opts.lens === "H") extra.push({ lens: true });
  if (opts.lens === "Q") extra.push({ qftLens: true });
  const all = [...cols, ...extra], cw = 44, rh = 34, x0 = 64, y0 = 22, W = x0 + all.length * cw + 24, Hh = y0 + rows * rh;
  const wireY = (q) => y0 + q * rh;
  const name = (q) => (q < T ? `t${q}` : q < T + N ? `n${q - T}` : q < n ? `i${q - T - N}` : `r${q - n}`);
  const cls = (q) => (q < T ? "time" : q < T + N ? "note" : q < n ? "inst" : "rec");
  let b = "";
  for (let q = 0; q < rows; q++)
    b += `<text x="6" y="${wireY(q) + 4}" class="wl ${cls(q)}">${name(q)}</text><line x1="40" x2="${W - 10}" y1="${wireY(q)}" y2="${wireY(q)}" class="wire ${q >= n ? "dash" : ""}"/>`;
  const box = (x, q, label, k = "") => `<rect x="${x - 14}" y="${wireY(q) - 13}" width="28" height="26" rx="5" class="gate ${k}"/><text x="${x}" y="${wireY(q) + 4.5}" class="gl">${esc(label)}</text>`;
  const dot = (x, q, v) => `<circle cx="${x}" cy="${wireY(q)}" r="5.5" class="${v ? "ctrl" : "anti"}"/>`;
  const plus = (x, q) => `<circle cx="${x}" cy="${wireY(q)}" r="10" class="oplus"/><line x1="${x - 10}" x2="${x + 10}" y1="${wireY(q)}" y2="${wireY(q)}" class="ol"/><line x1="${x}" x2="${x}" y1="${wireY(q) - 10}" y2="${wireY(q) + 10}" class="ol"/>`;
  all.forEach((c, k) => {
    const x = x0 + k * cw + cw / 2;
    if (c.copy !== undefined) { // recorder copies the beat: a CNOT onto a hidden wire
      b += `<line x1="${x}" x2="${x}" y1="${wireY(c.copy)}" y2="${wireY(n + c.copy)}" class="vl"/>` + dot(x, c.copy, 1) + plus(x, n + c.copy);
      return;
    }
    if (c.lens) { for (let q = 0; q < n; q++) b += box(x, q, "H", "lens"); return; }
    if (c.qftLens) { // inverse QFT on the clock (time) qubits only: the second half of phase estimation
      const top = wireY(0) - 13, h = wireY(T - 1) - wireY(0) + 26;
      b += `<rect x="${x - 21}" y="${top}" width="42" height="${h}" rx="5" class="gate lens"/><text x="${x}" y="${top + h / 2 + 4}" class="gl" font-size="10.5">QFT⁻¹</text>`;
      return;
    }
    if (c.startChord !== undefined) { // eigen-chord: inverse QFT of |v> on the note qubits
      const top = wireY(T) - 13, h = wireY(T + N - 1) - wireY(T) + 26;
      b += `<rect x="${x - 25}" y="${top}" width="50" height="${h}" rx="5" class="gate start"/><text x="${x}" y="${top + h / 2 - 2}" class="gl" font-size="9.5">eigen-</text><text x="${x}" y="${top + h / 2 + 10}" class="gl" font-size="9.5">chord ${c.startChord}</text>`;
      return;
    }
    const ctrls = c.ctrls || [], gates = c.gates || [];
    if (c.u >= 0) {
      const top = wireY(T) - 13, h = wireY(T + N - 1) - wireY(T) + 26;
      const ys = [...ctrls.map(([q]) => q), c.u];
      b += `<line x1="${x}" x2="${x}" y1="${wireY(Math.min(...ys))}" y2="${top}" class="vl"/>`;
      ctrls.forEach(([q, v]) => (b += dot(x, q, v))); b += dot(x, c.u, 1);
      b += `<rect x="${x - 16}" y="${top}" width="32" height="${h}" rx="5" class="gate u"/><text x="${x}" y="${top + h / 2 + 4}" class="gl">U${c.u ? "<tspan dy='-6' font-size='9'>" + (1 << c.u) + "</tspan>" : ""}</text>`;
      return;
    }
    const qs = [...ctrls.map(([q]) => q), ...gates.map(([q]) => q)];
    if (ctrls.length && qs.length > 1) b += `<line x1="${x}" x2="${x}" y1="${wireY(Math.min(...qs))}" y2="${wireY(Math.max(...qs))}" class="vl"/>`;
    ctrls.forEach(([q, v]) => (b += dot(x, q, v)));
    gates.forEach(([q, kind, deg]) => {
      if (kind === "X" && ctrls.length && (spec.dial ?? 1) >= 0.999) b += plus(x, q);
      else b += box(x, q, kind === "RY" ? `Ry` : kind === "X" && ctrls.length ? `Ry` : kind === "SDG" ? "S†" : kind);
    });
  });
  if (opts.lens === "H" || opts.lens === "Q") b += `<text x="${x0 + (all.length - 0.5) * cw}" y="${Hh - 2}" class="cap">lens</text>`;
  if (rec) b += `<text x="${x0 + (cols.length + T / 2) * cw}" y="${Hh - 2}" class="cap">record the beat</text>`;
  if (pre.length && start.k === "e") b += `<text x="${x0 + cw / 2}" y="${Hh - 2}" class="cap">starting notes</text>`;
  const out = svg(W, Hh + 6, b, `Circuit with ${n} qubits and ${cols.length} columns of gates${rec ? ", plus recorder wires that copy the beat" : ""}`);
  out.classList.add("circuit");
  return out;
}

/** Piano roll: beats are columns, notes are rows. Brighter = more probable. */
export function roll(P, spec, playing = -1) {
  const B = P.length, M = P[0].length, I = P[0][0].length, cw = Math.max(18, Math.min(40, 520 / B)), rh = 20, x0 = 40, y0 = 6;
  let b = "";
  // rows from low to high: by note index, or by real pitch when the song has its own pitch table
  const order = spec.pitches ? [...Array(M).keys()].sort((a, c) => (a === spec.rest ? -1 : c === spec.rest ? 1 : spec.pitches[a] - spec.pitches[c]))
    : spec.noteMap ? [...Array(M).keys()].sort((a, c) => spec.noteMap[a] - spec.noteMap[c]) : [...Array(M).keys()];
  order.forEach((n, row) => {
    const y = y0 + (M - 1 - row) * rh, rest = spec.rest === n;
    b += `<text x="${x0 - 6}" y="${y + 14}" class="rl">${rest ? "rest" : spec.names ? spec.names[n] : NOTE_NAMES[spec.noteMap ? spec.noteMap[n] : n]}</text>`;
    for (let t = 0; t < B; t++) {
      let tot = 0, best = 0, bi = 0;
      P[t][n].forEach((p, i) => { tot += p; if (p > best) { best = p; bi = i; } });
      const a = Math.min(1, tot * B);
      b += `<rect x="${x0 + t * cw + 1}" y="${y + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" class="sq${t === playing ? " now" : ""}"/>`;
      // a rest is drawn in the colour of the voice that rests; if several voices rest on the same
      // beat, the cell is split between their colours
      if (a > 0.01 && rest) {
        const resting = Array.from(P[t][n], (p, i) => [p, i]).filter(([p]) => p * B > 0.01), w = (cw - 2) / resting.length;
        resting.forEach(([p, i], j) => {
          const col = I > 1 ? "i" + (spec.instMap ? spec.instMap[i] : i) : "note";
          b += `<rect x="${(x0 + t * cw + 1 + j * w).toFixed(1)}" y="${y + 1}" width="${w.toFixed(1)}" height="${rh - 2}" rx="3" fill="var(--${col})" opacity="${(0.25 + 0.75 * Math.min(1, p * B)).toFixed(2)}"/>`;
        });
      }
      if (a > 0.01 && !rest) b += `<rect x="${x0 + t * cw + 1}" y="${y + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" fill="var(--${I > 1 ? "i" + (spec.instMap ? spec.instMap[bi] : bi) : "note"})" opacity="${(0.25 + 0.75 * a).toFixed(2)}"/>`;
    }
  });
  for (let t = 0; t < B; t++) b += `<text x="${x0 + t * cw + cw / 2}" y="${y0 + M * rh + 13}" class="bl${t === playing ? " now" : ""}">${t + 1}</text>`;
  return svg(x0 + B * cw + 6, y0 + M * rh + 18, b, "Piano roll; the same information is listed as text below it.");
}

/** Small beat x note grid (rows low to high), for overview figures. */
export function mini(P, label) {
  const B = P.length, M = P[0].length, c = 15, x0 = 2, y0 = 2;
  let b = "";
  for (let n = 0; n < M; n++) for (let t = 0; t < B; t++) {
    const p = P[t][n].reduce((s, v) => s + v, 0), a = Math.min(1, p * B), y = y0 + (M - 1 - n) * c;
    b += `<rect x="${x0 + t * c}" y="${y}" width="${c - 2}" height="${c - 2}" rx="2" class="sq"/>`;
    if (a > 0.01) b += `<rect x="${x0 + t * c}" y="${y}" width="${c - 2}" height="${c - 2}" rx="2" fill="var(--note)" opacity="${(0.2 + 0.8 * a).toFixed(2)}"/>`;
  }
  return svg(x0 + B * c + 2, y0 + M * c + 2, b, label);
}

/** One octave of a piano (C4 to C5) with do re mi fa marked, numbered by the beat they play on. */
export function piano() {
  const w = 34, h = 120, names = ["do", "re", "mi", "fa", "sol", "la", "ti", "do′"], beat = { 0: 1, 1: 2, 2: 3, 3: 4 };
  let b = "";
  for (let k = 0; k < 8; k++) {
    const on = k in beat, x = 4 + k * w;
    b += `<rect x="${x}" y="4" width="${w - 2}" height="${h}" rx="3" class="${on ? "key on" : "key"}"/>`;
    b += `<text x="${x + w / 2 - 1}" y="${h - 8}" class="kl">${names[k]}</text>`;
    if (on) b += `<circle cx="${x + w / 2 - 1}" cy="${h + 20}" r="10" class="kb"/><text x="${x + w / 2 - 1}" y="${h + 24}" class="kbn">${beat[k]}</text>`;
  }
  [0, 1, 3, 4, 5].forEach((k) => (b += `<rect x="${4 + (k + 1) * w - 11}" y="4" width="20" height="${h * 0.6}" rx="2" class="bkey"/>`));
  b += `<text x="${4 + 4 * w}" y="${h + 46}" class="cap">numbers: the beat each key plays on</text>`;
  return svg(8 + 8 * w, h + 52, b, "One octave of a piano keyboard. The keys do, re, mi and fa are highlighted and numbered 1 to 4: the beats they play on in the song do re mi fa.");
}

/** The four eigen-chords of U as phase arrows. Row v, note k: an arrow at angle -2*pi*v*k/4
 *  (all the same length: every note equally loud). Right: how far U turns the whole chord,
 *  and what the QFT lens reads. Row `mark` is highlighted. */
export function eigenChords(mark = 1) {
  const notes = [["do", "|00⟩"], ["re", "|01⟩"], ["mi", "|10⟩"], ["fa", "|11⟩"]], turns = ["none", "¼ turn", "½ turn", "¾ turn"];
  const COEF = ["1", "−i", "−1", "i"]; // (−i)^m: the arrow's direction, as a number
  const cw = 58, rh = 72, x0 = 118, y0 = 84, r = 18;
  const arrow = (cx, cy, ang, cls) => {
    const ex = cx + r * Math.cos(ang), ey = cy - r * Math.sin(ang), hx = Math.cos(ang), hy = -Math.sin(ang);
    const a1 = [ex - 7 * hx - 4 * hy, ey - 7 * hy + 4 * hx], a2 = [ex - 7 * hx + 4 * hy, ey - 7 * hy - 4 * hx];
    return `<circle cx="${cx}" cy="${cy}" r="${r}" class="ph-ring"/><line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" class="${cls}"/><polygon points="${ex},${ey} ${a1} ${a2}" class="${cls}-head"/>`;
  };
  let b = "";
  // key: which direction means which number
  const kx = 58, ky = 50;
  b += `<text x="${kx}" y="12" class="eh">arrow = number</text>` + arrow(kx, ky, 0, "ph");
  b += `<text x="${kx + 26}" y="${ky + 4}" class="ek">1</text><text x="${kx}" y="${ky - 22}" class="ek">i</text><text x="${kx - 28}" y="${ky + 4}" class="ek">−1</text><text x="${kx}" y="${ky + 32}" class="ek">−i</text>`;
  notes.forEach(([nm, ket], k) => (b += `<text x="${x0 + k * cw + cw / 2}" y="${y0 - 26}" class="eh">${nm}</text><text x="${x0 + k * cw + cw / 2}" y="${y0 - 12}" class="ek">${ket}</text>`));
  const xu = x0 + 4 * cw + 14, xq = xu + 92, xe = xq + 74;
  b += `<text x="${xu + 36}" y="${y0 - 26}" class="eh">U turns it</text><text x="${xu + 36}" y="${y0 - 12}" class="ek">by</text>`;
  b += `<text x="${xq + 30}" y="${y0 - 26}" class="eh">QFT lens</text><text x="${xq + 30}" y="${y0 - 12}" class="ek">reads</text>`;
  b += `<text x="${xe}" y="${y0 - 26}" class="ehl">the same chord as an equation</text>`;
  for (let v = 0; v < 4; v++) {
    const cy = y0 + v * rh + rh / 2 - 6;
    if (v === mark) b += `<rect x="4" y="${y0 + v * rh + 2}" width="${xe + 316}" height="${rh - 4}" rx="8" class="erow"/>`;
    b += `<text x="${x0 - 12}" y="${cy + 4}" class="el">eigen-chord ${v}</text>`;
    const cs = [];
    for (let k = 0; k < 4; k++) {
      const m = (v * k) % 4;
      cs.push(COEF[m]);
      b += arrow(x0 + k * cw + cw / 2, cy, (-2 * Math.PI * m) / 4, "ph") + `<text x="${x0 + k * cw + cw / 2}" y="${cy + r + 15}" class="ec">${COEF[m]}</text>`;
    }
    b += arrow(xu + 20, cy, (2 * Math.PI * v) / 4, "ph2") + `<text x="${xu + 46}" y="${cy + 4}" class="et">${turns[v]}</text>`;
    b += `<text x="${xq + 30}" y="${cy + 5}" class="eq">${v}</text>`;
    const term = (c, nm, first) => (c === "1" ? (first ? "" : " + ") : c === "−1" ? " − " : c === "i" ? " + i " : " − i ") + `|${nm}⟩`;
    b += `<text x="${xe}" y="${cy + 5}" class="eql">½ ( ${cs.map((c, k) => term(c, notes[k][0], k === 0)).join("")} )</text>`;
  }
  return svg(xe + 324, y0 + 4 * rh + 6, b, "The four eigen-chords of U. Each plays do, re, mi and fa equally loudly; only the phase arrows differ. An arrow pointing right means the number 1, up means i, left −1 and down −i. In eigen-chord v the arrow turns v quarter turns backwards from one note to the next. U turns the whole chord by v quarter turns, and the QFT lens reads v. Equations: eigen-chord 0 = ½(|do⟩ + |re⟩ + |mi⟩ + |fa⟩); 1 = ½(|do⟩ − i|re⟩ − |mi⟩ + i|fa⟩); 2 = ½(|do⟩ − |re⟩ + |mi⟩ − |fa⟩); 3 = ½(|do⟩ + i|re⟩ − |mi⟩ − i|fa⟩).");
}

/** Phase estimation, step by step: the clock's phase arrow at each beat (before the lens), then the
 *  clock readings after the inverse QFT. angles: one angle per beat, or null when the clock has no
 *  single phase (it is entangled with the notes). probs: probability of each reading. */
export function qpePanel(angles, probs) {
  const B = probs.length, r = 16, cw = 46, x0 = 10, y0 = 40, xb = x0 + B * cw + 96, bw = 34, bh = 70;
  let b = `<text x="${x0}" y="14" class="ehl">1. Before: the clock's phase</text>`;
  if (angles) {
    angles.forEach((ang, t) => {
      const cx = x0 + t * cw + cw / 2, cy = y0 + 20, ex = cx + r * Math.cos(ang), ey = cy - r * Math.sin(ang), hx = Math.cos(ang), hy = -Math.sin(ang);
      const a1 = [ex - 7 * hx - 4 * hy, ey - 7 * hy + 4 * hx], a2 = [ex - 7 * hx + 4 * hy, ey - 7 * hy - 4 * hx];
      b += `<circle cx="${cx}" cy="${cy}" r="${r}" class="ph-ring"/><line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" class="ph2"/><polygon points="${ex},${ey} ${a1} ${a2}" class="ph2-head"/><text x="${cx}" y="${cy + 34}" class="ek">beat ${t + 1}</text>`;
    });
  } else {
    b += `<text x="${x0}" y="${y0 + 18}" class="et">No single phase: the clock is entangled</text><text x="${x0}" y="${y0 + 34}" class="et">with the notes (a mix of eigen-chords).</text>`;
  }
  const xm = x0 + B * cw + 20;
  b += `<text x="${xm + 26}" y="${y0 + 14}" class="ek">inverse</text><text x="${xm + 26}" y="${y0 + 26}" class="ek">QFT</text><line x1="${xm}" y1="${y0 + 34}" x2="${xm + 48}" y2="${y0 + 34}" class="ph2"/><polygon points="${xm + 52},${y0 + 34} ${xm + 44},${y0 + 30} ${xm + 44},${y0 + 38}" class="ph2-head"/>`;
  b += `<text x="${xb}" y="14" class="ehl">2. After: clock readings</text>`;
  probs.forEach((p, y) => {
    const x = xb + y * (bw + 8), h = Math.max(1, p * bh), yy = y0 - 6 + bh - h;
    b += `<rect x="${x}" y="${y0 - 6}" width="${bw}" height="${bh}" rx="4" class="sq"/><rect x="${x}" y="${yy}" width="${bw}" height="${h}" rx="4" class="bar yes"/>`;
    b += `<text x="${x + bw / 2}" y="${y0 + bh + 8}" class="eh">${y}</text><text x="${x + bw / 2}" y="${yy - 4}" class="ek">${Math.round(p * 100)}%</text>`;
  });
  return svg(xb + B * (bw + 8) + 6, y0 + bh + 16, b, angles
    ? `Before the inverse QFT the clock's phase turns by the same amount at every beat; after it, the clock reads ${probs.findIndex((p) => p > 0.5)}.`
    : "The clock has no single phase because it is entangled with the notes; after the inverse QFT the readings are spread out.");
}

/** Heat map of a B x B matrix (magnitudes), with values written in each cell. */
export function heatmap(m, label) {
  const B = m.length, c = 34, x0 = 30, y0 = 18;
  let b = "";
  for (let i = 0; i < B; i++) {
    b += `<text x="${x0 - 6}" y="${y0 + i * c + c / 2 + 4}" class="rl">${i + 1}</text><text x="${x0 + i * c + c / 2}" y="${y0 - 6}" class="bl">${i + 1}</text>`;
    for (let j = 0; j < B; j++) {
      const v = m[i][j];
      b += `<rect x="${x0 + j * c + 1}" y="${y0 + i * c + 1}" width="${c - 2}" height="${c - 2}" rx="3" class="sq"/>`;
      if (v > 0.004) b += `<rect x="${x0 + j * c + 1}" y="${y0 + i * c + 1}" width="${c - 2}" height="${c - 2}" rx="3" fill="var(--accent)" opacity="${(0.15 + 3 * v).toFixed(2)}"/>`;
      b += `<text x="${x0 + j * c + c / 2}" y="${y0 + i * c + c / 2 + 4}" class="hv">${v < 0.004 ? "0" : v.toFixed(2).replace(/^0/, "")}</text>`;
    }
  }
  return svg(x0 + B * c + 4, y0 + B * c + 4, b, label);
}

/** Horizontal bars, each with its own dashed limit mark. items: [{label, value, limit, kind}] */
export function bars(items, max, label) {
  const w = 300, x0 = 170, rh = 34, H = items.length * rh + 34, sx = (v) => x0 + (v / max) * w;
  let b = "";
  items.forEach((it, k) => {
    const y = 8 + k * rh;
    b += `<text x="${x0 - 8}" y="${y + 15}" class="rl">${esc(it.label)}</text><rect x="${x0}" y="${y}" width="${Math.max(2, sx(it.value) - x0)}" height="20" rx="4" class="bar ${it.kind || ""}"/>`;
    b += `<line x1="${sx(it.limit)}" x2="${sx(it.limit)}" y1="${y - 4}" y2="${y + 24}" class="limit"/>`;
    b += `<text x="${Math.max(sx(it.value), sx(it.limit)) + 6}" y="${y + 15}" class="bv">${it.value.toFixed(2)} (limit ${it.limit})</text>`;
  });
  b += `<line x1="${x0}" x2="${x0 + 22}" y1="${H - 9}" y2="${H - 9}" class="limit"/><text x="${x0 + 28}" y="${H - 5}" class="capl">dashed line: the most any unentangled state can reach</text>`;
  return svg(x0 + w + 130, H, b, label);
}
