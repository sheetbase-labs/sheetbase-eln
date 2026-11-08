"""The Sequence tools operations: what the assistant, MCP, the API and pipelines call.

Each is a thin wrapper over ``molbio.tools`` (the maths, tested against the
TypeScript in the screen bundle) that takes and gives snake_case names.
"""
import re

from sheetbase_plugin import PluginError

from molbio import tools
from molbio.fingerprint import canonical_sequence, sequence_fingerprint, sequence_key_from


def _camel(name):
    head, *rest = name.split("_")
    return head + "".join(w.capitalize() for w in rest)


def _snake(name):
    return re.sub(r"(?<=[a-z0-9])([A-Z])", lambda m: "_" + m.group(1).lower(), name)


def _snake_keys(value):
    if isinstance(value, dict):
        return {_snake(k): _snake_keys(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_snake_keys(v) for v in value]
    return value


def _run(action, values, wrap=None):
    data = {"action": action}
    for key, value in values.items():
        if value is not None:
            data[_camel(key)] = value
    out = tools.run(data)
    if not out["ok"]:
        raise PluginError(out["result"])
    result = out["result"]
    if wrap:
        result = {wrap: result}
    return _snake_keys(result)


def find_sites(values):
    return _run("sites", values)


def digest(values):
    return _run("digest", values)


def annotate(values):
    return _run("annotate", values, wrap="features")


def design_primers(values):
    return _run("primers", values, wrap="pairs")


def check_primer(values):
    return _run("check_primer", values)


def simulate_pcr(values):
    return _run("pcr", values, wrap="products")


def assemble(values):
    return _run("assemble", values)


def align(values):
    return _run("align", values)


def find_guides(values):
    return _run("crispr", values)


def optimise_codons(values):
    return _run("codon_optimise", values)


def check_read(values):
    return _run("check_read", values)


def fingerprint(values):
    residues = values["sequence"]
    molecule = values.get("molecule") or "dna"
    topology = values.get("topology") or "linear"
    return {
        "fingerprint": sequence_fingerprint(residues, molecule, topology),
        "length": len(canonical_sequence(residues, molecule, topology)),
    }


def sequence_key(values):
    """The registry same-thing rule: entries with the same key are the same sequence."""
    key = sequence_key_from(values)
    if key is None:
        raise PluginError("There is no sequence to check against the registry.")
    return {"key": key}


__all__ = [
    "find_sites", "digest", "annotate", "design_primers", "check_primer", "simulate_pcr",
    "assemble", "align", "find_guides", "optimise_codons", "check_read", "fingerprint",
    "sequence_key",
]
