"""Loads a plugin's files from memory and calls one of its functions.

This one file is used twice, so that what runs on your machine is what runs in
Sheetbase: the app embeds it in the isolated Python runner, and the
``sheetbase-plugin`` command imports it. It uses only the standard library.

``files`` maps a path inside the package's ``python/`` folder to its source,
for example ``{"ops.py": "...", "util/__init__.py": "..."}``.
"""
import importlib.abc
import importlib.util
import sys

ENTRY_PATTERN = r"^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*:[a-z_][a-z0-9_]*$"


class _Loader(importlib.abc.Loader):
    def __init__(self, source, filename):
        self._source = source
        self._filename = filename

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__plugin__ = True
        exec(compile(self._source, self._filename, "exec"), module.__dict__)


class _Finder(importlib.abc.MetaPathFinder):
    """Finds modules in the plugin's own files, and nowhere else on disk."""

    def __init__(self, files):
        self._modules = {}
        for path, source in files.items():
            if not path.endswith(".py"):
                continue
            parts = path[:-3].split("/")
            package = parts[-1] == "__init__"
            if package:
                parts = parts[:-1]
            if not parts:
                continue
            self._modules[".".join(parts)] = (source, path, package)

    def find_spec(self, fullname, path=None, target=None):
        found = self._modules.get(fullname)
        if found is None:
            return None
        source, filename, package = found
        spec = importlib.util.spec_from_loader(
            fullname, _Loader(source, filename), is_package=package
        )
        if package:
            spec.submodule_search_locations = []
        return spec


def install(files):
    """Make the plugin's modules importable. Safe to call again with new files."""
    sys.meta_path[:] = [f for f in sys.meta_path if not isinstance(f, _Finder)]
    for name in [n for n, m in sys.modules.items() if getattr(m, "__plugin__", False)]:
        del sys.modules[name]
    sys.meta_path.insert(0, _Finder(files))


def resolve(entry):
    """The function an entry such as ``ops:viability`` names."""
    module_name, _, function_name = entry.partition(":")
    module = importlib.import_module(module_name)
    function = getattr(module, function_name, None)
    if not callable(function):
        raise LookupError(f"{entry} is not a function in this plugin")
    return function


def call_operation(entry, value):
    """Run an operation: one dictionary in, one dictionary out."""
    result = resolve(entry)(value)
    if result is None:
        return {}
    if not isinstance(result, dict):
        return {"result": result}
    return result


def call_analysis(entry, rows):
    """Run an analysis: dataset rows in, rows (or a DataFrame) out."""
    import pandas as pd

    return resolve(entry)(pd.DataFrame(rows))


def call_screen(entry, payload):
    """Run a screen: ``{context, state, event}`` in, ``{view, state?, notice?}`` out."""
    result = resolve(entry)(payload)
    if not isinstance(result, dict):
        raise TypeError("A screen function returns a dictionary with a view.")
    return result


def call_column(entry, rows):
    """Run a computed column: a list of row dictionaries in, one value per row out."""
    values = resolve(entry)(rows)
    if hasattr(values, "tolist"):
        values = values.tolist()
    return {"values": list(values)}


def call_action(entry, payload):
    """Run a row or column action: ``{rows, ...}`` in, ``{notice?, view?, download?}`` out."""
    result = resolve(entry)(payload)
    if result is None:
        return {}
    if not isinstance(result, dict):
        raise TypeError("An action returns a dictionary, or nothing.")
    return result


def _clean(frame):
    """A DataFrame with a missing value as None: a blank stays blank, never NaN."""
    return frame.astype(object).where(frame.notna(), None)


def _as_frame(result):
    import pandas as pd

    if isinstance(result, pd.DataFrame):
        return _clean(result)
    return _clean(pd.DataFrame(list(result or [])))


def call_step(entry, tables, value):
    """Run a pipeline step: named tables and settings in, one DataFrame out."""
    import pandas as pd

    frames = {name: pd.DataFrame(rows) for name, rows in tables.items()}
    return _as_frame(resolve(entry)(frames, value))


def call_rows(entry, value):
    """Run a function that answers with rows: a dictionary in, rows (or a DataFrame) out."""
    return _as_frame(resolve(entry)(value))


def _content(value):
    """A file's content as the plugin reads it: text, or bytes when it was sent as base64."""
    import base64

    content = value["content"]
    if value.get("encoding") == "base64":
        return base64.b64decode(content)
    return content


def call_file_rows(entry, value):
    """Run an importer: ``read(content, filename)`` answers with rows."""
    return _as_frame(resolve(entry)(_content(value), value["filename"]))


def call_file_value(entry, value):
    """Run a preview: ``show(content, filename)`` answers with one dictionary."""
    result = resolve(entry)(_content(value), value["filename"])
    if not isinstance(result, dict):
        raise TypeError("A preview answers with a dictionary")
    return [result]


def call_export(entry, rows, options, encoding):
    """Run an exporter: ``write(rows, options)`` answers with the file's text or bytes."""
    import base64

    result = resolve(entry)(rows, options)
    if isinstance(result, (bytes, bytearray)):
        if encoding != "base64":
            raise TypeError("This exporter is declared as text but answered with bytes")
        return [{"content": base64.b64encode(bytes(result)).decode("ascii")}]
    if not isinstance(result, str):
        raise TypeError("An exporter answers with text or bytes")
    if encoding == "base64":
        return [{"content": base64.b64encode(result.encode("utf-8")).decode("ascii")}]
    return [{"content": result}]


def call_check(entry, rows):
    """Run a check: a DataFrame of the bound columns in, a status and a message out."""
    import pandas as pd

    result = resolve(entry)(pd.DataFrame(rows))
    if not isinstance(result, dict):
        raise TypeError("A check answers with a dictionary: status and message")
    return [result]
