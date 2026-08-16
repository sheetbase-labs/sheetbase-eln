# Sheetbase Core Migration and Continuation Map

> **Purpose:** tell implementation agents what to preserve, converge, pause and build.  
> **Normative semantics:** `PRODUCT_CORE.md`, `CORE_ARCHITECTURE.md`, ADRs 0020–0026.

## Preserve

- PostgreSQL + additive Drizzle migrations.
- PostgREST and controlled RPC pattern.
- RLS as the security boundary.
- Better Auth/session/API credential foundations.
- Handsontable Excel-like interaction.
- HyperFormula deterministic calculation/provenance decisions.
- Extensible Model framework from PR #27.
- Dense registry/inspector/virtualisation UI direction.
- Notebook/document foundations.

## Converge

- Model/scientific field concepts → canonical `FieldDefinition` kernel.
- Legacy unit metadata → explicit quantity semantics where meaning is known; never infer scientific meaning silently.
- Embedded categories → preserve, while allowing future governed vocabularies.
- Scientific table/Dataset concepts → Dataset + Dataset Schema + immutable Dataset Version.
- Sheet/table blocks → Sheet Definition + Sheet Instance.
- Local columns → durable Instance-local fields with explicit promotion.
- Calculations → explicit Instance / Definition / Dataset-derived scope.
- Template behaviour → reusable versioned Notebook Templates referencing pinned Sheet Definition versions.
- Coarse role checks → incremental capabilities.
- Analysis provenance → future Dataset Versions/Pipeline Runs rather than a parallel transformation system.

## Organisational boundary

Reusable definitions/configuration are organisation/tenant-level concepts: Models, Dataset Schemas, Sheet Definitions, Notebook Templates and vocabularies.

Projects/workspaces organise scientific working state such as Records, Datasets, Notebooks and Sheet Instances. Project context does not redefine scientific identity or require duplication for cross-project reuse when permissions allow.

## Active epics

1. **CORE-01 — Common Schema Kernel** — complete.
2. **CORE-02 — Dataset Primitive and Versioning** — complete; live Dataset state, schema versions, immutable meaningful Dataset Versions.
3. **CORE-03 — Sheet Definition and Compositional Sheet Instance** — complete; reusable Definitions, typed parameters, multi-source Instances, local/calculated data, write-back, materialisation.
4. **CORE-04 — Records from Sheets** — complete; link/search/create/bulk-create Records through normal Model validation.
5. **CORE-05 — Schema Evolution and Role-aware Configuration** — complete.
6. **CORE-06 — Notebook Templates, Sharing and Frozen Evidence** — complete;
   pinned Definition references, explicit shared Instances, parameter flow and
   reconstructable evidence. AUTO-01 is not started.
7. **AUTO-01 — Pipeline Foundation** — broader typed transformations over immutable inputs/outputs.
8. **AUTO-02 — Agent-authored Operations** — agents propose drafts/plans and execute through normal contracts.

## Golden workflow

Use one Lentivector purification workflow throughout:

```text
Organisation configuration
  Model: Sample
  Dataset Schemas: Upstream Results, Purification Results
  Sheet Definition: Purification Summary

Project working state
  Upstream Dataset
  Purification Dataset
  Notebook
    `-- Sheet Instance
          +-- Sample Records
          +-- both Datasets
          +-- local Observation
          `-- calculated Recovery
```

The Core ultimately proves data paste, Record creation/linking, row identity/joins, write-back, durable local values, calculation, Definition reuse, presentation state, materialisation and frozen evidence.

## Agent invariants

1. Start from `NEXT.md`; read the active task and ADRs before coding.
2. Do not create parallel Model/Dataset/calculation/permission systems.
3. Stable IDs, not labels/positions/A1 coordinates, back dependencies.
4. PostgreSQL/server validation remains authoritative.
5. Audit history does not replace immutable Dataset Versions/evidence snapshots.
6. Models retain stable identity as fields evolve; historical values remain interpretable.
7. Quantity compatibility uses scientific kind + dimension/unit semantics, not numeric type alone.
8. Category/vocabulary values use stable identities, not labels alone.
9. Sheet Definitions never own experiment working values; Sheet Instances own local values.
10. Definition/Template reuse uses composition, not inheritance.
11. Definition upgrades are explicit and data-preserving.
12. Sheet composition is virtual until explicit materialisation.
13. Hard deletion is dependency-aware and immutable evidence is protected.
14. Shared live Sheet Instances are explicit; submitted evidence freezes them.
15. Duplicating a Sheet does not implicitly duplicate bound Datasets/Records.
16. Record UUID, human Record ID and Name are distinct concepts.
17. Files should converge on one durable File Artifact identity rather than per-module attachment stores.
18. AI has no privileged mutation path.

## Work de-emphasised during early Core work

Preserve but avoid broad feature expansion in Analysis Studio, Planner, Calendar, Instrument Monitor, Report Builder, Storage/freezer, Plate Designer and new dashboard surfaces except for defects or Core convergence.

## Broadening gate

Resume broad specialist development when common field semantics are stable; Dataset is independent/versionable; Definition/Instance split and multi-source Sheets work; local/calculated data is durable/scoped; Records can be created from Sheets; core capability/schema lifecycle exists; reusable Templates/Definitions are safe; and Notebook evidence can freeze/reconstruct relevant data and semantics.
