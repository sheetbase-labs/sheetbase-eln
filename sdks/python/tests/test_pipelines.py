"""Tests for the Pipelines resource, step-source helpers and CLI."""
import json

import httpx
import pytest

from sheetbase import (
    AsyncSheetbaseClient,
    SheetbaseClient,
    apply_step_source,
    notebook_to_python,
    parse_requirements,
)
from sheetbase.cli import main
from sheetbase.errors import PermissionDeniedError

from tests.conftest import BASE_URL, CREDENTIAL

WS = "11111111-1111-4111-8111-111111111111"
DEF = "22222222-2222-4222-8222-222222222222"
CODE = "def transform(inputs, parameters):\n    return inputs['a']\n"
CONFIG = {
    "configVersion": 1,
    "pythonRuntime": "sha256:abc",
    "transform": {"language": "none", "statement": ""},
    "steps": [{"name": "clean", "language": "sql", "statement": "select 1"}],
}


def version(lifecycle, revision=3):
    return {
        "id": f"v-{lifecycle}",
        "lifecycle": lifecycle,
        "version": 2 if lifecycle == "draft" else 1,
        "revision": revision,
        "configuration": CONFIG,
    }


def client():
    return SheetbaseClient(BASE_URL, CREDENTIAL, ["pipelines:read", "pipelines:write"])


class TestReads:
    def test_queries_run_logs_with_order(self, mock_transport):
        route = mock_transport.get("/api/db/pipeline_run_logs").respond(200, json=[])
        with client() as c:
            c.pipelines.run_logs("r1")
        query = route.calls.last.request.url.params
        assert query["run_id"] == "eq.r1"
        assert query["order"] == "sequence.asc"

    def test_get_by_key_or_id(self, mock_transport):
        route = mock_transport.get("/api/db/pipeline_definitions").respond(200, json=[{"id": DEF}])
        with client() as c:
            assert c.pipelines.get("nightly") == {"id": DEF}
            assert route.calls.last.request.url.params["key"] == "eq.nightly"
            c.pipelines.get(DEF)
            assert route.calls.last.request.url.params["id"] == f"eq.{DEF}"

    def test_wait_for_run_polls_until_settled(self, mock_transport):
        mock_transport.get("/api/db/pipeline_runs").mock(
            side_effect=[
                httpx.Response(200, json=[{"id": "r1", "status": "running"}]),
                httpx.Response(200, json=[{"id": "r1", "status": "succeeded"}]),
            ]
        )
        with client() as c:
            assert c.pipelines.wait_for_run("r1", interval=0.001)["status"] == "succeeded"

    def test_wait_for_run_times_out(self, mock_transport):
        mock_transport.get("/api/db/pipeline_runs").respond(
            200, json=[{"id": "r1", "status": "running"}]
        )
        with client() as c:
            with pytest.raises(TimeoutError):
                c.pipelines.wait_for_run("r1", timeout=0.005, interval=0.01)


class TestTrigger:
    def test_uses_the_pipeline_secret_and_idempotency_key(self, mock_transport):
        route = mock_transport.post(f"/api/pipelines/webhook/{DEF}").respond(
            200, json={"runId": "r1", "status": "succeeded"}
        )
        with client() as c:
            result = c.pipelines.trigger(
                definition_id=DEF, webhook_token="secret", idempotency_key="b7", parameters={"n": 1}
            )
        request = route.calls.last.request
        assert result == {"runId": "r1", "status": "succeeded"}
        assert request.headers["authorization"] == "Bearer secret"
        assert request.headers["idempotency-key"] == "b7"
        assert json.loads(request.content) == {"parameters": {"n": 1}}
        assert mock_transport["token"].call_count == 0

    def test_failed_run_is_returned_and_refusal_raises(self, mock_transport):
        route = mock_transport.post(f"/api/pipelines/webhook/{DEF}")
        route.respond(422, json={"runId": "r2", "status": "failed"})
        with client() as c:
            assert c.pipelines.trigger(
                definition_id=DEF, webhook_token="t", idempotency_key="k"
            ) == {"runId": "r2", "status": "failed"}
            route.respond(403, json={"error": "The webhook could not start a run."})
            with pytest.raises(PermissionDeniedError):
                c.pipelines.trigger(definition_id=DEF, webhook_token="t", idempotency_key="k")


class TestStepSource:
    def test_replaces_transform_or_named_step(self):
        main_ = apply_step_source(CONFIG, CODE, requirements=["pandas==2.2.2"])
        assert main_["transform"] == {"language": "python", "statement": CODE}
        assert main_["pythonRequirements"] == ["pandas==2.2.2"]
        assert CONFIG["transform"]["language"] == "none"
        step = apply_step_source(CONFIG, CODE, step="clean")
        assert step["steps"][0] == {"name": "clean", "language": "python", "statement": CODE}

    def test_refuses_what_cannot_run(self):
        with pytest.raises(ValueError, match="empty"):
            apply_step_source(CONFIG, " ")
        with pytest.raises(ValueError, match="transform"):
            apply_step_source(CONFIG, "x = 1")
        with pytest.raises(ValueError, match="no step named"):
            apply_step_source(CONFIG, CODE, step="nope")

    def test_needs_a_runtime_pin_when_none_exists(self):
        bare = {**CONFIG, "pythonRuntime": None}
        with pytest.raises(ValueError, match="python_runtime"):
            apply_step_source(bare, CODE)
        assert apply_step_source(bare, CODE, python_runtime="sha256:def")["pythonRuntime"] == "sha256:def"

    def test_notebook_code_cells_only_magics_commented(self):
        text = notebook_to_python(
            {
                "cells": [
                    {"cell_type": "markdown", "source": ["# title"]},
                    {"cell_type": "code", "source": ["%matplotlib inline\n", "import pandas as pd"]},
                    {"cell_type": "code", "source": "def transform(inputs, parameters):\n    return []"},
                ]
            }
        )
        assert text == "# %matplotlib inline\nimport pandas as pd\n\ndef transform(inputs, parameters):\n    return []\n"
        with pytest.raises(ValueError):
            notebook_to_python({})

    def test_requirements_must_be_pinned(self):
        assert parse_requirements("# libs\npandas==2.2.2  # frames\n\nnumpy==1.26.4\n") == [
            "pandas==2.2.2",
            "numpy==1.26.4",
        ]
        with pytest.raises(ValueError):
            parse_requirements("pandas>=2")


class TestSyncStep:
    def test_updates_open_draft_with_its_revision(self, mock_transport):
        mock_transport.get("/api/db/pipeline_definition_versions").respond(
            200, json=[version("draft"), version("published")]
        )
        route = mock_transport.post("/api/db/rpc/update_pipeline_definition_version_draft").respond(
            200, json={"id": "v-draft"}
        )
        with client() as c:
            _, created = c.pipelines.sync_step(workspace_id=WS, definition_id=DEF, code=CODE)
        sent = json.loads(route.calls.last.request.content)
        assert created is False
        assert sent["p_version_id"] == "v-draft"
        assert sent["p_expected_revision"] == 3
        assert sent["p_configuration"]["transform"]["statement"] == CODE

    def test_starts_a_draft_when_none_is_open(self, mock_transport):
        mock_transport.get("/api/db/pipeline_definition_versions").respond(
            200, json=[version("published")]
        )
        route = mock_transport.post("/api/db/rpc/create_pipeline_definition_version").respond(
            200, json={"id": "new"}
        )
        with client() as c:
            _, created = c.pipelines.sync_step(workspace_id=WS, definition_id=DEF, code=CODE)
        assert created is True
        assert json.loads(route.calls.last.request.content)["p_definition_id"] == DEF


@pytest.mark.asyncio
async def test_async_client_triggers_and_syncs(mock_transport):
    mock_transport.post(f"/api/pipelines/webhook/{DEF}").respond(200, json={"runId": "r1", "status": "running"})
    mock_transport.get("/api/db/pipeline_definition_versions").respond(200, json=[version("published")])
    mock_transport.post("/api/db/rpc/create_pipeline_definition_version").respond(200, json={"id": "new"})
    async with AsyncSheetbaseClient(BASE_URL, CREDENTIAL, ["pipelines:write"]) as c:
        assert (await c.pipelines.trigger(definition_id=DEF, webhook_token="t", idempotency_key="k"))["runId"] == "r1"
        _, created = await c.pipelines.sync_step(workspace_id=WS, definition_id=DEF, code=CODE)
    assert created is True


class TestCli:
    def test_pushes_a_script_and_a_notebook(self, mock_transport, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("SHEETBASE_URL", BASE_URL)
        monkeypatch.setenv("SHEETBASE_CREDENTIAL", CREDENTIAL)
        mock_transport.get("/api/db/pipeline_definition_versions").respond(200, json=[version("published")])
        route = mock_transport.post("/api/db/rpc/create_pipeline_definition_version").respond(
            200, json=[{"version": 2}]
        )
        script = tmp_path / "a.py"
        script.write_text(CODE)
        assert main(["push-step", str(script), "--workspace", WS, "--pipeline", DEF]) == 0
        assert "Created draft version 2" in capsys.readouterr().out
        notebook = tmp_path / "a.ipynb"
        notebook.write_text(json.dumps({"cells": [{"cell_type": "code", "source": CODE}]}))
        assert main(["push-step", str(notebook), "--workspace", WS, "--pipeline", DEF]) == 0
        sent = json.loads(route.calls.last.request.content)
        assert sent["p_configuration"]["transform"]["statement"].startswith("def transform")

    def test_reports_problems_without_a_traceback(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("SHEETBASE_URL", BASE_URL)
        monkeypatch.setenv("SHEETBASE_CREDENTIAL", CREDENTIAL)
        bad = tmp_path / "bad.py"
        bad.write_text("x = 1\n")
        assert main(["push-step", str(bad), "--workspace", WS, "--pipeline", DEF]) == 1
        assert "transform" in capsys.readouterr().err
        monkeypatch.delenv("SHEETBASE_URL")
        assert main(["push-step", str(bad), "--workspace", WS, "--pipeline", DEF]) == 2
