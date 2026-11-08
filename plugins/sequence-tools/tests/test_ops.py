"""The operations load and run through the same host the app uses, and the manifest matches them."""
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent.parent / "sdks" / "plugin-python" / "src"))

from sheetbase_plugin import PluginError, host  # noqa: E402
from sheetbase_plugin.package import read_folder  # noqa: E402

MANIFEST = json.loads((ROOT / "plugin.json").read_text())
OPS = {o["id"]: o for o in MANIFEST["provides"]["operations"]}


@pytest.fixture(autouse=True)
def installed():
    files = read_folder(ROOT)
    host.install({k[len("python/"):]: v for k, v in files.items() if k.startswith("python/")})


def call(op, values):
    return host.call_operation(OPS[op]["run"], values)


def test_every_declared_output_is_given():
    plasmid = "ATGC" * 300
    samples = {
        "find-sites": {"sequence": plasmid},
        "digest": {"sequence": plasmid, "enzymes": ["EcoRI"]},
        "annotate": {"sequence": plasmid},
        "design-primers": {"sequence": plasmid, "start": 100, "end": 900},
        "check-primer": {"primer": "TCGTACAGGCTAACTGATCC"},
        "simulate-pcr": {"template": plasmid, "forward": plasmid[100:120], "reverse": "GATCGATCGATCGATCGATC"},
        "assemble": {"method": "gibson", "parts": [{"name": "a", "sequence": plasmid}]},
        "align": {"reference": plasmid[:200], "query": plasmid[:200], "mode": "global"},
        "find-guides": {"sequence": "AAAA" + "GACGTCAGCTAGCTAGGATC" + "TGG" + "CCCC", "topology": "linear"},
        "optimise-codons": {"sequence": "MKTAYIAKQRQ", "input": "protein", "host": "ecoli"},
        "check-read": {"expected": plasmid, "read": plasmid[100:400]},
        "fingerprint": {"sequence": "GATTACA"},
    }
    assert set(samples) == set(OPS)
    for op, values in samples.items():
        out = call(op, values)
        for field in OPS[op]["outputs"]:
            if field["required"]:
                assert field["name"] in out, f"{op} gives no {field['name']}"
        assert set(out) <= {f["name"] for f in OPS[op]["outputs"]}, op


def test_refusals_say_what_is_wrong():
    with pytest.raises(PluginError, match="must lie inside"):
        call("design-primers", {"sequence": "ACGT" * 50, "start": 10, "end": 5000})
    with pytest.raises(PluginError, match="Golden Gate needs an enzyme"):
        call("assemble", {"method": "golden_gate", "parts": [{"name": "a", "sequence": "ACGT" * 30}]})


def test_the_registry_key_is_the_fingerprint_registries_already_hold():
    held = "seq:" + "ab" * 32
    key = host.call_operation("ops:sequence_key", {"sequence_fingerprint": held})
    assert key == {"key": held}
    same = [
        host.call_operation("ops:sequence_key", {"sequence": seq})["key"]
        for seq in ("GATTACAGG", "cctgtaatc")  # the second is the reverse complement
    ]
    assert same[0] == same[1]


def test_manifest_snake_names():
    for op in OPS.values():
        for field in op["inputs"] + op["outputs"]:
            assert field["name"].islower() and "-" not in field["name"]
