"""Build Qiskit circuits for the Music Box from the editor's JSON spec.

Qubit layout (qubit 0 is the lowest bit, as in Qiskit):
    time qubits        0 .. T-1          the beat number
    note qubits        T .. T+N-1        the note (scale degree)
    instrument qubits  T+N .. T+N+K-1    which instrument plays

The spec is a dict:
    {"T": 2, "N": 2, "K": 0,
     "start": {"k": "b" | "e", "v": int},   basis note, or eigen-chord v of U
     "step": int,                            U adds `step` to the note number
     "dial": float in [0, 1],                link strength for controlled gates
     "cols": [{"ctrls": [[qubit, 0|1], ...],
               "gates": [[qubit, "H"|"X"|"Z"|"S"|"SDG"|"T"|"RY", angle_deg], ...],
               "u": time_qubit or -1}, ...]}
"""
import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit.library import (HGate, PhaseGate, QFTGate, RYGate, SdgGate,
                                    SGate, TGate, XGate, ZGate)

_FIXED = {"H": HGate, "X": XGate, "Z": ZGate, "S": SGate, "SDG": SdgGate, "T": TGate}


def n_qubits(spec):
    return spec["T"] + spec["N"] + spec["K"]


def _ctrl_state(ctrls):
    """Qiskit ctrl_state: bit i is the value control i must have."""
    return sum(v << i for i, (_, v) in enumerate(ctrls))


def _gate(kind, angle, dial, controlled):
    """The single-qubit gate for one cell. Controlled gates follow the link-strength dial:
    at dial d, X becomes RY(180 d), RY(a) becomes RY(a d), Z/S/T become phase gates
    and H becomes H^d. Uncontrolled gates are always applied in full."""
    d = float(dial)
    if not controlled or d >= 0.999:
        return RYGate(np.deg2rad(angle)) if kind == "RY" else _FIXED[kind]()
    if kind == "X":
        return RYGate(np.deg2rad(180 * d))
    if kind == "RY":
        return RYGate(np.deg2rad(angle * d))
    if kind == "Z":
        return PhaseGate(np.pi * d)
    if kind == "S":
        return PhaseGate(np.pi / 2 * d)
    if kind == "SDG":
        return PhaseGate(-np.pi / 2 * d)
    if kind == "T":
        return PhaseGate(np.pi / 4 * d)
    if kind == "H":
        return HGate().power(d)
    raise ValueError(f"unknown gate {kind}")


def _add_step_up(qc, spec, ctrls, u_row):
    """Controlled-U^(2^u_row): add step * 2^u_row to the note register (mod 2^N),
    written as a cascade of multi-controlled X gates (ripple increment)."""
    T, N = spec["T"], spec["N"]
    shift = (spec["step"] * (1 << u_row)) % (1 << N)
    for j in range(N):
        if not (shift >> j) & 1:
            continue
        for b in range(N - 1, j - 1, -1):          # add 2^j: flip bit b if bits j..b-1 are all 1
            cl = list(ctrls) + [[u_row, 1]] + [[T + q, 1] for q in range(j, b)]
            qc.append(XGate().control(len(cl), ctrl_state=_ctrl_state(cl)),
                      [q for q, _ in cl] + [T + b])


def build(spec, recorder=False):
    """The Music Box circuit (no measurement). With recorder=True, T extra qubits copy the
    beat number with CNOTs: the 'classical copy', a decohered version of the same song."""
    T, N = spec["T"], spec["N"]
    n = n_qubits(spec)
    qc = QuantumCircuit(n + (T if recorder else 0), name="music_box")
    start = spec.get("start", {"k": "b", "v": 0})
    for i in range(N):
        if (start["v"] >> i) & 1:
            qc.x(T + i)
    if start["k"] == "e":                           # eigen-chord: inverse QFT of |v> on the notes
        qc.append(QFTGate(N).inverse(), list(range(T, T + N)))
    dial = spec.get("dial", 1.0)
    for col in spec["cols"]:
        ctrls = col.get("ctrls", [])
        if col.get("u", -1) >= 0:
            _add_step_up(qc, spec, ctrls, col["u"])
        for q, kind, angle in col.get("gates", []):
            g = _gate(kind, angle or 0, dial, bool(ctrls))
            if ctrls:
                qc.append(g.control(len(ctrls), ctrl_state=_ctrl_state(ctrls)),
                          [c for c, _ in ctrls] + [q])
            else:
                qc.append(g, [q])
    if recorder:
        for i in range(T):
            qc.cx(i, n + i)
    return qc


def with_scratch(qc, n=2):
    """Add n idle qubits. Qiskit's compiler can borrow them as scratch space when it breaks
    multi-controlled gates into CNOTs, which makes long songs much cheaper. They stay idle,
    so the music qubits' state is unchanged."""
    out = QuantumCircuit(qc.num_qubits + n, qc.num_clbits, name=qc.name)
    out.compose(qc, range(qc.num_qubits), range(qc.num_clbits), inplace=True)
    return out


def two_lens(spec, recorder=False):
    """One circuit holding two copies of the song, for backends that take one job per run.
    Copy A is measured as is (normal lens); copy B gets a Hadamard on every music qubit
    first (Hadamard lens). Classical bits 0..n-1 hold copy A, n..2n-1 copy B."""
    n = n_qubits(spec)
    one = build(spec, recorder)
    w = one.num_qubits
    qc = QuantumCircuit(2 * w, 2 * n, name="music_box_two_lens")
    qc.compose(one, range(w), inplace=True)
    qc.compose(one, range(w, 2 * w), inplace=True)
    qc.barrier()
    for q in range(n):
        qc.h(w + q)
    qc.measure(range(n), range(n))
    qc.measure(range(w, w + n), range(n, 2 * n))
    return qc
