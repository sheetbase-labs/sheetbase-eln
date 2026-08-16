# Core Hardening

Correction and convergence after CORE-01–06. This is not a redesign and not
product consolidation.

Source review: [`CORE_01_06_IMPLEMENTATION_REVIEW.md`](./CORE_01_06_IMPLEMENTATION_REVIEW.md)

## Status

| Bundle | Title                          | Status      |
| ------ | ------------------------------ | ----------- |
| H1     | Security + green baseline      | complete    |
| H2     | Ad-hoc → composed lifecycle    | complete    |
| H3     | Frozen composed evidence       | complete    |
| H4     | Legacy write-path closure      | complete    |
| H5     | Template catalogue convergence | pending     |

## H1 Security + green baseline

- **Status:** complete
- **Implementation:** `api.has_capability` honours `sheetbase.capability_mask`
  only when `session_user = 'migrator'`. Authenticated application sessions
  (including `api_client` after `SET ROLE`) keep role-mapped capabilities.
  Dataset Schema publish triggers still skip ordinary migrator fixture writes,
  but honour the overlay when the mask is set.
- **Migrations:** `0103_core_h1_capability_mask`
- **Tests:** `tests/db/core-h1-capability-mask.test.ts`; CORE-05 overlay now
  uses the migrator login
- **Limitations:** `viewer` remains a member-class data actor; role mapping
  still grants `schema.edit` and `schema.publish` together for steward
- **Completion evidence:** focused DB 8/8; `pnpm validate` green (Prettier,
  ESLint with existing warnings only, typecheck, unit tests, production
  build). CORE-06 ad-hoc test formatting/ESLint restored without production
  behaviour changes.

## H2 Ad-hoc → composed lifecycle

- **Status:** complete
- **Implementation:** `preview_sheet_instance_composition_adoption` /
  `apply_sheet_instance_composition_adoption` pin a published Definition
  Version onto the same ad-hoc Instance. Local fields, values, calculations,
  presentation and the Notebook `instanceId` block are kept. Unmatched local
  UUID rows remain as local-only keys when row identity becomes Dataset-backed.
  Binding a Dataset is still parameter resolution, not field promotion.
- **Migrations:** `0104_core_h2_composition_adoption`
- **Tests:** `tests/db/core-h2-composition-adoption.test.ts`
- **Limitations:** no product UI for the transition; scientists must call the
  RPCs until Product Consolidation
- **Completion evidence:** focused DB 1/1 covering identity, Notebook block,
  Dataset composition, local/calculation survival, stale revision, incompatible
  binding, retry, cross-workspace rejection and atomic failure

## H3 Frozen composed evidence

- **Status:** complete
- **Implementation:** `revision_sheet_evidence.composed_grid` is the
  authoritative historical Sheet render contract. Submit snapshots live
  Dataset bindings into Dataset Versions (reusing an existing Version when
  the binding is already version-pinned) and stores a denormalised grid from
  those Versions plus frozen Instance state. The REV-002 envelope is not
  rewritten after digest. Historical notebook render reads the side table.
- **Migrations:** `0105_core_h3_frozen_composed_grid`
- **Tests:** `tests/db/core-h3-frozen-composed-evidence.test.ts`;
  `src/lib/frozen-sheet-grid.test.ts`
- **Limitations:** review-workspace envelope render still falls back to local
  Instance JSON when the side table is absent (pre-H3 revisions)
- **Completion evidence:** submitted composed Sample values survive later live
  Dataset and Instance mutation; side-table updates are rejected; envelope has
  no post-digest `composedGrid`

## H4 Legacy write-path closure

- **Status:** complete
- **Implementation:** Authenticated and `api_client` EXECUTE grants are
  revoked for `insert_sheet_block`, `create_scientific_table`,
  `add_scientific_column`, and SCI-010 schema create/publish/instantiate/
  upgrade RPCs. Migrator retains EXECUTE for fixtures and conversion.
  Product helpers throw instead of calling those RPCs. `/schemas` is a
  compatibility catalogue (no create/publish). External API allowlist keeps
  `bind_legacy_sheet` only. Demo/month seed uses the migrator login for
  remaining scientific-table fixtures.
- **Migrations:** `0106_core_h4_close_legacy_writes`
- **Tests:** `tests/db/core-h4-legacy-writes.test.ts`; existing scientific-
  table and SCI-010 suites create fixtures as migrator
- **Classification:**
  - READ COMPATIBILITY — scientific table metadata, generated sheets,
    `query_dataset`, historical Notebook `{tableId}` render
  - CONVERT/MIGRATE — `convert_legacy_sheet_block`, `bind_legacy_sheet`,
    `apply_scientific_row_edits`
  - NEW WRITE — DISABLE — `insert_sheet_block`, `create_scientific_table`,
    `add_scientific_column`, SCI-010 create/publish/instantiate/upgrade
  - MIGRATOR/INTERNAL ONLY — the same write RPCs, demo seed, tests
- **Limitations:** existing scientific-table row edits remain; no bulk
  historical migration; Configure remains the CORE-02 schema surface
- **Completion evidence:** focused H4 DB contract plus rewritten fixture
  paths; scientist/owner/api_client cannot self-create SCI-010/sheet state

## H5 Template catalogue convergence

- **Status:** pending
