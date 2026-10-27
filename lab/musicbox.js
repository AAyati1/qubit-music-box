// The Music Box lab: the full editor at the end of the notebook. Circuits run in Qiskit
// through musicbox/engine.py; engine and backend are passed in by main.js.

export function initLab(engine, getBackend) {
  document.documentElement.lang = "en";
  const NAMES = ["do", "re", "mi", "fa", "sol", "la", "ti", "do′"];
  const FREQS = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
  const PALS = { band: ["piano", "guitar", "flute", "drums"], orch: ["cello", "viola", "flute", "violin"] };
  let PAL = "band",
    INST = PALS.band;
  const DRUM = (n) => ["kick", "kick", "snare", "snare", "hi-hat", "hi-hat", "tom", "tom"][n];
  const TOOLS = [
    ["H", "H"],
    ["X", "X"],
    ["Z", "Z"],
    ["S", "S"],
    ["T", "T"],
    ["RY", "Ry"],
    ["C", "● control"],
    ["A", "○ anti-control"],
    ["U", "U step-up"],
    ["E", "Erase"],
  ];
  let collapse = [],
    collapseSig = "",
    sweeping = false;
  let T = 2,
    N = 2,
    K = 0,
    REST = false,
    COLS = 10,
    cells = {},
    tool = "H",
    lens = "N",
    view = "P",
    start = { k: "b", v: 0 },
    step = 1,
    dial = 1,
    mode = "Q",
    pmode = "loud";
  const SUP = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
  const sup = (n) =>
    String(n)
      .split("")
      .map((d) => SUP[+d])
      .join("");
  const $ = (id) => document.getElementById(id);
  const key = (r, c) => r + "," + c;
  const nq = () => T + N + K;
  const isNoteRow = (r) => r >= T && r < T + N;
  const uCol = (c) => {
    for (let r = 0; r < T; r++) {
      const g = cells[key(r, c)];
      if (g && g.t === "U") return r;
    }
    return -1;
  };
  const isRest = (n) => REST && n === (1 << N) - 1;
  const noteName = (n) => (isRest(n) ? "rest" : NAMES[n]);
  const soundName = (n, i) => (isRest(n) ? "rest" : K && i === 3 && PAL === "band" ? DRUM(n) : NAMES[n]);

  function save() {} // Qollab's sandbox has no browser storage; nothing persists between runs
  function load() {
    return false;
    try {
      const s = JSON.parse(localStorage.getItem("qmb4") || "null");
      if (s && s.cells) {
        ({ T, N, K, REST, COLS, cells } = s);
        start = s.start || start;
        step = s.step || 1;
        pmode = s.pmode || "len";
        PAL = s.PAL === "orch" ? "orch" : "band";
        INST = PALS[PAL];
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ---------- simulator ---------- */
  function applyMat(re, im, q, m, ctrls) {
    const n = re.length,
      bit = 1 << q;
    for (let i = 0; i < n; i++) {
      if (i & bit) continue;
      let ok = true;
      for (const [cq, v] of ctrls) {
        if (((i >> cq) & 1) !== v) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const j = i | bit,
        ar = re[i],
        ai = im[i],
        br = re[j],
        bi = im[j],
        [a, b, c, d] = m;
      re[i] = a[0] * ar - a[1] * ai + b[0] * br - b[1] * bi;
      im[i] = a[0] * ai + a[1] * ar + b[0] * bi + b[1] * br;
      re[j] = c[0] * ar - c[1] * ai + d[0] * br - d[1] * bi;
      im[j] = c[0] * ai + c[1] * ar + d[0] * bi + d[1] * br;
    }
  }
  const s2 = Math.SQRT1_2,
    HM = [
      [s2, 0],
      [s2, 0],
      [s2, 0],
      [-s2, 0],
    ];
  function gateMat(g) {
    switch (g.t) {
      case "H":
        return HM;
      case "X":
        return [
          [0, 0],
          [1, 0],
          [1, 0],
          [0, 0],
        ];
      case "Z":
        return [
          [1, 0],
          [0, 0],
          [0, 0],
          [-1, 0],
        ];
      case "S":
        return [
          [1, 0],
          [0, 0],
          [0, 0],
          [0, 1],
        ];
      case "T":
        return [
          [1, 0],
          [0, 0],
          [0, 0],
          [s2, s2],
        ];
      case "RY": {
        const h = (g.a * Math.PI) / 360,
          c = Math.cos(h),
          s = Math.sin(h);
        return [
          [c, 0],
          [-s, 0],
          [s, 0],
          [c, 0],
        ];
      }
    }
  }
  const phaseMat = (f) => [
    [1, 0],
    [0, 0],
    [0, 0],
    [Math.cos(f), Math.sin(f)],
  ];
  function dialGate(g) {
    if (dial >= 0.999) return gateMat(g);
    const d = dial;
    switch (g.t) {
      case "X":
        return gateMat({ t: "RY", a: 180 * d });
      case "RY":
        return gateMat({ t: "RY", a: g.a * d });
      case "Z":
        return phaseMat(Math.PI * d);
      case "S":
        return phaseMat((Math.PI / 2) * d);
      case "T":
        return phaseMat((Math.PI / 4) * d);
      case "H": {
        const c = Math.cos(Math.PI * d),
          sn = Math.sin(Math.PI * d),
          pp = [(1 + s2) / 2, s2 / 2, s2 / 2, (1 - s2) / 2],
          pm = [(1 - s2) / 2, -s2 / 2, -s2 / 2, (1 + s2) / 2];
        return [0, 1, 2, 3].map((i) => [pp[i] + c * pm[i], sn * pm[i]]);
      }
    }
  }
  function colParts(cs, c) {
    // controls, gates, U row for one column
    let ur = -1;
    for (let r = 0; r < T; r++) {
      const g = cs[key(r, c)];
      if (g && g.t === "U") ur = r;
    }
    const ctr = [],
      gs = [];
    for (let r = 0; r < nq(); r++) {
      const g = cs[key(r, c)];
      if (!g) continue;
      if (ur >= 0 && isNoteRow(r)) continue;
      if (g.t === "C") ctr.push([r, 1]);
      else if (g.t === "A") ctr.push([r, 0]);
      else if (g.t !== "U") gs.push([r, g]);
    }
    return [ctr, gs, ur];
  }
  const circuitSig = () => JSON.stringify([T, N, K, REST, cells, start, step, dial]);
  function qftTime(re, im, sign) {
    // sign -1: inverse QFT (QPE readout), +1: forward QFT, on the time register
    const B = 1 << T,
      dim = re.length,
      nr = new Float64Array(dim),
      ni = new Float64Array(dim),
      s = 1 / Math.sqrt(B);
    for (let r = 0; r < dim / B; r++)
      for (let y = 0; y < B; y++) {
        let ar = 0,
          ai = 0;
        for (let t = 0; t < B; t++) {
          const a = (sign * 2 * Math.PI * y * t) / B,
            c = Math.cos(a),
            sn = Math.sin(a),
            i = t + B * r;
          ar += c * re[i] - sn * im[i];
          ai += c * im[i] + sn * re[i];
        }
        nr[y + B * r] = ar * s;
        ni[y + B * r] = ai * s;
      }
    return [nr, ni];
  }
  function regValue(x, reg) {
    const B = 1 << T,
      M = 1 << N;
    return reg === "note" ? (x >> T) & (M - 1) : reg === "inst" ? x >> (T + N) : x & (B - 1);
  }
  function project(re, im, reg, val) {
    if (reg === "clock") [re, im] = qftTime(re, im, -1);
    let norm = 0;
    for (let x = 0; x < re.length; x++) {
      if (regValue(x, reg === "clock" ? "time" : reg) !== val) {
        re[x] = 0;
        im[x] = 0;
      } else norm += re[x] ** 2 + im[x] ** 2;
    }
    const s = norm > 0 ? 1 / Math.sqrt(norm) : 0;
    for (let x = 0; x < re.length; x++) {
      re[x] *= s;
      im[x] *= s;
    }
    if (reg === "clock") [re, im] = qftTime(re, im, 1);
    return [re, im];
  }
  function simulateCore() {
    return applyCollapse(simulateGates());
  }
  function applyCollapse(st) {
    let { re, im } = st;
    for (const m of collapse) [re, im] = project(re, im, m.reg, m.val);
    return { re, im };
  }
  /* ---------- Qiskit engine ---------- */
  // The exact state comes from Qiskit (musicbox.engine.exact_state). jsSimulate() below gives instant
  // feedback while Qiskit works, runs when the Qiskit runtime is absent, and cross-checks Qiskit's answer.
  const qk = {
    sig: null,
    state: null,
    ent: null,
    seq: 0,
    inflight: null,
    check: null,
    version: "",
    err: null,
  };
  const hasEngine = () => typeof engine !== "undefined" && engine && engine.exact_state;
  function specJSON() {
    const cols = [];
    for (let c = 0; c < COLS; c++) {
      const [ctr, gs, ur] = colParts(cells, c);
      if (!gs.length && ur < 0) continue;
      cols.push({ ctrls: ctr, gates: gs.map(([r, g]) => [r, g.t, g.t === "RY" ? +g.a : 0]), u: ur });
    }
    return JSON.stringify({ T, N, K, start, step, dial, cols });
  }
  function requestQiskit() {
    if (!hasEngine()) return;
    const sig = circuitSig();
    if (sig === qk.sig || sig === qk.inflight) return;
    qk.inflight = sig;
    const id = ++qk.seq;
    engineStatus();
    engine.exact_state
      .callPromising(specJSON())
      .then((txt) => {
        if (id !== qk.seq) return;
        const d = JSON.parse(String(txt)),
          js = jsSimulate();
        let diff = 0;
        for (let x = 0; x < js.re.length; x++)
          diff = Math.max(diff, Math.abs(js.re[x] - d.re[x]), Math.abs(js.im[x] - d.im[x]));
        qk.sig = sig;
        qk.state = { re: Float64Array.from(d.re), im: Float64Array.from(d.im) };
        qk.ent = d;
        qk.check = diff;
        qk.version = d.qiskit;
        qk.err = null;
        qk.inflight = null;
        update();
      })
      .catch((e) => {
        if (id !== qk.seq) return;
        qk.inflight = null;
        qk.err = String(e).slice(0, 160);
        engineStatus();
      });
  }
  function engineStatus() {
    const el = $("engine");
    if (!el) return;
    if (!hasEngine()) {
      el.textContent = "Browser simulator only (Qiskit runtime not available here)";
      el.className = "engine warn";
      return;
    }
    if (qk.err) {
      el.textContent = "Qiskit error, showing the browser simulator: " + qk.err;
      el.className = "engine warn";
      return;
    }
    if (qk.sig !== circuitSig()) {
      el.textContent = qk.version ? "Qiskit is computing the new circuit…" : "Loading Qiskit…";
      el.className = "engine";
      return;
    }
    el.textContent = `Qiskit ${qk.version} statevector ✓ (matches the browser check to ${qk.check < 1e-12 ? "1e-12" : qk.check.toExponential(1)})`;
    el.className = "engine ok";
  }
  const qiskitCurrent = () => hasEngine() && qk.state && qk.sig === circuitSig();
  function simulateGates() {
    if (qiskitCurrent()) return { re: Float64Array.from(qk.state.re), im: Float64Array.from(qk.state.im) };
    return jsSimulate();
  }
  function jsSimulate() {
    const B = 1 << T,
      M = 1 << N,
      dim = 1 << nq();
    let re = new Float64Array(dim),
      im = new Float64Array(dim);
    if (start.k === "b") re[B * start.v] = 1;
    else
      for (let k = 0; k < M; k++) {
        const a = (-2 * Math.PI * start.v * k) / M;
        re[B * k] = Math.cos(a) / Math.sqrt(M);
        im[B * k] = Math.sin(a) / Math.sqrt(M);
      }
    for (let c = 0; c < COLS; c++) {
      const [ctr, gs, ur] = colParts(cells, c);
      if (ur >= 0) {
        const shift = step * (1 << ur),
          nr = new Float64Array(dim),
          ni = new Float64Array(dim);
        for (let i = 0; i < dim; i++) {
          let ok = ((i >> ur) & 1) === 1;
          for (const [cq, v] of ctr)
            if (((i >> cq) & 1) !== v) {
              ok = false;
              break;
            }
          let j = i;
          if (ok) {
            const t = i & (B - 1),
              n = (i >> T) & (M - 1),
              rest = i >> (T + N);
            j = t + B * ((n + shift) % M) + B * M * rest;
          }
          nr[j] = re[i];
          ni[j] = im[i];
        }
        re = nr;
        im = ni;
      }
      for (const [r, g] of gs) applyMat(re, im, r, ctr.length ? dialGate(g) : gateMat(g), ctr);
    }
    return { re, im };
  }
  function applyLens(st, lensMode) {
    const B = 1 << T,
      dim = 1 << nq();
    let re = Float64Array.from(st.re),
      im = Float64Array.from(st.im);
    if (lensMode === "H") for (let q = 0; q < nq(); q++) applyMat(re, im, q, HM, []);
    if (lensMode === "Q") [re, im] = qftTime(re, im, -1);
    return { re, im };
  }
  function probs3(st) {
    // P[t][n][i]
    const B = 1 << T,
      M = 1 << N,
      I = 1 << K,
      P = [];
    for (let t = 0; t < B; t++) {
      P.push([]);
      for (let n = 0; n < M; n++) {
        const a = new Float64Array(I);
        for (let i = 0; i < I; i++) {
          const x = t + B * n + B * M * i;
          a[i] = st.re[x] ** 2 + st.im[x] ** 2;
        }
        P[t].push(a);
      }
    }
    return P;
  }
  function getProbs(lensMode) {
    if (mode === "Q") return probs3(applyLens(simulateCore(), lensMode));
    const st = simulateCore(),
      B = 1 << T,
      dim = 1 << nq();
    let acc = null;
    for (let t = 0; t < B; t++) {
      const re = new Float64Array(dim),
        im = new Float64Array(dim);
      for (let x = 0; x < dim; x++)
        if ((x & (B - 1)) === t) {
          re[x] = st.re[x];
          im[x] = st.im[x];
        }
      const P = probs3(applyLens({ re, im }, lensMode));
      if (!acc) acc = P;
      else
        P.forEach((r, a) =>
          r.forEach((v, n) =>
            v.forEach((p, i) => {
              acc[a][n][i] += p;
            }),
          ),
        );
    }
    return acc;
  }
  const flat = (P) =>
    P.map((r) => {
      const o = [];
      r.forEach((a) => a.forEach((p) => o.push(p)));
      return o;
    }); // time × (note, instrument)
  function mutualInfo(Mx) {
    const A = Mx.length,
      Bn = Mx[0].length,
      pa = new Float64Array(A),
      pb = new Float64Array(Bn);
    let s = 0;
    for (let a = 0; a < A; a++)
      for (let b = 0; b < Bn; b++) {
        pa[a] += Mx[a][b];
        pb[b] += Mx[a][b];
        s += Mx[a][b];
      }
    let I = 0;
    for (let a = 0; a < A; a++)
      for (let b = 0; b < Bn; b++) {
        const p = Mx[a][b] / s;
        if (p > 1e-12) I += p * Math.log2(p / ((pa[a] / s) * (pb[b] / s)));
      }
    return Math.max(0, I);
  }
  function jacobiEig(A) {
    const n = A.length,
      a = A.map((r) => r.slice());
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
      if (off < 1e-20) break;
      for (let p = 0; p < n; p++)
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(a[p][q]) < 1e-15) continue;
          const th = (a[q][q] - a[p][p]) / (2 * a[p][q]),
            t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)),
            c = 1 / Math.sqrt(t * t + 1),
            s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = a[k][p],
              akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = a[p][k],
              aqk = a[q][k];
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
          }
        }
    }
    return a.map((r, i) => r[i]);
  }
  function entropyOf(st, S) {
    const n = nq(),
      comp = [];
    for (let q = 0; q < n; q++) if (!S.includes(q)) comp.push(q);
    const dA = 1 << S.length,
      dE = 1 << comp.length,
      Ar = [],
      Ai = [];
    for (let a = 0; a < dA; a++) {
      Ar.push(new Float64Array(dE));
      Ai.push(new Float64Array(dE));
    }
    for (let x = 0; x < 1 << n; x++) {
      let a = 0,
        e = 0;
      S.forEach((q, j) => {
        a |= ((x >> q) & 1) << j;
      });
      comp.forEach((q, j) => {
        e |= ((x >> q) & 1) << j;
      });
      Ar[a][e] = st.re[x];
      Ai[a][e] = st.im[x];
    }
    const E = [];
    for (let i = 0; i < 2 * dA; i++) E.push(new Array(2 * dA).fill(0));
    for (let a = 0; a < dA; a++)
      for (let b = 0; b < dA; b++) {
        let sr = 0,
          si = 0;
        for (let e = 0; e < dE; e++) {
          sr += Ar[a][e] * Ar[b][e] + Ai[a][e] * Ai[b][e];
          si += Ai[a][e] * Ar[b][e] - Ar[a][e] * Ai[b][e];
        }
        E[a][b] = sr;
        E[a + dA][b + dA] = sr;
        E[a][b + dA] = -si;
        E[a + dA][b] = si;
      }
    let H = 0;
    for (const l of jacobiEig(E)) if (l > 1e-12) H -= l * Math.log2(l);
    return Math.max(0, H / 2);
  }
  function sampleShots(P, nShots) {
    const cum = [],
      idx = [];
    let acc = 0;
    P.forEach((r, t) =>
      r.forEach((a, n) =>
        a.forEach((p, i) => {
          acc += p;
          cum.push(acc);
          idx.push([t, n, i]);
        }),
      ),
    );
    const Q = P.map((r) => r.map((a) => new Float64Array(a.length)));
    for (let s = 0; s < nShots; s++) {
      const u = Math.random() * acc;
      let j = cum.findIndex((v) => v >= u);
      if (j < 0) j = cum.length - 1;
      const [t, n, i] = idx[j];
      Q[t][n][i] += 1 / nShots;
    }
    return Q;
  }

  /* ---------- circuit cost (Qiskit 2.x, basis cx+u, level 1, measured per gate) ---------- */
  const XLO = [0, 1, 6, 12, 18, 24, 30, 36];
  const COST = {
    X: [0, 1, 6, 14, 36, 84, 124, 180],
    P: [0, 2, 6, 20, 44, 84, 140, 220],
    RY: [0, 2, 8, 20, 24, 40, 56, 80],
    POW: [0, 2, 10, 52, 236, 1004, 4140, 16812],
  };
  const cxOf = (row, k) => COST[row][Math.min(k, 7)];
  const costText = (c, rec = 0) => {
    const a = c.lo + rec,
      b = c.total + rec;
    return a === b ? `${b} CNOT${b === 1 ? "" : "s"}` : `${a}–${b} CNOTs`;
  };
  function circuitCost(cs, cols) {
    const M = 1 << N,
      nTot = nq() + (mode === "C" ? T : 0);
    let total = 0,
      lo = 0,
      tof = 0;
    const addX = (k) => {
      total += cxOf("X", k);
      lo += nTot > k + 1 ? XLO[Math.min(k, 7)] : cxOf("X", k);
      if (k === 2) tof++;
    };
    for (let c = 0; c < cols; c++) {
      const [ctr, gs, ur] = colParts(cs, c);
      if (ur >= 0) {
        const shift = (step * (1 << ur)) % M,
          base = ctr.length + 1;
        for (let j = 0; j < N; j++)
          if ((shift >> j) & 1) for (let b = N - 1; b >= j; b--) addX(base + (b - j));
      }
      for (const [, g] of gs) {
        const k = ctr.length;
        if (!k) continue;
        let row = g.t === "RY" ? "RY" : g.t === "S" || g.t === "T" ? "P" : "X";
        if (dial < 0.999) row = g.t === "H" ? "POW" : g.t === "Z" || g.t === "S" || g.t === "T" ? "P" : "RY";
        if (row === "X") addX(k);
        else {
          const v = cxOf(row, k);
          total += v;
          lo += v;
        }
      }
    }
    return { total, lo, tof };
  }

  /* ---------- circuit UI ---------- */
  function buildTools() {
    const el = $("tools");
    el.innerHTML = "";
    for (const [id, label] of TOOLS) {
      const b = document.createElement("button");
      b.className = "tool";
      b.id = "tool-" + id;
      b.textContent = label;
      b.setAttribute("aria-pressed", id === tool ? "true" : "false");
      b.onclick = () => {
        tool = id;
        buildTools();
      };
      el.appendChild(b);
    }
    $("ang").disabled = tool !== "RY";
    $("angl").style.opacity = $("angv").style.opacity = tool === "RY" ? 1 : 0.5;
  }
  function rowLabel(r) {
    return r < T
      ? ["t", `t${r}`, "time"]
      : r < T + N
        ? ["n", `n${r - T}`, "note"]
        : ["i", `i${r - T - N}`, "instrument"];
  }
  let focusCell = [0, 0];
  function renderCircuit() {
    const hadFocus =
      document.activeElement &&
      document.activeElement.classList &&
      document.activeElement.classList.contains("cell");
    setTimeout(() => {
      if (hadFocus) {
        const f = $(`cell-${focusCell[0]}-${focusCell[1]}`);
        if (f) f.focus();
      }
    }, 0);
    if (focusCell[0] >= nq()) focusCell[0] = nq() - 1;
    if (focusCell[1] >= COLS) focusCell[1] = COLS - 1;
    const el = $("circuit");
    el.innerHTML = "";
    el.style.gridTemplateColumns = `auto repeat(${COLS},48px)`;
    el.appendChild(document.createElement("div"));
    for (let c = 0; c < COLS; c++) {
      const h = document.createElement("div");
      h.className = "colhead";
      h.textContent = c + 1;
      el.appendChild(h);
    }
    const vinfo = {},
      lastNote = T + N - 1;
    for (let c = 0; c < COLS; c++) {
      let rows = [],
        hasC = false,
        hasG = false;
      const ur = uCol(c);
      if (ur >= 0) {
        for (let r = 0; r < nq(); r++) {
          if (isNoteRow(r)) continue;
          const g = cells[key(r, c)];
          if (g && (g.t === "C" || g.t === "A" || g.t === "U")) rows.push(r);
        }
        vinfo[c] = [Math.min(...rows, T), Math.max(...rows, T), true, true];
        continue;
      }
      for (let r = 0; r < nq(); r++) {
        const g = cells[key(r, c)];
        if (!g) continue;
        rows.push(r);
        if (g.t === "C" || g.t === "A") hasC = true;
        else hasG = true;
      }
      vinfo[c] =
        hasC && hasG && rows.length > 1
          ? [Math.min(...rows), Math.max(...rows), true, false]
          : [0, 0, false, false];
    }
    for (let r = 0; r < nq(); r++) {
      const [cls, name, kind] = rowLabel(r),
        lab = document.createElement("div");
      lab.className = "qlabel " + cls;
      lab.innerHTML = `${name}<small>${kind}</small>`;
      el.appendChild(lab);
      for (let c = 0; c < COLS; c++) {
        const b = document.createElement("button");
        b.className = "cell";
        b.id = `cell-${r}-${c}`;
        const g = cells[key(r, c)],
          [lo, hi, on, isU] = vinfo[c],
          ur = uCol(c);
        if (on && r >= lo && r <= hi) {
          if (isU && isNoteRow(r)) {
            if (r === T && lo < T) b.classList.add("vtop");
            if (r === lastNote && hi > lastNote) b.classList.add("vbot");
          } else b.classList.add(r === lo ? "vbot" : r === hi ? "vtop" : "vfull");
        }
        b.setAttribute(
          "aria-label",
          `${name}, column ${c + 1}${g ? ", " + g.t : ""}${ur >= 0 && isNoteRow(r) ? ", part of U box" : ""}`,
        );
        if (ur >= 0 && isNoteRow(r)) {
          const d = document.createElement("span");
          d.className = "g ubox" + (r === T ? " first" : "") + (r === lastNote ? " last" : "");
          if (r === T) d.textContent = "U" + sup(1 << ur);
          else if (r === T + 1) d.textContent = "+" + step * (1 << ur);
          b.appendChild(d);
        } else if (g) {
          const d = document.createElement("span");
          if (g.t === "C" || g.t === "U") d.className = "g ctrl";
          else if (g.t === "A") d.className = "g anti";
          else if (g.t === "X" && on) {
            d.className = "g oplus";
            d.textContent = "+";
          } else if (g.t === "RY") {
            d.className = "g ry";
            d.innerHTML = `Ry<br>${Math.round(g.a)}°`;
          } else {
            d.className = "g";
            d.textContent = g.t;
          }
          b.appendChild(d);
        }
        b.onclick = () => {
          focusCell = [r, c];
          place(r, c);
        };
        b.tabIndex = r === focusCell[0] && c === focusCell[1] ? 0 : -1;
        b.onfocus = () => {
          focusCell = [r, c];
        };
        b.onkeydown = (ev) => {
          const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[ev.key];
          if (!mv && ev.key !== "Home" && ev.key !== "End") return;
          ev.preventDefault();
          let r2 = r,
            c2 = c;
          if (mv) {
            r2 = Math.max(0, Math.min(nq() - 1, r + mv[0]));
            c2 = Math.max(0, Math.min(COLS - 1, c + mv[1]));
          } else c2 = ev.key === "Home" ? 0 : COLS - 1;
          const nb = $(`cell-${r2}-${c2}`);
          if (nb) {
            b.tabIndex = -1;
            nb.tabIndex = 0;
            nb.focus();
          }
        };
        el.appendChild(b);
      }
    }
  }
  function place(r, c) {
    const k = key(r, c),
      cur = cells[k],
      ur = uCol(c);
    if (ur >= 0 && isNoteRow(r) && tool !== "E") return;
    if (tool === "U") {
      if (r >= T) return;
      if (cur && cur.t === "U") delete cells[k];
      else {
        if (ur >= 0) delete cells[key(ur, c)];
        for (let q = T; q < T + N; q++) delete cells[key(q, c)];
        cells[k] = { t: "U" };
      }
    } else if (tool === "E") {
      if (ur >= 0 && isNoteRow(r)) delete cells[key(ur, c)];
      else delete cells[k];
    } else if (cur && cur.t === tool && (tool !== "RY" || Math.round(cur.a) === +$("ang").value))
      delete cells[k];
    else cells[k] = tool === "RY" ? { t: "RY", a: +$("ang").value } : { t: tool };
    if (c === COLS - 1) COLS++;
    update();
  }

  /* ---------- output UI ---------- */
  let curP = null,
    playingBeat = -1;
  const instColor = (i) => (K ? `var(--i${i})` : "var(--note)");
  function renderRoll(P) {
    const B = 1 << T,
      M = 1 << N,
      I = 1 << K,
      el = $("roll");
    el.innerHTML = "";
    el.style.gridTemplateColumns = `auto repeat(${B},34px)`;
    for (let n = M - 1; n >= 0; n--) {
      const l = document.createElement("div");
      l.className = "rl" + (isRest(n) ? " rest" : "");
      l.textContent = noteName(n);
      el.appendChild(l);
      for (let t = 0; t < B; t++) {
        const d = document.createElement("div");
        d.className = "rc" + (t === playingBeat ? " now" : "");
        let tot = 0,
          best = 0,
          bi = 0;
        for (let i = 0; i < I; i++) {
          tot += P[t][n][i];
          if (P[t][n][i] > best) {
            best = P[t][n][i];
            bi = i;
          }
        }
        const a = Math.min(1, tot * B);
        if (a > 0.004 && isRest(n)) {
          // a rest in the colour of the instrument that rests; split between colours if several rest
          const resting = [...Array(I).keys()].filter((i) => P[t][n][i] * B > 0.004);
          const cols = resting.map((i) => `color-mix(in oklab, ${instColor(i)} ${Math.round(18 + 82 * Math.min(1, P[t][n][i] * B))}%, var(--soft))`);
          d.style.background = cols.length === 1 ? cols[0] : `linear-gradient(to right, ${cols.map((c, j) => `${c} ${(100 * j) / cols.length}% ${(100 * (j + 1)) / cols.length}%`).join(", ")})`;
        } else if (a > 0.004)
          d.style.background = `color-mix(in oklab, ${instColor(bi)} ${Math.round(18 + 82 * a)}%, var(--soft))`;
        d.title = `beat ${t + 1}, ${noteName(n)}: ${(tot * 100).toFixed(1)}%${K && tot > 1e-9 ? " (" + INST[bi] + ")" : ""}`;
        el.appendChild(d);
      }
    }
    el.appendChild(document.createElement("div"));
    for (let t = 0; t < B; t++) {
      const b = document.createElement("div");
      b.className = "bl";
      b.textContent = lens === "Q" ? t : t + 1;
      el.appendChild(b);
    }
    $("legend").innerHTML = K
      ? INST.map((nm, i) => `<span><i style="background:var(--i${i})"></i>${nm}</span>`).join("")
      : "";
    const ro = $("readout");
    ro.innerHTML = "";
    for (let t = 0; t < B; t++) {
      let tot = 0;
      const parts = [];
      P[t].forEach((a) =>
        a.forEach((p) => {
          tot += p;
        }),
      );
      for (let i = 0; i < I; i++)
        for (let n = 0; n < M; n++) {
          const p = P[t][n][i];
          if (tot > 1e-9 && p / tot > 0.05)
            parts.push(
              `${soundName(n, i)}${K ? " (" + INST[i] + ")" : ""}${p / tot < 0.95 ? " " + Math.round((100 * p) / tot) + "%" : ""}`,
            );
        }
      const b = document.createElement("span");
      b.className = "b";
      b.textContent = lens === "Q" ? `reading ${t}` : `beat ${t + 1}`;
      const v = document.createElement("span");
      v.textContent = tot < 1e-9 ? "silent" : parts.join(" + ");
      ro.appendChild(b);
      ro.appendChild(v);
    }
  }
  function runPlan() {
    if (!$("runb") || $("runb").disabled) return;
    const n = nq(), need = 10 * (1 << n), width = 2 * (n + (mode === "C" ? T : 0)) + 2, shots = +$("shots").value;
    $("runstatus").textContent =
      `Uses ${width} qubits. ` +
      (shots >= need ? "Enough shots for a verdict." : `With ${shots.toLocaleString("en")} shots you will hear the measured music but get no verdict: this circuit needs at least ${need.toLocaleString("en")}.`);
  }
  function update() {
    requestQiskit();
    engineStatus();
    if (backendRes && backendRes.sig !== circuitSig()) {
      backendRes = null;
      $("viewB").disabled = true;
      if (view === "B") view = "P";
      $("bres").hidden = true;
    }
    if (collapse.length && collapseSig !== circuitSig()) {
      collapse = [];
      $("mstatus").textContent = "";
    }
    $("unmeasure").disabled = !collapse.length;
    [...$("mreg").options].forEach((o) => {
      if (o.value === "inst") o.disabled = K === 0;
    });
    if (K === 0 && $("mreg").value === "inst") $("mreg").value = "time";
    renderCircuit();
    const st = simulateCore(),
      timeQ = [...Array(T)].map((_, i) => i),
      instQ = [...Array(K)].map((_, i) => T + N + i);
    const useQk = qiskitCurrent() && !collapse.length;
    const e = mode === "Q" ? (useQk ? qk.ent.ent_time : entropyOf(st, timeQ)) : 0;
    const Pz = getProbs("N"),
      Px = getProbs("H"),
      Pq = getProbs("Q");
    $("entl").textContent = K ? "Entanglement, time ↔ notes and instruments" : "Entanglement, time ↔ notes";
    $("ent").textContent = e.toFixed(2) + " bits";
    $("entd").textContent =
      mode === "C"
        ? "Classical copy: the recorder holds the beat number and is never read, so time and notes form a classical mixture with no entanglement between them. It sounds the same."
        : e < 0.005
          ? "None: every beat plays the same thing (a drone, a chord, a doubled line)."
          : `Maximum possible here: ${Math.min(T, N + K)} bits. What you hear depends on the beat.`;
    $("instbox").hidden = K === 0;
    if (K) {
      const ei = mode === "Q" ? (useQk ? qk.ent.ent_inst : entropyOf(st, instQ)) : 0;
      $("enti").textContent = ei.toFixed(2) + " bits";
      $("entid").textContent =
        ei < 0.005
          ? "None: the instrument choice is the same on every beat and note."
          : "Which instrument plays depends on the beat or the note.";
    }
    const iz = mutualInfo(flat(Pz)),
      ix = mutualInfo(flat(Px)),
      bound = Math.min(T, N + K),
      proven = iz + ix > bound + 1e-6;
    $("cz").textContent = iz.toFixed(2) + " bits";
    $("cx").textContent = ix.toFixed(2) + " bits";
    $("proof").textContent = proven ? "Entanglement detected" : "Not certified";
    $("proof").className = "v " + (proven ? "ok" : "no");
    $("proofd").textContent =
      `Normal + Hadamard correlation = ${(iz + ix).toFixed(2)} bits; unentangled states stay at or below ${bound} bits.${proven ? "" : " Below the bound this test is silent: the state may still be entangled."}`;
    const B = 1 << T,
      clock = Pq.map((r) => {
        let s = 0;
        r.forEach((a) =>
          a.forEach((p) => {
            s += p;
          }),
        );
        return s;
      }),
      gcd = (a, b) => (b ? gcd(b, a % b) : a);
    $("qpe").innerHTML = clock
      .map((p, y) => [p, y])
      .filter(([p]) => p > 0.02)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 6)
      .map(([p, y]) => {
        const g = gcd(y, B) || B;
        return `<span>reads ${y} · phase ${y ? `${y / g}/${B / g}` : "0"} · ${Math.round(p * 100)}%</span>`;
      })
      .join("");
    const cost = circuitCost(cells, COLS),
      rec = mode === "C" ? T : 0;
    $("cost").textContent = costText(cost, rec);
    $("costd").textContent =
      `What Qiskit compiles it to (CNOT + single-qubit gates), counted gate by gate.${cost.lo < cost.total ? " The range depends on whether Qiskit can borrow idle qubits for multi-controlled X gates." : ""}${rec ? ` Includes ${rec} CNOTs for the recorder.` : ""}${cost.tof ? ` ${cost.tof} gate${cost.tof > 1 ? "s are" : " is"} Toffoli-type: from controlled-√X gates, each takes 5 two-qubit gates instead of 6.` : ""}`;
    let P = lens === "N" ? Pz : lens === "H" ? Px : Pq;
    if (view === "S") P = sampleShots(P, 64);
    if (view === "B" && backendRes && lens !== "Q")
      P = countsToP(lens === "H" ? backendRes.hadamard : backendRes.normal);
    curP = P;
    renderRoll(P);
    renderCode();
    renderPair();
    runPlan();
    save();
  }

  /* ---------- Qiskit export ---------- */
  function renderCode() {
    const notes = [...Array(N)].map((_, i) => T + i).join(", ");
    const L = [
      "from qiskit import QuantumCircuit",
      "from qiskit.circuit.library import HGate, XGate, ZGate, SGate, TGate, RYGate, PhaseGate, QFT",
      "import numpy as np",
      "",
      `qc = QuantumCircuit(${nq() + (mode === "C" ? T : 0)})  # qubits 0-${T - 1}: time, ${T}-${T + N - 1}: note${K ? `, ${T + N}-${nq() - 1}: instrument` : ""}${mode === "C" ? `, ${nq()}-${nq() + T - 1}: recorder` : ""}`,
    ];
    if (dial < 0.999)
      L.push(`# link strength ${Math.round(dial * 100)}%: every controlled gate is turned part of the way`);
    for (let i = 0; i < N; i++) if ((start.v >> i) & 1) L.push(`qc.x(${T + i})`);
    if (start.k === "e")
      L.push(`qc.append(QFT(${N}, inverse=True), [${notes}])  # eigen-chord ${start.v} of U`);
    const G = { H: "HGate()", X: "XGate()", Z: "ZGate()", S: "SGate()", T: "TGate()" };
    for (let c = 0; c < COLS; c++) {
      const [ctr, gs, ur] = colParts(cells, c);
      if (ur >= 0) {
        const shift = (step * (1 << ur)) % (1 << N);
        L.push(`# controlled-U^${1 << ur}: add ${shift} to the note number, as multi-controlled X gates`);
        for (let j = 0; j < N; j++)
          if ((shift >> j) & 1)
            for (let b = N - 1; b >= j; b--) {
              const cl = [...ctr, [ur, 1]];
              for (let q = j; q < b; q++) cl.push([T + q, 1]);
              const cs = cl.reduce((a, [q, v], i) => a + (v << i), 0);
              L.push(
                `qc.append(XGate().control(${cl.length}, ctrl_state=${cs}), [${cl.map((x) => x[0]).join(", ")}, ${T + b}])`,
              );
            }
      }
      for (const [r, g] of gs) {
        let gate = g.t === "RY" ? `RYGate(np.deg2rad(${+(+g.a).toFixed(4)}))` : G[g.t];
        if (ctr.length && dial < 0.999) {
          const d = +dial.toFixed(4);
          gate =
            g.t === "X"
              ? `RYGate(np.deg2rad(${180 * d}))`
              : g.t === "RY"
                ? `RYGate(np.deg2rad(${g.a * d}))`
                : g.t === "Z"
                  ? `PhaseGate(np.pi*${d})`
                  : g.t === "S"
                    ? `PhaseGate(np.pi/2*${d})`
                    : g.t === "T"
                      ? `PhaseGate(np.pi/4*${d})`
                      : `HGate().power(${d})`;
        }
        if (!ctr.length)
          L.push(
            g.t === "RY" ? `qc.ry(np.deg2rad(${+(+g.a).toFixed(4)}), ${r})` : `qc.${g.t.toLowerCase()}(${r})`,
          );
        else {
          const cs = ctr.reduce((a, [q, v], i) => a + (v << i), 0);
          L.push(
            `qc.append(${gate}.control(${ctr.length}, ctrl_state=${cs}), [${ctr.map((x) => x[0]).join(", ")}, ${r}])`,
          );
        }
      }
    }
    if (mode === "C")
      for (let i = 0; i < T; i++)
        L.push(`qc.cx(${i}, ${nq() + i})  # recorder copies the beat: classical copy`);
    if (lens === "H") L.push(`qc.h(range(${nq()}))  # Hadamard lens`);
    if (lens === "Q")
      L.push(`qc.append(QFT(${T}, inverse=True), range(${T}))  # QFT lens: QPE readout on the time register`);
    L.push(
      "qc.measure_all()",
      `# beat = qubits 0..${T - 1}, note = qubits ${T}..${T + N - 1}${REST ? ` (note ${(1 << N) - 1} is a rest)` : ""}${K ? `, instrument = qubits ${T + N}..${nq() - 1} (${INST.map((s, i) => i + " " + s).join(", ")})` : ""}`,
    );
    $("code").textContent = L.join("\n");
  }
  function selectCode() {
    const r = document.createRange();
    r.selectNodeContents($("code"));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  $("copy").onclick = () => {
    const done = (m) => {
      $("copied").textContent = m;
      setTimeout(() => ($("copied").textContent = ""), 2000);
    };
    try {
      navigator.clipboard.writeText($("code").textContent).then(
        () => done("Copied"),
        () => {
          selectCode();
          done("Selected. Press Ctrl+C / ⌘C to copy.");
        },
      );
    } catch (e) {
      selectCode();
      done("Selected. Press Ctrl+C / ⌘C to copy.");
    }
  };

  /* ---------- instruments (synthesized, no samples) ---------- */
  let ctx = null,
    timers = [],
    raf = 0,
    startAt = 0,
    beatDur = 0.5,
    playing = false;
  const bufCache = new Map();
  function bowed(SR, f, bright) {
    // bowed string: band-limited sawtooth, delayed vibrato, soft bow attack
    const data = new Float32Array(SR * 2),
      H = Math.min(14, Math.floor(9000 / f));
    let ph = 0,
      lp = 0;
    for (let k = 0; k < data.length; k++) {
      const t = k / SR,
        vib = 1 + 0.006 * Math.min(1, t / 0.25) * Math.sin(2 * Math.PI * 5.6 * t);
      ph += (2 * Math.PI * f * vib) / SR;
      let v = 0;
      for (let h = 1; h <= H; h++) v += (Math.sin(h * ph) / h) * Math.exp(-h / bright);
      lp = 0.97 * lp + 0.03 * (Math.random() * 2 - 1);
      data[k] = (0.42 * v + 0.05 * lp) * Math.min(1, t / 0.09);
    }
    return data;
  }
  function makeBuffer(inst, n) {
    const orch = PAL === "orch",
      SR = ctx.sampleRate,
      f = FREQS[n] * (orch ? [0.25, 0.5, 2, 1] : [1, 0.5, 2, 1])[inst];
    let dur = 2,
      data;
    const noise = () => Math.random() * 2 - 1;
    if (orch && inst === 0)
      data = bowed(SR, f, 5); // cello, two octaves down
    else if (orch && inst === 3)
      data = bowed(SR, f, 3.2); // violin
    else if (orch && inst === 1)
      data = bowed(SR, f, 4); // viola, an octave down
    else if (inst === 0) {
      // piano: decaying harmonics with a soft hammer
      data = new Float32Array(SR * dur);
      const amps = [1, 0.5, 0.28, 0.14, 0.07];
      for (let k = 0; k < data.length; k++) {
        const t = k / SR;
        let v = 0;
        amps.forEach((a, h) => {
          v += a * Math.sin(2 * Math.PI * f * (h + 1) * 1.0007 ** h * t) * Math.exp(-t * (1.4 + 0.9 * h));
        });
        data[k] = 0.45 * v * Math.min(1, t / 0.004);
      }
    } else if (inst === 1) {
      // guitar: Karplus-Strong plucked string
      data = new Float32Array(SR * dur);
      const Lp = Math.round(SR / f);
      for (let k = 0; k <= Lp; k++) data[k] = noise() * 0.6;
      for (let k = Lp + 1; k < data.length; k++) data[k] = 0.996 * 0.5 * (data[k - Lp] + data[k - Lp - 1]);
    } else if (inst === 2) {
      // flute: breathy sine with vibrato, sustained
      data = new Float32Array(SR * dur);
      let ph = 0,
        lp = 0;
      for (let k = 0; k < data.length; k++) {
        const t = k / SR;
        ph += (2 * Math.PI * f * (1 + 0.005 * Math.sin(2 * Math.PI * 5.2 * t))) / SR;
        lp = 0.9 * lp + 0.1 * noise();
        data[k] =
          (0.5 * Math.sin(ph) + 0.08 * Math.sin(2 * ph) + 0.03 * Math.sin(3 * ph) + 0.12 * lp) *
          Math.min(1, t / 0.07);
      }
    } else {
      // drums: kick, snare, hi-hat, tom by note
      const d = DRUM(n);
      dur = d === "hi-hat" ? 0.15 : d === "snare" ? 0.3 : 0.5;
      data = new Float32Array(Math.floor(SR * dur));
      let ph = 0,
        prev = 0;
      for (let k = 0; k < data.length; k++) {
        const t = k / SR,
          w = noise();
        if (d === "kick") {
          ph += (2 * Math.PI * (60 + 140 * Math.exp(-t * 30))) / SR;
          const v = Math.sin(ph) * Math.exp(-t * 7);
          data[k] = Math.tanh(2.2 * v) * 0.9 + (t < 0.006 ? 0.5 * w * (1 - t / 0.006) : 0);
        } else if (d === "tom") {
          ph += (2 * Math.PI * (150 + 110 * Math.exp(-t * 14))) / SR;
          data[k] = Math.tanh(1.6 * Math.sin(ph) * Math.exp(-t * 6)) * 0.8;
        } else if (d === "snare") {
          ph += (2 * Math.PI * 200) / SR;
          const hp = w - prev;
          prev = w;
          data[k] = 0.75 * hp * Math.exp(-t * 16) + 0.4 * Math.sin(ph) * Math.exp(-t * 22);
        } else {
          const hp = w - prev;
          prev = w;
          data[k] = 0.6 * hp * Math.exp(-t * 40);
        }
      }
    }
    const buf = ctx.createBuffer(1, data.length, SR);
    buf.copyToChannel(data, 0);
    return buf;
  }
  const LEVELS = { band: [0.75, 0.9, 0.55, 1.1], orch: [1.25, 1.0, 0.75, 0.95] };
  let LEVEL = LEVELS.band;
  function playNote(dest, inst, n, t0, dur, gain) {
    const k = PAL + inst + "-" + n;
    if (!bufCache.has(k)) bufCache.set(k, makeBuffer(inst, n));
    const src = ctx.createBufferSource(),
      g = ctx.createGain();
    src.buffer = bufCache.get(k);
    const len = inst === 3 && PAL === "band" ? src.buffer.duration : Math.max(0.05, dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.setValueAtTime(gain, t0 + Math.max(0.02, len - 0.03));
    g.gain.linearRampToValueAtTime(0.0001, t0 + len);
    src.connect(g).connect(dest);
    src.start(t0);
    src.stop(t0 + len + 0.02);
  }
  function stop() {
    playing = false;
    sweeping = false;
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(raf);
    playingBeat = -1;
    if (ctx) {
      ctx.close();
      ctx = null;
      bufCache.clear();
    }
    if (curP) renderRoll(curP);
  }
  function play() {
    stop();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    playing = true;
    LEVEL = LEVELS[PAL];
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    const B = 1 << T,
      M = 1 << N,
      I = 1 << K;
    beatDur = 60 / +$("bpm").value;
    let firstLoop = true;
    const schedule = () => {
      if (sweeping && !firstLoop) {
        if (dial >= 0.999) {
          sweeping = false;
          $("mstatus").textContent = "Sweep done: link strength 100%.";
          stop();
          return;
        }
        dial = Math.min(1, dial + 0.25);
        $("dial").value = Math.round(dial * 100);
        $("dialv").textContent = Math.round(dial * 100) + "%";
        update();
      }
      firstLoop = false;
      const P = curP;
      startAt = ctx.currentTime + 0.1;
      for (let t = 0; t < B; t++) {
        const t0 = startAt + t * beatDur;
        for (let i = 0; i < I; i++) {
          const inst = K ? i : 0;
          let layer = 0;
          for (let n = 0; n < M; n++) layer += P[t][n][i];
          if (layer * B < 0.02) continue;
          for (let n = 0; n < M; n++) {
            const p = P[t][n][i];
            if (p * B < 0.02) continue;
            // every outcome in a beat sounds at once; its volume follows its amplitude, sqrt(probability)
            if (!isRest(n)) playNote(master, inst, n, t0, beatDur * 1.1, 0.32 * LEVEL[inst] * Math.min(1, Math.sqrt(p * B)));
          }
        }
      }
      const total = B * beatDur;
      if ($("loop").checked)
        timers.push(
          setTimeout(
            () => {
              if (playing) schedule();
            },
            (total - 0.06) * 1000,
          ),
        );
      else
        timers.push(
          setTimeout(
            () => {
              if (playing) stop();
            },
            (total + 1.5) * 1000,
          ),
        );
    };
    schedule();
    const tick = () => {
      if (!ctx) return;
      const b = Math.floor((ctx.currentTime - startAt) / beatDur),
        nb = b >= 0 && b < B ? b : -1;
      if (nb !== playingBeat) {
        playingBeat = nb;
        renderRoll(curP);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  $("play").onclick = () => {
    sweeping = false;
    play();
  };
  $("stop").onclick = stop;
  $("bpm").oninput = () => {
    $("bpmv").textContent = $("bpm").value + " bpm";
  };
  $("ang").oninput = () => {
    $("angv").textContent = $("ang").value + "°";
  };

  /* ---------- lens / view / source / dial ---------- */
  function setLens(l, silent) {
    lens = l;
    for (const [id, v] of [
      ["lensN", "N"],
      ["lensH", "H"],
      ["lensQ", "Q"],
    ])
      $(id).setAttribute("aria-pressed", l === v ? "true" : "false");
    if (!silent) update();
  }
  $("lensN").onclick = () => setLens("N");
  $("lensH").onclick = () => setLens("H");
  $("lensQ").onclick = () => setLens("Q");
  function setMode(m) {
    mode = m;
    $("modeQ").setAttribute("aria-pressed", m === "Q" ? "true" : "false");
    $("modeC").setAttribute("aria-pressed", m === "C" ? "true" : "false");
    update();
  }
  $("modeQ").onclick = () => setMode("Q");
  $("modeC").onclick = () => setMode("C");
  function setView(v) {
    view = v;
    ["P", "S", "B"].forEach((k) => $("view" + k).setAttribute("aria-pressed", v === k ? "true" : "false"));
    update();
  }
  $("shots").addEventListener("change", runPlan);
  $("viewP").onclick = () => setView("P");
  $("viewS").onclick = () => setView("S");
  $("viewB").onclick = () => setView("B");

  /* ---------- running on a backend (one job, two lenses) ---------- */
  let backendRes = null;
  function countsToP(counts) {
    const B = 1 << T,
      M = 1 << N,
      I = 1 << K,
      P = [];
    let tot = 0;
    for (const k in counts) tot += counts[k];
    for (let t = 0; t < B; t++) {
      P.push([]);
      for (let n = 0; n < M; n++) P[t].push(new Float64Array(I));
    }
    for (const k in counts) {
      const x = +k;
      P[x & (B - 1)][(x >> T) & (M - 1)][x >> (T + N)] += counts[k] / tot;
    }
    return P;
  }
  $("runb").onclick = async () => {
    const st = $("runstatus");
    if (!hasEngine() || !getBackend()) {
      st.textContent = "Press Run in Qollab first: the backend comes from the Select QPU dialog.";
      return;
    }
    // block only when the backend reports a definite limit; an unknown capacity (null) is not a reason to refuse
    let width = 2 * (nq() + (mode === "C" ? T : 0)) + 2, cap = null;
    try { const p = JSON.parse(String(await engine.plan_two_lens.callPromising(getBackend(), specJSON(), +$("shots").value, mode === "C"))); width = p.qubits; cap = p.capacity; } catch (e) { /* use the estimate */ }
    if (cap !== null && width > cap) {
      st.textContent = `Not sent: this needs ${width} qubits (two copies plus 2 scratch qubits), but the backend has ${cap}. Use fewer qubits or switch off the classical copy.`;
      return;
    }
    const sig = circuitSig();
    $("runb").disabled = true;
    st.textContent = `Running ${$("shots").value} shots on ${width} qubits…`;
    try {
      const d = JSON.parse(
        String(await engine.run_two_lens.callPromising(getBackend(), specJSON(), +$("shots").value, mode === "C")),
      );
      if (d.error) {
        st.textContent = "Not run: " + d.error + ".";
        return;
      }
      d.sig = sig;
      backendRes = d;
      $("bres").hidden = false;
      $("bname").textContent = d.backend;
      $("bmeta").textContent =
        `${d.shots} shots · ${d.qubits} qubits · ${d.compiled_2q} multi-qubit instructions after compiling for this backend`;
      $("bcz").textContent = d.corr_normal.toFixed(2) + " bits";
      $("bcx").textContent = d.corr_hadamard.toFixed(2) + " bits";
      const sum = d.corr_normal + d.corr_hadamard;
      $("bproof").textContent = d.proven ? "Entanglement detected" : d.enough_shots ? "Not certified" : "No verdict";
      $("bproof").className = "v " + (d.proven ? "ok" : "no");
      $("bproofd").textContent =
        d.enough_shots
          ? `Sum ${sum.toFixed(2)} ± ${d.err.toFixed(2)} bits (approx. 95% lower bound ${d.low95.toFixed(2)}) vs the ${d.bound}-bit limit for unentangled states.${d.proven ? "" : " Detected only when the lower bound clears the limit."}`
          : `This circuit needs at least ${d.min_shots} shots (10 per possible outcome) before the test gives a verdict.`;
      $("viewB").disabled = false;
      st.textContent = 'Done. Press "Backend shots" to hear the measured song.';
      if (view === "B") update();
    } catch (e) {
      const m = String(e);
      st.textContent = /one job|already|limit/i.test(m)
        ? "IonQ takes one job per run: press Run in Qollab again to submit another."
        : "Backend error: " + m.slice(0, 200);
    } finally {
      $("runb").disabled = false;
    }
  };
  $("exactcost").onclick = async () => {
    const out = $("exactcostv");
    if (!hasEngine()) {
      out.textContent = "Needs the Qiskit runtime.";
      return;
    }
    $("exactcost").disabled = true;
    out.textContent = "Transpiling…";
    try {
      const d = JSON.parse(String(await engine.compiled_cost.callPromising(specJSON())));
      out.textContent = `${d.cx} CNOTs, depth ${d.depth} (Qiskit transpiler, basis cx + u)`;
    } catch (e) {
      out.textContent = "Error: " + String(e).slice(0, 160);
    } finally {
      $("exactcost").disabled = false;
    }
  };
  $("dial").oninput = () => {
    dial = +$("dial").value / 100;
    $("dialv").textContent = $("dial").value + "%";
    update();
  };
  function renderStart() {
    const el = $("start"),
      M = 1 << N;
    el.innerHTML = "";
    for (let n = 0; n < M; n++) {
      const o = document.createElement("option");
      o.value = "b" + n;
      o.textContent = noteName(n);
      el.appendChild(o);
    }
    for (let j = 0; j < M; j++) {
      const o = document.createElement("option");
      o.value = "e" + j;
      o.textContent = `eigen-chord ${j}`;
      el.appendChild(o);
    }
    if (start.v >= M) start = { k: "b", v: 0 };
    el.value = start.k + start.v;
    $("step").value = step;
  }
  $("start").onchange = () => {
    const v = $("start").value;
    start = { k: v[0], v: +v.slice(1) };
    update();
  };
  $("step").onchange = () => {
    step = +$("step").value;
    update();
  };

  /* ---------- measurement ---------- */
  $("measure").onclick = () => {
    const reg = $("mreg").value;
    if (reg === "inst" && !K) return;
    let { re, im } = simulateCore();
    if (reg === "clock") [re, im] = qftTime(re, im, -1);
    const probsByVal = new Map();
    let r = Math.random(),
      pick = null;
    for (let x = 0; x < re.length; x++) {
      const v = regValue(x, reg === "clock" ? "time" : reg);
      probsByVal.set(v, (probsByVal.get(v) || 0) + re[x] ** 2 + im[x] ** 2);
    }
    for (const [v, p] of [...probsByVal].sort((a, b) => a[0] - b[0])) {
      if (r < p) {
        pick = [v, p];
        break;
      }
      r -= p;
    }
    if (!pick) {
      const last = [...probsByVal].filter(([, p]) => p > 1e-12).pop();
      pick = last;
    }
    collapse.push({ reg, val: pick[0] });
    collapseSig = circuitSig();
    const B = 1 << T,
      v = pick[0],
      pct = Math.round(pick[1] * 100),
      gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const what =
      reg === "time"
        ? `beat ${v + 1}`
        : reg === "note"
          ? noteName(v)
          : reg === "inst"
            ? INST[v]
            : `clock reading ${v} (phase ${v ? `${v / gcd(v, B)}/${B / gcd(v, B)}` : "0"})`;
    const after =
      reg === "time"
        ? "Only that beat is left: one moment of the song."
        : reg === "note"
          ? "Only that note is left, at the beats where it was playing."
          : reg === "inst"
            ? "Only that instrument is left."
            : "The notes collapsed onto the matching eigen-chord.";
    $("mstatus").textContent =
      `Measured the ${{ time: "time register", note: "note register", inst: "instrument register", clock: "clock in the QPE basis" }[reg]}: got ${what} (it had a ${pct}% chance). ${after} Press Undo measurements to restore the full state.`;
    update();
  };
  $("unmeasure").onclick = () => {
    collapse = [];
    $("mstatus").textContent = "";
    update();
  };

  /* ---------- sweep ---------- */
  $("sweep").onclick = () => {
    dial = 0;
    $("dial").value = 0;
    $("dialv").textContent = "0%";
    $("loop").checked = true;
    update();
    play();
    sweeping = true;
    $("mstatus").textContent =
      "Sweeping: each loop turns the links up by 25%, from a drone to the full melody.";
  };

  /* ---------- builder ---------- */
  function syncControls() {
    $("pal").value = PAL;
    $("pal").disabled = K === 0;
    $("tq").value = T;
    $("nq").value = N;
    $("kq").value = K;
    $("rest").checked = REST;
    renderBuilder();
    renderStart();
  }
  function setSize(t, n, k = 0, rest = false, st = { k: "b", v: 0 }, sp = 1, pal = "band") {
    PAL = pal;
    INST = PALS[pal];
    T = t;
    N = n;
    K = k;
    REST = rest;
    start = st;
    step = sp;
    cells = {};
    COLS = 8;
    dial = 1;
    $("dial").value = 100;
    $("dialv").textContent = "100%";
    syncControls();
  }
  function qpeCircuit() {
    cells = {};
    for (let r = 0; r < T; r++) {
      cells[key(r, 0)] = { t: "H" };
      cells[key(r, r + 1)] = { t: "U" };
    }
    COLS = Math.max(T + 3, 8);
  }
  const OUT = () => N + K; // output bits written per beat: note, then instrument
  function addLookup(vals, extra, c) {
    // one controlled column per beat, appended from column c; returns the next free column
    const B = 1 << T;
    for (let t = 0; t < B; t++) {
      const v = vals[t];
      if (!v) continue;
      for (let r = 0; r < T; r++) cells[key(r, c)] = { t: (t >> r) & 1 ? "C" : "A" };
      for (const [q, g] of extra) cells[key(q, c)] = g;
      for (let k = 0; k < OUT(); k++) if ((v >> k) & 1) cells[key(T + k, c)] = { t: "X" };
      c++;
    }
    return c;
  }
  function melodyCircuit(vals, extra = []) {
    // lookup table; vals = note + (instrument << N)
    cells = {};
    for (let r = 0; r < T; r++) cells[key(r, 0)] = { t: "H" };
    const c = addLookup(vals, extra, 1);
    COLS = Math.max(c + 1, 8);
    return c;
  }
  function anfCircuit(vals) {
    cells = {};
    const B = 1 << T;
    for (let r = 0; r < T; r++) cells[key(r, 0)] = { t: "H" };
    const terms = new Map();
    for (let k = 0; k < OUT(); k++) {
      const f = [...Array(B)].map((_, t) => (vals[t] >> k) & 1);
      for (let i = 0; i < T; i++) for (let t = 0; t < B; t++) if ((t >> i) & 1) f[t] ^= f[t ^ (1 << i)];
      for (let m = 0; m < B; m++)
        if (f[m]) {
          if (!terms.has(m)) terms.set(m, []);
          terms.get(m).push(k);
        }
    }
    const pc = (m) => m.toString(2).split("1").length - 1;
    let c = 1;
    for (const m of [...terms.keys()].sort((a, b) => pc(a) - pc(b) || a - b)) {
      for (let r = 0; r < T; r++) if ((m >> r) & 1) cells[key(r, c)] = { t: "C" };
      for (const k of terms.get(m)) cells[key(T + k, c)] = { t: "X" };
      c++;
    }
    COLS = Math.max(c + 1, 8);
  }
  function anfVoices(fn, c) {
    // note bits as XORs of AND-terms of the time AND instrument bits; fn(t,i) = note
    const B = 1 << T,
      I = 1 << K,
      inQ = [...Array(T).keys(), ...[...Array(K)].map((_, j) => T + N + j)],
      V = inQ.length,
      S = 1 << V,
      terms = new Map();
    for (let k = 0; k < N; k++) {
      const f = [...Array(S)].map((_, x) => (fn(x & (B - 1), x >> T) >> k) & 1);
      for (let b = 0; b < V; b++) for (let x = 0; x < S; x++) if ((x >> b) & 1) f[x] ^= f[x ^ (1 << b)];
      for (let m = 0; m < S; m++)
        if (f[m]) {
          if (!terms.has(m)) terms.set(m, []);
          terms.get(m).push(k);
        }
    }
    const pc = (m) => m.toString(2).split("1").length - 1;
    for (const m of [...terms.keys()].sort((a, b) => pc(a) - pc(b) || a - b)) {
      for (let b = 0; b < V; b++) if ((m >> b) & 1) cells[key(inQ[b], c)] = { t: "C" };
      for (const k of terms.get(m)) cells[key(T + k, c)] = { t: "X" };
      c++;
    }
    return c;
  }
  function renderBuilder() {
    const el = $("builder"),
      B = 1 << T,
      M = 1 << N;
    const prevN = [...el.querySelectorAll("select.bn")].map((s) => +s.value),
      prevI = [...el.querySelectorAll("select.bi")].map((s) => +s.value);
    el.innerHTML = "";
    for (let t = 0; t < B; t++) {
      const l = document.createElement("label");
      l.textContent = `beat ${t + 1}`;
      const s = document.createElement("select");
      s.id = "beat-" + t;
      s.className = "bn";
      for (let n = 0; n < M; n++) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = noteName(n);
        s.appendChild(o);
      }
      s.value = Math.min(prevN[t] ?? t % M, M - 1);
      l.appendChild(s);
      if (K) {
        const si = document.createElement("select");
        si.id = "inst-" + t;
        si.className = "bi";
        INST.forEach((nm, i) => {
          const o = document.createElement("option");
          o.value = i;
          o.textContent = nm;
          si.appendChild(o);
        });
        si.value = prevI[t] ?? 0;
        l.appendChild(si);
      }
      el.appendChild(l);
    }
  }
  $("build").onclick = () => {
    const B = 1 << T,
      vals = [...Array(B)].map((_, t) => +$("beat-" + t).value + (K ? +$("inst-" + t).value << N : 0));
    melodyCircuit(vals);
    const ca = circuitCost(cells, COLS),
      a = ca.total;
    anfCircuit(vals);
    const cb = circuitCost(cells, COLS),
      b = cb.total;
    if ($("enc").value === "lookup") melodyCircuit(vals);
    $("buildinfo").textContent =
      `Same melody, two encodings: lookup table ${costText(ca)}, algebraic ${costText(cb)}${b < a ? ` (${Math.round(100 * Math.min(1 - cb.lo / ca.lo, 1 - b / a))}–${Math.round(100 * Math.max(1 - cb.lo / ca.lo, 1 - b / a))}% fewer)` : ""}. Showing the ${$("enc").value === "lookup" ? "lookup table" : "algebraic"} version.`;
    update();
  };

  /* ---------- typed melodies ---------- */
  const NOTE_WORDS = {
    c: 0,
    d: 1,
    e: 2,
    f: 3,
    g: 4,
    a: 5,
    b: 6,
    do: 0,
    re: 1,
    mi: 2,
    fa: 3,
    sol: 4,
    so: 4,
    la: 5,
    ti: 6,
    si: 6,
  };
  const INST_WORDS = { piano: 0, p: 0, guitar: 1, g: 1, flute: 2, f: 2, drums: 3, drum: 3, d: 3 };
  function parseMelody(text) {
    const toks = text
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!toks.length) return { err: "Type at least one note." };
    if (toks.length > 16) return { err: `That is ${toks.length} notes; the box holds up to 16 beats.` };
    const out = [];
    let rest = false,
      high = false,
      inst = false;
    for (const tk of toks) {
      const [nRaw, iRaw] = tk.toLowerCase().split(/[:/]/);
      let n,
        i = 0;
      if (["-", "_", "r", "rest", "x"].includes(nRaw)) {
        n = -1;
        rest = true;
      } else {
        const hi = /['′’]$/.test(nRaw) || /^c5$/.test(nRaw),
          base = nRaw.replace(/['′’]$/, "").replace(/^c5$/, "c");
        if (hi && (base === "c" || base === "do")) {
          n = 7;
          high = true;
        } else if (base in NOTE_WORDS) n = NOTE_WORDS[base];
        else
          return {
            err: `I don't recognise "${tk}". Use C D E F G A B C′, do re mi fa sol la ti do′, or - for a rest.`,
          };
      }
      if (iRaw !== undefined) {
        if (!(iRaw in INST_WORDS))
          return { err: `Unknown instrument in "${tk}". Use piano, guitar, flute or drums.` };
        i = INST_WORDS[iRaw];
        inst = true;
      }
      out.push([n, i]);
    }
    const t = Math.max(2, Math.ceil(Math.log2(toks.length))),
      B = 1 << t;
    if (out.length < B) rest = true;
    if (rest && high)
      return { err: "Use either rests or high do′ (C′), not both: they share the top note slot." };
    while (out.length < B) out.push([-1, 0]);
    const k = inst ? 2 : 0;
    return { t, k, rest, vals: out.map(([n, i]) => (n < 0 ? 7 : n) + (i << 3)) };
  }
  $("fromtext").onclick = () => {
    const r = parseMelody($("mtext").value);
    if (r.err) {
      $("buildinfo").textContent = r.err;
      return;
    }
    setSize(r.t, 3, r.k, r.rest);
    melodyCircuit(r.vals);
    const ca = circuitCost(cells, COLS);
    anfCircuit(r.vals);
    const cb = circuitCost(cells, COLS);
    if ($("enc").value === "lookup") melodyCircuit(r.vals);
    $("buildinfo").textContent =
      `Built ${1 << r.t} beats from your text${r.rest ? " (rests on)" : ""}${r.k ? " with instruments" : ""}. Lookup table ${costText(ca)}, algebraic ${costText(cb)}. Showing the ${$("enc").value === "lookup" ? "lookup table" : "algebraic"} version.`;
    setLens("N", true);
    update();
  };

  /* ---------- two-qubit test: correlation or entanglement ---------- */
  function pairDist(qa, qb, had, copied) {
    // P(a,b) for two qubits, through the normal or Hadamard lens, quantum or classical copy
    const st = simulateCore(),
      B = 1 << T,
      dim = st.re.length,
      acc = [0, 0, 0, 0];
    const branches = copied ? [...Array(B).keys()] : [null];
    for (const br of branches) {
      const re = new Float64Array(dim),
        im = new Float64Array(dim);
      for (let x = 0; x < dim; x++)
        if (br === null || (x & (B - 1)) === br) {
          re[x] = st.re[x];
          im[x] = st.im[x];
        }
      if (had) {
        applyMat(re, im, qa, HM, []);
        applyMat(re, im, qb, HM, []);
      }
      for (let x = 0; x < dim; x++) acc[((x >> qa) & 1) + 2 * ((x >> qb) & 1)] += re[x] ** 2 + im[x] ** 2;
    }
    return acc;
  }
  const pairMI = (a) =>
    mutualInfo([
      [a[0], a[2]],
      [a[1], a[3]],
    ]);
  const qName = (q) => (q < T ? `t${q}` : q < T + N ? `n${q - T}` : `i${q - T - N}`);
  let duetCtx = null;
  function hearPair(dist, el) {
    if (duetCtx) {
      duetCtx.close();
      duetCtx = null;
    }
    const c = new (window.AudioContext || window.webkitAudioContext)();
    duetCtx = c;
    const tot = dist.reduce((s, p) => s + p, 0),
      marks = [];
    let t0 = c.currentTime + 0.08;
    for (let k = 0; k < 8; k++) {
      let u = Math.random() * tot,
        o = 0;
      while (o < 3 && u >= dist[o]) {
        u -= dist[o];
        o++;
      }
      const a = o & 1,
        b = (o >> 1) & 1;
      marks.push(a === b ? "✓" : "✗");
      [
        [a ? 369.99 : 261.63, -0.8],
        [b ? 739.99 : 523.25, 0.8],
      ].forEach(([f, pan]) => {
        const osc = c.createOscillator(),
          g = c.createGain(),
          p = c.createStereoPanner();
        osc.type = "triangle";
        osc.frequency.value = f;
        p.pan.value = pan;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
        osc.connect(g).connect(p).connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + 0.36);
      });
      t0 += 0.4;
    }
    el.textContent = "";
    marks.forEach((m, i) =>
      setTimeout(
        () => {
          el.textContent += m + " ";
        },
        80 + 400 * i,
      ),
    );
  }
  function pairCard(dist, lensName, qa, qb) {
    const tot = dist.reduce((s, p) => s + p, 0) || 1,
      pc = (p) => Math.round((100 * p) / tot) + "%",
      agree = (dist[0] + dist[3]) / tot,
      mi = pairMI(dist);
    const card = document.createElement("div");
    card.className = "bcard";
    const lab = lensName === "normal" ? ["0", "1"] : ["+", "−"];
    card.innerHTML = `<span class="lbl">${lensName} lens</span>
    <table class="pt"><tr><th></th><th>${qName(qb)} = ${lab[0]}</th><th>${qName(qb)} = ${lab[1]}</th></tr>
    <tr><th>${qName(qa)} = ${lab[0]}</th><td class="${dist[0] / tot > 0.01 ? "hit" : ""}">${pc(dist[0])}</td><td class="${dist[2] / tot > 0.01 ? "hit" : ""}">${pc(dist[2])}</td></tr>
    <tr><th>${qName(qa)} = ${lab[1]}</th><td class="${dist[1] / tot > 0.01 ? "hit" : ""}">${pc(dist[1])}</td><td class="${dist[3] / tot > 0.01 ? "hit" : ""}">${pc(dist[3])}</td></tr></table>
    <span class="bline">agree ${Math.round(agree * 100)}% · correlation ${mi.toFixed(2)} bit${Math.abs(mi - 1) < 0.005 ? "" : "s"}</span>
    <div class="row" style="gap:8px"><button>▶ Hear 8 shots</button><span class="shots" aria-live="polite"></span></div>`;
    card.querySelector("button").onclick = () => hearPair(dist, card.querySelector(".shots"));
    return card;
  }
  function renderPair() {
    const pa = $("pa"),
      pb = $("pb"),
      oa = +pa.value,
      ob = +pb.value;
    const tOpts = [...Array(T)].map((_, q) => q),
      pOpts = [...Array(N + K)].map((_, j) => T + j);
    if (pa.options.length !== tOpts.length || pa.dataset.sig !== String(nq())) {
      pa.innerHTML = tOpts.map((q) => `<option value="${q}">${qName(q)} (time)</option>`).join("");
      pb.innerHTML = pOpts
        .map((q) => `<option value="${q}">${qName(q)} (${q < T + N ? "note" : "instrument"})</option>`)
        .join("");
      pa.value = tOpts.includes(oa) ? oa : 0;
      pb.value = pOpts.includes(ob) ? ob : T;
      pa.dataset.sig = String(nq());
    }
    const qa = +pa.value,
      qb = +pb.value;
    for (const [id, copied] of [
      ["bq", false],
      ["bc", true],
    ]) {
      const el = $(id);
      el.innerHTML = "";
      const dz = pairDist(qa, qb, false, copied),
        dx = pairDist(qa, qb, true, copied),
        sum = pairMI(dz) + pairMI(dx);
      el.appendChild(pairCard(dz, "normal", qa, qb));
      el.appendChild(pairCard(dx, "Hadamard", qa, qb));
      const v = document.createElement("span");
      v.className = "verdict " + (sum > 1 + 1e-6 ? "ok" : "no");
      v.textContent =
        sum > 1 + 1e-6
          ? `Entangled: ${sum.toFixed(2)} bits in total, above the 1-bit limit for unentangled pairs.`
          : `Not proven: ${sum.toFixed(2)} bit${Math.abs(sum - 1) < 0.005 ? "" : "s"} in total, within the 1-bit limit${copied ? " (the copy picked its beat in advance, so it can only be correlated in one of the two measurements)" : ""}.`;
      el.appendChild(v);
    }
  }
  $("pa").onchange = renderPair;
  $("pb").onchange = renderPair;

  /* ---------- presets ---------- */
  const H = { t: "H" },
    X = { t: "X" },
    CT = { t: "C" },
    AN = { t: "A" };
  const OLD = [0, 0, 0, 4, 5, 5, 4, 4, 2, 2, 1, 1, 0, 0, 0, 0]; // Old MacDonald, held notes repeated
  const OLD_R = [0, 0, 0, 4, 5, 5, 4, 7, 2, 2, 1, 1, 0, 7, 7, 7]; // with rests (slot 7)
  // Pachelbel's Canon in C: C G Am Em F C F G, two beats per chord. Slots: 0 C,1 D,2 E,3 F,4 G,5 A,6 B,7 C'
  const CANON = {
    cello: [7, 7, 4, 4, 5, 5, 2, 2, 3, 3, 0, 0, 3, 3, 4, 4], // the ground bass, two octaves down
    viola: [2, 4, 1, 6, 0, 2, 4, 6, 3, 5, 2, 4, 5, 7, 1, 6], // broken chords, an octave down
    flute: [4, 7, 6, 4, 5, 7, 6, 4, 5, 3, 4, 7, 7, 3, 6, 1], // counter-melody, an octave up
    violin: [7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 3, 3, 4, 4],
  }; // the canon theme
  const PRESETS = [
    [
      "Drone",
      () => {
        setSize(2, 2);
        cells[key(0, 0)] = H;
        cells[key(1, 0)] = H;
      },
    ],
    [
      "Chord, no entanglement",
      () => {
        setSize(2, 2);
        cells[key(0, 0)] = H;
        cells[key(1, 0)] = H;
        cells[key(3, 0)] = H;
      },
    ],
    [
      "do re mi fa",
      () => {
        setSize(2, 2);
        cells[key(0, 0)] = H;
        cells[key(1, 0)] = H;
        cells[key(0, 1)] = CT;
        cells[key(2, 1)] = X;
        cells[key(1, 2)] = CT;
        cells[key(3, 2)] = X;
      },
    ],
    [
      "fa mi re do",
      () => {
        PRESETS[2][1]();
        cells[key(2, 3)] = X;
        cells[key(3, 3)] = X;
      },
    ],
    [
      "do do re fa (Toffoli)",
      () => {
        setSize(2, 2);
        cells[key(0, 0)] = H;
        cells[key(1, 0)] = H;
        cells[key(1, 1)] = CT;
        cells[key(2, 1)] = X;
        cells[key(0, 2)] = CT;
        cells[key(1, 2)] = CT;
        cells[key(3, 2)] = X;
      },
    ],
    [
      "Bell pair (t0 ↔ n0)",
      () => {
        setSize(2, 2);
        cells[key(0, 0)] = H;
        cells[key(1, 0)] = H;
        cells[key(0, 1)] = CT;
        cells[key(2, 1)] = X;
      },
    ],
    [
      "Moving chords (two notes per beat)",
      () => {
        setSize(2, 3);
        cells[key(0, 0)] = H;
        cells[key(1, 0)] = H;
        cells[key(4, 0)] = H;
        cells[key(0, 1)] = CT;
        cells[key(2, 1)] = X;
        cells[key(1, 2)] = CT;
        cells[key(3, 2)] = X;
      },
    ],
    [
      "Twinkle",
      () => {
        setSize(3, 3, 0, true);
        melodyCircuit([0, 0, 4, 4, 5, 5, 4, 7]);
      },
    ],
    [
      "Scale: do to do′ (8 beats)",
      () => {
        setSize(3, 3);
        melodyCircuit([0, 1, 2, 3, 4, 5, 6, 7]);
      },
    ],
    [
      "Hot Cross Buns",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit([2, 1, 0, 7, 2, 1, 0, 7, 0, 0, 1, 1, 2, 1, 0, 7]);
      },
    ],
    [
      "Mary Had a Little Lamb",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit([2, 1, 0, 1, 2, 2, 2, 7, 1, 1, 1, 7, 2, 4, 4, 7]);
      },
    ],
    [
      "Au clair de la lune",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit([0, 0, 0, 1, 2, 7, 1, 7, 0, 2, 1, 1, 0, 7, 7, 7]);
      },
    ],
    [
      "Frère Jacques",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit([0, 1, 2, 0, 0, 1, 2, 0, 2, 3, 4, 7, 2, 3, 4, 7]);
      },
    ],
    [
      "London Bridge",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit([4, 5, 4, 3, 2, 3, 4, 7, 1, 2, 3, 7, 2, 3, 4, 7]);
      },
    ],
    [
      "Jingle Bells",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit([2, 2, 2, 7, 2, 2, 2, 7, 2, 4, 0, 1, 2, 7, 7, 7]);
      },
    ],
    [
      "Ode to Joy",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit([2, 2, 3, 4, 4, 3, 2, 1, 0, 0, 1, 2, 2, 1, 1, 7]);
      },
    ],
    [
      "Old MacDonald (with rests)",
      () => {
        setSize(4, 3, 0, true);
        melodyCircuit(OLD_R);
      },
    ],
    [
      "Old MacDonald · piano + flute",
      () => {
        setSize(4, 3, 2, true);
        melodyCircuit(OLD_R);
        cells[key(T + N + 1, 0)] = H;
      },
    ],
    [
      "Old MacDonald · new instrument each bar",
      () => {
        setSize(4, 3, 2, false);
        const c = melodyCircuit(OLD);
        cells[key(2, c)] = CT;
        cells[key(T + N, c)] = X;
        cells[key(3, c + 1)] = CT;
        cells[key(T + N + 1, c + 1)] = X;
        COLS = Math.max(COLS, c + 3);
      },
    ],
    [
      "Old MacDonald · with drums",
      () => {
        setSize(4, 3, 2, true);
        const i0 = T + N,
          i1 = T + N + 1;
        const c = melodyCircuit(OLD_R, [[i1, AN]]); // the melody is written only in the piano branch
        for (let r = c; r >= 1; r--)
          for (let q = 0; q < nq(); q++) {
            const g = cells[key(q, r)];
            if (g) {
              cells[key(q, r + 2)] = g;
              delete cells[key(q, r)];
            }
          }
        cells[key(i1, 0)] = H;
        cells[key(i1, 1)] = CT;
        cells[key(i0, 1)] = X; // i1 picks piano (0) or drums (3)
        cells[key(i1, 2)] = CT;
        cells[key(0, 2)] = CT;
        cells[key(T + 1, 2)] = X; // drums: kick on beats 1,3,…, snare on 2,4,…
        COLS = c + 4;
      },
    ],
    [
      "Old MacDonald · full band",
      () => {
        setSize(4, 3, 2, true);
        const i0 = T + N,
          i1 = T + N + 1;
        for (let r = 0; r < T; r++) cells[key(r, 0)] = H;
        cells[key(i0, 0)] = H;
        cells[key(i1, 0)] = H; // every beat: all four instruments at once
        let c = addLookup(OLD_R, [[i0, AN]], 1); // piano (00) and flute (10): the tune
        c = addLookup(
          [0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0],
          [
            [i0, CT],
            [i1, AN],
          ],
          c,
        ); // guitar (01): a bass line, an octave down
        cells[key(i0, c)] = CT;
        cells[key(i1, c)] = CT;
        cells[key(0, c)] = CT;
        cells[key(T + 1, c)] = X;
        c++; // drums (11): kick, snare, kick, snare
        COLS = c + 1;
      },
    ],
    [
      "Canon in C · orchestra (Pachelbel)",
      () => {
        setSize(4, 3, 2, false, { k: "b", v: 0 }, 1, "orch");
        for (let r = 0; r < T; r++) cells[key(r, 0)] = H;
        cells[key(T + N, 0)] = H;
        cells[key(T + N + 1, 0)] = H; // every beat, all four instruments at once
        const V = [CANON.cello, CANON.viola, CANON.flute, CANON.violin];
        COLS = anfVoices((t, i) => V[i][t], 1) + 1;
        $("bpm").value = 84;
        $("bpmv").textContent = "84 bpm";
      },
    ],
    [
      "QPE: melody from U",
      () => {
        setSize(2, 2);
        qpeCircuit();
      },
    ],
    [
      "QPE: eigen-chord 1",
      () => {
        setSize(2, 2, 0, false, { k: "e", v: 1 });
        qpeCircuit();
      },
    ],
    [
      "QPE: leaps of 3, 8 beats",
      () => {
        setSize(3, 3, 0, false, { k: "b", v: 0 }, 3);
        qpeCircuit();
      },
    ],
  ];
  PRESETS.push([
    "All four notes at once",
    () => {
      setSize(2, 2);
      for (let q = 0; q < 4; q++) cells[key(q, 0)] = H;
    },
  ]);

  // how the presets are grouped in free play
  const PRESET_GROUPS = [
    ["From the notebook", ["Drone", "Chord, no entanglement", "All four notes at once", "do re mi fa", "do do re fa (Toffoli)", "Bell pair (t0 ↔ n0)", "QPE: melody from U", "QPE: eigen-chord 1"]],
    ["Simple songs", ["Scale: do to do′ (8 beats)", "Twinkle", "Hot Cross Buns", "Mary Had a Little Lamb", "Au clair de la lune", "Frère Jacques", "London Bridge", "Jingle Bells", "Ode to Joy"]],
    ["Instruments and bigger songs", ["Old MacDonald (with rests)", "Old MacDonald · piano + flute", "Old MacDonald · new instrument each bar", "Old MacDonald · with drums", "Old MacDonald · full band", "Canon in C · orchestra (Pachelbel)"]],
    ["Experiments", ["fa mi re do", "Moving chords (two notes per beat)", "QPE: leaps of 3, 8 beats"]],
  ];

  /* ---------- chapters: one section per point the project makes ---------- */
  const CHAPTERS = [
    {
      title: "Superposition: everything at once",
      point:
        "Hadamard gates put the time qubits in superposition, so every beat exists at once. On its own that only gives a drone or a chord: every beat plays the same thing.",
      presets: ["Drone", "Chord, no entanglement", "All four notes at once"],
      notice: [
        "Entanglement, time ↔ notes reads 0 bits.",
        "Every column of the piano roll is identical.",
        "Hadamards on the note qubits give a chord, not a melody: superposition is not change.",
      ],
      show: [],
    },
    {
      title: "Entanglement makes the melody",
      point:
        "A gate controlled by a time qubit and acting on a note qubit makes the note depend on the beat. That dependence is the melody, and it is entanglement between time and notes.",
      presets: ["do re mi fa", "fa mi re do", "do do re fa (Toffoli)", "Scale: do to do′ (8 beats)", "Twinkle", "Hot Cross Buns", "Mary Had a Little Lamb", "Frère Jacques", "Ode to Joy"],
      notice: [
        "The entanglement readout climbs as soon as notes change from beat to beat.",
        "Press Sweep: the link strength steps from 0% to 100% and the melody grows out of a drone.",
        "Ode to Joy reaches 2.40 bits; do re mi fa reaches the 2-bit maximum. Held notes end in a rest: the music box has no way to hold a note.",
      ],
      show: ["dial", "sweep"],
    },
    {
      title: "Correlation is not entanglement",
      point:
        "In do re mi fa the note always matches the beat. That is a correlation, and an ordinary machine can produce it without any quantum physics: pick a beat at random, look up its note, play it. The Classical copy switch does exactly that. It sounds the same. To tell them apart, the app can measure a second way: apply a Hadamard gate to every qubit just before measuring (the Hadamard lens). In this example, the entangled circuit stays correlated in both measurements, while the classical copy stays correlated only in the normal measurement.",
      presets: ["do re mi fa", "Bell pair (t0 ↔ n0)", "do do re fa (Toffoli)", "Ode to Joy"],
      notice: [
        "Normal lens, Quantum vs Classical copy: the same note on every beat. Listening alone cannot tell them apart, but the entanglement readout drops to 0 for the copy.",
        "Now the Hadamard lens: the real circuit still shows a correlation (2 bits for do re mi fa); the copy shows 0.",
        "The badge adds the two correlations. Nothing classical can go above the limit (2 bits here). do re mi fa reaches 4, so it must be entangled. Ode to Joy and the Toffoli melody pass too.",
        "Bell pair: use the two-qubit test below and press Hear. Through the Hadamard lens the real pair still agrees every time (✓); the copy agrees only half the time.",
      ],
      show: ["lens", "mode", "corr", "proof", "bell"],
    },
    {
      title: "On a real quantum backend",
      point:
        "One job holds two copies of the song, one measured normally and one through the Hadamard lens. That is all the test needs, so it runs within IonQ's limit of one job per run.",
      presets: ["do re mi fa", "Bell pair (t0 ↔ n0)", "do do re fa (Toffoli)", "Ode to Joy"],
      notice: [
        "Press Run in Qollab with a backend selected, then Run on the selected backend.",
        "Press Backend shots to hear what the backend measured.",
        "Switch to Classical copy and run again: the Hadamard-lens correlation from shots drops to about 0.",
      ],
      show: ["mode", "view", "lens", "run"],
    },
    {
      title: "Time from entanglement",
      point:
        "The whole circuit is one frozen state, Σₜ |t⟩|notesₜ⟩. Change only appears relative to the clock: Page and Wootters' time from entanglement. The U boxes build the history state of quantum phase estimation.",
      presets: ["QPE: melody from U", "QPE: eigen-chord 1", "QPE: leaps of 3, 8 beats"],
      notice: [
        "QPE: melody from U is do re mi fa built from U (on t0) and U² (on t1): 'at beat t, step up t times'.",
        "An eigen-chord plays the same chord on every beat (no entanglement), yet the QFT lens reads its phase exactly.",
        "Measure the clock register: the notes collapse onto the matching eigen-chord.",
      ],
      show: ["qpe", "lensQ", "lens", "qpestat", "measure"],
    },
    {
      title: "Songs as circuits",
      point:
        "Any tune is a circuit, and how you encode it matters. Instruments add a third register: doubling a line needs no entanglement, switching instruments over time does.",
      presets: [
        "Old MacDonald (with rests)",
        "Old MacDonald · piano + flute",
        "Old MacDonald · new instrument each bar",
        "Old MacDonald · with drums",
        "Old MacDonald · full band",
        "Canon in C · orchestra (Pachelbel)",
      ],
      notice: [
        "Write a tune below and compare the lookup table with the algebraic encoding: Ode to Joy needs about half the CNOTs.",
        "Piano + flute doubles the tune: the instrument register is not entangled. A new instrument each bar is.",
        "Count the exact cost with the Qiskit transpiler, then try the algebraic encoding of the same tune.",
      ],
      show: ["cost", "build", "code"],
    },
    {
      title: "Free play",
      point: "Every gate, preset and readout at once. Build your own circuit and listen.",
      presets: null,
      notice: [],
      show: ["dial", "sweep", "lens", "lensQ", "mode", "view", "corr", "proof", "bell", "run", "qpe", "qpestat", "measure", "cost", "build", "code", "listen"],
    },
  ];
  const up = (el, sel) => el.closest(sel);
  const PARTS = {
    dial: () => [up($("dial"), ".row")],
    sweep: () => [$("sweep")],
    lens: () => [up($("lensN"), ".seg")],
    lensQ: () => [$("lensQ")],
    mode: () => [up($("modeQ"), ".seg")],
    view: () => [up($("viewP"), ".seg")],
    corr: () => [up($("cz"), ".stat"), up($("cx"), ".stat")],
    proof: () => [up($("proof"), ".stat")],
    bell: () => [up($("h-bell"), "section")],
    run: () => [up($("h-run"), "section")],
    qpe: () => [up($("start"), ".row")],
    qpestat: () => [up($("qpe"), ".stat")],
    measure: () => [$("mreg").previousElementSibling, $("mreg"), $("measure"), $("unmeasure"), $("mstatus")],
    cost: () => [up($("cost"), ".stat")],
    build: () => [up($("h-build"), "section")],
    code: () => [up($("code"), "section")],
    listen: () => [up($("h-listen"), "section")],
  };
  let chapter = 0;
  function setChapter(k, focus) {
    chapter = k;
    const ch = CHAPTERS[k];
    for (const [name, get] of Object.entries(PARTS)) get().forEach((el) => el && (el.hidden = !ch.show.includes(name)));
    document.querySelectorAll("#chapters button").forEach((b, i) => {
      if (i === k) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    $("ch-num").textContent = k < CHAPTERS.length - 1 ? `Point ${k + 1} of ${CHAPTERS.length - 1}` : "Explore";
    $("ch-title").textContent = ch.title;
    $("ch-point").textContent = ch.point;
    $("ch-notice").innerHTML = ch.notice.map((t) => `<li>${t}</li>`).join("");
    $("ch-noticebox").hidden = !ch.notice.length;
    $("ch-prev").disabled = k === 0;
    $("ch-next").disabled = k === CHAPTERS.length - 1;
    // start each chapter from a clean, comparable state
    if (lens !== "N" || (lens === "Q" && !ch.show.includes("lensQ"))) setLens("N", true);
    if (mode !== "Q") setMode("Q");
    view = "P";
    ["P", "S", "B"].forEach((v) => $("view" + v).setAttribute("aria-pressed", v === "P" ? "true" : "false"));
    collapse = [];
    $("mstatus").textContent = "";
    renderPresets();
    const first = ch.presets ? PRESETS.find(([n]) => n === ch.presets[0]) : null;
    if (first) {
      stop();
      first[1]();
      setLens("N", true);
    }
    update();
    if (focus) $("ch-title").focus();
  }
  function renderChapters() {
    const nav = $("chapters");
    nav.innerHTML = "";
    CHAPTERS.forEach((ch, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="n">${i < CHAPTERS.length - 1 ? i + 1 : "★"}</span> ${ch.title}`;
      b.onclick = () => setChapter(i, true);
      nav.appendChild(b);
    });
    $("ch-prev").onclick = () => setChapter(Math.max(0, chapter - 1), true);
    $("ch-next").onclick = () => setChapter(Math.min(CHAPTERS.length - 1, chapter + 1), true);
  }

  function renderPresets() {
    const el = $("presets");
    el.innerHTML = "";
    const only = typeof CHAPTERS !== "undefined" ? CHAPTERS[chapter].presets : null;
    const order = only ? PRESETS.map((p, i) => [p, i]) : PRESET_GROUPS.flatMap(([head, names]) => [head, ...names.map((n) => { const i = PRESETS.findIndex(([m]) => m === n); return [PRESETS[i], i]; })]);
    order.forEach((item) => {
      if (typeof item === "string") {
        const h = document.createElement("p");
        h.className = "pgroup lbl";
        h.textContent = item;
        el.appendChild(h);
        return;
      }
      const [[name, fn], i] = item;
      if (only && !only.includes(name)) return;
      const b = document.createElement("button");
      b.id = "preset-" + i;
      b.textContent = name;
      b.onclick = () => {
        fn();
        setLens("N", true);
        update();
      };
      el.appendChild(b);
    });
  }
  $("tq").onchange = () => {
    T = +$("tq").value;
    cells = {};
    for (let r = 0; r < T; r++) cells[key(r, 0)] = H;
    COLS = Math.max(COLS, 8);
    renderBuilder();
    update();
  };
  $("nq").onchange = () => {
    N = +$("nq").value;
    cells = {};
    for (let r = 0; r < T; r++) cells[key(r, 0)] = H;
    renderBuilder();
    renderStart();
    update();
  };
  $("kq").onchange = () => {
    K = +$("kq").value;
    $("pal").disabled = K === 0;
    for (const k in cells) if (+k.split(",")[0] >= T + N) delete cells[k];
    renderBuilder();
    update();
  };
  $("rest").onchange = () => {
    REST = $("rest").checked;
    renderBuilder();
    renderStart();
    update();
  };
  $("pal").onchange = () => {
    PAL = $("pal").value;
    INST = PALS[PAL];
    renderBuilder();
    update();
  };
  $("addcol").onclick = () => {
    COLS++;
    update();
  };
  $("clear").onclick = () => {
    cells = {};
    update();
  };

  buildTools();
  syncControls();
  setChapter(CHAPTERS.length - 1); // the lab opens in free play, with do re mi fa loaded
  PRESETS[2][1]();
  update();
}
