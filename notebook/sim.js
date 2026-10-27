// State-vector maths for the notebook. Qiskit (musicbox/engine.py) computes the real state;
// this file turns a state into what you hear and see, and simulates the circuit in the
// browser as an instant preview and a cross-check of Qiskit's answer.
//
// A spec is the same JSON that musicbox/circuit.py builds from:
//   {T, N, K, start:{k,v}, step, dial, cols:[{ctrls:[[q,v]], gates:[[q,kind,deg]], u}]}
// Qubit 0 is the lowest bit. Index x = t + B*n + B*M*i  (B = 2^T beats, M = 2^N notes).

const s2 = Math.SQRT1_2;
const HM = [[s2, 0], [s2, 0], [s2, 0], [-s2, 0]];

function gateMatrix(kind, deg, dial, controlled) {
  const ry = (a) => {
    const h = (a * Math.PI) / 360, c = Math.cos(h), s = Math.sin(h);
    return [[c, 0], [-s, 0], [s, 0], [c, 0]];
  };
  const phase = (f) => [[1, 0], [0, 0], [0, 0], [Math.cos(f), Math.sin(f)]];
  if (!controlled || dial >= 0.999) {
    switch (kind) {
      case "H": return HM;
      case "X": return [[0, 0], [1, 0], [1, 0], [0, 0]];
      case "Z": return phase(Math.PI);
      case "S": return phase(Math.PI / 2);
      case "SDG": return phase(-Math.PI / 2);
      case "T": return phase(Math.PI / 4);
      case "RY": return ry(deg);
    }
  }
  const d = dial; // link-strength dial: controlled gates turned part of the way
  switch (kind) {
    case "X": return ry(180 * d);
    case "RY": return ry(deg * d);
    case "Z": return phase(Math.PI * d);
    case "S": return phase((Math.PI / 2) * d);
    case "SDG": return phase((-Math.PI / 2) * d);
    case "T": return phase((Math.PI / 4) * d);
    case "H": {
      const c = Math.cos(Math.PI * d), sn = Math.sin(Math.PI * d);
      const pp = [(1 + s2) / 2, s2 / 2, s2 / 2, (1 - s2) / 2], pm = [(1 - s2) / 2, -s2 / 2, -s2 / 2, (1 + s2) / 2];
      return [0, 1, 2, 3].map((i) => [pp[i] + c * pm[i], sn * pm[i]]);
    }
  }
  throw new Error("unknown gate " + kind);
}

function applyGate(re, im, q, m, ctrls) {
  const bit = 1 << q;
  for (let i = 0; i < re.length; i++) {
    if (i & bit) continue;
    let ok = true;
    for (const [c, v] of ctrls) if (((i >> c) & 1) !== v) { ok = false; break; }
    if (!ok) continue;
    const j = i | bit, ar = re[i], ai = im[i], br = re[j], bi = im[j], [a, b, c, d] = m;
    re[i] = a[0] * ar - a[1] * ai + b[0] * br - b[1] * bi;
    im[i] = a[0] * ai + a[1] * ar + b[0] * bi + b[1] * br;
    re[j] = c[0] * ar - c[1] * ai + d[0] * br - d[1] * bi;
    im[j] = c[0] * ai + c[1] * ar + d[0] * bi + d[1] * br;
  }
}

export const nQubits = (s) => s.T + s.N + s.K;

/** Browser simulation of a spec (same rules as musicbox/circuit.py). */
export function simulate(spec) {
  const { T, N } = spec, B = 1 << T, M = 1 << N, dim = 1 << nQubits(spec);
  const re = new Float64Array(dim), im = new Float64Array(dim);
  const start = spec.start || { k: "b", v: 0 }, dial = spec.dial ?? 1, step = spec.step ?? 1;
  if (start.k === "b") re[B * start.v] = 1;
  else for (let k = 0; k < M; k++) { // eigen-chord: inverse QFT of |v> on the notes
    const a = (-2 * Math.PI * start.v * k) / M;
    re[B * k] = Math.cos(a) / Math.sqrt(M); im[B * k] = Math.sin(a) / Math.sqrt(M);
  }
  for (const col of spec.cols) {
    const ctrls = col.ctrls || [];
    if (col.u >= 0) { // controlled-U^(2^u): add step*2^u to the note number
      const shift = step * (1 << col.u), nr = new Float64Array(dim), ni = new Float64Array(dim);
      for (let i = 0; i < dim; i++) {
        let ok = ((i >> col.u) & 1) === 1;
        for (const [c, v] of ctrls) if (((i >> c) & 1) !== v) ok = false;
        let j = i;
        if (ok) { const t = i & (B - 1), n = (i >> T) & (M - 1), r = i >> (T + N); j = t + B * ((n + shift) % M) + B * M * r; }
        nr[j] = re[i]; ni[j] = im[i];
      }
      re.set(nr); im.set(ni);
    }
    for (const [q, kind, deg] of col.gates || []) applyGate(re, im, q, gateMatrix(kind, deg, dial, ctrls.length > 0), ctrls);
  }
  return { re, im };
}

/** A Hadamard on every qubit: the "Hadamard lens", a second way to measure. */
export function hadamardAll(st, n) {
  const re = Float64Array.from(st.re), im = Float64Array.from(st.im);
  for (let q = 0; q < n; q++) applyGate(re, im, q, HM, []);
  return { re, im };
}

/** Inverse QFT on the time register (sign -1): the phase-estimation readout. */
export function qftTime(st, T, sign = -1) {
  const B = 1 << T, dim = st.re.length, re = new Float64Array(dim), im = new Float64Array(dim), s = 1 / Math.sqrt(B);
  for (let r = 0; r < dim / B; r++)
    for (let y = 0; y < B; y++) {
      let ar = 0, ai = 0;
      for (let t = 0; t < B; t++) {
        const a = (sign * 2 * Math.PI * y * t) / B, c = Math.cos(a), sn = Math.sin(a), i = t + B * r;
        ar += c * st.re[i] - sn * st.im[i]; ai += c * st.im[i] + sn * st.re[i];
      }
      re[y + B * r] = ar * s; im[y + B * r] = ai * s;
    }
  return { re, im };
}

/** Probabilities P[t][n][i] from a state. */
export function probs(st, spec) {
  const B = 1 << spec.T, M = 1 << spec.N, I = 1 << spec.K, P = [];
  for (let t = 0; t < B; t++) {
    P.push([]);
    for (let n = 0; n < M; n++) {
      const a = new Float64Array(I);
      for (let i = 0; i < I; i++) { const x = t + B * n + B * M * i; a[i] = st.re[x] ** 2 + st.im[x] ** 2; }
      P[t].push(a);
    }
  }
  return P;
}

/** What you measure, through a lens ("N" normal, "H" Hadamard, "Q" QFT on time),
 *  for the real circuit or for the classical copy (beat recorded first: no entanglement). */
export function measured(st, spec, lens = "N", classical = false) {
  const n = nQubits(spec), B = 1 << spec.T;
  const look = (s) => (lens === "H" ? hadamardAll(s, n) : lens === "Q" ? qftTime(s, spec.T) : s);
  if (!classical) return probs(look(st), spec);
  // Classical copy: the beat is fixed first, so each beat's branch is measured on its own and the
  // results are simply added. No branch can interfere with another.
  let acc = null;
  for (let t = 0; t < B; t++) {
    const re = new Float64Array(st.re.length), im = new Float64Array(st.re.length);
    for (let x = 0; x < re.length; x++) if ((x & (B - 1)) === t) { re[x] = st.re[x]; im[x] = st.im[x]; }
    const P = probs(look({ re, im }), spec);
    if (!acc) acc = P; else P.forEach((r, a) => r.forEach((v, k) => v.forEach((p, i) => (acc[a][k][i] += p))));
  }
  return acc;
}

/** Sample `shots` outcomes from a probability grid P[t][n][i]. Returns counts keyed by index x. */
export function sampleCounts(P, shots) {
  const B = P.length, M = P[0].length, flat = [];
  P.forEach((r, t) => r.forEach((a, n) => a.forEach((p, i) => { if (p > 0) flat.push([t + B * n + B * M * i, p]); })));
  const cum = []; let s = 0; for (const [, p] of flat) cum.push((s += p));
  const counts = {};
  for (let k = 0; k < shots; k++) {
    const u = Math.random() * s; let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
    const x = flat[lo][0]; counts[x] = (counts[x] || 0) + 1;
  }
  return counts;
}

/** Mutual information (bits) between the beat and everything else: how much the
 *  sound depends on the beat. */
export function correlation(P) {
  const B = P.length, rows = P.map((r) => r.flatMap((a) => [...a])), R = rows[0].length;
  let s = 0; const pt = new Float64Array(B), pr = new Float64Array(R);
  rows.forEach((row, t) => row.forEach((p, r) => { pt[t] += p; pr[r] += p; s += p; }));
  let I = 0;
  rows.forEach((row, t) => row.forEach((p, r) => { if (p > 1e-12) I += (p / s) * Math.log2((p / s) / ((pt[t] / s) * (pr[r] / s))); }));
  return Math.max(0, I);
}

/** The time register's reduced density matrix: entry [t][t'] is the overlap between the note
 *  patterns of beat t and beat t'. Returns {re, im} as B x B arrays. */
export function rhoTime(st, T) {
  const B = 1 << T, R = st.re.length / B, re = [], im = [];
  for (let a = 0; a < B; a++) {
    re.push(new Float64Array(B)); im.push(new Float64Array(B));
    for (let b = 0; b < B; b++) {
      let sr = 0, si = 0;
      for (let r = 0; r < R; r++) {
        const x = a + B * r, y = b + B * r; // psi(a,r) * conj(psi(b,r))
        sr += st.re[x] * st.re[y] + st.im[x] * st.im[y];
        si += st.im[x] * st.re[y] - st.re[x] * st.im[y];
      }
      re[a][b] = sr; im[a][b] = si;
    }
  }
  return { re, im };
}

/** Eigenvalues of a Hermitian matrix (Jacobi on its real 2B x 2B embedding). */
export function eigenvalues(rho) {
  const B = rho.re.length, n = 2 * B, a = [];
  for (let i = 0; i < n; i++) a.push(new Float64Array(n));
  for (let i = 0; i < B; i++) for (let j = 0; j < B; j++) {
    a[i][j] = rho.re[i][j]; a[i + B][j + B] = rho.re[i][j]; a[i][j + B] = -rho.im[i][j]; a[i + B][j] = rho.im[i][j];
  }
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    }
  }
  // each eigenvalue appears twice in the embedding
  const ev = [...Array(n).keys()].map((i) => a[i][i]).sort((x, y) => y - x);
  return ev.filter((_, i) => i % 2 === 0).map((v) => Math.max(0, v));
}

/** Entanglement entropy (bits) between the time qubits and the rest. */
export function entanglement(st, T) {
  return eigenvalues(rhoTime(st, T)).reduce((s, l) => (l > 1e-12 ? s - l * Math.log2(l) : s), 0);
}
