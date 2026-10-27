// Circuits used in the notebook, written as specs for musicbox/circuit.py.
// Notes are scale degrees: 0 do, 1 re, 2 mi, 3 fa, 4 sol, 5 la, 6 ti, 7 do'.

export const NOTE_NAMES = ["do", "re", "mi", "fa", "sol", "la", "ti", "do′"];

const g = (q, kind, deg = 0) => [q, kind, deg];
const col = (gates, ctrls = [], u = -1) => ({ ctrls, gates, u });
const base = (T, N, K = 0, extra = {}) => ({ T, N, K, start: { k: "b", v: 0 }, step: 1, dial: 1, cols: [], ...extra });
const hTime = (T) => col([...Array(T).keys()].map((q) => g(q, "H")));

/** Lookup-table encoding: one column per beat, controlled on every time qubit. */
export function lookup(T, N, notes, K = 0) {
  const s = base(T, N, K);
  s.cols.push(hTime(T));
  notes.forEach((v, t) => {
    if (!v) return;
    const ctrls = [...Array(T).keys()].map((q) => [q, (t >> q) & 1]);
    const gates = [...Array(N).keys()].filter((k) => (v >> k) & 1).map((k) => g(T + k, "X"));
    s.cols.push(col(gates, ctrls));
  });
  return s;
}

/** Algebraic encoding: each note bit as an XOR of AND-terms of the input bits (its
 *  Reed-Muller form, found with a Moebius transform). fn(t, i) gives the note for beat t,
 *  instrument i. Inputs are the time qubits, then the instrument qubits. */
export function algebraic(T, N, fn, K = 0) {
  const s = base(T, N, K);
  s.cols.push(col([...[...Array(T).keys()], ...[...Array(K).keys()].map((j) => T + N + j)].map((q) => g(q, "H"))));
  const inQ = [...Array(T).keys(), ...[...Array(K).keys()].map((j) => T + N + j)], V = inQ.length, S = 1 << V, B = 1 << T;
  const terms = new Map();
  for (let k = 0; k < N; k++) {
    const f = [...Array(S).keys()].map((x) => (fn(x & (B - 1), x >> T) >> k) & 1);
    for (let b = 0; b < V; b++) for (let x = 0; x < S; x++) if ((x >> b) & 1) f[x] ^= f[x ^ (1 << b)];
    f.forEach((on, m) => { if (on) { if (!terms.has(m)) terms.set(m, []); terms.get(m).push(k); } });
  }
  const pc = (m) => m.toString(2).split("1").length - 1;
  for (const m of [...terms.keys()].sort((a, b) => pc(a) - pc(b) || a - b)) {
    const ctrls = inQ.filter((_, b) => (m >> b) & 1).map((q) => [q, 1]);
    s.cols.push(col(terms.get(m).map((k) => g(T + k, "X")), ctrls));
  }
  return s;
}

/** Beethoven, Für Elise (1810, public domain): the opening, in sixteenth notes.
 *  6 time qubits = 64 sixteenths, 4 note qubits index a chromatic pitch table, 1 voice qubit picks
 *  the right hand (0) or the left hand (1). Both hands sound at once from one 11-qubit state. */
export function furElise(lookupOnly = false) {
  // pitch table (MIDI numbers), low to high
  // Which key gets which 4-bit label is free, and it changes the cost. Index 0 is the rest (most
  // sixteenths are silent in one hand, and 0 needs no gates); the other labels were chosen by a
  // search (simulated annealing) that minimises the gates of the algebraic encoding: 2,454 CNOTs
  // instead of 3,728 for keys numbered low to high (both with two scratch qubits).
  const P = { E2: 6, A2: 10, E3: 3, "G#3": 5, A3: 13, C4: 7, E4: 15, "G#4": 9, A4: 11, B4: 8, C5: 1, D5: 12, "D#5": 14, E5: 4 }, R = 0;
  const pitches = [0, 72, 77, 52, 76, 56, 40, 60, 71, 68, 45, 69, 74, 57, 75, 64];
  const names = ["rest", "C5", "F5", "E3", "E5", "G♯3", "E2", "C4", "B4", "G♯4", "A2", "A4", "D5", "A3", "D♯5", "E4"];
  const bar = (rh, lh = "- - - - - -") => [rh.split(" "), lh.split(" ")];
  const bars = [
    bar("E5 D#5", "- -"),                                   // pick-up
    bar("E5 D#5 E5 B4 D5 C5"),                              // 1
    bar("A4 - - C4 E4 A4", "A2 E3 A3 - - -"),              // 2
    bar("B4 - - E4 G#4 B4", "E2 E3 G#3 - - -"),            // 3
    bar("C5 - - E4 E5 D#5", "A2 E3 A3 - - -"),             // 4
    bar("E5 D#5 E5 B4 D5 C5"),                              // 5
    bar("A4 - - C4 E4 A4", "A2 E3 A3 - - -"),              // 6
    bar("B4 - - E4 C5 B4", "E2 E3 G#3 - - -"),             // 7
    bar("A4 - - - E5 D#5", "A2 E3 A3 - - -"),              // 8, leading back to the start
    bar("E5 D#5 E5 B4 D5 C5"),                              // 9 (= 1)
    bar("A4 - - C4 E4 A4", "A2 E3 A3 - - -"),              // 10 (= 2)
    bar("- -", "- -"),                                      // breath before the loop
  ];
  const rh = bars.flatMap(([r]) => r), lh = bars.flatMap(([, l]) => l);
  const idx = (s) => (s === "-" ? R : P[s]);
  const score = [rh.map(idx), lh.map(idx)];                 // score[voice][sixteenth]
  if (score[0].length !== 64 || score[1].length !== 64) throw new Error("Für Elise must fill 64 sixteenths");
  const extra = { pitches, names, rest: R, voices: ["right hand", "left hand"], bpm: 240, sustain: 4 };
  return lookupOnly ? { ...lookupVoices(6, 4, 1, score), ...extra } : { ...algebraic(6, 4, (t, i) => score[i][t], 1), ...extra };
}

/** Lookup table with a voice register: one column per (voice, beat), controlled on all of them. */
function lookupVoices(T, N, K, score) {
  const s = base(T, N, K), inQ = [...Array(T).keys(), ...[...Array(K).keys()].map((j) => T + N + j)];
  s.cols.push(col(inQ.map((q) => g(q, "H"))));
  score.forEach((line, v) => line.forEach((val, t) => {
    if (!val) return;
    const ctrls = [...[...Array(T).keys()].map((q) => [q, (t >> q) & 1]), ...[...Array(K).keys()].map((j) => [T + N + j, (v >> j) & 1])];
    s.cols.push(col([...Array(N).keys()].filter((k) => (val >> k) & 1).map((k) => g(T + k, "X")), ctrls));
  }));
  return s;
}

const ODE = [2, 2, 3, 4, 4, 3, 2, 1, 0, 0, 1, 2, 2, 1, 1, 7];

export const SONGS = {
  silence: () => base(2, 2),
  drone: () => ({ ...base(2, 2), cols: [hTime(2)] }),
  chord: () => ({ ...base(2, 2), cols: [col([g(0, "H"), g(1, "H"), g(3, "H")])] }),
  allNotes: () => ({ ...base(2, 2), cols: [col([g(0, "H"), g(1, "H"), g(2, "H"), g(3, "H")])] }),
  doremifa: (dial = 1) => ({ ...base(2, 2, 0, { dial }), cols: [hTime(2), col([g(2, "X")], [[0, 1]]), col([g(3, "X")], [[1, 1]])] }),
  dodorefa: () => ({ ...base(2, 2), cols: [hTime(2), col([g(2, "X")], [[1, 1]]), col([g(3, "X")], [[0, 1], [1, 1]])] }),
  bell: () => ({ ...base(2, 2), cols: [hTime(2), col([g(2, "X")], [[0, 1]])] }),
  // the last note is a half note, so beat 16 is a rest (note 7)
  ode: (dial = 1) => ({ ...lookup(4, 3, ODE), dial, rest: 7 }),
  odeAlgebraic: () => ({ ...algebraic(4, 3, (t) => ODE[t]), rest: 7 }),
  qpeMelody: () => ({ ...base(2, 2), cols: [hTime(2), col([], [], 0), col([], [], 1)] }),
  // eigen-chord v of U = 1/2 sum_k (-i)^(v k) |k> = [(|0> + (-i)^v |1>)/sqrt2 on n0] x [(|0> + (-1)^v |1>)/sqrt2 on n1]:
  // Hadamards on the notes (alone they give eigen-chord 0), then a phase gate on each note qubit.
  eigenChord: (v = 1) => {
    const p0 = [null, "SDG", "Z", "S"][v], p1 = [null, "Z", null, "Z"][v];
    const phases = [p0 && g(2, p0), p1 && g(3, p1)].filter(Boolean);
    return { ...base(2, 2), cols: [col([g(2, "H"), g(3, "H")]), ...(phases.length ? [col(phases)] : []), hTime(2), col([], [], 0), col([], [], 1)] };
  },
  furElise: () => furElise(),
  furEliseLookup: () => furElise(true),
  canon: () => {
    // Pachelbel's Canon in C: C G Am Em F C F G, two beats per chord.
    const V = [
      [7, 7, 4, 4, 5, 5, 2, 2, 3, 3, 0, 0, 3, 3, 4, 4], // cello: the ground bass
      [2, 4, 1, 6, 0, 2, 4, 6, 3, 5, 2, 4, 5, 7, 1, 6], // viola: broken chords
      [4, 7, 6, 4, 5, 7, 6, 4, 5, 3, 4, 7, 7, 3, 6, 1], // flute: counter-melody
      [7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 3, 3, 4, 4], // violin: the canon theme
    ];
    // Binary labels for notes and instruments are free to choose. An exhaustive search over all
    // 8! x 4! labellings picked these (968 -> about 630 CNOTs); the music is unchanged.
    const noteLabel = [0, 1, 3, 2, 5, 4, 6, 7]; // scale degree -> 3-bit label
    const instMap = [0, 1, 3, 2];                // 2-bit label -> instrument (flute and violin swap)
    const noteMap = noteLabel.map((_, l) => noteLabel.indexOf(l)); // label -> scale degree
    return { ...algebraic(4, 3, (t, i) => noteLabel[V[instMap[i]][t]], 2), pal: "orch", bpm: 84, noteMap, instMap };
  },
};
