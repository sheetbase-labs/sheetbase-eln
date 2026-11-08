"""Chemistry for Sheetbase, with RDKit.

A structure is kept as a molfile. The parent of a drawing is its largest piece,
neutralised, with every other piece (a chloride, a sodium, water, a solvent)
set aside as a salt. Two compounds are the same when their parents are.
"""
import re

from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors
from rdkit.Chem.MolStandardize import rdMolStandardize

from sheetbase_plugin import PluginError, host_call

RDLogger.DisableLog("rdApp.*")

_CHOOSER = rdMolStandardize.LargestFragmentChooser(preferOrganic=True)
_UNCHARGER = rdMolStandardize.Uncharger()


def _is_molfile(text):
    return bool(re.search(r"M {2}END|V2000|V3000", text)) or "\n" in text


def read(text):
    """A molecule from a molfile or a SMILES line, or None."""
    text = str(text or "")
    if not text.strip():
        return None
    mol = Chem.MolFromMolBlock(text) if _is_molfile(text) else Chem.MolFromSmiles(text.strip())
    if mol is None or mol.GetNumAtoms() == 0:
        return None
    return mol


def split(mol):
    """The parent and the SMILES of the pieces set aside."""
    pieces = Chem.GetMolFrags(mol, asMols=True)
    if len(pieces) <= 1:
        return mol, []
    parent = _CHOOSER.choose(mol)
    parent = _UNCHARGER.uncharge(parent)
    kept = Chem.MolToSmiles(parent)
    aside = [Chem.MolToSmiles(p) for p in pieces]
    # Drop one copy of the parent from the pieces; the rest are salts.
    for index, smiles in enumerate(aside):
        if smiles == kept or Chem.MolToSmiles(_UNCHARGER.uncharge(pieces[index])) == kept:
            del aside[index]
            break
    return parent, aside


def _molfile(mol):
    if mol.GetNumConformers() == 0:
        mol = Chem.Mol(mol)
        AllChem.Compute2DCoords(mol)
    return Chem.MolToMolBlock(mol)


def describe(input):
    mol = read(input["structure"])
    if mol is None:
        raise PluginError("That is not a structure Sheetbase can read. Use a molfile or a SMILES line.")
    parent, salts = split(mol)
    return {
        "formula": rdMolDescriptors.CalcMolFormula(parent),
        "mass": round(Descriptors.MolWt(parent), 3),
        "parent_smiles": Chem.MolToSmiles(parent),
        "salts": salts,
        "molfile": input["structure"] if _is_molfile(input["structure"]) else _molfile(mol),
    }


def parent_key(values):
    """The same-thing rule: two entries with the same key are the same compound."""
    mol = read(values["structure"])
    if mol is None:
        raise PluginError("The structure could not be read, so it cannot be checked against the registry.")
    parent, _ = split(mol)
    return {"key": Chem.MolToSmiles(parent)}


# Search ----------------------------------------------------------------------

_QUERY = re.compile(r"^\s*(sub|sim|substructure|similarity)\s*:\s*(.+?)\s*$", re.I | re.S)


def _molfile_in(text):
    """The molfile inside some text, or None."""
    end = text.find("M  END")
    if end < 0:
        return None
    head = text[:end]
    counts = list(re.finditer(r"^[ 0-9]{3}[ 0-9]{3}.*V[23]000", head, re.M))
    if not counts:
        return None
    start = counts[-1].start()
    for _ in range(3):  # title, program and comment lines
        start = head.rfind("\n", 0, max(start - 1, 0)) + 1
    return text[start : end + 6]


def _fingerprint(mol):
    return AllChem.GetMorganFingerprintAsBitVect(mol, 2, 2048)


# The index ---------------------------------------------------------------------
# Each compound gets an entry in the plugin's "structures" index: the bits of its
# pattern fingerprint as words (a compound that contains a structure has all the
# structure's bits, so the database can narrow substructure search to the
# compounds that have them) and a short fingerprint vector (the database can
# order compounds by how alike they are). The plugin then checks what the index
# found, so the index only has to be quick, not exact.

PATTERN_BITS = 2048
SIMILARITY_BITS = 512
SUBSTRUCTURE_CANDIDATES = 5000
SIMILARITY_CANDIDATES = 500


def _pattern_words(mol):
    return " ".join(f"p{bit}" for bit in Chem.PatternFingerprint(mol, fpSize=PATTERN_BITS).GetOnBits())


def _similarity_vector(mol):
    fp = AllChem.GetMorganFingerprintAsBitVect(mol, 2, SIMILARITY_BITS)
    return [float(bit) for bit in fp.ToList()]


def index(input):
    """After a compound is saved: put its structure in the index."""
    record = input.get("record") or {}
    target = None
    for value in (record.get("custom_fields") or {}).values():
        if isinstance(value, str) and "M  END" in value:
            block = _molfile_in(value) or _molfile_in("\n" + value)
            target = read(block) if block else None
            if target is not None:
                break
    if target is None:
        return {}
    parent, _ = split(target)
    return {
        "index": [
            {
                "index": "structures",
                "entry": "main",
                "text": _pattern_words(target),
                "vector": _similarity_vector(parent),
            }
        ]
    }


def _plan(mode, query):
    """Which compounds are worth checking: the index answers, then search runs again on those."""
    if mode == "sub":
        words = _pattern_words(query)
        if not words:
            raise PluginError("Draw a little more of the structure to look for.")
        return {
            "hits": [],
            "nearest": {"index": "structures", "text": words, "verify": True, "limit": SUBSTRUCTURE_CANDIDATES},
        }
    return {
        "hits": [],
        "nearest": {
            "index": "structures",
            "vector": _similarity_vector(split(query)[0]),
            "verify": True,
            "limit": SIMILARITY_CANDIDATES,
        },
    }


def search(input):
    """sub:<SMILES or molfile> finds compounds that contain it, sim:<...> compounds that look like it."""
    match = _QUERY.match(input["query"])
    if not match:
        return {"hits": []}
    mode = "sim" if match.group(1).lower().startswith("sim") else "sub"
    source = match.group(2)
    query = read(source)
    if query is None and mode == "sub":
        query = Chem.MolFromSmarts(source)
    if query is None:
        raise PluginError("The structure to look for could not be read.")
    if input.get("stage") == "plan":
        return _plan(mode, query)
    query_fp = _fingerprint(split(query)[0]) if mode == "sim" else None
    hits = []
    for document in input["documents"]:
        target = None
        for value in (document.get("fields") or {}).values():
            if isinstance(value, str) and "M  END" in value:
                block = _molfile_in(value) or _molfile_in("\n" + value)
                target = read(block) if block else None
                if target is not None:
                    break
        if target is None:
            continue
        parent, _ = split(target)
        if mode == "sub":
            if parent.HasSubstructMatch(query) or target.HasSubstructMatch(query):
                hits.append({"id": document["id"], "score": 1.0, "snippet": "Contains the structure"})
        else:
            score = DataStructs.TanimotoSimilarity(query_fp, _fingerprint(parent))
            if score >= 0.5:
                hits.append(
                    {"id": document["id"], "score": round(score, 3), "snippet": f"{round(score * 100)}% similar"}
                )
    hits.sort(key=lambda hit: -hit["score"])
    return {"hits": hits[:100]}


def add_lot(input):
    """Make a lot of a compound with the lab action the API and the assistant use, as the person running this."""
    compound = input["compound_id"]
    before = host_call("sheetbase.lab.act", {"action": "list_compound_lots", "arguments": {"p_compound_id": compound}})
    arguments = {"p_compound_id": compound}
    if input.get("title"):
        arguments["p_title"] = input["title"]
    lot = host_call("sheetbase.lab.act", {"action": "add_compound_lot", "arguments": arguments})
    return {"identifier": (lot or {}).get("identifier") or "", "lots": len(before or []) + 1}


# Operations that reach the registry -------------------------------------------


def _registry(input):
    return input.get("registry") or "compound"


def find(input):
    """Structure search as an operation: the same search the search page runs, as the person."""
    mode = "sim" if str(input.get("mode") or "substructure").lower().startswith("sim") else "sub"
    source = input["structure"]
    if read(source) is None and not (mode == "sub" and Chem.MolFromSmarts(source) is not None):
        raise PluginError("The structure to look for could not be read.")
    minimum = float(input.get("min_similarity") if input.get("min_similarity") is not None else 0.6)
    found = host_call(
        "sheetbase.plugin.search",
        {"query": f"{mode}:{source}", "limit": int(input.get("limit") or 50)},
    )
    wanted = input.get("registry")
    compounds = []
    for hit in (found or {}).get("hits", []):
        if wanted and hit.get("kind") != wanted:
            continue
        if mode == "sim" and hit.get("score", 0) < minimum:
            continue
        compounds.append(
            {
                "id": hit["id"],
                "identifier": hit["identifier"],
                "name": hit["title"],
                "registry": hit["kind"],
                **({"similarity": hit["score"]} if mode == "sim" else {}),
            }
        )
    return {"mode": "similarity" if mode == "sim" else "substructure", "count": len(compounds), "compounds": compounds}


def check(input):
    """Is this structure already registered? Uses the registry's same-thing rule, so salts do not make a new compound."""
    parent = describe({"structure": input["structure"]})["parent_smiles"]
    matches = host_call(
        "sheetbase.lab.act",
        {
            "action": "registry_sameness_matches",
            "arguments": {"p_model_key": _registry(input), "p_value": parent},
        },
    )
    described = describe({"structure": input["structure"]})
    return {
        "registry": _registry(input),
        "parent_smiles": parent,
        "formula": described["formula"],
        "mass": described["mass"],
        "salts": described["salts"],
        "registered": bool(matches),
        "matches": [
            {
                "id": m["id"],
                "identifier": m["identifier"],
                "name": m["title"],
                "retired": bool(m.get("archived")),
            }
            for m in (matches or [])
        ],
    }
