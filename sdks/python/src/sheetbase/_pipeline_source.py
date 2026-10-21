"""Pure helpers for putting local Python into a pipeline step. Nothing here talks to the network."""
from __future__ import annotations

import copy
import json
import re
from typing import Any, Optional, Sequence


def notebook_to_python(notebook: Any) -> str:
    """``.ipynb`` JSON (a dict or its text) to a script: code cells in order, magics and shell lines commented out."""
    if isinstance(notebook, (str, bytes)):
        notebook = json.loads(notebook)
    cells = notebook.get("cells") if isinstance(notebook, dict) else None
    if not isinstance(cells, list):
        raise ValueError("Not a notebook: it has no cells.")
    chunks: list[str] = []
    for cell in cells:
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        source = cell.get("source", "")
        text = "".join(source) if isinstance(source, list) else str(source)
        lines = [f"# {line}" if re.match(r"^\s*[%!]", line) else line for line in text.split("\n")]
        joined = "\n".join(lines).rstrip()
        if joined:
            chunks.append(joined)
    return "\n\n".join(chunks) + "\n"


def parse_requirements(text: str) -> list[str]:
    """``requirements.txt`` text to pinned ``name==version`` lines; anything unpinned is refused."""
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9][A-Za-z0-9.!+_-]*", line):
            raise ValueError(f"{line!r} is not pinned as name==version.")
        lines.append(line)
    return lines


def check_source(code: str) -> None:
    """Refuse a source that cannot run, before anything is sent."""
    if not code.strip():
        raise ValueError("The step source is empty.")
    if not re.search(r"\bdef\s+transform\s*\(", code):
        raise ValueError("The source must define transform(inputs, parameters).")


def apply_step_source(
    configuration: dict[str, Any],
    code: str,
    *,
    step: Optional[str] = None,
    requirements: Optional[Sequence[str]] = None,
    python_runtime: Optional[str] = None,
) -> dict[str, Any]:
    """Return ``configuration`` with one Python step's code (and optionally its requirements and runtime pin) replaced."""
    check_source(code)
    new = copy.deepcopy(configuration)
    if step is None:
        new["transform"] = {**(new.get("transform") or {}), "language": "python", "statement": code}
    else:
        steps = new.get("steps") or []
        for index, entry in enumerate(steps):
            if entry.get("name") == step:
                steps[index] = {**entry, "language": "python", "statement": code}
                break
        else:
            raise ValueError(f'The pipeline has no step named "{step}".')
        new["steps"] = steps
    if requirements is not None:
        new["pythonRequirements"] = list(requirements)
    if python_runtime:
        new["pythonRuntime"] = python_runtime
    elif not new.get("pythonRuntime"):
        raise ValueError(
            "This pipeline has no Python runtime pinned yet; pass python_runtime (see GET /api/pipelines/runtime)."
        )
    return new
