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

# Sanity bounds so a malformed zip can't exhaust the server. They sit far above
# any real plugin; a plugin's runtime limits are separate, per-plugin settings.
MAX_FILES = 2000
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_DECLARATIONS = 1000
MAX_FIELDS = 500

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
UI_POINTS = ("pages", "settings-pages", "dashboard-widgets", "report-sections")
PROVIDES = (
    "operations", "analysis-kinds", "blocks", "panels", "table-cells", "columns",
    "row-actions", "field-types", "pipeline-steps", "calculators", "checks",
    "search-providers", "connectors", "publishers", "notification-channels",
    "importers", "exporters", "previews",
    "sameness-keys", "event-hooks", "record-hooks", "instrument-parsers",
    "label-formats", "barcode-formats", "storage-rules",
    *UI_POINTS,
)
PROVIDES_WITHOUT_PYTHON = ("table-cells", "field-types", "panels", *UI_POINTS)
# Operations, calculators, pipeline steps and publishers share one name in Sheetbase.
CALLED = ("operations", "calculators", "pipeline-steps", "publishers")
NO_DESCRIPTION_NEEDED = ("analysis-kinds", "pipeline-steps")
HOST_PATTERN = re.compile(
    r"^(?!\d+(?:\.\d+){3}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
FILE_EXTENSION_PATTERN = re.compile(r"^\.[a-z0-9]{1,12}$")
RECORD_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")
MIME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$")
STATUS_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
RECORD_HOOK_WHEN = ("created", "edited", "uploaded", "status-changed")
MAX_LIST_ITEMS = 10
TOP_LEVEL = (
    "id", "name", "version", "description", "author", "compatibleWith",
    "permissions", "provides", "examples", "python",
)

_NAME = r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?"
_EXTRAS = r"(?:\[[A-Za-z0-9](?:[A-Za-z0-9._,\s-]*[A-Za-z0-9])?\])?"
_CLAUSE = r"(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9][A-Za-z0-9.*+!_-]*"
_VERSIONS = rf"(?:\s*{_CLAUSE}(?:\s*,\s*{_CLAUSE})*)?"
_MARKER = r"(?:\s*;\s*[A-Za-z0-9 _.'\"()<>=!~,-]+)?"
REQUIREMENT_PATTERN = re.compile(
    rf"^{_NAME}{_EXTRAS}(?:{_VERSIONS}|\s*@\s*https://[^\s;]+){_MARKER}$"
)
NETWORK_HOST_PATTERN = re.compile(
    r"^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
UI_ENTRY_PATTERN = re.compile(r"^ui/[A-Za-z0-9._/-]{1,100}\.html$")
UI_FILE_PATTERN = re.compile(r"^ui/[A-Za-z0-9._/-]+\.(html|js|mjs|css|svg|json)$")
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
        if "label" in entry and not _text(entry["label"], 1, 80):
            errors.append(f"{where} {label} {name} label must be 1-80 characters")
            return
        if "unit" in entry and not _text(entry["unit"], 1, 24):
            errors.append(f"{where} {label} {name} unit must be 1-24 characters")
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
    description = entry.get("description")
    if "description" in entry or point not in NO_DESCRIPTION_NEEDED:
        if not _text(description, 1, 600):
            errors.append(f"{name} description must be 1-600 characters")
            return None
    _entry_exists(entry.get("run"), files, name, errors)
    if point in ("connectors", "publishers") or (
        point in ("barcode-formats", "notification-channels") and "parse" in entry
    ):
        _entry_exists(entry.get("parse"), files, f"{name} parse", errors)
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
    has_ui = any(key in entry for key in ("ui", "render", "input"))
    if not python and not has_ui and point not in PROVIDES_WITHOUT_PYTHON:
        errors.append(f"{name} needs a Python function to run")
    for run in python:
        _entry_exists(run, files, name, errors)
    for key, example in (("ui", "ui/index.html"), ("render", "ui/cells.html"), ("input", "ui/input.html")):
        if key in entry:
            if not isinstance(entry[key], str) or not UI_ENTRY_PATTERN.match(entry[key]):
                errors.append(f"{name} {key} must be an .html file in ui/, such as {example}")
            elif entry[key] not in files:
                errors.append(f"{name} {key} points at {entry[key]}, which is not in the package")
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


def _ui_point(point):
    """Pages, settings pages, Home widgets and report sections: screens a plugin draws itself."""

    def check(value, files, errors):
        if not _list(point, value, errors):
            return
        allowed = ("id", "title", "description", "icon", "ui") + (("size",) if point == "dashboard-widgets" else ())
        seen = set()
        for entry in value:
            name = _hook_head(point, entry, seen, errors, files, allowed)
            if name is None:
                return
            if "icon" in entry and not (isinstance(entry["icon"], str) and ICON_PATTERN.match(entry["icon"])):
                errors.append(f"{name} icon must be an icon name such as flask")
                return
            if "ui" not in entry:
                errors.append(f"{name} ui must be an .html file in ui/, such as ui/page.html")
                return
            if "size" in entry and entry["size"] not in ("normal", "wide"):
                errors.append(f"{name} size is normal or wide")
                return

    return check


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
        name = _hook_head(
            "table-cells", entry, seen, errors, files, ("id", "title", "description", "appliesTo", "display", "render")
        )
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
        if ("display" in entry) == ("render" in entry):
            errors.append(f"{name} needs a display (a declared look) or a render (a UI bundle that draws the cells), not both")
            return
        if "display" in entry:
            check_display(entry["display"], name, errors)


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
             "min", "max", "placeholder", "display", "input"),
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


def _list(point, value, errors):
    if not isinstance(value, list) or len(value) > MAX_DECLARATIONS:
        errors.append(f"provides.{point} must be a list of at most {MAX_DECLARATIONS}")
        return None
    return value


def _strings(where, label, value, pattern, hint, errors):
    if (
        not isinstance(value, list)
        or not 1 <= len(value) <= MAX_LIST_ITEMS
        or not all(isinstance(entry, str) and pattern.match(entry) for entry in value)
    ):
        errors.append(f"{where} {label} needs 1-{MAX_LIST_ITEMS} entries, each {hint}")
        return False
    if len(set(value)) != len(value):
        errors.append(f"{where} {label} repeats an entry")
        return False
    return True


def _labelled(where, label, value, errors, extra, maximum, minimum=0):
    if not isinstance(value, list) or len(value) > maximum:
        errors.append(f"{where} {label} must be a list of at most {maximum}")
        return False
    seen = set()
    for entry in value:
        if (
            not _is_object(entry)
            or not isinstance(entry.get("name"), str)
            or not FIELD_NAME_PATTERN.match(entry["name"])
            or entry["name"] in seen
            or not _text(entry.get("label"), 1, 80)
            or not isinstance(entry.get("required"), bool)
            or not extra(entry)
        ):
            errors.append(f"{where} {label} need a unique name, a label of 1-80 characters and required")
            return False
        seen.add(entry["name"])
    if len(value) < minimum:
        errors.append(f"{where} needs at least {minimum} {label}")
        return False
    return True


def _result_columns(where, value, errors):
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_FIELDS:
        errors.append(f"{where} result needs 1-{MAX_FIELDS} columns")
        return False
    seen = set()
    for column in value:
        if (
            not _is_object(column)
            or not isinstance(column.get("name"), str)
            or not FIELD_NAME_PATTERN.match(column["name"])
            or column["name"] in seen
            or column.get("type") not in ("number", "text")
        ):
            errors.append(f"{where} result columns need a unique name and a type of number or text")
            return False
        seen.add(column["name"])
    return True


def _encoding(where, entry, errors):
    if entry.get("encoding") not in ("text", "base64"):
        errors.append(f"{where} encoding must be text or base64")
        return False
    return True


def _each(point, value, files, errors, check):
    entries = _list(point, value, errors)
    if entries is None:
        return
    seen = set()
    for entry in entries:
        name = _head(point, entry, seen, errors, files)
        if name is None or not check(entry, name):
            return


def _pipeline_steps(value, files, errors):
    def check(entry, name):
        if not _labelled(name, "tables", entry.get("tables"), errors, lambda _t: True, 6, 1):
            return False
        before = len(errors)
        _fields(name, "parameters", entry.get("parameters"), errors)
        result = entry.get("result")
        return len(errors) == before and _result_columns(
            name, result.get("columns") if _is_object(result) else None, errors
        )

    _each("pipeline-steps", value, files, errors, check)


def _calculators(value, files, errors):
    def check(entry, name):
        before = len(errors)
        _fields(name, "inputs", entry.get("inputs"), errors)
        _fields(name, "outputs", entry.get("outputs"), errors)
        if len(errors) > before:
            return False
        if not entry["inputs"] or not entry["outputs"]:
            errors.append(f"{name} needs at least one input and one output")
            return False
        return True

    _each("calculators", value, files, errors, check)


def _checks(value, files, errors):
    return _each(
        "checks", value, files, errors,
        lambda entry, name: _labelled(
            name, "inputs", entry.get("inputs"), errors,
            lambda i: i.get("type") in ("number", "category"), MAX_FIELDS, 1,
        ),
    )


def _search_providers(value, files, errors):
    _each(
        "search-providers", value, files, errors,
        lambda entry, name: _strings(
            name, "types", entry.get("types"), RECORD_TYPE_PATTERN, "like sample or registry_entry", errors
        ),
    )


def _connectors(value, files, errors):
    def check(entry, name):
        if not _strings(name, "hosts", entry.get("hosts"), HOST_PATTERN, "a host name such as api.example.org", errors):
            return False
        if not _labelled(
            name, "settings", entry.get("settings"), errors,
            lambda s: isinstance(s.get("secret"), bool), 8,
        ):
            return False
        before = len(errors)
        _fields(name, "parameters", entry.get("parameters"), errors)
        return len(errors) == before

    _each("connectors", value, files, errors, check)


def _publishers(value, files, errors):
    def check(entry, name):
        if not _strings(name, "hosts", entry.get("hosts"), HOST_PATTERN, "a host name such as api.example.org", errors):
            return False
        if not _labelled(
            name, "settings", entry.get("settings"), errors,
            lambda s: isinstance(s.get("secret"), bool), 8,
        ):
            return False
        before = len(errors)
        _fields(name, "parameters", entry.get("parameters"), errors)
        if len(errors) > before:
            return False
        if any(p.get("name") in ("rows", "name") for p in entry["parameters"]):
            errors.append(f"{name} parameters can’t be called rows or name")
            return False
        return True

    _each("publishers", value, files, errors, check)


def _notification_channels(value, files, errors):
    def check(entry, name):
        if not _strings(name, "hosts", entry.get("hosts"), HOST_PATTERN, "a host name such as slack.com", errors):
            return False
        if not _labelled(
            name, "settings", entry.get("settings"), errors,
            lambda s: isinstance(s.get("secret"), bool), 8,
        ):
            return False
        destination = entry.get("destination")
        if (
            not _is_object(destination)
            or not _text(destination.get("label"), 1, 80)
            or ("hint" in destination and not _text(destination.get("hint"), 1, 120))
        ):
            errors.append(f"{name} destination needs a label of 1-80 characters and may have a hint of up to 120")
            return False
        return True

    _each("notification-channels", value, files, errors, check)


def _importers(value, files, errors):
    _each(
        "importers", value, files, errors,
        lambda entry, name: _strings(
            name, "extensions", entry.get("extensions"), FILE_EXTENSION_PATTERN, "like .mzml", errors
        ) and _encoding(name, entry, errors),
    )


def _exporters(value, files, errors):
    def check(entry, name):
        if not isinstance(entry.get("extension"), str) or not FILE_EXTENSION_PATTERN.match(entry["extension"]):
            errors.append(f"{name} extension must look like .fasta")
            return False
        if not isinstance(entry.get("mime"), str) or not MIME_PATTERN.match(entry["mime"]):
            errors.append(f"{name} mime must look like text/plain")
            return False
        if not _encoding(name, entry, errors):
            return False
        before = len(errors)
        _fields(name, "parameters", entry.get("parameters"), errors)
        return len(errors) == before

    _each("exporters", value, files, errors, check)


def _previews(value, files, errors):
    _each(
        "previews", value, files, errors,
        lambda entry, name: _strings(
            name, "extensions", entry.get("extensions"), FILE_EXTENSION_PATTERN, "like .mzml", errors
        ) and _encoding(name, entry, errors),
    )


def _sameness_keys(value, files, errors):
    def check(entry, name):
        before = len(errors)
        _fields(name, "fields", entry.get("fields"), errors)
        if len(errors) > before:
            return False
        if not entry["fields"]:
            errors.append(f"{name} needs at least one field")
            return False
        return True

    _each("sameness-keys", value, files, errors, check)


def _event_hooks(value, files, errors):
    def check(entry, name):
        events = entry.get("events")
        if not isinstance(events, list) or not 1 <= len(events) <= MAX_LIST_ITEMS:
            errors.append(f"{name} events needs 1-{MAX_LIST_ITEMS} event names")
            return False
        for event in events:
            if not isinstance(event, str) or not re.match(r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$", event):
                errors.append(f"{name} names an unknown event: {event}")
                return False
        if len(set(events)) != len(events):
            errors.append(f"{name} repeats an event")
            return False
        return True

    _each("event-hooks", value, files, errors, check)


_MISSING = object()


def _unique_strings(name, label, value, pattern, errors, hint):
    """A missing key is fine; a present one (even null) must be a unique, non-empty, well formed list."""
    if value is _MISSING:
        return True
    if (
        not isinstance(value, list)
        or len(value) < 1
        or not all(isinstance(item, str) and pattern.match(item) for item in value)
    ):
        errors.append(f"{name} {label} needs at least one entry, each {hint}")
        return False
    if len(set(value)) != len(value):
        errors.append(f"{name} {label} repeats an entry")
        return False
    return True


def _record_hooks(value, files, errors):
    def check(entry, name):
        when = entry.get("when")
        if (
            not isinstance(when, list)
            or len(when) < 1
            or not all(isinstance(item, str) and item in RECORD_HOOK_WHEN for item in when)
            or len(set(when)) != len(when)
        ):
            errors.append(
                f"{name} when needs one or more different entries from {', '.join(RECORD_HOOK_WHEN)}"
            )
            return False
        if entry.get("timing") not in ("before", "after"):
            errors.append(f"{name} timing must be before or after")
            return False
        if not _unique_strings(
            name, "kinds", entry.get("kinds", _MISSING), RECORD_TYPE_PATTERN, errors, "like experiment or sample"
        ):
            return False
        if not _unique_strings(
            name, "statuses", entry.get("statuses", _MISSING), STATUS_PATTERN, errors, "like in_review"
        ):
            return False
        if "statuses" in entry and "status-changed" not in when:
            errors.append(f"{name} statuses only apply to status-changed")
            return False
        if "file" in entry:
            if "uploaded" not in when:
                errors.append(f"{name} file only applies to uploaded")
                return False
            if entry["file"] not in ("text", "base64"):
                errors.append(f"{name} file encoding must be text or base64")
                return False
        return True

    _each("record-hooks", value, files, errors, check)


def _instrument_parsers(value, files, errors):
    def check(entry, name):
        if not _strings(
            name, "extensions", entry.get("extensions"), FILE_EXTENSION_PATTERN, "like .xlsx", errors
        ) or not _encoding(name, entry, errors):
            return False
        if "instrument" in entry and not _text(entry["instrument"], 1, 120):
            errors.append(f"{name} instrument must be 1-120 characters")
            return False
        if "contains" in entry:
            contains = entry["contains"]
            if (
                not isinstance(contains, list)
                or not 1 <= len(contains) <= 5
                or not all(_text(item, 1, 80) for item in contains)
                or len(set(contains)) != len(contains)
            ):
                errors.append(f"{name} contains needs 1-5 different texts of 1-80 characters")
                return False
        return True

    _each("instrument-parsers", value, files, errors, check)


def _label_formats(value, files, errors):
    _each(
        "label-formats", value, files, errors,
        lambda entry, name: _strings(
            name, "kinds", entry.get("kinds"), RECORD_TYPE_PATTERN, "like sample", errors
        ),
    )


def _barcode_formats(value, files, errors):
    def check(entry, name):
        if entry.get("shape") not in ("1d", "2d"):
            errors.append(f"{name} shape must be 1d or 2d")
            return False
        return True

    _each("barcode-formats", value, files, errors, check)


def _storage_rules(value, files, errors):
    _each("storage-rules", value, files, errors, lambda _entry, _name: True)


POINT_CHECKS = {
    "pipeline-steps": _pipeline_steps,
    "calculators": _calculators,
    "checks": _checks,
    "search-providers": _search_providers,
    "connectors": _connectors,
    "publishers": _publishers,
    "notification-channels": _notification_channels,
    "importers": _importers,
    "exporters": _exporters,
    "previews": _previews,
    "sameness-keys": _sameness_keys,
    "event-hooks": _event_hooks,
    "record-hooks": _record_hooks,
    "instrument-parsers": _instrument_parsers,
    "label-formats": _label_formats,
    "barcode-formats": _barcode_formats,
    "storage-rules": _storage_rules,
}


def _called_names_are_unique(provides, errors):
    seen = set()
    for point in CALLED:
        entries = provides.get(point)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if _is_object(entry) and isinstance(entry.get("id"), str):
                if entry["id"] in seen:
                    errors.append(f"{entry['id']} is used twice across operations, calculators, pipeline steps and publishers")
                seen.add(entry["id"])


def requirement_problem(line):
    """Why a pip requirement line is refused, or None."""
    if not isinstance(line, str):
        return "a package must be written as text"
    text = line.strip()
    if not text:
        return "a package line is empty"
    if len(text) > 300:
        return f"{text[:40]}… is too long"
    if text.startswith("-"):
        return f"{text} is a pip option, not a package: write the package name and version"
    if not REQUIREMENT_PATTERN.match(text):
        return f"{text} is not a package pip understands (for example rdkit>=2024.3 or biopython==1.84)"
    return None


def host_problem(host):
    """Why a network host is refused, or None."""
    if not isinstance(host, str):
        return "a host must be written as text"
    if len(host) > 253:
        return f"{host[:40]}… is too long"
    if not NETWORK_HOST_PATTERN.match(host):
        return (
            f"{host} is not a host name such as eutils.ncbi.nlm.nih.gov or *.ebi.ac.uk "
            "(no https://, no path, no port)"
        )
    return None


def _python_declaration(value, errors):
    if value is None:
        return
    if not _is_object(value):
        errors.append("python must be an object")
        return
    for key in value:
        if key not in ("requirements", "network"):
            errors.append(f"unknown key in python: {key}")
    for key, check in (("requirements", requirement_problem), ("network", host_problem)):
        if key not in value:
            continue
        if not isinstance(value[key], list):
            errors.append(f"python.{key} must be a list")
            continue
        for entry in value[key]:
            problem = check(entry)
            if problem:
                errors.append(f"python.{key}: {problem}")


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
    _python_declaration(manifest.get("python"), errors)
    provides = manifest.get("provides")
    if not _is_object(provides):
        errors.append("provides must be an object")
    else:
        for key in provides:
            if key not in PROVIDES:
                errors.append(f"unknown contribution point: {key}")
        if not any(provides.get(key) for key in PROVIDES):
            errors.append(
                "a plugin has to provide at least one thing: an operation, calculator, analysis kind, "
                "pipeline step, check, search, connector, importer, exporter, preview, same-thing rule, "
                "event reaction, block, panel, table cell display, column, row action, field type, page, settings page, Home widget or report section"
            )
        if "operations" in provides:
            _operations(provides["operations"], files, errors)
        if "analysis-kinds" in provides:
            _analysis_kinds(provides["analysis-kinds"], files, errors)
        for point, check in (
            ("blocks", _blocks), ("panels", _panels), ("table-cells", _table_cells),
            ("columns", _columns), ("row-actions", _row_actions), ("field-types", _field_types),
            *((point, _ui_point(point)) for point in UI_POINTS),
        ):
            if point in provides:
                check(provides[point], files, errors)
        for point, check in POINT_CHECKS.items():
            if point in provides:
                check(provides[point], files, errors)
        _called_names_are_unique(provides, errors)
        used_ui = {
            entry[key]
            for point in PROVIDES
            for entry in (provides.get(point) if isinstance(provides.get(point), list) else [])
            for key in ("ui", "render", "input")
            if _is_object(entry) and isinstance(entry.get(key), str)
        }
        if not used_ui and any(path.startswith("ui/") for path in files):
            errors.append(
                "ui/ files need a screen (a block, panel, page, widget, report section, field input or cell renderer) "
                "whose ui points at one of them"
            )
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
            errors.append(f"{path} is over {MAX_FILE_BYTES // (1024 * 1024)} MiB")
        parts = path.split("/")
        if path.startswith("/") or "\\" in path or ".." in parts or "" in parts:
            errors.append(f"{path} is not a safe path")
        elif parts[0] == "ui":
            if not UI_FILE_PATTERN.match(path):
                errors.append(f"{path}: ui/ holds .html, .js, .mjs, .css, .svg and .json files only")
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
