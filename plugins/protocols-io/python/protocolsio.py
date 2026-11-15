"""Public protocols from protocols.io: search, read and import.

Only the search words or the protocol named leave the workspace, to
www.protocols.io. The access token is a sealed setting an administrator sets in
Settings, Plugins; it arrives as ``input["_settings"]["token"]``.
"""
import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from sheetbase_plugin import PluginError, host_call

API = "https://www.protocols.io/api"
TIMEOUT = 20
MAX_STEPS = 200


def _get(path, params, input):
    token = (input.get("_settings") or {}).get("token", "").strip()
    if not token:
        raise PluginError("protocols.io needs an access token. An administrator sets it in Settings, Plugins.")
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = _json(error)
        code = (body or {}).get("status_code")
        if error.code in (401, 403) or code in (1218, 1219):
            raise PluginError("protocols.io did not accept the access token. An administrator can replace it in Settings, Plugins.")
        if error.code == 404:
            raise PluginError("protocols.io has no protocol like that.")
        if error.code == 429:
            raise PluginError("protocols.io is limiting requests. Try again in a minute.")
        raise PluginError("protocols.io did not answer. Try again.")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise PluginError("protocols.io could not be reached. Try again in a moment.")
    return body


def _json(error):
    try:
        return json.loads(error.read().decode("utf-8"))
    except (ValueError, OSError):
        return None


def plain(value):
    """Text without the markup protocols.io may still send."""
    text = str(value or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|li|div)>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _doi(value):
    return re.sub(r"^(https?://)?(dx\.)?doi\.org/", "", str(value or "").strip())


def _summary(item):
    uri = item.get("uri") or ""
    return {
        "id": item.get("id"),
        "uri": uri,
        "title": plain(item.get("title")),
        "doi": _doi(item.get("doi")),
        "url": item.get("url") or f"https://www.protocols.io/view/{uri}",
        "authors": [a.get("name") for a in (item.get("authors") or []) if a.get("name")],
        "published": _day(item.get("published_on")),
    }


def _day(stamp):
    if not stamp:
        return None
    from datetime import datetime, timezone

    return datetime.fromtimestamp(int(stamp), tz=timezone.utc).strftime("%Y-%m-%d")


def search(input):
    query = str(input.get("query") or "").strip()
    if not query:
        raise PluginError("Give something to search for.")
    limit = max(1, min(int(input.get("limit") or 8), 20))
    body = _get(
        "/v3/protocols",
        {"filter": "public", "key": query, "page_size": limit, "page_id": 0, "order_field": "activity"},
        input,
    )
    protocols = [_summary(item) for item in (body.get("items") or []) if isinstance(item, dict) and item.get("uri")]
    return {"count": len(protocols), "protocols": protocols}


def _fetch(input):
    wanted = str(input.get("protocol") or "").strip()
    wanted = re.sub(r"^https?://www\.protocols\.io/view/", "", wanted)
    if not wanted or len(wanted) > 300 or re.search(r"[\s?#]", wanted):
        raise PluginError("Name a protocol by its id, uri or DOI.")
    body = _get(f"/v4/protocols/{urllib.parse.quote(wanted, safe='/.-_')}", {"content_format": "markdown"}, input)
    payload = body.get("payload")
    if not isinstance(payload, dict):
        raise PluginError("protocols.io sent a protocol this app could not read.")
    steps = []
    for raw in payload.get("steps") or []:
        if not isinstance(raw, dict):
            continue
        text = plain(raw.get("step"))
        if not text:
            continue
        steps.append({"number": len(steps) + 1, "section": plain(raw.get("section")), "text": text})
        if len(steps) >= MAX_STEPS:
            break
    reagents = []
    for raw in payload.get("materials") or []:
        if not isinstance(raw, dict) or not plain(raw.get("name")):
            continue
        vendor = plain((raw.get("vendor") or {}).get("name"))
        sku = plain(raw.get("sku"))
        detail = ", ".join(part for part in (vendor, sku) if part)
        reagents.append(plain(raw.get("name")) + (f" ({detail})" if detail else ""))
    description = "\n\n".join(
        part
        for part in (
            plain(payload.get("description")),
            ("Before you start: " + plain(payload.get("before_start"))) if plain(payload.get("before_start")) else "",
            ("Warning: " + plain(payload.get("warning"))) if plain(payload.get("warning")) else "",
        )
        if part
    )
    return {**_summary(payload), "description": description, "steps": steps, "reagents": reagents}


def read(input):
    protocol = _fetch(input)
    if not protocol["steps"]:
        raise PluginError("That protocol has no steps to read.")
    return {key: protocol[key] for key in ("title", "url", "doi", "authors", "description", "steps", "reagents")}


def import_protocol(input):
    """Reads the protocol, then makes it a draft protocol with the lab action the API and the assistant use."""
    protocol = _fetch(input)
    if not protocol["steps"]:
        raise PluginError("That protocol has no steps to import.")
    title = str(input.get("title") or "").strip() or protocol["title"] or "Imported protocol"
    made = host_call(
        "sheetbase.lab.act",
        {
            "action": "import_protocol",
            "arguments": {
                "p_title": title[:200],
                "p_steps": [{"text": s["text"], "section": s["section"]} for s in protocol["steps"]],
                "p_description": protocol["description"],
                "p_reagents": protocol["reagents"],
                "p_source": {"provider": "protocols.io", "url": protocol["url"], "doi": protocol["doi"]},
            },
        },
    )
    record = (made or {}).get("record") or {}
    return {"identifier": record.get("identifier") or "", "title": title, "steps": (made or {}).get("steps") or len(protocol["steps"])}
