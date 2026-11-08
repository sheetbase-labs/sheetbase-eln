"""The Python sequence maths gives the same answers as the TypeScript.

``test-vectors/vectors.json`` is written by running the TypeScript tool
(``bun plugins/sequence-tools/test-vectors/generate.ts``); the TypeScript test replays
the same file. Numbers match to 1e-9 (the two languages' maths libraries can differ
in the last bit); everything else matches exactly.
"""
import json
import math
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

from molbio import tools  # noqa: E402

CASES = json.loads((ROOT / "test-vectors" / "vectors.json").read_text())
RUNNABLE = [c for c in CASES if "expected" in c]


def same(want, got, path="result"):
    if isinstance(want, bool) or want is None or isinstance(want, str):
        assert got == want, path
    elif isinstance(want, (int, float)):
        assert isinstance(got, (int, float)) and not isinstance(got, bool), f"{path}: {got!r}"
        assert math.isclose(want, got, rel_tol=1e-9, abs_tol=1e-9), f"{path}: {want} != {got}"
    elif isinstance(want, list):
        assert isinstance(got, list) and len(got) == len(want), f"{path}: length {len(got)} != {len(want)}"
        for i, (w, g) in enumerate(zip(want, got)):
            same(w, g, f"{path}[{i}]")
    elif isinstance(want, dict):
        assert isinstance(got, dict) and set(got) == set(want), f"{path}: keys {sorted(got)} != {sorted(want)}"
        for k in want:
            same(want[k], got[k], f"{path}.{k}")
    else:
        raise AssertionError(f"{path}: unexpected {want!r}")


@pytest.mark.parametrize("case", RUNNABLE, ids=[c["name"] for c in RUNNABLE])
def test_matches_the_typescript(case):
    got = tools.run(case["input"])
    assert got["ok"] == case["expected"]["ok"]
    same(case["expected"]["result"], got["result"])


def test_every_action_is_covered():
    actions = {c["input"]["action"] for c in RUNNABLE if c["expected"]["ok"]}
    assert actions == set(tools._ACTIONS)


FINGERPRINTS = json.loads((ROOT / "test-vectors" / "fingerprints.json").read_text())


@pytest.mark.parametrize("case", FINGERPRINTS, ids=[str(i) for i in range(len(FINGERPRINTS))])
def test_fingerprint_matches_the_app(case):
    from molbio.fingerprint import canonical_sequence, sequence_fingerprint

    i = case["input"]
    assert canonical_sequence(i["residues"], i["molecule"], i["topology"]) == case["canonical"]
    assert sequence_fingerprint(i["residues"], i["molecule"], i["topology"]) == case["fingerprint"]
