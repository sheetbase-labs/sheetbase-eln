"""The protocols.io plugin's Python, against canned answers (no network)."""
import io
import json
import pathlib
import sys
import urllib.error

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent.parent / "sdks" / "plugin-python" / "src"))
sys.path.insert(0, str(ROOT / "python"))

import protocolsio  # noqa: E402
from sheetbase_plugin import PluginError  # noqa: E402

SETTINGS = {"_settings": {"token": "t0ken"}}


class Answer:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def serve(monkeypatch, body=None, status=None):
    seen = []

    def fake(request, timeout=None):
        seen.append(request)
        if status:
            raise urllib.error.HTTPError(request.full_url, status, "x", {}, io.BytesIO(json.dumps(body or {}).encode()))
        return Answer(body)

    monkeypatch.setattr(protocolsio.urllib.request, "urlopen", fake)
    return seen


PROTOCOL = {
    "payload": {
        "id": 7,
        "uri": "picogreen-dna-assay-abc",
        "title": "<p>PicoGreen DNA assay</p>",
        "doi": "dx.doi.org/10.17504/protocols.io.abc",
        "url": "https://www.protocols.io/view/picogreen-dna-assay-abc",
        "authors": [{"name": "A. Researcher"}],
        "description": "Quantify dsDNA.",
        "before_start": "Warm the dye.",
        "warning": "",
        "steps": [
            {"step": "Dilute the dye 1:200 in TE.", "section": "Prepare"},
            {"step": "<p>Add 100 &micro;L to each well.</p>", "section": "Prepare"},
            {"step": "", "section": None},
        ],
        "materials": [{"name": "Quant-iT PicoGreen", "sku": "P7589", "vendor": {"name": "Thermo Fisher"}}],
    }
}


def test_search_sends_the_token_and_returns_protocols(monkeypatch):
    seen = serve(monkeypatch, {"items": [PROTOCOL["payload"]]})
    out = protocolsio.search({"query": "picogreen", **SETTINGS})
    assert seen[0].get_header("Authorization") == "Bearer t0ken"
    assert "key=picogreen" in seen[0].full_url and "filter=public" in seen[0].full_url
    assert out["count"] == 1
    assert out["protocols"][0]["doi"] == "10.17504/protocols.io.abc"
    assert out["protocols"][0]["title"] == "PicoGreen DNA assay"


def test_search_without_a_token_says_where_to_set_it():
    with pytest.raises(PluginError, match="access token"):
        protocolsio.search({"query": "x"})


def test_a_rejected_token_is_explained(monkeypatch):
    serve(monkeypatch, {"status_code": 1218}, status=400)
    with pytest.raises(PluginError, match="did not accept"):
        protocolsio.search({"query": "x", **SETTINGS})


def test_read_numbers_the_steps_and_lists_reagents(monkeypatch):
    serve(monkeypatch, PROTOCOL)
    out = protocolsio.read({"protocol": "picogreen-dna-assay-abc", **SETTINGS})
    assert [s["number"] for s in out["steps"]] == [1, 2]
    assert out["steps"][1]["text"].startswith("Add 100")
    assert out["reagents"] == ["Quant-iT PicoGreen (Thermo Fisher, P7589)"]
    assert "Before you start: Warm the dye." in out["description"]


def test_read_refuses_an_odd_name():
    with pytest.raises(PluginError):
        protocolsio.read({"protocol": "a b", **SETTINGS})


def test_import_makes_a_protocol_with_the_lab_action(monkeypatch):
    serve(monkeypatch, PROTOCOL)
    calls = []

    def fake_host(name, arguments=None):
        calls.append((name, arguments))
        return {"record": {"identifier": "PRO-2026-0001"}, "steps": 2}

    monkeypatch.setattr(protocolsio, "host_call", fake_host)
    out = protocolsio.import_protocol({"protocol": "7", **SETTINGS})
    name, arguments = calls[0]
    assert name == "sheetbase.lab.act" and arguments["action"] == "import_protocol"
    args = arguments["arguments"]
    assert args["p_source"]["provider"] == "protocols.io"
    assert args["p_steps"][0] == {"text": "Dilute the dye 1:200 in TE.", "section": "Prepare"}
    assert out == {"identifier": "PRO-2026-0001", "title": "PicoGreen DNA assay", "steps": 2}
