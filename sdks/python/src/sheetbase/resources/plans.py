"""Plans: several RPCs run in order, each able to use what the one before made.

A step is an RPC name and its arguments. An argument value may be
``{"$ref": "<step key>.<path>"}`` to use part of an earlier step's result, such
as the ``id`` of a new experiment. The plan stops at the first step that
fails and says which steps are done, the same shape as ``sheetbase.lab.plan``
over MCP. Each RPC runs as the person the token belongs to, so what that
person may do still decides what each step may do.
"""

from __future__ import annotations

from typing import Any, Optional

from sheetbase._http import AsyncHttpTransport, HttpTransport

MIN_STEPS = 2
MAX_STEPS = 12


def _lookup(value: Any, path: list[str]) -> Any:
    for part in path:
        if isinstance(value, list):
            try:
                value = value[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(value, dict):
            value = value.get(part)
        else:
            return None
    return value


def resolve_references(value: Any, results: dict[str, Any]) -> Any:
    """Replace each ``{"$ref": "key.path"}`` with what that step returned.

    Raises ``ValueError`` naming the reference when the step has not run or
    the path finds nothing, so a plan never carries on with a guess.
    """
    if isinstance(value, dict):
        if set(value) == {"$ref"} and isinstance(value["$ref"], str):
            key, *path = value["$ref"].split(".")
            if key not in results:
                raise ValueError(f'"{value["$ref"]}" names a step that has not run yet.')
            found = _lookup(results[key], path)
            if found is None:
                raise ValueError(f'"{value["$ref"]}" found nothing in that step\'s result.')
            return found
        return {name: resolve_references(item, results) for name, item in value.items()}
    if isinstance(value, list):
        return [resolve_references(item, results) for item in value]
    return value


def check_steps(steps: list[dict[str, Any]]) -> None:
    if not MIN_STEPS <= len(steps) <= MAX_STEPS:
        raise ValueError(f"A plan needs {MIN_STEPS} to {MAX_STEPS} steps.")
    keys = [step.get("key") for step in steps]
    if len(set(keys)) != len(keys):
        raise ValueError("Two steps have the same key. Give each its own.")


def _failed(steps: list[dict[str, Any]], index: int, message: str) -> dict[str, Any]:
    report = [{"key": s["key"], "status": "done"} for s in steps[:index]]
    report.append({"key": steps[index]["key"], "status": "failed", "message": message})
    report += [{"key": s["key"], "status": "not_run"} for s in steps[index + 1 :]]
    return {"status": "failed", "steps": report}


class PlansResource:
    def __init__(self, transport: HttpTransport) -> None:
        self._transport = transport

    def run(self, steps: list[dict[str, Any]]) -> dict[str, Any]:
        """Run ``[{"key", "rpc", "arguments"}, ...]`` in order, stopping on failure."""
        check_steps(steps)
        results: dict[str, Any] = {}
        report: list[dict[str, Any]] = []
        for index, step in enumerate(steps):
            try:
                arguments = resolve_references(step.get("arguments", {}), results)
            except ValueError as error:
                return _failed(steps, index, str(error))
            try:
                result = self._transport.post(
                    f"/api/db/rpc/{step['rpc']}", json_body=arguments
                )
            except Exception as error:  # noqa: BLE001 - report which step failed
                return _failed(steps, index, str(error))
            results[step["key"]] = result
            report.append({"key": step["key"], "status": "done", "result": result})
        return {"status": "done", "steps": report}


class AsyncPlansResource:
    def __init__(self, transport: AsyncHttpTransport) -> None:
        self._t = transport

    async def run(self, steps: list[dict[str, Any]]) -> dict[str, Any]:
        check_steps(steps)
        results: dict[str, Any] = {}
        report: list[dict[str, Any]] = []
        for index, step in enumerate(steps):
            try:
                arguments = resolve_references(step.get("arguments", {}), results)
            except ValueError as error:
                return _failed(steps, index, str(error))
            try:
                result = await self._t.post(
                    f"/api/db/rpc/{step['rpc']}", json_body=arguments
                )
            except Exception as error:  # noqa: BLE001 - report which step failed
                return _failed(steps, index, str(error))
            results[step["key"]] = result
            report.append({"key": step["key"], "status": "done", "result": result})
        return {"status": "done", "steps": report}
