"""Converts an instrument export to Allotrope Simple Model (ASM) JSON.

Runs inside the isolated Python runtime (`transform(inputs, parameters)`), which
has the pinned `allotropy` package and no network. Two modes:

  parameters.mode == "vendors"  -> one row per converter the image offers
  parameters.mode == "convert"  -> one row: the ASM document, its manifest and
                                   technique, and a flat table of measurements

The app reads the answer; nothing here writes to Sheetbase.
"""
import base64
import io
import os
import re

MAX_TABLE_ROWS = 20000
MAX_COLUMNS = 200


def _vendors():
    from allotropy.parser_factory import Vendor

    rows = []
    for vendor in Vendor:
        if str(vendor.name).startswith("EXAMPLE"):
            continue
        try:
            extensions = list(vendor.supported_extensions)
        except Exception:
            extensions = []
        rows.append(
            {
                "key": vendor.name,
                "name": vendor.display_name,
                "technique": vendor.technique,
                "extensions": ",".join(extensions),
                "release_state": str(getattr(vendor.release_state, "value", vendor.release_state)),
            }
        )
    rows.sort(key=lambda row: row["name"].lower())
    return rows


def _scalar(value):
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float, str)):
        return value
    return None


def _leaves(node, prefix=""):
    """Flatten one object to {name: scalar}. `{value, unit}` becomes name and name unit."""
    out = {}
    if not isinstance(node, dict):
        return out
    if "value" in node and "unit" in node and len(node) <= 3 and not isinstance(node["value"], (dict, list)):
        out[prefix] = node["value"]
        out[prefix + " unit"] = node["unit"]
        return out
    for key, value in node.items():
        if key.startswith(("@", "$")) or key in ("field @index", "measurement identifier"):
            continue
        name = (prefix + " " + key).strip() if prefix else key
        if isinstance(value, dict):
            out.update(_leaves(value, name))
        elif isinstance(value, list):
            continue
        else:
            scalar = _scalar(value)
            if scalar is not None:
                out[name] = scalar
    return out


def _walk(node, context, rows):
    if isinstance(node, dict):
        mine = dict(context)
        mine.update(_leaves({k: v for k, v in node.items() if not isinstance(v, (list, dict)) or k in ("device control aggregate document",)}))
        for key, value in node.items():
            if key == "measurement document" and isinstance(value, list):
                for measurement in value:
                    row = dict(mine)
                    row.update(_leaves(measurement))
                    rows.append(row)
            elif isinstance(value, (dict, list)):
                _walk(value, mine, rows)
    elif isinstance(node, list):
        for item in node:
            _walk(item, context, rows)


def _short(name):
    return re.sub(r"\s+", " ", name).strip()


def _table(asm):
    rows = []
    _walk(asm, {}, rows)
    warnings = []
    if len(rows) > MAX_TABLE_ROWS:
        warnings.append("Only the first %d measurements are in the table; the full document is kept." % MAX_TABLE_ROWS)
        rows = rows[:MAX_TABLE_ROWS]
    columns = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    if len(columns) > MAX_COLUMNS:
        warnings.append("Only the first %d columns are in the table; the full document is kept." % MAX_COLUMNS)
        columns = columns[:MAX_COLUMNS]
    table = []
    for row in rows:
        table.append({_short(c): ("" if row.get(c) is None else str(row.get(c))) for c in columns})
    return [_short(c) for c in columns], table, warnings


def _manifest_of(asm):
    manifest = asm.get("$asm.manifest")
    if isinstance(manifest, dict):
        return manifest.get("href") or manifest.get("value") or ""
    return manifest or ""


def _technique_of(asm):
    for key in asm:
        if key.endswith("aggregate document") and key != "$asm.manifest":
            return key[: -len(" aggregate document")]
    return ""


def _device_of(asm):
    """The first device system document: who made the instrument that wrote the file."""
    found = []

    def look(node):
        if found:
            return
        if isinstance(node, dict):
            document = node.get("device system document")
            if isinstance(document, dict):
                found.append(_leaves(document))
                return
            for value in node.values():
                look(value)
        elif isinstance(node, list):
            for item in node:
                look(item)

    look(asm)
    return found[0] if found else {}


def _measurement_count(asm):
    rows = []
    _walk(asm, {}, rows)
    return len(rows)


def _convert(inputs, parameters):
    import importlib.metadata

    allotropy_version = importlib.metadata.version("allotropy")
    from allotropy.parser_factory import Vendor
    from allotropy.to_allotrope import allotrope_from_io

    files = inputs.get("file") or []
    if len(files) != 1:
        raise ValueError("Give exactly one file to convert")
    name = os.path.basename(str(files[0].get("name") or "file"))
    data = base64.b64decode(files[0]["content_b64"])
    vendor_key = parameters.get("vendor")
    vendor = Vendor[vendor_key] if vendor_key else None
    asm = allotrope_from_io(io.BytesIO(data), name, vendor)
    columns, table, warnings = _table(asm)
    return [
        {
            "asm": asm,
            "manifest": _manifest_of(asm),
            "technique": _technique_of(asm),
            "vendor": vendor.name if vendor else "",
            "converter": "allotropy",
            "converter_version": allotropy_version,
            "measurements": _measurement_count(asm),
            "device": _device_of(asm),
            "columns": columns,
            "table": table,
            "warnings": warnings,
        }
    ]


def transform(inputs, parameters):
    if parameters.get("mode") == "vendors":
        return _vendors()
    return _convert(inputs, parameters)
