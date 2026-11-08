"""Chemistry for Sheetbase, with RDKit.

A structure is kept as a molfile. The parent of a drawing is its largest piece,
neutralised, with every other piece (a chloride, a sodium, water, a solvent)
set aside as a salt. Two compounds are the same when their parents are.
"""
import re

from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors
from rdkit.Chem.MolStandardize import rdMolStandardize

from sheetbase_plugin import PluginError

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
