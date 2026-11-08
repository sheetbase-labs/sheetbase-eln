import re
from urllib.parse import quote

from sheetbase_plugin import PluginError


def _squash(text):
    """'EXP-0145' and 'exp 145' both become 'exp145'."""
    return re.sub(r"(?<!\d)0+(?=\d)", "", re.sub(r"[^a-z0-9]", "", str(text).lower()))


def search(input):
    """A search provider gets the query and the documents it may look through."""
    wanted = _squash(input["query"])
    if not wanted:
        return {"hits": []}
    hits = []
    for document in input["documents"]:
        identifier = _squash(document.get("fields", {}).get("identifier", ""))
        title = _squash(document.get("title", ""))
        if wanted == identifier:
            hits.append({"id": document["id"], "score": 1.0, "snippet": "Same identifier"})
        elif wanted in identifier:
            hits.append({"id": document["id"], "score": 0.8, "snippet": "Part of the identifier"})
        elif wanted in title:
            hits.append({"id": document["id"], "score": 0.5, "snippet": "Part of the name"})
    hits.sort(key=lambda hit: -hit["score"])
    return {"hits": hits[:100]}


def plan_pubchem(input):
    """A connector first says which addresses to call. Sheetbase makes the calls."""
    name = str(input["parameters"]["compound"]).strip()
    if not name:
        raise PluginError("Give a compound name.")
    url = (
        "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/"
        + quote(name)
        + "/property/MolecularFormula,MolecularWeight,CanonicalSMILES/JSON"
    )
    return {"requests": [{"url": url}]}


def parse_pubchem(input):
    """Then it turns what came back into rows."""
    response = input["responses"][0]
    if response["status"] == 404:
        raise PluginError("PubChem does not know a compound with that name.")
    properties = (response["json"] or {}).get("PropertyTable", {}).get("Properties", [])
    return [
        {
            "cid": item.get("CID"),
            "formula": item.get("MolecularFormula"),
            "mass": float(item["MolecularWeight"]) if item.get("MolecularWeight") else None,
            "smiles": item.get("CanonicalSMILES") or item.get("ConnectivitySMILES"),
        }
        for item in properties
    ]
