"""Describe a screen in Python and let Sheetbase draw it.

A block, a panel or a row action can show a screen. You do not write any
page code: you return a description made from these parts, and Sheetbase draws
it with its own components, so it looks like the rest of the app, follows dark
mode and works on a phone::

    from sheetbase_plugin import ui

    def screen(payload):
        live = (payload["state"] or {}).get("live", 0)
        return ui.screen(
            ui.stack(
                ui.heading("Viability"),
                ui.form(
                    ui.number_input("live", "Live cells", value=live, required=True),
                    submit=ui.submit("Work it out", "work"),
                ),
                ui.bar(92, max=100, label="92 %", tone="success"),
            ),
            state={"live": live},
        )

``payload`` is ``{"context": ..., "state": ..., "event": ...}``. ``event`` is
``None`` the first time and ``{"action": "work", "values": {...}}`` after a
person presses a button or sends a form. Return ``ui.screen(...)`` with the new
``state`` to keep.

``validate_view`` checks a view the way Sheetbase does before it draws it, so
``sheetbase-plugin dev`` can tell you about a problem before an upload does. The
same cases are run against the app's checker (``tests/screen_cases.json``).
"""
import json
import re

TONES = ("neutral", "success", "warning", "danger", "info")
LIMITS = {
    "depth": 8,
    "nodes": 300,
    "text": 2000,
    "label": 120,
    "table_rows": 200,
    "table_columns": 12,
    "sparkline": 400,
    "options": 50,
    "svg_bytes": 64 * 1024,
    "state_bytes": 64 * 1024,
}
_NAME = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
_ACTION = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
_PATH = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$")


# ---------------------------------------------------------------------------
# Builders. They only make dictionaries; leaving an argument out leaves the key out.
# ---------------------------------------------------------------------------

def _node(node_type, /, **fields):
    node = {"type": node_type}
    node.update({k: v for k, v in fields.items() if v is not None})
    return node


def screen(view, state=None, notice=None):
    """What a screen function returns: the view, the state to keep and an optional notice."""
    return {k: v for k, v in {"view": view, "state": state, "notice": notice}.items() if v is not None}


def notice(text, tone="neutral"):
    return {"tone": tone, "text": text}


def stack(*children, direction=None, gap=None):
    return _node("stack", direction=direction, gap=gap, children=list(children))


def row(*children, gap=None):
    return stack(*children, direction="row", gap=gap)


def heading(text, level=None):
    return _node("heading", text=text, level=level)


def text(text, tone=None):
    return _node("text", text=text, tone=tone)


def stat(label, value, unit=None, tone=None):
    return _node("stat", label=label, value=value, unit=unit, tone=tone)


def badge(text, tone=None):
    return _node("badge", text=text, tone=tone)


def bar(value, max=None, label=None, tone=None):
    return _node("bar", value=value, max=max, label=label, tone=tone)


def sparkline(values, tone=None):
    return _node("sparkline", values=list(values), tone=tone)


def table(columns, rows):
    """``columns`` is ``[{"key": "name", "label": "Name"}]``; ``rows`` are dictionaries keyed the same."""
    return _node("table", columns=list(columns), rows=list(rows))


def svg(markup, title):
    return _node("svg", svg=markup, title=title)


def input(name, label, kind=None, options=None, value=None, required=None, help=None):
    return _node("input", name=name, label=label, kind=kind, options=options, value=value, required=required, help=help)


def number_input(name, label, **kwargs):
    return input(name, label, kind="number", **kwargs)


def select(name, label, options, **kwargs):
    """``options`` is a list of ``(value, label)`` pairs or ``{"value", "label"}`` dictionaries."""
    cleaned = [o if isinstance(o, dict) else {"value": o[0], "label": o[1]} for o in options]
    return input(name, label, kind="select", options=cleaned, **kwargs)


def checkbox(name, label, **kwargs):
    return input(name, label, kind="checkbox", **kwargs)


def button(label, action, variant=None):
    return _node("button", label=label, action=action, variant=variant)


def submit(label, action):
    return {"label": label, "action": action}


def form(*children, submit):
    return _node("form", children=list(children), submit=submit)


def link(text, to):
    return _node("link", text=text, to=to)


def divider():
    return _node("divider")


# ---------------------------------------------------------------------------
# The check. Mirrors src/lib/extensions/screens.ts.
# ---------------------------------------------------------------------------

class _Walk:
    def __init__(self):
        self.nodes = 0
        self.errors = []

    def fail(self, path, message):
        if len(self.errors) < 20:
            self.errors.append(f"{path}: {message}")
        return False


def _is_text(value, low, high):
    return isinstance(value, str) and low <= len(value) <= high


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float("inf")


def _only(walk, path, node, allowed):
    extra = next((k for k in node if k not in allowed), None)
    if extra is not None:
        return walk.fail(path, f"unknown setting {extra}")
    return True


def _children(walk, value, path, depth):
    if not isinstance(value, list) or len(value) > 60:
        return walk.fail(path, "children is a list of up to 60 parts")
    return all(_node_ok(walk, child, f"{path}[{i}]", depth + 1) for i, child in enumerate(value))


def _node_ok(walk, node, path, depth):
    walk.nodes += 1
    if walk.nodes > LIMITS["nodes"]:
        return walk.fail(path, f"a screen has at most {LIMITS['nodes']} parts")
    if depth > LIMITS["depth"]:
        return walk.fail(path, f"parts nest at most {LIMITS['depth']} deep")
    if not isinstance(node, dict) or not isinstance(node.get("type"), str):
        return walk.fail(path, "every part needs a type")
    kind = node["type"]
    at = f"{path}({kind})"
    tone_ok = lambda allowed=TONES: node.get("tone") is None or node.get("tone") in allowed  # noqa: E731
    if kind == "stack":
        if not _only(walk, at, node, ("type", "direction", "gap", "children")):
            return False
        if node.get("direction") not in (None, "column", "row") or node.get("gap") not in (None, "sm", "md", "lg"):
            return walk.fail(at, "direction is column or row, gap is sm, md or lg")
        return _children(walk, node.get("children"), at, depth)
    if kind == "heading":
        return (
            _only(walk, at, node, ("type", "text", "level"))
            and (_is_text(node.get("text"), 1, LIMITS["label"]) or walk.fail(at, "text must be 1-120 characters"))
            and (node.get("level") in (None, 1, 2, 3) or walk.fail(at, "level is 1, 2 or 3"))
        )
    if kind == "text":
        return (
            _only(walk, at, node, ("type", "text", "tone"))
            and (_is_text(node.get("text"), 0, LIMITS["text"]) or walk.fail(at, "text must be 0-2000 characters"))
            and (tone_ok(("muted", "success", "danger")) or walk.fail(at, "tone is muted, success or danger"))
        )
    if kind == "stat":
        value = node.get("value")
        return (
            _only(walk, at, node, ("type", "label", "value", "unit", "tone"))
            and (_is_text(node.get("label"), 1, LIMITS["label"]) or walk.fail(at, "label must be 1-120 characters"))
            and (_number(value) or _is_text(value, 0, 60) or walk.fail(at, "value is a number or up to 60 characters"))
            and (node.get("unit") is None or _is_text(node["unit"], 1, 20) or walk.fail(at, "unit must be 1-20 characters"))
            and (tone_ok() or walk.fail(at, "unknown tone"))
        )
    if kind == "badge":
        return (
            _only(walk, at, node, ("type", "text", "tone"))
            and (_is_text(node.get("text"), 1, 60) or walk.fail(at, "text must be 1-60 characters"))
            and (tone_ok() or walk.fail(at, "unknown tone"))
        )
    if kind == "bar":
        return (
            _only(walk, at, node, ("type", "value", "max", "label", "tone"))
            and (_number(node.get("value")) or walk.fail(at, "value is a number"))
            and (node.get("max") is None or (_number(node["max"]) and node["max"] > 0) or walk.fail(at, "max is a number above 0"))
            and (node.get("label") is None or _is_text(node["label"], 1, 60) or walk.fail(at, "label must be 1-60 characters"))
            and (tone_ok() or walk.fail(at, "unknown tone"))
        )
    if kind == "sparkline":
        values = node.get("values")
        return (
            _only(walk, at, node, ("type", "values", "tone"))
            and (
                (isinstance(values, list) and 2 <= len(values) <= LIMITS["sparkline"] and all(_number(v) for v in values))
                or walk.fail(at, f"values are 2-{LIMITS['sparkline']} numbers")
            )
            and (tone_ok() or walk.fail(at, "unknown tone"))
        )
    if kind == "table":
        if not _only(walk, at, node, ("type", "columns", "rows")):
            return False
        columns, rows = node.get("columns"), node.get("rows")
        if not isinstance(columns, list) or not 1 <= len(columns) <= LIMITS["table_columns"]:
            return walk.fail(at, f"a table has 1-{LIMITS['table_columns']} columns")
        keys = set()
        for column in columns:
            if (
                not isinstance(column, dict)
                or not isinstance(column.get("key"), str)
                or not _NAME.match(column["key"])
                or column["key"] in keys
                or not _is_text(column.get("label"), 1, 60)
                or column.get("align") not in (None, "start", "end")
                or any(k not in ("key", "label", "align") for k in column)
            ):
                return walk.fail(at, "columns need a unique key (a-z, 0-9, _), a label and an optional align")
            keys.add(column["key"])
        if not isinstance(rows, list) or len(rows) > LIMITS["table_rows"]:
            return walk.fail(at, f"a table has at most {LIMITS['table_rows']} rows")
        for entry in rows:
            if not isinstance(entry, dict):
                return walk.fail(at, "each row is an object")
            for key in keys:
                cell = entry.get(key)
                if cell is None or isinstance(cell, bool):
                    continue
                if not (_number(cell) or (isinstance(cell, str) and len(cell) <= 300)):
                    return walk.fail(at, "cells are text (up to 300 characters), numbers, true/false or empty")
        return True
    if kind == "svg":
        return (
            _only(walk, at, node, ("type", "svg", "title"))
            and (
                (isinstance(node.get("svg"), str) and len(node["svg"].encode("utf-8")) <= LIMITS["svg_bytes"])
                or walk.fail(at, "svg is text up to 64 KiB")
            )
            and (_is_text(node.get("title"), 1, LIMITS["label"]) or walk.fail(at, "title must be 1-120 characters"))
        )
    if kind == "input":
        if not _only(walk, at, node, ("type", "name", "label", "kind", "options", "value", "required", "help")):
            return False
        if not isinstance(node.get("name"), str) or not _NAME.match(node["name"]):
            return walk.fail(at, "name matches ^[a-z][a-z0-9_]{0,47}$")
        if not _is_text(node.get("label"), 1, LIMITS["label"]):
            return walk.fail(at, "label must be 1-120 characters")
        input_kind = node.get("kind", "text")
        if input_kind not in ("text", "number", "select", "checkbox", "date"):
            return walk.fail(at, "kind is text, number, select, checkbox or date")
        options = node.get("options")
        if input_kind == "select":
            if not (
                isinstance(options, list)
                and 1 <= len(options) <= LIMITS["options"]
                and all(
                    isinstance(o, dict)
                    and isinstance(o.get("value"), str)
                    and len(o["value"]) <= 100
                    and _is_text(o.get("label"), 1, 100)
                    for o in options
                )
            ):
                return walk.fail(at, f"a select needs 1-{LIMITS['options']} options of {{ value, label }}")
        elif options is not None:
            return walk.fail(at, "only a select has options")
        value = node.get("value")
        if value is not None and not (isinstance(value, (str, bool)) or _number(value)):
            return walk.fail(at, "value is text, a number or true/false")
        if node.get("required") is not None and not isinstance(node["required"], bool):
            return walk.fail(at, "required is true or false")
        if node.get("help") is not None and not _is_text(node["help"], 1, 300):
            return walk.fail(at, "help must be 1-300 characters")
        return True
    if kind == "button":
        return (
            _only(walk, at, node, ("type", "label", "action", "variant"))
            and (_is_text(node.get("label"), 1, 60) or walk.fail(at, "label must be 1-60 characters"))
            and (
                (isinstance(node.get("action"), str) and _ACTION.match(node["action"]))
                or walk.fail(at, "action matches ^[a-z][a-z0-9_-]{0,47}$")
            )
            and (node.get("variant") in (None, "primary", "secondary") or walk.fail(at, "variant is primary or secondary"))
        )
    if kind == "form":
        if not _only(walk, at, node, ("type", "children", "submit")):
            return False
        sub = node.get("submit")
        if not (
            isinstance(sub, dict)
            and _is_text(sub.get("label"), 1, 60)
            and isinstance(sub.get("action"), str)
            and _ACTION.match(sub["action"])
            and all(k in ("label", "action") for k in sub)
        ):
            return walk.fail(at, "submit needs a label and an action")
        return _children(walk, node.get("children"), at, depth)
    if kind == "link":
        to = node.get("to")
        return (
            _only(walk, at, node, ("type", "text", "to"))
            and (_is_text(node.get("text"), 1, 100) or walk.fail(at, "text must be 1-100 characters"))
            and (
                (isinstance(to, str) and len(to) <= 300 and not to.startswith("//") and _PATH.match(to))
                or walk.fail(at, "to is a path inside Sheetbase, such as /records/…, never a web address")
            )
        )
    if kind == "divider":
        return _only(walk, at, node, ("type",))
    return walk.fail(path, f"unknown part type {kind}")


def validate_screen(result):
    """Every problem with a screen function's answer, as a list of sentences."""
    walk = _Walk()
    if not isinstance(result, dict):
        return ["a screen returns an object"]
    for key in result:
        if key not in ("view", "state", "notice"):
            walk.errors.append(f"unknown key in a screen's answer: {key}")
    if walk.errors:
        return walk.errors
    _node_ok(walk, result.get("view"), "view", 1)
    note = result.get("notice")
    if note is not None and not (
        isinstance(note, dict)
        and note.get("tone") in TONES
        and _is_text(note.get("text"), 1, 300)
        and all(k in ("tone", "text") for k in note)
    ):
        walk.errors.append("notice needs a tone and text of up to 300 characters")
    if result.get("state") is not None:
        try:
            if len(json.dumps(result["state"]).encode("utf-8")) > LIMITS["state_bytes"]:
                walk.errors.append("state is data up to 64 KiB")
        except (TypeError, ValueError):
            walk.errors.append("state is data up to 64 KiB")
    return walk.errors
