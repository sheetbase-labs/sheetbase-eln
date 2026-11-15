"""Tests for lab lookups: protocols, stock, templates and models."""
from sheetbase import SheetbaseClient
from sheetbase.resources.lookups import lots_on_hand, _protocol_content

from tests.conftest import BASE_URL, CREDENTIAL

PROTOCOL = "11111111-1111-4111-8111-111111111111"


def test_protocol_content_orders_steps_and_flattens_prose():
    content = _protocol_content(
        [
            {"type": "procedure_step", "payload": {"text": "Read", "stepNumber": 2}},
            {"type": "procedure_step", "payload": {"text": "Dilute", "stepNumber": 1}},
            {"type": "rich_text", "payload": {"doc": {"content": [{"content": [{"text": "Purpose"}]}]}}},
        ]
    )
    assert [s["text"] for s in content["steps"]] == ["Dilute", "Read"]
    assert content["text"] == ["Purpose"]


def test_latest_movement_of_each_lot_is_what_is_left():
    lots = lots_on_hand(
        [
            {"lot": "A", "resulting_quantity": 10, "created_at": "2026-01-01"},
            {"lot": "A", "resulting_quantity": 4, "created_at": "2026-02-01"},
            {"lot": "B", "resulting_quantity": 7, "created_at": "2026-01-15"},
        ]
    )
    assert {l["lot"]: l["quantity_left"] for l in lots} == {"A": 4, "B": 7}


def test_protocols_reads_steps_versions_and_links(mock_transport):
    mock_transport.get("/api/db/records").respond(
        200, json=[{"id": PROTOCOL, "kind": "protocol_template", "identifier": "PRT-1", "title": "PicoGreen assay", "status": "active"}]
    )
    mock_transport.get("/api/db/blocks").respond(
        200, json=[{"type": "procedure_step", "payload": {"text": "Dilute dye", "stepNumber": 1}}]
    )
    mock_transport.get("/api/db/protocol_versions").respond(200, json=[{"version": 2}])
    mock_transport.get("/api/db/record_links").respond(200, json=[{"target_identifier": "MAT-9"}])
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
        found = client.lookups.protocols("PicoGreen")
    assert found[0]["steps"] == [{"number": 1, "text": "Dilute dye"}]
    assert found[0]["linked_records"][0]["target_identifier"] == "MAT-9"


def test_stock_leaves_out_records_without_movements(mock_transport):
    mock_transport.get("/api/db/records").respond(
        200,
        json=[
            {"id": "r1", "kind": "material", "identifier": "MAT-1", "title": "PicoGreen dye"},
            {"id": "r2", "kind": "sample", "identifier": "SMP-1", "title": "PicoGreen plate"},
        ],
    )
    mock_transport.get("/api/db/reagent_movements").respond(
        200, json=[{"reagent_record_id": "r1", "lot": "A", "resulting_quantity": 4, "created_at": "2026-02-01"}]
    )
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
        items = client.lookups.stock("PicoGreen")
    assert [i["identifier"] for i in items] == ["MAT-1"]
