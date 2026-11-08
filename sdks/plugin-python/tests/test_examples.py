"""The sample plugins do what their descriptions say, through the same host functions the app uses."""
import pathlib

import pytest

from sheetbase_plugin import PluginError, host
from sheetbase_plugin.package import read_folder

EXAMPLES = pathlib.Path(__file__).parent.parent / "examples"


def load(name):
    files = read_folder(EXAMPLES / name)
    host.install({k[len("python/"):]: v for k, v in files.items() if k.startswith("python/")})


def test_master_mix_and_its_refusals():
    load("bench-extras")
    assert host.call_operation("bench:master_mix", {"reactions": 24, "per_reaction": 20, "overage": 10}) == {
        "total": 528.0,
        "per_reaction_with_extra": 22.0,
    }
    with pytest.raises(PluginError):
        host.call_operation("bench:master_mix", {"reactions": 0, "per_reaction": 20})


def test_readings_check_passes_and_fails():
    load("bench-extras")
    ok = host.call_check("bench:readings_present", [{"reading": 1.0}, {"reading": 2.5}])
    assert ok[0]["status"] == "pass"
    bad = host.call_check("bench:readings_present", [{"reading": 1.0}, {"reading": None}, {"reading": -3}])
    assert bad[0] == {"status": "fail", "message": "1 missing, 1 below zero"}


def test_subtract_blank_step():
    load("bench-extras")
    rows = [
        {"label": "blank", "od": 0.1},
        {"label": "blank", "od": 0.3},
        {"label": "A1", "od": 1.2},
    ]
    out = host.call_step(
        "bench:subtract_blank",
        {"readings": rows},
        {"value_column": "od", "label_column": "label"},
    )
    assert [round(r["corrected"], 3) for r in out.to_dict("records")] == [-0.1, 0.1, 1.0]


def test_hook_answers_with_notes_only():
    load("bench-extras")
    answer = host.call_operation("bench:remind_on_release", {"event": {"name": "sample.released"}})
    assert list(answer) == ["notes"] and answer["notes"][0]["title"]


FASTA = ">one\nACGT\nACGT\n>two\nGGGG\n"


def test_fasta_round_trip_and_preview():
    load("sequence-files")
    rows = host.call_file_rows("fasta:read_rows", {"content": FASTA, "filename": "x.fasta"})
    assert rows.to_dict("records")[0] == {"name": "one", "length": 8, "sequence": "ACGTACGT"}
    written = host.call_export("fasta:write_file", rows.to_dict("records"), {"width": 4}, "text")
    assert written[0]["content"] == ">one\nACGT\nACGT\n>two\nGGGG\n"
    shown = host.call_file_value("fasta:preview", {"content": FASTA, "filename": "x.fasta"})
    assert shown[0]["rows"][1] == {"name": "two", "length": 4, "gc_percent": 100.0}


def test_importer_refuses_what_is_not_fasta():
    load("sequence-files")
    with pytest.raises(PluginError):
        host.call_file_rows("fasta:read_rows", {"content": "hello", "filename": "x.fasta"})


def test_sequence_key_is_strand_blind():
    load("sequence-files")
    forward = host.call_operation("fasta:sequence_key", {"sequence": "AACG"})
    reverse = host.call_operation("fasta:sequence_key", {"sequence": "cgtt"})
    other = host.call_operation("fasta:sequence_key", {"sequence": "AAAA"})
    assert forward == reverse and forward != other


def test_loose_identifier_search_and_pubchem_plan():
    load("lookup-tools")
    docs = [
        {"id": "1", "type": "record", "title": "Western blot", "text": "", "fields": {"identifier": "EXP-0145"}},
        {"id": "2", "type": "record", "title": "Other", "text": "", "fields": {"identifier": "EXP-0200"}},
    ]
    hits = host.call_operation("lookup:search", {"query": "exp 145", "documents": docs})["hits"]
    assert [h["id"] for h in hits] == ["1"]
    plan = host.call_operation("lookup:plan_pubchem", {"parameters": {"compound": "aspirin"}, "settings": {}})
    assert plan["requests"][0]["url"].startswith("https://pubchem.ncbi.nlm.nih.gov/")
    parsed = host.call_rows(
        "lookup:parse_pubchem",
        {
            "responses": [
                {
                    "status": 200,
                    "json": {"PropertyTable": {"Properties": [{"CID": 2244, "MolecularFormula": "C9H8O4", "MolecularWeight": "180.16", "CanonicalSMILES": "CC(=O)OC1=CC=CC=C1C(=O)O"}]}},
                }
            ],
            "parameters": {},
        },
    )
    assert parsed.to_dict("records")[0]["formula"] == "C9H8O4"
