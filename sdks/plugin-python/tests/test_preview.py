import json
import pathlib
import urllib.request

from sheetbase_plugin import cli, preview

EXAMPLES = pathlib.Path(__file__).parent.parent / "examples"


def _get(server, path):
    port = server.server_address[1]
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as response:
        return response.read().decode(), dict(response.headers)


def _post(server, path, body):
    port = server.server_address[1]
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(), method="POST")
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def test_serves_the_index_the_page_and_the_sdk():
    server = preview.serve(str(EXAMPLES / "ui-counter"), port=0, once=True)
    try:
        page, _ = _get(server, "/")
        assert "Colony counter" in page
        html, headers = _get(server, "/ui/ui/counter.html")
        assert "sheetbase-ui.js" in html
        assert "connect-src 'none'" in headers["Content-Security-Policy"]
        sdk, _ = _get(server, "/ui/ui/sheetbase-ui.js")
        assert "window.sheetbase" in sdk
    finally:
        server.shutdown()


def test_runs_hooks_and_operations():
    server = preview.serve(str(EXAMPLES / "plate-tools"), port=0, once=True)
    try:
        answer = _post(server, "/api/hook", {"kind": "column", "id": "grade", "payload": {"rows": [{"viability": 95}]}})
        assert answer["result"]["values"] == ["Pass"] and answer["problems"] == []
        refused = _post(server, "/api/hook", {"kind": "row-action", "id": "inspect", "payload": {"rows": [{}, {}]}})
        assert refused["problems"]
    finally:
        server.shutdown()
    cell_count = preview.serve(str(EXAMPLES / "cell-count"), port=0, once=True)
    try:
        result = _post(cell_count, "/api/call", {"operation": "viability", "input": {"live": 92, "dead": 8}})
        assert result["output"]["viability"] == 92.0
    finally:
        cell_count.shutdown()


def test_try_checks_a_screen(capsys):
    folder = str(EXAMPLES / "dilution-block")
    payload = json.dumps({"context": {}, "state": None, "event": None})
    assert cli.main(["try", "block", "dilution", "--folder", folder, "--payload", payload]) == 0
    assert "Stock (mM)" in capsys.readouterr().out
