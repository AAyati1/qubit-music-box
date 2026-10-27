"""Checks for the Qiskit side. Run locally with:  python -m pytest tests
(Qollab runs main.js, not these tests.)"""
import json
import math
import os
import sys

import numpy as np
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import Statevector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from musicbox import circuit, engine  # noqa: E402

H = lambda q: [q, "H", 0]
X = lambda q: [q, "X", 0]

# do re mi fa: two time qubits in superposition, each copied onto a note qubit
DO_RE_MI_FA = {"T": 2, "N": 2, "K": 0, "start": {"k": "b", "v": 0}, "step": 1, "dial": 1,
               "cols": [{"ctrls": [], "gates": [H(0), H(1)], "u": -1},
                        {"ctrls": [[0, 1]], "gates": [X(2)], "u": -1},
                        {"ctrls": [[1, 1]], "gates": [X(3)], "u": -1}]}
DRONE = {**DO_RE_MI_FA, "cols": DO_RE_MI_FA["cols"][:1]}


def probs(spec):
    return Statevector.from_instruction(circuit.build(spec)).probabilities()


def test_melody_is_beat_note_pairs():
    p = probs(DO_RE_MI_FA)
    for t in range(4):                      # index = t + 4 * note: beat t plays note t
        assert math.isclose(p[t + 4 * t], 0.25)


def test_melody_is_entangled_and_drone_is_not():
    assert math.isclose(json.loads(engine.exact_state(json.dumps(DO_RE_MI_FA)))["ent_time"], 2.0)
    assert json.loads(engine.exact_state(json.dumps(DRONE)))["ent_time"] < 1e-9


def test_dial_zero_removes_links():
    p = probs({**DO_RE_MI_FA, "dial": 0})
    assert math.isclose(sum(p[t] for t in range(4)), 1.0)   # every beat plays do


def test_step_up_box_is_phase_estimation_history():
    # QPE first half: H on time, U^(2^k) on time qubit k. Beat t plays note t (step 1).
    spec = {"T": 2, "N": 2, "K": 0, "start": {"k": "b", "v": 0}, "step": 1, "dial": 1,
            "cols": [{"ctrls": [], "gates": [H(0), H(1)], "u": -1},
                     {"ctrls": [], "gates": [], "u": 0}, {"ctrls": [], "gates": [], "u": 1}]}
    p = probs(spec)
    assert all(math.isclose(p[t + 4 * t], 0.25) for t in range(4))


def test_two_lens_run_detects_entanglement_but_not_in_the_classical_copy():
    be = BasicSimulator()
    real = json.loads(engine.run_two_lens(be, json.dumps(DO_RE_MI_FA), 1000))
    copy = json.loads(engine.run_two_lens(be, json.dumps(DO_RE_MI_FA), 1000, True))
    assert real["proven"] and real["corr_hadamard"] > 1.9
    assert not copy["proven"] and copy["corr_hadamard"] < 0.1
    assert sum(real["normal"].values()) == 1000 == sum(real["hadamard"].values())


def test_no_verdict_without_enough_shots():
    # 4 music qubits -> 16 outcomes -> at least 160 shots needed
    few = json.loads(engine.run_two_lens(BasicSimulator(), json.dumps(DO_RE_MI_FA), 100))
    assert not few["enough_shots"] and not few["proven"] and few["min_shots"] == 160


def test_plan_counts_scratch_qubits_and_shots():
    p = json.loads(engine.plan_two_lens(BasicSimulator(), json.dumps(DO_RE_MI_FA), 100))
    assert p["qubits"] == 2 * 4 + 2 and not p["enough_shots"] and p["min_shots"] == 160
    p = json.loads(engine.plan_two_lens(None, json.dumps(DO_RE_MI_FA), 1000, True))
    assert p["qubits"] == 2 * (4 + 2) + 2 and p["fits"] and p["enough_shots"]
