"""One JSON job on stdin, one JSON result on stdout. Isolation belongs to Docker."""
import contextlib
import datetime
import importlib.metadata
import io
import json
import platform
import re
import sys

import os

# What a pipeline step gets. A plugin call carries its own `limits` (set per
# plugin by an administrator), which replace these for that call.
MAX_ROWS = 100_000
MAX_CELLS = 1_000_000
MAX_BYTES = 32 * 1024 * 1024
MAX_FIELDS = 256
MAX_LOG_BYTES = 64 * 1024
MAX_PROBLEMS = 5

REQUIREMENT = re.compile(r"^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)==([A-Za-z0-9](?:[A-Za-z0-9.!+_-]*[A-Za-z0-9])?)$")
DECIMAL = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")


class ContractError(ValueError):
    """The rows going in or out do not match the step's declared contract."""


class BoundedLog(io.StringIO):
    """Captures print output. Past the limit it stops recording, it does not fail the step."""

    def __init__(self, max_bytes=MAX_LOG_BYTES):
        super().__init__()
        self.byte_count = 0
        self.truncated = False
        self.max_bytes = max_bytes
        # Room kept free for the truncation marker so the logs always fit the limit.
        self.budget = max_bytes - 256

    def write(self, text):
        if self.truncated:
            return len(text)
        size = len(text.encode("utf-8"))
        if self.byte_count + size > self.budget:
            self.truncated = True
            super().write(f"\n[log truncated at {self.max_bytes // 1024} KiB]\n")
            return len(text)
        self.byte_count += size
        return super().write(text)

    def lines(self):
        return self.getvalue().splitlines()


def normalise(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def installed_packages():
    packages = {}
    for dist in importlib.metadata.distributions():
        name = dist.metadata["Name"]
        if name:
            packages[normalise(name)] = dist.version
    return dict(sorted(packages.items()))


def environment(requirements=()):
    """The interpreter and the versions of the packages this step declared."""
    packages = installed_packages()
    used = {}
    for line in requirements:
        name = normalise(REQUIREMENT.match(line).group(1))
        used[name] = packages[name]
    return {"python": platform.python_version(), "packages": used}


def check_requirements(requirements):
    """Nothing is installed here: the pinned image either provides the versions or the run is refused."""
    if not isinstance(requirements, list) or not all(isinstance(line, str) for line in requirements):
        raise ValueError("Requirements must be a list of name==version lines")
    packages = installed_packages()
    problems = []
    for line in requirements:
        match = REQUIREMENT.match(line)
        if not match:
            problems.append(f"{line[:80]!r} is not pinned as name==version")
            continue
        name, version = normalise(match.group(1)), match.group(2)
        have = packages.get(name)
        if have is None:
            problems.append(f"{name}=={version} is not in this runtime")
        elif have != version:
            problems.append(f"{name}=={version} was requested but this runtime has {have}")
    if problems:
        raise ValueError(
            "Package requirements are not met: "
            + "; ".join(problems)
            + ". Packages cannot be installed while a pipeline runs; ask an administrator to add them to the Python image."
        )


def matches_type(kind, value):
    if kind == "text":
        return isinstance(value, str)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "decimal":
        if isinstance(value, bool):
            return False
        return isinstance(value, (int, float)) or (isinstance(value, str) and DECIMAL.match(value) is not None)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "date":
        return isinstance(value, str) and DATE.match(value) is not None
    if kind == "timestamp":
        return isinstance(value, str) and TIMESTAMP.match(value) is not None
    return kind == "json"


def check_columns(rows, columns, label, additional_ok, present=None):
    """Compare JSON rows with a declared column list; name the first few problems, not just that there are some.

    `present` is a DataFrame's own column list, which also covers an empty result.
    """
    declared = {column["name"]: column for column in columns}
    seen = set(present or ())
    missing = set()
    wrong = []
    for index, row in enumerate(rows, start=1):
        seen.update(row)
        for name, column in declared.items():
            if name not in row:
                missing.add(name)
                continue
            value = row[name]
            if value is None:
                if column.get("nullable", True) is False:
                    wrong.append(f'{label} column "{name}" is empty in row {index} but is declared not null')
            elif not matches_type(column["type"], value):
                wrong.append(f'{label} column "{name}" expects {column["type"]} but row {index} has {json.dumps(value)[:40]}')
    if present is not None:
        missing |= set(declared) - set(present)
    problems = [f'{label} column "{name}" is missing' for name in sorted(missing)]
    problems += wrong
    if not additional_ok:
        extra = sorted(seen - set(declared))
        if extra:
            problems.append(
                f'{label} has undeclared column{"s" if len(extra) > 1 else ""} '
                + ", ".join(f'"{name}"' for name in extra[:5])
                + " (declare them or allow additional columns)"
            )
    if problems:
        raise ContractError("; ".join(problems[:MAX_PROBLEMS]))


def check_inputs(inputs, contract):
    for alias, columns in (contract or {}).items():
        rows = inputs.get(alias)
        if rows is None:
            raise ContractError(f'Input "{alias}" was not provided')
        check_columns(rows, columns, f'Input "{alias}"', True)


def encode_value(value):
    import numpy as np
    import pandas as pd
    if value is pd.NaT:
        raise TypeError("Output contains NaT; use None for a missing date")
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    raise TypeError(f"Output contains unsupported value type: {type(value).__name__}")


def pipeline_line(error):
    """The line of the user's code an error came from; never any source text."""
    if isinstance(error, SyntaxError) and error.filename == "<pipeline>":
        return error.lineno
    line = None
    trace = error.__traceback__
    while trace is not None:
        if trace.tb_frame.f_code.co_filename == "<pipeline>":
            line = trace.tb_lineno
        trace = trace.tb_next
    return line


def limits_of(job):
    """Row, cell, field and byte limits for this job: the plugin's own, or the pipeline defaults."""
    given = job.get("limits")
    if not isinstance(given, dict):
        return {"rows": MAX_ROWS, "cells": MAX_CELLS, "fields": MAX_FIELDS, "bytes": MAX_BYTES}
    # A plugin's call is bounded by its rows and bytes alone: cells and the width of a row follow from those.
    return {"rows": int(given["rows"]), "cells": None, "fields": None, "bytes": int(given["bytes"])}


def execute(job, logs):
    limit = limits_of(job)
    requirements = job.get("requirements") or []
    check_requirements(requirements)
    contract = job.get("contract") or {}
    check_inputs(job["inputs"], contract.get("inputs"))
    with contextlib.redirect_stdout(logs), contextlib.redirect_stderr(logs):
        namespace = {"__name__": "__pipeline__"}
        exec(compile(job["statement"], "<pipeline>", "exec"), namespace)
        transform = namespace.get("transform")
        if not callable(transform):
            raise ValueError("Define transform(inputs, parameters) and return rows")
        result = transform(job["inputs"], job["parameters"])
    output = contract.get("output")
    present = None
    import pandas as pd
    if isinstance(result, pd.DataFrame):
        if not result.columns.is_unique or not all(isinstance(key, str) for key in result.columns):
            raise ValueError("DataFrame columns must be unique strings")
        if len(result) > limit["rows"] or (limit["cells"] is not None and result.size > limit["cells"]):
            raise ValueError("Python result exceeds row or cell limit")
        present = list(result.columns)
        result = result.to_dict(orient="records")
    if not isinstance(result, list) or len(result) > limit["rows"]:
        raise ValueError(f"Return a list of row dictionaries or a DataFrame, at most {limit['rows']} rows")
    cells = 0
    for row in result:
        if not isinstance(row, dict) or not all(isinstance(key, str) for key in row):
            raise ValueError("Every output row must be a dictionary with string keys")
        cells += len(row)
        if (limit["fields"] is not None and len(row) > limit["fields"]) or (
            limit["cells"] is not None and cells > limit["cells"]
        ):
            raise ValueError("Python result exceeds field or cell limit")
    # Reject NaN and infinity instead of silently changing scientific values.
    encoded = json.dumps(
        {
            "rows": result,
            "logs": logs.lines(),
            "environment": environment(requirements),
        },
        default=encode_value,
        allow_nan=False,
        separators=(",", ":"),
    )
    if len(encoded.encode("utf-8")) > limit["bytes"]:
        raise ValueError(f"Python result exceeds {limit['bytes'] // (1024 * 1024)} MiB")
    if output is not None:
        # Check the rows as the app will see them: after JSON encoding, so a date
        # is its ISO string and a NumPy integer is an int.
        decoded = json.loads(encoded)["rows"]
        check_columns(decoded, output["columns"], "Output", bool(output.get("additionalColumns")), present)
    return encoded


def main():
    # The runner broker has already bounded the job by the plugin's own data limit and tells us what it
    # allowed; without it (a pipeline step) the fixed pipeline limit applies.
    allowed = int(os.environ.get("SHEETBASE_MAX_INPUT_BYTES", MAX_BYTES))
    raw = sys.stdin.buffer.read(allowed + 1)
    if len(raw) > allowed:
        raise ValueError(f"Python input exceeds {allowed // (1024 * 1024)} MiB")
    job = json.loads(raw)
    if job.get("mode") == "inspect":
        sys.stdout.write(json.dumps({"environment": {"python": platform.python_version(), "packages": installed_packages()}}))
        return 0
    given = job.get("limits")
    logs = BoundedLog(int(given["logBytes"]) if isinstance(given, dict) and "logBytes" in given else MAX_LOG_BYTES)
    try:
        encoded = execute(job, logs)
    except BaseException as error:
        # No traceback, source or input dump: a message, the line it came from and the
        # step's own print output. An exception message is still untrusted output.
        report = {"error": f"{type(error).__name__}: {error}"[:2000], "logs": logs.lines()}
        line = pipeline_line(error)
        if line:
            report["line"] = line
        sys.stdout.write(json.dumps(report))
        return 1
    sys.stdout.write(encoded)
    return 0


if __name__ == "__main__":
    try:
        status = main()
    except BaseException as error:
        message = f"{type(error).__name__}: {error}"[:2000]
        sys.stdout.write(json.dumps({"error": message}))
        status = 1
    sys.exit(status)
