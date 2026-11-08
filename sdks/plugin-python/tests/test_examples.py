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


RECORD = {
    "id": None,
    "identifier": "EXP-1",
    "kind": "experiment",
    "title": "Titration of sodium chloride",
    "status": "draft",
    "tags": [],
    "properties": {},
    "custom_fields": {},
    "project_id": None,
}


def test_lab_rules_refuses_warns_and_fills_before_a_save():
    load("lab-rules")
    short = host.call_operation("rules:check_experiment", {"record": {**RECORD, "title": "ab"}})
    assert short == {"refuse": "Give the experiment a title of at least five characters."}
    answer = host.call_operation("rules:check_experiment", {"record": RECORD})
    assert answer["warn"].startswith("No protocol note")
    assert answer["set"] == {"tags": ["storage"]}
    clean = host.call_operation(
        "rules:check_experiment",
        {"record": {**RECORD, "tags": ["storage"], "custom_fields": {"protocol_note": "SOP-4"}}},
    )
    assert clean == {}


def test_lab_rules_summarises_and_asks_for_a_sign_off_after_a_save():
    load("lab-rules")
    answer = host.call_operation("rules:summarise", {"record": RECORD})
    assert answer["summary"] == "EXP-1: Titration of sodium chloride (draft)"
    assert answer["index"][0]["index"] == "summaries"
    asked = host.call_operation("rules:ask_for_review", {"record": RECORD})
    assert asked["sign_off"][0]["independent"] is True


def test_lab_rules_refuses_an_empty_upload_and_searches_its_index():
    load("lab-rules")
    assert host.call_operation("rules:check_upload", {"file": {"byte_size": 0, "content": ""}}) == {
        "refuse": "That file is empty."
    }
    assert host.call_operation("rules:check_upload", {"file": {"byte_size": 4, "content": "text"}}) == {}
    assert host.call_operation("rules:search", {"query": "titration", "documents": []}) == {
        "hits": [],
        "nearest": {"index": "summaries", "text": "titration"},
    }


def test_acme_reader_reads_wells_and_refuses_other_files():
    load("lab-inventory")
    text = "Acme PlateReader 3000\nRead time: 2026-11-08 09:00\nWell,Sample,OD450\nA1,SMP-1,0.42\nA2,SMP-2,\n"
    rows = host.call_file_rows("reader:read_rows", {"content": text, "filename": "run.csv", "encoding": "text"}).to_dict("records")
    assert [(r["well"], r["sample"], r["od450"]) for r in rows] == [("A1", "SMP-1", 0.42), ("A2", "SMP-2", None)]
    assert rows[0]["read_time"] == "2026-11-08 09:00"
    with pytest.raises(PluginError):
        host.call_file_rows("reader:read_rows", {"content": "a,b\n1,2\n", "filename": "x.csv", "encoding": "text"})


def test_code39_is_drawn_and_read_back():
    load("lab-inventory")
    bits = host.call_operation("labels:code39_modules", {"value": "smp-1"})["modules"]
    assert set(bits) == {"0", "1"} and bits.startswith("1") and bits.endswith("1")
    # start + 5 characters + stop = 7 characters of 5 bars and 4 spaces (3 wide), plus 6 gaps
    assert len(bits) == 7 * (6 + 3 * 3) + 6
    assert host.call_operation("labels:code39_value", {"text": "*smp-1*"}) == {"value": "SMP-1"}
    assert host.call_operation("labels:code39_value", {"text": "not a code!"}) == {"value": None}
    with pytest.raises(PluginError):
        host.call_operation("labels:code39_modules", {"value": "SMP/1"})


def test_cryo_label_lines():
    load("lab-inventory")
    out = host.call_operation(
        "labels:cryo_compact",
        {"record": {"identifier": "SMP-9", "sampleType": "Serum", "facts": {"lot": "L7", "condition": "-80 °C", "useBy": "2027-01-01"}}},
    )
    assert out["lines"] == [
        {"text": "SMP-9", "bold": True},
        {"text": "Serum · L7"},
        {"text": "-80 °C · use by 2027-01-01"},
    ]


def test_cold_chain_rule():
    load("lab-inventory")
    sample = {"identifier": "SMP-9", "properties": {"holdCondition": "-80 °C"}}
    warm = {"path": ["Lab", "Fridge"], "temperatureC": {"min": 2, "max": 8}}
    assert host.call_operation("storage:cold_chain", {"sample": sample, "to": warm})["status"] == "refuse"
    cold = {"path": ["Lab", "Ultra"], "temperatureC": {"min": -90, "max": -70}, "box": "Box 1", "capacity": 10, "held": 9}
    assert host.call_operation("storage:cold_chain", {"sample": sample, "to": cold})["status"] == "warn"
    roomy = {**cold, "held": 2}
    assert host.call_operation("storage:cold_chain", {"sample": sample, "to": roomy}) == {"status": "ok"}
