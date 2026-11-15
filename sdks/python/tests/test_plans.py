"""Tests for plans: RPCs run in order, later steps using earlier results."""
import httpx
import pytest

from sheetbase import SheetbaseClient
from sheetbase.resources.plans import resolve_references

from tests.conftest import BASE_URL, CREDENTIAL

EXPERIMENT = "11111111-1111-4111-8111-111111111111"


def steps():
    return [
        {"key": "experiment", "rpc": "plan_experiment", "arguments": {"p_title": "A"}},
        {
            "key": "samples",
            "rpc": "log_samples",
            "arguments": {"p_experiment": {"$ref": "experiment.id"}},
        },
    ]


def test_resolves_references_anywhere():
    out = resolve_references(
        {"a": [{"$ref": "x.id"}], "b": 1}, {"x": {"id": EXPERIMENT}}
    )
    assert out == {"a": [EXPERIMENT], "b": 1}


def test_unknown_reference_is_an_error():
    with pytest.raises(ValueError):
        resolve_references({"$ref": "later.id"}, {})


def test_runs_in_order_and_feeds_results(mock_transport):
    first = mock_transport.post("/api/db/rpc/plan_experiment").respond(
        200, json={"id": EXPERIMENT}
    )
    second = mock_transport.post("/api/db/rpc/log_samples").respond(200, json={"ok": 1})
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["lab:write"]) as client:
        report = client.plans.run(steps())
    assert report["status"] == "done"
    assert first.called and second.called
    assert b"11111111" in second.calls[0].request.content


def test_stops_at_the_first_failure(mock_transport):
    mock_transport.post("/api/db/rpc/plan_experiment").respond(
        400, json={"message": "no"}
    )
    later = mock_transport.post("/api/db/rpc/log_samples").respond(200, json={})
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["lab:write"]) as client:
        report = client.plans.run(steps())
    assert report["status"] == "failed"
    assert [s["status"] for s in report["steps"]] == ["failed", "not_run"]
    assert not later.called


def test_refuses_a_single_step():
    with SheetbaseClient(BASE_URL, CREDENTIAL, ["lab:write"]) as client:
        with pytest.raises(ValueError):
            client.plans.run(steps()[:1])
