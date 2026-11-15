"""Ontology terms from the EBI Ontology Lookup Service (OLS4)."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from sheetbase_plugin import PluginError

URL = "https://www.ebi.ac.uk/ols4/api/search"
DEFAULTS = ["obi", "chebi", "cl", "clo", "efo", "bto", "uberon", "ncbitaxon", "uo"]
KNOWN = {"obi", "chebi", "cl", "uberon", "ncbitaxon", "uo", "efo", "go", "bao", "clo", "bto", "pato"}


def _description(value):
    for candidate in value if isinstance(value, list) else [value]:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()[:400]
    return None


def search(input):
    query = str(input.get("query") or "").strip()
    if len(query) < 2:
        raise PluginError("Give at least two letters to search for.")
    asked = [o.strip().lower() for o in str(input.get("ontologies") or "").split(",") if o.strip()]
    ontologies = [o for o in asked if o in KNOWN] or DEFAULTS
    rows = max(1, min(int(input.get("limit") or 15), 30))
    params = {
        "q": query,
        "rows": rows,
        "obsoletes": "false",
        "fieldList": "iri,label,ontology_name,short_form,description",
        "ontology": ",".join(ontologies),
    }
    try:
        with urllib.request.urlopen(f"{URL}?{urllib.parse.urlencode(params)}", timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise PluginError("The ontology service did not answer. Try again in a moment.")
    terms, seen = [], set()
    for doc in ((body.get("response") or {}).get("docs") or []):
        if not isinstance(doc, dict) or not re.match(r"^https?://", str(doc.get("iri") or "")):
            continue
        if doc["iri"] in seen or not doc.get("label"):
            continue
        seen.add(doc["iri"])
        terms.append(
            {
                "iri": doc["iri"],
                "label": doc["label"],
                "ontology": str(doc.get("ontology_name") or "").lower(),
                "short_id": doc.get("short_form"),
                "description": _description(doc.get("description")),
            }
        )
    return {"count": len(terms), "terms": terms}
