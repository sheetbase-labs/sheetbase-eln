"""One JSON job on stdin, one JSON result on stdout. Isolation belongs to Docker."""
import contextlib
import datetime
import io
import json
import sys

MAX_ROWS = 100_000
MAX_CELLS = 1_000_000
MAX_BYTES = 32 * 1024 * 1024
MAX_LOG_BYTES = 64 * 1024


class BoundedLog(io.StringIO):
    def __init__(self):
        super().__init__()
        self.byte_count = 0

    def write(self, text):
        self.byte_count += len(text.encode("utf-8"))
        if self.byte_count > MAX_LOG_BYTES:
            raise ValueError("Python log output exceeds 64 KiB")
        return super().write(text)


def encode_value(value):
    import numpy as np
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    raise TypeError(f"Output contains unsupported value type: {type(value).__name__}")


def main():
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Python input exceeds 32 MiB")
    job = json.loads(raw)
    logs = BoundedLog()
    with contextlib.redirect_stdout(logs), contextlib.redirect_stderr(logs):
        namespace = {"__name__": "__pipeline__"}
        exec(compile(job["statement"], "<pipeline>", "exec"), namespace)
        transform = namespace.get("transform")
        if not callable(transform):
            raise ValueError("Define transform(inputs, parameters) and return rows")
        result = transform(job["inputs"], job["parameters"])
        import pandas as pd
        if isinstance(result, pd.DataFrame):
            if not result.columns.is_unique or not all(isinstance(key, str) for key in result.columns):
                raise ValueError("DataFrame columns must be unique strings")
            if len(result) > MAX_ROWS or result.size > MAX_CELLS:
                raise ValueError("Python result exceeds row or cell limit")
            result = result.to_dict(orient="records")
        if not isinstance(result, list) or len(result) > MAX_ROWS:
            raise ValueError("Return a list of row dictionaries or a DataFrame, at most 100000 rows")
        cells = 0
        for row in result:
            if not isinstance(row, dict) or not all(isinstance(key, str) for key in row):
                raise ValueError("Every output row must be a dictionary with string keys")
            cells += len(row)
            if len(row) > 256 or cells > MAX_CELLS:
                raise ValueError("Python result exceeds field or cell limit")
        # Reject NaN and infinity instead of silently changing scientific values.
        encoded = json.dumps({"rows": result, "logs": logs.getvalue().splitlines()}, default=encode_value, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_BYTES:
            raise ValueError("Python result exceeds 32 MiB")
    sys.stdout.write(encoded)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        # No traceback/source/input dump. An exception message is still untrusted output.
        message = f"{type(error).__name__}: {error}"[:2000]
        sys.stdout.write(json.dumps({"error": message}))
        sys.exit(1)
