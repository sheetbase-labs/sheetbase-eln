import json

from sheetbase_plugin.cli import run_operation
from sheetbase_plugin.package import check_package

MANIFEST = {
    "id": "acme.lookup",
    "name": "Lookup",
    "version": "1.0.0",
    "description": "Looks things up.",
    "provides": {
        "operations": [
            {
                "id": "search",
                "title": "Search",
                "description": "Searches.",
                "access": "read",
                "inputs": [{"name": "query", "type": "text", "required": True}],
                "outputs": [{"name": "token", "type": "text", "required": True}],
                "settings": [{"name": "token", "label": "Token", "secret": True, "required": True}],
                "run": "ops:search",
            }
        ]
    },
}

OPS = "def search(input):\n    return {\"token\": input[\"_settings\"][\"token\"]}\n"


def files(manifest=MANIFEST):
    return {"plugin.json": json.dumps(manifest), "python/ops.py": OPS}


def test_operation_settings_are_valid_and_reach_the_function():
    assert check_package(files()) == []
    assert run_operation(files(), "search", {"query": "x"}, {"token": "abc"}) == {"token": "abc"}


def test_operation_settings_need_a_secret_flag():
    bad = json.loads(json.dumps(MANIFEST))
    bad["provides"]["operations"][0]["settings"] = [{"name": "token", "label": "Token", "required": True}]
    assert check_package(files(bad))
