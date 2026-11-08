"""How a plugin says to draw a table cell, without running any code in the table.

A display is data: ``{"kind": "badge", "tones": {"pass": "success", "fail": "danger"}}``.
These are the same checks as ``src/lib/extensions/cell-display.ts`` in the app;
``tests/package_cases.json`` runs the same cases against both.
"""
import math

TONES = ("neutral", "success", "warning", "danger", "info")
KINDS = ("text", "number", "badge", "bar", "sparkline", "svg")


def _short(value, high=40):
    return isinstance(value, str) and 1 <= len(value) <= high


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _only(spec, allowed, where, errors):
    extra = next((k for k in spec if k not in allowed), None)
    if extra is not None:
        errors.append(f"{where} has an unknown setting: {extra}")
        return False
    return True


def check_display(spec, where, errors):
    """Append every problem with a display spec to ``errors``."""
    if not isinstance(spec, dict) or not isinstance(spec.get("kind"), str):
        errors.append(f"{where} display needs a kind")
        return
    kind = spec["kind"]
    if kind == "text":
        if not _only(spec, ("kind", "prefix", "suffix", "mono"), where, errors):
            return
        if (
            ("prefix" in spec and not _short(spec["prefix"]))
            or ("suffix" in spec and not _short(spec["suffix"]))
            or ("mono" in spec and not isinstance(spec["mono"], bool))
        ):
            errors.append(f"{where} text display: prefix and suffix are 1-40 characters, mono is true or false")
    elif kind == "number":
        if not _only(spec, ("kind", "decimals", "unit", "grouping"), where, errors):
            return
        decimals = spec.get("decimals")
        if (
            ("decimals" in spec and not (isinstance(decimals, int) and not isinstance(decimals, bool) and 0 <= decimals <= 8))
            or ("unit" in spec and not _short(spec["unit"], 12))
            or ("grouping" in spec and not isinstance(spec["grouping"], bool))
        ):
            errors.append(f"{where} number display: decimals is 0-8, unit is 1-12 characters, grouping is true or false")
    elif kind == "badge":
        if not _only(spec, ("kind", "tones", "labels", "fallback"), where, errors):
            return
        tones = spec.get("tones")
        if not (
            isinstance(tones, dict)
            and 1 <= len(tones) <= 24
            and all(_short(k, 60) and v in TONES for k, v in tones.items())
        ):
            errors.append(f"{where} badge display needs tones: 1-24 values, each one of {', '.join(TONES)}")
            return
        labels = spec.get("labels")
        if "labels" in spec and not (
            isinstance(labels, dict) and len(labels) <= 24 and all(_short(k, 60) and _short(v, 40) for k, v in labels.items())
        ):
            errors.append(f"{where} badge labels are up to 24 short words")
        if "fallback" in spec and spec["fallback"] not in TONES:
            errors.append(f"{where} badge fallback must be a tone")
    elif kind == "bar":
        if not _only(spec, ("kind", "min", "max", "tone", "thresholds", "showValue"), where, errors):
            return
        low = spec.get("min", 0)
        if (
            not _is_number(low)
            or not _is_number(spec.get("max"))
            or spec["max"] <= low
            or ("tone" in spec and spec["tone"] not in TONES)
            or ("showValue" in spec and not isinstance(spec["showValue"], bool))
        ):
            errors.append(f"{where} bar display needs a max above its min (default 0), an optional tone and showValue")
            return
        thresholds = spec.get("thresholds")
        if "thresholds" in spec and not (
            isinstance(thresholds, list)
            and len(thresholds) <= 6
            and all(isinstance(t, dict) and _is_number(t.get("below")) and t.get("tone") in TONES for t in thresholds)
        ):
            errors.append(f"{where} bar thresholds are up to 6 of {{ below, tone }}")
    elif kind == "sparkline":
        if _only(spec, ("kind", "tone"), where, errors) and "tone" in spec and spec["tone"] not in TONES:
            errors.append(f"{where} sparkline tone must be a tone")
    elif kind == "svg":
        _only(spec, ("kind",), where, errors)
    else:
        errors.append(f"{where} display kind {kind} is unknown (use {', '.join(KINDS)})")
