"""Functions main.js calls. Inputs and outputs are JSON strings, so nothing depends on
how Python objects are converted to JavaScript."""
import json
import math
from functools import lru_cache

import numpy as np

import qiskit
from qiskit import transpile
from qiskit.quantum_info import Statevector, entropy, partial_trace

from . import circuit

# Empirical guardrails for the shot-based verdict (tested by simulation, not proven):
MIN_SHOTS_PER_OUTCOME = 10  # below this, shot-based mutual information is too biased for a verdict
VERDICT_MARGIN = 0.02       # bits the lower bound must clear the limit by; separable states that sit
                            # exactly on the limit can produce lower bounds of 3.00 against a limit of 3


def _register_entropy(state, keep, n):
    """Von Neumann entropy (bits) of the qubits in `keep`: the entanglement between them
    and the rest of the music qubits."""
    if not keep or len(keep) == n:
        return 0.0
    traced = [q for q in range(n) if q not in keep]
    return float(entropy(partial_trace(state, traced), base=2))


@lru_cache(maxsize=32)
def _state(spec_json):
    """Circuit and exact statevector for a spec, cached: the notebook asks for the same circuit's
    state, then for shots of it, many times."""
    qc = circuit.build(json.loads(spec_json))
    return qc, Statevector.from_instruction(qc)


def exact_state(spec_json):
    """Exact statevector of the circuit, from Qiskit, plus entanglement entropies."""
    spec = json.loads(spec_json)
    T, N, K = spec["T"], spec["N"], spec["K"]
    n = T + N + K
    qc, state = _state(spec_json)
    amps = state.data
    return json.dumps({
        "qiskit": qiskit.__version__,
        "re": [float(a.real) for a in amps],
        "im": [float(a.imag) for a in amps],
        "ent_time": _register_entropy(state, list(range(T)), n),
        "ent_inst": _register_entropy(state, list(range(T + N, n)), n) if K else 0.0,
        "gates": int(sum(qc.count_ops().values())),
        "drawing": str(qc.draw(output="text", fold=-1)),
    })


def sample_counts(spec_json, shots=1000, seed=None):
    """Measure the circuit `shots` times, as an ideal simulator would: Qiskit samples outcomes
    from the exact statevector. No backend job is used. Returns counts keyed by outcome index."""
    _, exact = _state(spec_json)
    state = exact.copy()
    if seed is not None:
        state.seed(int(seed))
    counts = state.sample_counts(int(shots))
    return json.dumps({"shots": int(shots), "counts": {str(int(k, 2)): int(v) for k, v in counts.items()}})


def compiled_cost(spec_json):
    """Exact CNOT count and depth after Qiskit's transpiler (basis cx + u), with two scratch qubits."""
    qc = circuit.with_scratch(circuit.build(json.loads(spec_json)))
    tq = transpile(qc, basis_gates=["cx", "u"], optimization_level=1, seed_transpiler=7)
    return json.dumps({"cx": int(tq.count_ops().get("cx", 0)), "depth": int(tq.depth())})


def _mi_from_array(cnt, B):
    """Plug-in mutual information (bits) between time (index % B) and the rest (index // B)."""
    total = cnt.sum()
    joint = cnt.reshape(-1, B) / total               # rows: rest, columns: time
    pt, pr = joint.sum(axis=0), joint.sum(axis=1)
    nz = joint > 0
    return float((joint[nz] * np.log2(joint[nz] / np.outer(pr, pt)[nz])).sum())


def _mi_with_error(counts, T, n, rng, resamples=300):
    """Mutual information from shots with a bias-corrected bootstrap.

    Shot noise makes the plug-in estimate too high, most of all when shots are spread over
    many outcomes. The bootstrap estimates that bias (mean of resamples minus the estimate)
    and its spread. Returns (corrected estimate, standard error, resampled corrected values)."""
    cnt = np.zeros(1 << n)
    for x, c in counts.items():
        cnt[x] = c
    raw = _mi_from_array(cnt, 1 << T)
    total = int(cnt.sum())
    boots = np.array([_mi_from_array(rng.multinomial(total, cnt / total).astype(float), 1 << T)
                      for _ in range(resamples)])
    corrected = 2 * raw - boots.mean()
    return corrected, float(boots.std()), corrected - (boots - boots.mean())


SCRATCH_QUBITS = 2  # idle qubits added for the compiler (see circuit.with_scratch)


def _capacity(backend):
    """Number of qubits the selected backend accepts, or None if it does not say."""
    for get in (lambda b: b.num_qubits, lambda b: b.configuration().n_qubits, lambda b: b.target.num_qubits):
        try:
            n = get(backend)
            if n:
                return int(n)
        except Exception:
            pass
    return None


def plan_two_lens(backend, spec_json, shots=1000, recorder=False):
    """What a two-lens run would need, before sending anything: qubits (two copies, the recorder
    if any, and the scratch qubits), the backend's capacity, and the shots needed for a verdict."""
    spec = json.loads(spec_json)
    T, N, K = spec["T"], spec["N"], spec["K"]
    n = T + N + K
    width = 2 * (n + (T if recorder else 0)) + SCRATCH_QUBITS
    cap = _capacity(backend) if backend is not None else None
    needed = MIN_SHOTS_PER_OUTCOME * (1 << n)
    return json.dumps({"qubits": width, "capacity": cap, "fits": cap is None or width <= cap,
                       "min_shots": needed, "enough_shots": int(shots) >= needed})


def run_two_lens(backend, spec_json, shots=1000, recorder=False):
    """Run ONE job on the selected backend: two copies of the song, one through each lens.
    Returns the counts for each lens (keyed by outcome index) and the entanglement test.

    The verdict is "proven" only if (1) there are at least MIN_SHOTS_PER_OUTCOME shots per
    possible outcome, and (2) the bootstrap 95% lower bound on (normal + Hadamard correlation)
    beats the limit by VERDICT_MARGIN. Both are empirical guardrails. Rule (1) matters: with too few shots the correlation bias is larger than
    the bootstrap can correct (200 shots of the 9-qubit Canon were "proven" in every simulated
    run although its exact total is below the limit). The bound is an estimate, not a proof."""
    spec = json.loads(spec_json)
    T, N, K = spec["T"], spec["N"], spec["K"]
    n = T + N + K
    qc = circuit.with_scratch(circuit.two_lens(spec, bool(recorder)), SCRATCH_QUBITS)
    cap = _capacity(backend)
    if cap is not None and qc.num_qubits > cap:
        return json.dumps({"error": f"needs {qc.num_qubits} qubits, but this backend has {cap}"})
    tq = transpile(qc, backend=backend, optimization_level=1, seed_transpiler=7)
    job = backend.run(tq, shots=int(shots))
    raw = job.result().get_counts()
    normal, hadamard = {}, {}
    for bits, c in raw.items():
        v = int(bits.replace(" ", ""), 2)           # Qiskit strings: highest classical bit first
        a, b = v & ((1 << n) - 1), v >> n
        normal[a] = normal.get(a, 0) + c
        hadamard[b] = hadamard.get(b, 0) + c
    rng = np.random.default_rng(7)
    iz, ez, bz = _mi_with_error(normal, T, n, rng)
    ix, ex, bx = _mi_with_error(hadamard, T, n, rng)
    total = bz + bx
    low = float(np.percentile(total, 2.5))
    bound = min(T, N + K)
    needed = MIN_SHOTS_PER_OUTCOME * (1 << n)
    return json.dumps({
        "backend": str(getattr(backend, "name", backend)),
        "shots": int(shots),
        "qubits": qc.num_qubits,
        # instructions acting on two or more qubits after compiling for this backend (not an exact
        # count of native two-qubit gates: simulators may keep
        # multi-controlled gates whole; hardware backends break them into native two-qubit gates)
        "compiled_2q": int(sum(1 for inst in tq.data if inst.operation.num_qubits >= 2 and inst.operation.name != "barrier")),
        "normal": {str(k): v for k, v in normal.items()},
        "hadamard": {str(k): v for k, v in hadamard.items()},
        "corr_normal": max(0.0, iz), "corr_hadamard": max(0.0, ix),
        "err": float(np.hypot(ez, ex)), "low95": low, "bound": bound,
        "min_shots": needed, "enough_shots": int(shots) >= needed,
        "proven": bool(int(shots) >= needed and low > bound + VERDICT_MARGIN),
    })
