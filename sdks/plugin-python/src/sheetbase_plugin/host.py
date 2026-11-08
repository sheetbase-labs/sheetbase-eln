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
