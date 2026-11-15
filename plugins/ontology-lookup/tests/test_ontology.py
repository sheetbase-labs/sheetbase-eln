import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent.parent / "sdks" / "plugin-python" / "src"))
sys.path.insert(0, str(ROOT / "python"))

import ontology  # noqa: E402
from sheetbase_plugin import PluginError  # noqa: E402


class Answer:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_search_decodes_terms_and_drops_repeats(monkeypatch):
    seen = []
    docs = [
        {"iri": "http://purl.obolibrary.org/obo/CHEBI_26710", "label": "sodium chloride", "ontology_name": "CHEBI", "short_form": "CHEBI_26710", "description": ["An ionic compound."]},
        {"iri": "http://purl.obolibrary.org/obo/CHEBI_26710", "label": "sodium chloride", "ontology_name": "CHEBI"},
        {"iri": "javascript:alert(1)", "label": "bad"},
    ]
    monkeypatch.setattr(ontology.urllib.request, "urlopen", lambda url, timeout=None: seen.append(url) or Answer({"response": {"docs": docs}}))
    out = ontology.search({"query": "sodium chloride", "ontologies": "chebi,nope"})
    assert "ontology=chebi" in seen[0]
    assert out["count"] == 1 and out["terms"][0]["ontology"] == "chebi"
    assert out["terms"][0]["description"] == "An ionic compound."


def test_a_short_query_is_refused():
    with pytest.raises(PluginError):
        ontology.search({"query": "a"})
