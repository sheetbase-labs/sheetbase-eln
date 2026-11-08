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


def indexed(smiles):
    out = chem.index({"record": {"custom_fields": {"structure": molfile(smiles)}}})
    return out["index"][0]


def test_a_compound_without_a_structure_adds_nothing_to_the_index():
    assert chem.index({"record": {"custom_fields": {"title": "x"}}}) == {}


def test_the_index_entry_has_words_and_a_vector():
    entry = indexed(ASPIRIN)
    assert entry["index"] == "structures"
    assert entry["text"].startswith("p")
    assert len(entry["vector"]) == chem.SIMILARITY_BITS


def test_the_substructure_prefilter_never_loses_a_match():
    plan = chem.search({"query": "sub:c1ccccc1C(=O)O", "documents": [], "stage": "plan"})
    wanted = set(plan["nearest"]["text"].split())
    assert plan["nearest"]["verify"] is True
    for smiles in (ASPIRIN, SODIUM_SALT, "OC(=O)c1ccccc1", "CC(=O)Oc1ccccc1C(=O)OC"):
        assert wanted <= set(indexed(smiles)["text"].split()), smiles


def test_the_similarity_plan_asks_for_the_closest_by_vector():
    plan = chem.search({"query": f"sim:{ASPIRIN}", "documents": [], "stage": "plan"})
    assert len(plan["nearest"]["vector"]) == chem.SIMILARITY_BITS
    assert plan["nearest"]["verify"] is True


def test_the_plan_answers_a_query_that_is_not_ours_with_nothing():
    assert chem.search({"query": "aspirin", "documents": [], "stage": "plan"}) == {"hits": []}


def test_adding_a_lot_asks_the_app_twice_and_counts_the_lots():
    from sheetbase_plugin import host

    host.install({"chem.py": (ROOT / "python" / "chem.py").read_text()})
    try:
        first = host.call_operation("chem:add_lot", {"compound_id": "c1"})
        assert first["__host_calls__"][0]["arguments"]["action"] == "list_compound_lots"
        second = host.call_operation("chem:add_lot", {"compound_id": "c1", "__host__": [{"ok": True, "result": [{}, {}]}]})
        assert second["__host_calls__"][0]["arguments"] == {
            "action": "add_compound_lot",
            "arguments": {"p_compound_id": "c1"},
        }
        done = host.call_operation(
            "chem:add_lot",
            {"compound_id": "c1", "__host__": [{"ok": True, "result": [{}, {}]}, {"ok": True, "result": {"identifier": "LOT-0003"}}]},
        )
        assert done == {"identifier": "LOT-0003", "lots": 3}
    finally:
        host.install({})


def _run(operation, input, answers):
    from sheetbase_plugin import host

    host.install({"chem.py": (ROOT / "python" / "chem.py").read_text()})
    try:
        return host.call_operation(operation, {**input, "__host__": answers})
    finally:
        host.install({})


def test_find_asks_for_the_search_and_keeps_only_close_enough_compounds():
    hits = {
        "hits": [
            {"id": "a", "identifier": "CMP-1", "title": "Aspirin", "kind": "compound", "score": 0.9},
            {"id": "b", "identifier": "CMP-2", "title": "Other", "kind": "compound", "score": 0.55},
        ]
    }
    asked = _run("chem:find", {"structure": "CC(=O)Oc1ccccc1C(=O)O", "mode": "similarity"}, [])
    assert asked["__host_calls__"][0]["name"] == "sheetbase.plugin.search"
    assert asked["__host_calls__"][0]["arguments"]["query"].startswith("sim:")
    done = _run("chem:find", {"structure": "CC(=O)Oc1ccccc1C(=O)O", "mode": "similarity"}, [{"ok": True, "result": hits}])
    assert [c["identifier"] for c in done["compounds"]] == ["CMP-1"]
    assert done["compounds"][0]["similarity"] == 0.9


def test_check_looks_up_the_parent_without_its_salt():
    asked = _run("chem:check", {"structure": "CC(=O)Oc1ccccc1C(=O)O.[Na+].[Cl-]"}, [])
    call = asked["__host_calls__"][0]
    assert call["arguments"]["action"] == "registry_sameness_matches"
    assert call["arguments"]["arguments"] == {"p_model_key": "compound", "p_value": "CC(=O)Oc1ccccc1C(=O)O"}
    done = _run(
        "chem:check",
        {"structure": "CC(=O)Oc1ccccc1C(=O)O.[Na+].[Cl-]"},
        [{"ok": True, "result": [{"id": "a", "identifier": "CMP-1", "title": "Aspirin", "archived": False}]}],
    )
    assert done["registered"] is True and done["matches"][0]["identifier"] == "CMP-1"


def test_register_sends_the_molfile_and_the_parent_key_to_the_registry():
    asked = _run(
        "chem:register",
        {"structure": SODIUM_SALT, "name": "Aspirin sodium", "project_id": "p1"},
        [],
    )
    call = asked["__host_calls__"][0]["arguments"]
    assert call["action"] == "create_registry_entry"
    arguments = call["arguments"]
    assert arguments["p_kind"] == "compound"
    assert arguments["p_allow_duplicate"] is False
    assert arguments["p_sameness_value"] == chem.parent_key({"structure": ASPIRIN})["key"]
    assert "M  END" in arguments["p_custom_fields"]["structure"]
    done = _run(
        "chem:register",
        {"structure": ASPIRIN, "name": "Aspirin", "project_id": "p1"},
        [{"ok": True, "result": {"id": "e1", "identifier": "CMP-0001"}}],
    )
    assert done["identifier"] == "CMP-0001" and done["formula"] == "C9H8O4"
