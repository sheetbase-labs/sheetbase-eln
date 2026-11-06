"""The generated typed layer: tables, RPCs and the generator itself."""
from __future__ import annotations

import copy
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest

from sheetbase import UNSET, AsyncSheetbaseClient, SheetbaseClient
from sheetbase._generated import CONTRACT_VERSION, Rpc, Tables
from sheetbase._tables import build_params
from sheetbase._version import API_VERSION
from tests.conftest import BASE_URL, CREDENTIAL

SDK_ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = SDK_ROOT.parents[1] / "docs" / "api" / "openapi" / "external-api-v0.json"
SPEC: dict[str, Any] = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
METHODS = ("get", "head", "post", "patch", "delete")


def _load_generator() -> Any:
    spec = importlib.util.spec_from_file_location("sdk_generate", SDK_ROOT / "scripts" / "generate.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["sdk_generate"] = module
    spec.loader.exec_module(module)
    return module


generator = _load_generator()


def _tables() -> dict[str, set[str]]:
    return {
        path[len("/api/db/"):]: {m for m in item if m in METHODS}
        for path, item in SPEC["paths"].items()
        if path.startswith("/api/db/") and not path.startswith("/api/db/rpc/")
    }


def _rpcs() -> dict[str, dict[str, Any]]:
    out = {}
    for path, item in SPEC["paths"].items():
        if path.startswith("/api/db/rpc/"):
            body = item["post"]["requestBody"]["content"]["application/json"]["schema"]
            out[path.rsplit("/", 1)[-1]] = body
    return out


def client() -> SheetbaseClient:
    return SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read", "projects:write"])


# ── sync with the contract ──────────────────────────────────────────────


def test_committed_files_match_the_contract() -> None:
    assert generator.main(["--check"]) == 0, "run `pnpm sdk:generate`"


def test_contract_version_matches() -> None:
    assert CONTRACT_VERSION == SPEC["info"]["version"] == API_VERSION


def test_every_table_is_exposed_with_only_its_methods() -> None:
    tables = _tables()
    assert set(Tables.NAMES) == set(tables)
    with client() as c:
        for name, methods in tables.items():
            table = c.tables[name]
            assert table.name == name
            assert hasattr(table, "list") == ("get" in methods)
            assert hasattr(table, "count") == ("head" in methods or "get" in methods)
            assert hasattr(table, "insert") == ("post" in methods)
            assert hasattr(table, "update") == ("patch" in methods)
            assert hasattr(table, "delete") == ("delete" in methods)


def test_unknown_tables_fail_closed() -> None:
    with client() as c:
        with pytest.raises(KeyError):
            c.tables["users"]


def test_every_rpc_is_a_method_with_its_parameters() -> None:
    rpcs = _rpcs()
    assert set(Rpc.NAMES) == set(rpcs)
    for name, body in rpcs.items():
        method = getattr(Rpc, name)
        params = inspect.signature(method).parameters
        expected = {
            generator.ident(p[2:] if p.startswith("p_") else p) for p in body.get("properties", {})
        }
        assert set(params) - {"self"} == expected, name
        for wire in body.get("required", []):
            arg = generator.ident(wire[2:] if wire.startswith("p_") else wire)
            assert params[arg].default is inspect.Parameter.empty, f"{name}.{arg}"


def test_new_endpoints_show_up_when_the_contract_grows(tmp_path: Path) -> None:
    spec = copy.deepcopy(SPEC)
    spec["paths"]["/api/db/freezer_readings"] = copy.deepcopy(spec["paths"]["/api/db/folders"])
    spec["paths"]["/api/db/rpc/log_freezer_reading"] = {
        "post": {
            "summary": "Log a freezer reading",
            "x-sheetbase-scopes": ["equipment:write"],
            "requestBody": {
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "required": ["p_freezer_id", "p_celsius"],
                            "properties": {
                                "p_freezer_id": {"type": "string", "format": "uuid"},
                                "p_celsius": {"type": "number"},
                                "p_note": {"type": "string", "nullable": True},
                            },
                        }
                    }
                }
            },
            "responses": {"200": {"content": {"application/json": {"schema": {"type": "object"}}}}},
        }
    }
    files = generator.render(spec)
    assert "class FreezerReadingsTable(ReadableTable[FoldersRow])" in files["tables.py"]
    assert "self.freezer_readings = FreezerReadingsTable(transport)" in files["tables.py"]
    assert "def log_freezer_reading(" in files["rpc.py"]
    assert "        freezer_id: str,\n        celsius: float," in files["rpc.py"]
    assert "class _LogFreezerReadingParamsRequired(TypedDict):" in files["models.py"]

    spec_file = tmp_path / "spec.json"
    spec_file.write_text(json.dumps(spec))
    assert generator.main(["--check", "--spec", str(spec_file)]) == 1


# ── tables ──────────────────────────────────────────────────────────────


def test_where_builds_postgrest_filters() -> None:
    params = build_params(
        where={"status": "active", "archived_at": None, "kind": ["sample", "a b"], "pinned": True},
        filters={"created_at": "gte.2026-01-01"},
        select="id,title",
        order=["title.asc", "id.desc"],
        limit=10,
        offset=20,
    )
    assert params == {
        "status": "eq.active",
        "archived_at": "is.null",
        "kind": 'in.(sample,"a b")',
        "pinned": "eq.true",
        "created_at": "gte.2026-01-01",
        "select": "id,title",
        "order": "title.asc,id.desc",
        "limit": 10,
        "offset": 20,
    }


def test_table_list_sends_filters(mock_transport, project_row) -> None:
    route = mock_transport.get("/api/db/projects").respond(200, json=[project_row])
    with client() as c:
        rows = c.tables.projects.list(where={"status": "active"}, order="title.asc", limit=5)
    assert rows[0]["key"] == "lenti-purification"
    query = route.calls.last.request.url.params
    assert query["status"] == "eq.active"
    assert query["order"] == "title.asc"
    assert query["limit"] == "5"
    assert route.calls.last.request.headers["authorization"] == "Bearer fake-jwt-token"


def test_table_iter_pages_until_a_short_page(mock_transport, project_row) -> None:
    pages = [[project_row] * 2, [project_row] * 2, [project_row]]
    seen: list[tuple[str, str]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.params["limit"], request.url.params["offset"]))
        return httpx.Response(200, json=pages[len(seen) - 1])

    mock_transport.get("/api/db/records").mock(side_effect=respond)
    with client() as c:
        rows = list(c.tables.records.iter(where={"project_id": "p"}, page_size=2))
    assert len(rows) == 5
    assert seen == [("2", "0"), ("2", "2"), ("2", "4")]


def test_table_get_and_count(mock_transport, project_row) -> None:
    mock_transport.get("/api/db/projects").respond(200, json=[project_row])
    head = mock_transport.head("/api/db/projects").respond(
        200, headers={"Content-Range": "0-0/42"}
    )
    with client() as c:
        assert c.tables.projects.get(project_row["id"])["title"] == project_row["title"]
        assert c.tables.projects.count(where={"status": "active"}) == 42
    assert head.calls.last.request.headers["prefer"] == "count=exact"


def test_table_insert_and_update(mock_transport, project_row) -> None:
    post = mock_transport.post("/api/db/projects").respond(201, json=[project_row])
    patch = mock_transport.patch("/api/db/projects").respond(200, json=[project_row])
    with client() as c:
        created = c.tables.projects.insert(
            {"workspace_id": project_row["workspace_id"], "key": "k", "title": "T"}
        )
        updated = c.tables.projects.update({"title": "New"}, where={"id": project_row["id"]})
        with pytest.raises(ValueError):
            c.tables.projects.update({"title": "Everything"})
    assert created["id"] == project_row["id"]
    assert updated[0]["id"] == project_row["id"]
    assert post.calls.last.request.headers["prefer"] == "return=representation"
    assert json.loads(patch.calls.last.request.content) == {"title": "New"}
    assert patch.calls.last.request.url.params["id"] == f"eq.{project_row['id']}"


# ── rpc ─────────────────────────────────────────────────────────────────


def test_rpc_method_sends_prefixed_params_and_omits_unset(mock_transport) -> None:
    route = mock_transport.post("/api/db/rpc/search").respond(200, json=[])
    with client() as c:
        c.rpc.search(query="lenti", project_id=None, limit=5)
    assert json.loads(route.calls.last.request.content) == {
        "p_query": "lenti",
        "p_project_id": None,
        "p_limit": 5,
    }


def test_rpc_required_parameters(mock_transport, project_row) -> None:
    route = mock_transport.post("/api/db/rpc/create_project").respond(200, json=[project_row])
    with client() as c:
        result = c.rpc.create_project(title="Assay")
        with pytest.raises(TypeError):
            c.rpc.create_project()  # type: ignore[call-arg]
    assert json.loads(route.calls.last.request.content) == {"p_title": "Assay"}
    assert result == [project_row]


def test_rpc_stays_callable_for_raw_access(mock_transport) -> None:
    route = mock_transport.post("/api/db/rpc/search").respond(200, json=[])
    with client() as c:
        c.rpc("search", query="x", p_limit=3)
    assert json.loads(route.calls.last.request.content) == {"p_query": "x", "p_limit": 3}


def test_unset_is_falsy_and_singleton() -> None:
    from sheetbase._unset import Unset

    assert not UNSET
    assert Unset() is UNSET
    assert repr(UNSET) == "UNSET"


# ── async ───────────────────────────────────────────────────────────────


async def test_async_tables_and_rpc(mock_transport, project_row) -> None:
    pages = [[project_row, project_row], [project_row]]
    calls = {"n": 0}

    def respond(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=pages[calls["n"] - 1])

    mock_transport.get("/api/db/projects").mock(side_effect=respond)
    rpc = mock_transport.post("/api/db/rpc/create_project").respond(200, json=[project_row])
    async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as c:
        rows = [row async for row in c.tables.projects.iter(page_size=2)]
        await c.rpc.create_project(title="Async")
    assert len(rows) == 3
    assert json.loads(rpc.calls.last.request.content) == {"p_title": "Async"}
