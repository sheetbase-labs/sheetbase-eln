# Core Hardening

Correction and convergence after CORE-01–06. This is not a redesign and not
product consolidation.

Source review: [`CORE_01_06_IMPLEMENTATION_REVIEW.md`](./CORE_01_06_IMPLEMENTATION_REVIEW.md)

## Status

| Bundle | Title                          | Status      |
| ------ | ------------------------------ | ----------- |
| H1     | Security + green baseline      | complete    |
| H2     | Ad-hoc → composed lifecycle    | complete    |
| H3     | Frozen composed evidence       | in progress |
| H4     | Legacy write-path closure      | pending     |
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

- **Status:** pending

## H4 Legacy write-path closure

- **Status:** pending

## H5 Template catalogue convergence

- **Status:** pending
