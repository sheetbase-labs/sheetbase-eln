"""The ``.sbplugin`` package: what a folder must contain and how it is checked.

These are the same rules Sheetbase applies when an administrator uploads the
package (``src/lib/extensions/package.ts`` in the app). The shared test cases in
``tests/package_cases.json`` keep the two in step.

A package is a zip with:

- ``plugin.json``: the manifest;
- ``python/``: the ``.py`` files the manifest points at;
- optionally ``README.md`` and ``LICENSE``.

``ui/`` is reserved for plugin screens, which Sheetbase does not load yet.
"""
import io
import json
import re
import zipfile

MAX_FILES = 100
MAX_FILE_BYTES = 512 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024
MAX_DECLARATIONS = 25
MAX_FIELDS = 24

ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$")
ITEM_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,48}$")
FIELD_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
ENTRY_PATTERN = re.compile(r"^([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*):([a-z_][a-z0-9_]*)$")
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
SCOPE_PATTERN = re.compile(r"^[a-z][a-z_]*:[a-z][a-z_]*$")
FIELD_TYPES = ("text", "number", "integer", "boolean", "date", "json")
CHART_TYPES = ("line", "scatter", "bar")
PROVIDES = ("operations", "analysis-kinds")
TOP_LEVEL = (
    "id", "name", "version", "description", "author", "compatibleWith",
    "permissions", "provides", "ui", "examples",
)
ALLOWED_ROOT_FILES = ("plugin.json", "README.md", "LICENSE", "LICENSE.md", "LICENSE.txt")


def _is_object(value):
    return isinstance(value, dict)


def _text(value, low, high):
    return isinstance(value, str) and low <= len(value.strip()) <= high


def _fields(where, label, value, errors):
    if not isinstance(value, list) or len(value) > MAX_FIELDS:
        errors.append(f"{where} {label} must be a list of at most {MAX_FIELDS}")
        return
    seen = set()
    for entry in value:
        if not _is_object(entry) or not isinstance(entry.get("name"), str) or not FIELD_NAME_PATTERN.match(entry["name"]):
            errors.append(f"{where} {label} names must match ^[a-z][a-z0-9_]{{0,47}}$")
            return
        name = entry["name"]
        if entry.get("type") not in FIELD_TYPES:
            errors.append(f"{where} {label} {name} has an unknown type (use {', '.join(FIELD_TYPES)})")
            return
        if not isinstance(entry.get("required"), bool):
            errors.append(f"{where} {label} {name} must say whether it is required")
            return
        if "description" in entry and not _text(entry["description"], 1, 300):
            errors.append(f"{where} {label} {name} description must be 1-300 characters")
            return
        if name in seen:
            errors.append(f"{where} {label} repeats {name}")
            return
        seen.add(name)


def _entry_exists(entry, files, where, errors):
    match = ENTRY_PATTERN.match(entry) if isinstance(entry, str) else None
    if not match:
        errors.append(f"{where} run must look like module:function, such as ops:viability")
        return
    module, function = match.groups()
    path = module.replace(".", "/")
    source = files.get(f"python/{path}.py")
    if source is None:
        source = files.get(f"python/{path}/__init__.py")
    if source is None:
        errors.append(f"{where} run points at {module}, which is not in python/")
        return
    pattern = rf"^(?:def\s+{function}\s*\(|{function}\s*=|from\s+\S+\s+import\s+.*\b{function}\b)"
    if not re.search(pattern, source, re.M):
        errors.append(f"{where} run points at {function}, which {module} does not define")


def _head(point, entry, seen, errors, files):
    where = f"provides.{point}"
    if not _is_object(entry) or not isinstance(entry.get("id"), str) or not ITEM_ID_PATTERN.match(entry["id"]):
        errors.append(f"{where} entry ids must match ^[a-z][a-z0-9-]{{0,48}}$")
        return None
    if entry["id"] in seen:
        errors.append(f"{where} has a duplicate id: {entry['id']}")
        return None
    seen.add(entry["id"])
    name = f"{where}.{entry['id']}"
    if not _text(entry.get("title"), 1, 120):
        errors.append(f"{name} title must be 1-120 characters")
        return None
    if not _text(entry.get("description"), 1, 600):
        errors.append(f"{name} description must be 1-600 characters")
        return None
    _entry_exists(entry.get("run"), files, name, errors)
    return name


def _operations(value, files, errors):
    if not isinstance(value, list) or len(value) > MAX_DECLARATIONS:
        errors.append(f"provides.operations must be a list of at most {MAX_DECLARATIONS}")
        return
    seen = set()
    for entry in value:
        name = _head("operations", entry, seen, errors, files)
        if name is None:
            return
        if entry.get("access") not in ("read", "write"):
            errors.append(f"{name} access must be read or write")
            return
        _fields(name, "inputs", entry.get("inputs"), errors)
        _fields(name, "outputs", entry.get("outputs"), errors)


def _analysis_kinds(value, files, errors):
    if not isinstance(value, list) or len(value) > MAX_DECLARATIONS:
        errors.append(f"provides.analysis-kinds must be a list of at most {MAX_DECLARATIONS}")
        return
    seen = set()
    for entry in value:
        name = _head("analysis-kinds", entry, seen, errors, files)
        if name is None:
            return
        inputs = entry.get("inputs")
        if not isinstance(inputs, list) or not 1 <= len(inputs) <= MAX_FIELDS:
            errors.append(f"{name} needs 1-{MAX_FIELDS} inputs")
            return
        names = set()
        for item in inputs:
            if (
                not _is_object(item)
                or not isinstance(item.get("name"), str)
                or not FIELD_NAME_PATTERN.match(item["name"])
                or item["name"] in names
                or not _text(item.get("label"), 1, 80)
                or item.get("type") not in ("number", "category")
                or not isinstance(item.get("required"), bool)
            ):
                errors.append(f"{name} inputs need a unique name, a label, a type of number or category, and required")
                return
            names.add(item["name"])
        result = entry.get("result")
        columns = result.get("columns") if _is_object(result) else None
        if not isinstance(columns, list) or not 1 <= len(columns) <= MAX_FIELDS:
            errors.append(f"{name} result needs 1-{MAX_FIELDS} columns")
            return
        column_names, numeric = set(), set()
        for column in columns:
            if (
                not _is_object(column)
                or not isinstance(column.get("name"), str)
                or not FIELD_NAME_PATTERN.match(column["name"])
                or column["name"] in column_names
                or column.get("type") not in ("number", "text")
            ):
                errors.append(f"{name} result columns need a unique name and a type of number or text")
                return
            column_names.add(column["name"])
            if column["type"] == "number":
                numeric.add(column["name"])
        if "chart" in result:
            chart = result["chart"]
            if (
                not _is_object(chart)
                or chart.get("type") not in CHART_TYPES
                or chart.get("x") not in column_names
                or chart.get("y") not in numeric
                or ("group" in chart and chart["group"] not in column_names)
            ):
                errors.append(
                    f"{name} chart needs a type (line, scatter or bar), an x column, a numeric y column "
                    "and an optional group column, all from the result columns"
                )
                return


def validate_manifest(manifest, files):
    """Every problem with a ``plugin.json`` value, given the package's files."""
    errors = []
    if not _is_object(manifest):
        return ["plugin.json must be an object"]
    for key in manifest:
        if key not in TOP_LEVEL:
            errors.append(f"unknown key in plugin.json: {key}")
    if not isinstance(manifest.get("id"), str) or not ID_PATTERN.match(manifest["id"]):
        errors.append("id must be a namespaced package identity (e.g. acme.cell-count)")
    if not _text(manifest.get("name"), 1, 200):
        errors.append("name must be 1-200 non-blank characters")
    if not isinstance(manifest.get("version"), str) or not SEMVER_PATTERN.match(manifest["version"]):
        errors.append("version must be semver (e.g. 1.2.3)")
    if not _text(manifest.get("description"), 1, 600):
        errors.append("description must be 1-600 characters")
    if "author" in manifest and not _text(manifest["author"], 1, 200):
        errors.append("author must be 1-200 characters")
    if "compatibleWith" in manifest and not _text(manifest["compatibleWith"], 1, 200):
        errors.append("compatibleWith must be a version range string")
    permissions = manifest.get("permissions", [])
    if not isinstance(permissions, list) or not all(isinstance(p, str) and SCOPE_PATTERN.match(p) for p in permissions):
        errors.append("permissions must be a list of scopes such as projects:read")
    if manifest.get("ui") is not None:
        errors.append("ui is reserved: plugins cannot bring their own screens yet")
    provides = manifest.get("provides")
    if not _is_object(provides):
        errors.append("provides must be an object")
    else:
        for key in provides:
            if key not in PROVIDES:
                errors.append(f"unknown contribution point: {key}")
        if not any(provides.get(key) for key in PROVIDES):
            errors.append("a plugin has to provide at least one operation or analysis kind")
        if "operations" in provides:
            _operations(provides["operations"], files, errors)
        if "analysis-kinds" in provides:
            _analysis_kinds(provides["analysis-kinds"], files, errors)
    examples = manifest.get("examples")
    if examples is not None:
        if not isinstance(examples, list) or len(examples) > 50 or not all(
            _is_object(e) and isinstance(e.get("operation"), str) and _is_object(e.get("input"))
            for e in examples
        ):
            errors.append("examples must be a list of { operation, input, output? }")
    return errors


def validate_files(files):
    """Problems with the shape of the package: allowed paths and sizes."""
    errors = []
    if len(files) > MAX_FILES:
        errors.append(f"a package has at most {MAX_FILES} files")
    total = 0
    for path, content in files.items():
        size = len(content.encode("utf-8")) if isinstance(content, str) else len(content)
        total += size
        if size > MAX_FILE_BYTES:
            errors.append(f"{path} is over {MAX_FILE_BYTES // 1024} KiB")
        parts = path.split("/")
        if path.startswith("/") or "\\" in path or ".." in parts or "" in parts:
            errors.append(f"{path} is not a safe path")
        elif parts[0] == "ui":
            errors.append("ui/ is reserved: plugins cannot bring their own screens yet")
        elif parts[0] == "python":
            if not path.endswith(".py") or len(parts) < 2:
                errors.append(f"{path}: python/ holds .py files only")
        elif path not in ALLOWED_ROOT_FILES:
            errors.append(f"{path} does not belong in a plugin package")
    if total > MAX_TOTAL_BYTES:
        errors.append(f"a package is at most {MAX_TOTAL_BYTES // (1024 * 1024)} MiB")
    if "plugin.json" not in files:
        errors.append("plugin.json is missing")
    return errors


def check_package(files):
    """Everything wrong with a package given as ``{path: text}``."""
    errors = validate_files(files)
    if "plugin.json" not in files:
        return errors
    try:
        manifest = json.loads(files["plugin.json"])
    except ValueError as error:
        return errors + [f"plugin.json is not valid JSON: {error}"]
    return errors + validate_manifest(manifest, files)


def read_folder(folder):
    """The files of a plugin folder that belong in the package, as text."""
    import os

    files = {}
    for root, dirs, names in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if d not in ("__pycache__", ".git", "tests", ".venv", "node_modules"))
        for name in sorted(names):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, folder).replace(os.sep, "/")
            parts = rel.split("/")
            if parts[0] == "python" and rel.endswith(".py"):
                pass
            elif rel in ALLOWED_ROOT_FILES:
                pass
            elif parts[0] == "ui":
                pass  # reported by validate_files
            else:
                continue
            with open(full, encoding="utf-8") as handle:
                files[rel] = handle.read()
    return files


def pack(files):
    """The bytes of a ``.sbplugin`` zip. Stable: same files, same bytes."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            info = zipfile.ZipInfo(path, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, files[path])
    return buffer.getvalue()


def unpack(data):
    """The files of a ``.sbplugin`` zip, as text."""
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            files[info.filename] = archive.read(info).decode("utf-8")
    return files
