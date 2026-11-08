"""The ``.sbplugin`` package: what a folder must contain and how it is checked.

These are the same rules Sheetbase applies when an administrator uploads the
package (``src/lib/extensions/package.ts`` in the app). The shared test cases in
``tests/package_cases.json`` keep the two in step.

A package is a zip with:

- ``plugin.json``: the manifest;
- ``python/``: the ``.py`` files the manifest points at;
- optionally ``README.md`` and ``LICENSE``;
- optionally ``ui/``: the ``.html``, ``.js``, ``.css``, ``.svg`` and ``.json`` files of a plugin
  UI bundle, which Sheetbase runs only in a sandboxed frame.
"""
import io
import json
import re
import zipfile

from .displays import check_display

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
PROVIDES = ("operations", "analysis-kinds", "blocks", "panels", "table-cells", "columns", "row-actions", "field-types")
PROVIDES_WITHOUT_PYTHON = ("table-cells", "field-types", "panels")
TOP_LEVEL = (
    "id", "name", "version", "description", "author", "compatibleWith",
    "permissions", "provides", "examples",
)
UI_ENTRY_PATTERN = re.compile(r"^ui/[A-Za-z0-9._/-]{1,100}\.html$")
UI_FILE_PATTERN = re.compile(r"^ui/[A-Za-z0-9._/-]+\.(html|js|css|svg|json)$")
UI_SDK_NAME = "sheetbase-ui.js"
MODEL_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
ICON_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
LOGICAL_TYPES = ("text", "integer", "decimal", "boolean", "date", "timestamp", "category", "reference")
COLUMN_VALUES = ("number", "text", "boolean", "svg")
FIELD_TYPE_BASES = ("text", "integer", "decimal")
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


def _pointers(entry):
    python = [entry[k] for k in ("run", "screen") if k in entry]
    for action in entry.get("actions") or []:
        if _is_object(action) and "run" in action:
            python.append(action["run"])
    return python


def _hook_head(point, entry, seen, errors, files, allowed, description_required=False):
    """The id, title and pointers every screen and table declaration shares."""
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
    if ("description" in entry or description_required) and not _text(entry.get("description"), 1, 600):
        errors.append(f"{name} description must be 1-600 characters")
        return None
    extra = next((k for k in entry if k not in allowed), None)
    if extra:
        errors.append(f"{name} has an unknown setting: {extra}")
        return None
    python = _pointers(entry)
    if not python and "ui" not in entry and point not in PROVIDES_WITHOUT_PYTHON:
        errors.append(f"{name} needs a Python function to run")
    for run in python:
        _entry_exists(run, files, name, errors)
    if "ui" in entry:
        if not isinstance(entry["ui"], str) or not UI_ENTRY_PATTERN.match(entry["ui"]):
            errors.append(f"{name} ui must be an .html file in ui/, such as ui/index.html")
        elif entry["ui"] not in files:
            errors.append(f"{name} ui points at {entry['ui']}, which is not in the package")
    return name


def _models(name, entry, errors):
    models = entry.get("models")
    if "models" in entry and not (
        isinstance(models, list) and 1 <= len(models) <= 25 and all(isinstance(k, str) and MODEL_KEY_PATTERN.match(k) for k in models)
    ):
        errors.append(f"{name} models is a list of 1-25 model keys")
        return False
    return True


def _input_names(name, entry, errors):
    inputs = entry.get("inputs")
    if "inputs" in entry and not (
        isinstance(inputs, list) and 1 <= len(inputs) <= MAX_FIELDS and all(isinstance(k, str) and FIELD_NAME_PATTERN.match(k) for k in inputs)
    ):
        errors.append(f"{name} inputs is a list of 1-{MAX_FIELDS} field names")
        return False
    return True


def _screen_choice(name, entry, errors, optional):
    if "screen" in entry and "ui" in entry:
        errors.append(f"{name} has a screen or a ui, not both")
    elif "screen" not in entry and "ui" not in entry and not optional:
        errors.append(f"{name} needs a screen (Python) or a ui (a bundle in ui/)")


def _list(point, value, errors):
    if not isinstance(value, list) or len(value) > MAX_DECLARATIONS:
        errors.append(f"provides.{point} must be a list of at most {MAX_DECLARATIONS}")
        return False
    return True


def _blocks(value, files, errors):
    if not _list("blocks", value, errors):
        return
    seen = set()
    for entry in value:
        name = _hook_head("blocks", entry, seen, errors, files, ("id", "title", "description", "icon", "screen", "ui"), True)
        if name is None:
            return
        if "icon" in entry and not (isinstance(entry["icon"], str) and ICON_PATTERN.match(entry["icon"])):
            errors.append(f"{name} icon must be an icon name such as flask")
        _screen_choice(name, entry, errors, False)


def _panels(value, files, errors):
    if not _list("panels", value, errors):
        return
    seen = set()
    for entry in value:
        name = _hook_head("panels", entry, seen, errors, files, ("id", "title", "description", "models", "screen", "ui"))
        if name is None:
            return
        _screen_choice(name, entry, errors, True)
        _models(name, entry, errors)


def _table_cells(value, files, errors):
    if not _list("table-cells", value, errors):
        return
    seen = set()
    for entry in value:
        name = _hook_head("table-cells", entry, seen, errors, files, ("id", "title", "description", "appliesTo", "display"))
        if name is None:
            return
        target = entry.get("appliesTo")
        if not _is_object(target) or not target or any(k not in ("fieldTypes", "models", "fields", "pluginTypes") for k in target):
            errors.append(f"{name} appliesTo says which cells: fieldTypes, models, fields or pluginTypes")
            return
        if "fieldTypes" in target and not (
            isinstance(target["fieldTypes"], list) and target["fieldTypes"] and all(t in LOGICAL_TYPES for t in target["fieldTypes"])
        ):
            errors.append(f"{name} appliesTo.fieldTypes are field types such as decimal")
            return
        if not _models(f"{name} appliesTo", target, errors):
            return
        if "fields" in target and not (
            isinstance(target["fields"], list)
            and 1 <= len(target["fields"]) <= 25
            and all(isinstance(f, str) and FIELD_NAME_PATTERN.match(f) for f in target["fields"])
        ):
            errors.append(f"{name} appliesTo.fields are 1-25 field names")
            return
        if "pluginTypes" in target and not (
            isinstance(target["pluginTypes"], list)
            and target["pluginTypes"]
            and all(isinstance(t, str) and ITEM_ID_PATTERN.match(t) for t in target["pluginTypes"])
        ):
            errors.append(f"{name} appliesTo.pluginTypes are the ids of this plugin's field types")
            return
        check_display(entry.get("display"), name, errors)


def _columns(value, files, errors):
    if not _list("columns", value, errors):
        return
    seen = set()
    for entry in value:
        name = _hook_head(
            "columns", entry, seen, errors, files,
            ("id", "title", "description", "models", "value", "display", "run", "inputs", "actions"),
        )
        if name is None:
            return
        if entry.get("value") not in COLUMN_VALUES:
            errors.append(f"{name} value is {', '.join(COLUMN_VALUES)}")
            return
        if not _models(name, entry, errors) or not _input_names(name, entry, errors):
            return
        if "display" in entry:
            check_display(entry["display"], name, errors)
        actions = entry.get("actions")
        if "actions" in entry:
            ids = set()
            if not (isinstance(actions, list) and 1 <= len(actions) <= 10):
                errors.append(f"{name} actions are 1-10 header menu entries")
                return
            for action in actions:
                if (
                    not _is_object(action)
                    or not isinstance(action.get("id"), str)
                    or not ITEM_ID_PATTERN.match(action["id"])
                    or action["id"] in ids
                    or not _text(action.get("title"), 1, 80)
                    or any(k not in ("id", "title", "run") for k in action)
                ):
                    errors.append(f"{name} actions need a unique id, a title and a runner")
                    return
                ids.add(action["id"])


def _row_actions(value, files, errors):
    if not _list("row-actions", value, errors):
        return
    seen = set()
    for entry in value:
        name = _hook_head(
            "row-actions", entry, seen, errors, files,
            ("id", "title", "description", "models", "selection", "run", "inputs"), True,
        )
        if name is None:
            return
        if entry.get("selection") not in ("one", "many"):
            errors.append(f"{name} selection is one or many")
            return
        if not _models(name, entry, errors) or not _input_names(name, entry, errors):
            return


def _field_types(value, files, errors):
    if not _list("field-types", value, errors):
        return
    seen = set()
    for entry in value:
        name = _hook_head(
            "field-types", entry, seen, errors, files,
            ("id", "title", "description", "base", "pattern", "patternMessage", "minLength", "maxLength",
             "min", "max", "placeholder", "display"),
        )
        if name is None:
            return
        base = entry.get("base")
        if base not in FIELD_TYPE_BASES:
            errors.append(f"{name} base is {', '.join(FIELD_TYPE_BASES)}")
            return
        text_only = ("pattern", "patternMessage", "minLength", "maxLength")
        number_only = ("min", "max")
        for key in (number_only if base == "text" else text_only):
            if key in entry:
                errors.append(f"{name} {key} does not apply to a {base} type")
                return
        if "pattern" in entry:
            pattern = entry["pattern"]
            ok = isinstance(pattern, str) and len(pattern) <= 200 and pattern.startswith("^") and pattern.endswith("$")
            if ok:
                try:
                    re.compile(pattern)
                except re.error:
                    ok = False
            if not ok:
                errors.append(f"{name} pattern must be an anchored expression (^…$) up to 200 characters")
                return
        if "patternMessage" in entry and not _text(entry["patternMessage"], 1, 160):
            errors.append(f"{name} patternMessage is 1-160 characters")
            return
        for key in ("minLength", "maxLength"):
            if key in entry and not (isinstance(entry[key], int) and not isinstance(entry[key], bool) and 0 <= entry[key] <= 10000):
                errors.append(f"{name} {key} is a whole number up to 10000")
                return
        for key in ("min", "max"):
            if key in entry and (isinstance(entry[key], bool) or not isinstance(entry[key], (int, float))):
                errors.append(f"{name} {key} is a number")
                return
        if "placeholder" in entry and not _text(entry["placeholder"], 1, 80):
            errors.append(f"{name} placeholder is 1-80 characters")
            return
        if "display" in entry:
            check_display(entry["display"], name, errors)


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
    provides = manifest.get("provides")
    if not _is_object(provides):
        errors.append("provides must be an object")
    else:
        for key in provides:
            if key not in PROVIDES:
                errors.append(f"unknown contribution point: {key}")
        if not any(provides.get(key) for key in PROVIDES):
            errors.append(
                "a plugin has to provide at least one operation, analysis kind, block, panel, "
                "table cell display, column, row action or field type"
            )
        if "operations" in provides:
            _operations(provides["operations"], files, errors)
        if "analysis-kinds" in provides:
            _analysis_kinds(provides["analysis-kinds"], files, errors)
        for point, check in (
            ("blocks", _blocks), ("panels", _panels), ("table-cells", _table_cells),
            ("columns", _columns), ("row-actions", _row_actions), ("field-types", _field_types),
        ):
            if point in provides:
                check(provides[point], files, errors)
        used_ui = {
            entry["ui"]
            for point in ("blocks", "panels")
            for entry in (provides.get(point) or [])
            if _is_object(entry) and isinstance(entry.get("ui"), str)
        }
        if not used_ui and any(path.startswith("ui/") for path in files):
            errors.append("ui/ files need a block or panel whose ui points at one of them")
    examples = manifest.get("examples")
    if examples is not None:
        if not isinstance(examples, list) or len(examples) > 50 or not all(
            _is_object(e) and isinstance(e.get("operation"), str) and _is_object(e.get("input"))
            for e in examples
        ):
            errors.append("examples must be a list of { operation, input, output? }")
    return errors


_WEB_ADDRESS = re.compile(r"(?:https?:)?//[a-z0-9.-]+\.[a-z]{2,}", re.I)


def _web_address(content):
    return isinstance(content, str) and bool(_WEB_ADDRESS.search(content))


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
            if not UI_FILE_PATTERN.match(path):
                errors.append(f"{path}: ui/ holds .html, .js, .css, .svg and .json files only")
            elif parts[-1] == UI_SDK_NAME:
                errors.append(f"{path}: {UI_SDK_NAME} is provided by Sheetbase, leave it out")
            elif path.endswith((".html", ".css")) and _web_address(content):
                errors.append(f"{path} refers to a web address; a plugin UI cannot reach the network, bundle what it needs")
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
                pass  # reported by validate_files if it does not belong
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
