"""Checks a plugin's inputs and outputs against what ``plugin.json`` declared.

Sheetbase does the same on the server, before a plugin sees an input and again
on what it returns, so a wrong type is a plain message and never a crash.
"""
import math
import re

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ValueProblem(ValueError):
    """An input or an answer that does not match the declaration."""


def _matches(kind, value):
    if kind == "text":
        return isinstance(value, str)
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "date":
        return isinstance(value, str) and _DATE.match(value) is not None
    return value is not None


def check_values(fields, value, what):
    """Return only the declared fields of ``value``; raise ``ValueProblem`` otherwise."""
    if not isinstance(value, dict):
        raise ValueProblem(
            "The input has to be an object of named values."
            if what == "input"
            else "The plugin's answer is not an object of named values."
        )
    out = {}
    for field in fields:
        name = field["name"]
        if value.get(name) is None:
            if field["required"]:
                raise ValueProblem(
                    f"“{name}” is needed."
                    if what == "input"
                    else f"The plugin's answer is missing “{name}”."
                )
            continue
        if not _matches(field["type"], value[name]):
            article = "a value" if field["type"] == "json" else f"a {field['type']}"
            raise ValueProblem(f"“{name}” should be {article}.")
        out[name] = value[name]
    if what == "input":
        declared = {field["name"] for field in fields}
        for key in value:
            if key not in declared:
                raise ValueProblem(f"“{key}” is not something this plugin reads.")
    return out
