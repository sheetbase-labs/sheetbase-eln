# Core Hardening

Correction and convergence after CORE-01–06. This is not a redesign and not
product consolidation.

Source review: [`CORE_01_06_IMPLEMENTATION_REVIEW.md`](./CORE_01_06_IMPLEMENTATION_REVIEW.md)

## Status

| Bundle | Title                          | Status   |
| ------ | ------------------------------ | -------- |
| H1     | Security + green baseline      | complete |
| H2     | Ad-hoc → composed lifecycle    | complete |
| H3     | Frozen composed evidence       | complete |
| H4     | Legacy write-path closure      | complete |
| H5     | Template catalogue convergence | complete |

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
  `bind_legacy_sheet` only. Demo and month seeds create CORE-03 Sheet
  Instances with local grids; they do not write scientific tables.
- **Migrations:** `0106_core_h4_close_legacy_writes`,
  `0108_core_h4_legacy_write_guard`
- **Tests:** `tests/db/core-h4-legacy-writes.test.ts`; existing scientific-
  table and SCI-010 suites create fixtures as migrator
- **Classification:**
  - REMOVED — `insert_sheet_block`, `create_scientific_table`,
    `add_scientific_column`, SCI-010 create/publish/instantiate/upgrade,
    `convert_legacy_sheet_block`, `bind_legacy_sheet`, `/schemas`, external
    scientific-table allowlist
  - KEEP — CORE-02 Dataset Schema Definitions, CORE-03 Sheet Instances,
    historical Notebook `{instanceId}` render, protocol templates
- **Limitations:** existing scientific-table row edits remain; no bulk
  historical migration; Configure remains the CORE-02 schema surface
- **Completion evidence:** focused H4 DB contract plus rewritten fixture
  paths; scientist/owner/api_client cannot self-create SCI-010/sheet state

## H5 Template catalogue convergence

- **Status:** complete, then superseded
- **Implementation:** Compatibility is removed. `records.kind =
notebook_template` cannot be created or instantiated by any role, including
  migrator. Existing notebook_template records are deleted by migration
  `0109`. Protocol templates and CORE-06 `notebook_templates` remain.
- **Migrations:** `0107_core_h5_notebook_template_catalogue`,
  `0109_remove_legacy_compatibility`
- **Tests:** `tests/db/core-h5-notebook-templates.test.ts`
- **Limitations:** leftover `notebook_template` is still listed on the records
  kind check constraint so historical dumps can load; new rows cannot be
  created through RPCs
- **Completion evidence:** no role can create notebook_template records;
  CORE-06 `create_notebook_template` still works; protocol templates still
  create

## Compatibility removal

Product owner decision: no SCI-010 / scientific-table / `{tableId}` Sheet /
legacy notebook-template record compatibility surface.

- `/schemas` removed from routing and navigation
- `convert_legacy_sheet_block` and `bind_legacy_sheet` dropped
- Scientific-table and SCI-010 RPCs raise or have EXECUTE revoked for every
  role, including migrator
- External API no longer allowlists scientific-table resources
- Demo seed uses Sheet Instances, not scientific tables. Virus Stability
  seeds a six-column, 32-row ad-hoc local grid (Control / sucrose /
  trehalose / poloxamer × eight timepoints). Month showcase seeds an
  eight-row transduction grid. Chart blocks stay empty placeholders
  because chart specs still require a scientific-table `tableId`.

Physical `scientific_tables` / generated `sheet_*` relations are not dropped
in this migration (FK/formula cluster). They have no product write or
external API path.

## Programme status

Core Hardening H1–H5 is complete. Legacy compatibility is removed.
Next phase is Product Consolidation / Workflow Validation. AUTO-01 remains
deferred.

## Exit gate

- `pnpm db:fresh --demo` applies `0000`–`0109` and 27 idempotent demo seed
  steps (reseed also 27/27).
- `pnpm test:db` 65 files / 620 tests after that fresh migrate.
- `pnpm validate` is green: Prettier, ESLint with 0 errors and 21 existing
  warnings, typecheck, 173 files / 1,835 tests, production client/SSR build.
- The CORE-02.6 100k+80k Dataset benchmark was not rerun.

A later snapshot checkpoint `0110_core_schema_snapshot_checkpoint` records the
current `schema.ts` generate baseline and performs no DDL.
