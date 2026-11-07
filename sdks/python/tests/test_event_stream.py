"""Tests for the replayable event stream resource."""
import json

import httpx
import pytest

from sheetbase import CursorExpiredError, SheetbaseClient

from tests.conftest import BASE_URL, CREDENTIAL


def client():
    return SheetbaseClient(BASE_URL, CREDENTIAL, ["admin:read"])


def cloud_event(seq):
    return {
        "specversion": "1.0",
        "id": f"id-{seq}",
        "type": "io.sheetbase.pipeline.run.reproduced",
        "sequence": str(seq),
        "data": {},
    }


def test_page_sends_cursor_and_types(mock_transport):
    route = mock_transport.get("/api/events/stream").respond(
        200, json={"events": [cloud_event(4)], "nextCursor": 4, "hasMore": False}
    )
    page = client().events.page(after=3, limit=50, types=["pipeline.run.reproduced"])
    assert page["nextCursor"] == 4
    url = route.calls[0].request.url
    assert url.params["after"] == "3"
    assert url.params["limit"] == "50"
    assert url.params["types"] == "pipeline.run.reproduced"


def test_pages_follow_has_more(mock_transport):
    mock_transport.get("/api/events/stream").mock(
        side_effect=[
            httpx.Response(200, json={"events": [cloud_event(1)], "nextCursor": 1, "hasMore": True}),
            httpx.Response(200, json={"events": [cloud_event(2)], "nextCursor": 2, "hasMore": False}),
        ]
    )
    seen = [e["sequence"] for page in client().events.pages() for e in page["events"]]
    assert seen == ["1", "2"]


def test_expired_cursor(mock_transport):
    mock_transport.get("/api/events/stream").respond(
        410, json={"error": {"code": "cursor_expired", "message": "too old", "earliest": 9}}
    )
    with pytest.raises(Exception) as caught:
        client().events.page(after=1)
    assert getattr(caught.value, "code", None) == "cursor_expired" or isinstance(
        caught.value, CursorExpiredError
    )


def test_stream_yields_events_and_resumes(mock_transport):
    body = "".join(
        f"id: {n}\nevent: pipeline.run.reproduced\ndata: {json.dumps(cloud_event(n))}\n\n"
        for n in (5, 6)
    )
    route = mock_transport.get("/api/events/stream").respond(
        200, content=body.encode(), headers={"content-type": "text/event-stream"}
    )
    stream = client().events.stream(after=4, reconnect_delay=0)
    got = [next(stream)["sequence"], next(stream)["sequence"]]
    assert got == ["5", "6"]
    assert route.calls[0].request.url.params["after"] == "4"
