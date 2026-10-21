"""Pipelines: list them, trigger and watch runs, read logs and outputs, and save a Python step as a draft.

Reads need ``pipelines:read``. Saving a draft needs ``pipelines:write`` and a personal
token (the database refuses a service credential). A draft is not runnable until a
person publishes it.
"""

from __future__ import annotations

import re
import time
from typing import Any, Optional

from sheetbase._http import HttpTransport
from sheetbase._pipeline_source import apply_step_source, check_source

SETTLED = ("succeeded", "failed", "cancelled")
_UUID = re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE)


class PipelinesResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def list(self, *, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/pipeline_definitions", params={"order": "key.asc", **(params or {})}
        )

    def get(self, id_or_key: str) -> Optional[dict[str, Any]]:
        column = "id" if _UUID.match(id_or_key) else "key"
        rows = self._transport.get(
            "/api/db/pipeline_definitions", params={column: f"eq.{id_or_key}", "limit": 1}
        )
        return rows[0] if rows else None

    def versions(self, definition_id: str) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/pipeline_definition_versions",
            params={"definition_id": f"eq.{definition_id}", "order": "version.desc"},
        )

    def runs(
        self,
        *,
        definition_version_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"order": "started_at.desc", "limit": limit}
        if definition_version_id:
            params["definition_version_id"] = f"eq.{definition_version_id}"
        if status:
            params["status"] = f"eq.{status}"
        return self._transport.get("/api/db/pipeline_runs", params=params)

    def get_run(self, run_id: str) -> Optional[dict[str, Any]]:
        rows = self._transport.get(
            "/api/db/pipeline_runs", params={"id": f"eq.{run_id}", "limit": 1}
        )
        return rows[0] if rows else None

    def run_logs(self, run_id: str) -> list[dict[str, Any]]:
        """Ordered log entries; a Python step's carry ``detail.logs`` and ``detail.line``."""
        return self._transport.get(
            "/api/db/pipeline_run_logs",
            params={"run_id": f"eq.{run_id}", "order": "sequence.asc"},
        )

    def run_outputs(self, run_id: str) -> list[dict[str, Any]]:
        return self._transport.get(
            "/api/db/pipeline_run_outputs",
            params={"run_id": f"eq.{run_id}", "order": "created_at.asc"},
        )

    def trigger(
        self,
        *,
        definition_id: str,
        webhook_token: str,
        idempotency_key: str,
        parameters: Optional[dict[str, Any]] = None,
        input_versions: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        """Start a run of the published version through the pipeline's webhook.

        ``webhook_token`` is the pipeline's own secret (shown once when the webhook is
        enabled in the app), not your API credential. Repeating a call with the same
        ``idempotency_key`` and inputs returns the same run.
        """
        body: dict[str, Any] = {}
        if parameters is not None:
            body["parameters"] = parameters
        if input_versions is not None:
            body["inputVersions"] = input_versions
        _, result = self._transport.send_with_bearer(
            "POST",
            f"/api/pipelines/webhook/{definition_id}",
            webhook_token,
            json_body=body,
            headers={"Idempotency-Key": idempotency_key},
        )
        return result

    def wait_for_run(
        self, run_id: str, *, timeout: float = 300.0, interval: float = 2.0
    ) -> dict[str, Any]:
        """Poll until the run settles (or ``timeout`` seconds pass) and return its row."""
        deadline = time.monotonic() + timeout
        while True:
            run = self.get_run(run_id)
            if run is None:
                raise LookupError(f"Run {run_id} was not found.")
            if run["status"] in SETTLED:
                return run
            if time.monotonic() + interval > deadline:
                raise TimeoutError(f"Run {run_id} is still {run['status']}.")
            time.sleep(interval)

    def create_draft(
        self, *, workspace_id: str, definition_id: str, configuration: dict[str, Any]
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/create_pipeline_definition_version",
            json_body={
                "p_workspace_id": workspace_id,
                "p_definition_id": definition_id,
                "p_configuration": configuration,
            },
        )

    def save_draft(
        self,
        *,
        workspace_id: str,
        version_id: str,
        expected_revision: int,
        configuration: dict[str, Any],
    ) -> Any:
        return self._transport.post(
            "/api/db/rpc/update_pipeline_definition_version_draft",
            json_body={
                "p_workspace_id": workspace_id,
                "p_version_id": version_id,
                "p_expected_revision": expected_revision,
                "p_configuration": configuration,
            },
        )

    def sync_step(
        self,
        *,
        workspace_id: str,
        definition_id: str,
        code: str,
        step: Optional[str] = None,
        requirements: Optional[list[str]] = None,
        python_runtime: Optional[str] = None,
    ) -> tuple[Any, bool]:
        """Put local Python into a pipeline step as a draft; returns ``(version, created)``.

        Updates the open draft if there is one, otherwise starts a new draft from the
        latest version. Nothing is published. For a notebook, pass
        ``notebook_to_python(...)`` as ``code``.
        """
        check_source(code)
        versions = self.versions(definition_id)
        draft = next((v for v in versions if v["lifecycle"] == "draft"), None)
        base = draft or (versions[0] if versions else None)
        if base is None:
            raise LookupError("The pipeline has no version to start from.")
        configuration = apply_step_source(
            base["configuration"],
            code,
            step=step,
            requirements=requirements,
            python_runtime=python_runtime,
        )
        if draft:
            version = self.save_draft(
                workspace_id=workspace_id,
                version_id=draft["id"],
                expected_revision=draft["revision"],
                configuration=configuration,
            )
            return version, False
        version = self.create_draft(
            workspace_id=workspace_id, definition_id=definition_id, configuration=configuration
        )
        return version, True
