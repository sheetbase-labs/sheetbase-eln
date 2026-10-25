---
name: sheetbase-domain
description: Understand Sheetbase ELN's scientific model, evidence boundaries and agent permissions before reading, explaining or proposing changes to a notebook, sheet, dataset, record or analysis. Use when working in this repository or connected to its MCP server.
---

# Sheetbase Domain

Sheetbase is a scientific electronic lab notebook for biopharma R&D. It combines notebook narrative with structured data and evidence. The canonical model is in `docs/knowledge/product/core-concepts.md`, `docs/knowledge/architecture/system-overview.md` and `docs/knowledge/PRODUCT.md`; this skill is the working summary an agent needs before it reads or proposes anything.

The same text is served by the MCP server at `sheetbase://domain/core-model` and the other `sheetbase://domain/*` resources. Do not maintain a second, divergent description.

## The objects

| Object | What it owns | Identity |
| --- | --- | --- |
| Project | A body of work and its access. | Stable UUID. |
| Record | A typed scientific entity (sample, reagent, instrument…). Its type is a Model; its fields are Model Field Definitions. | Stable UUID and identifier. |
| Notebook | Free-form scientific narrative made of typed blocks, linked to records, datasets, analyses and files. | Stable UUID. |
| Dataset | A typed table. Columns come from a Dataset Schema Version; rows are values; a Dataset Version is an immutable snapshot. | Stable UUID. |
| Sheet | A spreadsheet-like composition. A Sheet Definition owns layout and formulas; a Sheet Instance is one saved composition. Write-back creates Records. | Stable UUID. |
| Analysis | A saved definition over a pinned Dataset Version, producing charts and statistics. | Stable UUID. |
| Revision | A submitted, frozen notebook revision. Signatures bind a person to that exact revision. | Stable revision id. |

Stable UUIDs are identity. Names, folder placement and row numbers are not. Never resolve an object by name when a UUID is available.

## Live versus pinned

A live read reflects current state. A Dataset Version or frozen analysis reflects immutable state. State which one you used, and never mix them in one claim. Cite the version pin when one exists.

## Evidence boundaries

Draft → review → submit → sign are different acts:

- An edit changes a working draft.
- A submission freezes a revision.
- A signature attests to the frozen revision.
- A correction after signature is an amendment, not a silent edit.

AI output is never a signature, approval, submission or authoritative result. It is a draft or explanation a person must review.

## Permissions

PostgreSQL row-level security is the authority, not the UI. A read that returns nothing may mean the object does not exist **or** that you cannot see it. Say "not available" rather than guessing.

External credentials carry explicit scopes. Agent writes follow one path: read with the canonical read tools, propose a draft with `propose_agent_operation`, and let a person approve or execute consequential work. There is no arbitrary RPC, no private database access, no UI automation and no agent signing.

## Output rules

- Cite the stable id and version pin you used.
- Distinguish live from pinned evidence.
- Mark uncertainty; never invent a unit or value.
- Never claim to have written, signed, approved, submitted or executed anything.
- Do not reproduce secrets, tokens, session ids or full file contents.

## Where to read more

- `docs/knowledge/product/core-concepts.md` — canonical object semantics.
- `docs/knowledge/architecture/system-overview.md` — planes and invariants.
- `docs/knowledge/architecture/evidence-versioning.md` — revisions and signatures.
- `docs/knowledge/PRODUCT.md` — users, boundaries and the assistive-AI rule.
- MCP resources `sheetbase://domain/*` — the same guidance at runtime.
