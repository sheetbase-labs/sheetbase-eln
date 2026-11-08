"""The chemistry plugin's Python: parent structures, the same-thing key and search."""
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent.parent / "sdks" / "plugin-python" / "src"))
sys.path.insert(0, str(ROOT / "python"))

pytest.importorskip("rdkit")

import chem  # noqa: E402
from sheetbase_plugin import PluginError  # noqa: E402

ASPIRIN = "CC(=O)Oc1ccccc1C(=O)O"
SODIUM_SALT = "CC(=O)Oc1ccccc1C(=O)[O-].[Na+]"


def molfile(smiles):
    return chem.describe({"structure": smiles})["molfile"]


def test_a_salt_has_the_same_key_as_the_free_acid():
    assert chem.parent_key({"structure": SODIUM_SALT}) == chem.parent_key({"structure": ASPIRIN})


def test_a_molfile_and_a_smiles_line_agree():
    assert chem.parent_key({"structure": molfile(ASPIRIN)}) == chem.parent_key({"structure": ASPIRIN})


def test_a_different_compound_has_a_different_key():
    assert chem.parent_key({"structure": "CCO"}) != chem.parent_key({"structure": ASPIRIN})


def test_describe_sets_the_salt_aside():
    out = chem.describe({"structure": SODIUM_SALT})
    assert out["formula"] == "C9H8O4"
    assert out["salts"]


def test_unreadable_input_is_refused_in_plain_words():
    with pytest.raises(PluginError):
        chem.parent_key({"structure": "not a structure"})


def documents():
    return [
        {"id": "aspirin", "fields": {"structure": molfile(ASPIRIN)}},
        {"id": "ethanol", "fields": {"structure": molfile("CCO")}},
        {"id": "note", "fields": {"title": "no structure here"}},
    ]


def test_substructure_finds_what_contains_it():
    hits = chem.search({"query": "sub:c1ccccc1", "documents": documents()})["hits"]
    assert [h["id"] for h in hits] == ["aspirin"]


def test_similarity_ranks_and_leaves_out_the_unlike():
    hits = chem.search({"query": f"sim:{ASPIRIN}", "documents": documents()})["hits"]
    assert [h["id"] for h in hits] == ["aspirin"]
    assert hits[0]["score"] == 1.0


def test_other_queries_are_not_this_provider_s():
    assert chem.search({"query": "aspirin", "documents": documents()}) == {"hits": []}
