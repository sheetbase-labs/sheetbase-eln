# CORE-05 — Schema Evolution and Role-aware Configuration

**Status:** Complete (2026-08-15)

**Blocked by:** CORE-05.1 epic-start audit (complete).
**Normative decisions:** ADRs 0021, 0023, 0025, 0026, 0038 plus CORE architecture.

## Epic goal

Make Model, Dataset Schema and reusable Definition configuration safely delegable, version-aware and impact-aware without turning every scientist into an administrator.

## Invariants

- Schema-edit authority is distinct from data-edit authority.
- Dataset Schema versions are explicit; breaking changes never silently reinterpret data.
- Models retain stable identity with evolving durable fields.
- Historical values/semantic manifests remain interpretable.
- Local field/calculation promotion is explicit.
- Dependencies use stable IDs.
- Server/RLS capability enforcement is authoritative.
- Named Views are not a Core prerequisite.

---

## CORE-05.1 — Audit current roles, schema mutations and dependency information

**Status:** Complete (2026-08-15)

**Goal:** Map owner/admin/member checks, RLS, schema-management RPCs, Model Fields UI, Dataset Schema mutation paths, formula dependencies and Template/Definition dependencies.

**Deliverables:** `docs/core/audits/SCHEMA_CAPABILITY_AUDIT.md`; exact checks/claims/RPCs; current dependency sources; keep/adapt/deprecate map; migration risks.

**Data/API changes:** None.

**Exit gate:** capability/storage changes are grounded in current security implementation.

### Completion evidence

- `docs/core/audits/SCHEMA_CAPABILITY_AUDIT.md` records the authority
  matrix, KEEP/ADAPT/CONVERGE/DEPRECATE map, unused membership roles,
  dual Dataset Schema stacks, dependency catalogue, lifecycle gaps, and
  capability-storage options without implementing them.
- No product behaviour, migrations, RLS, or RPCs changed.
- Stale `NEXT.md` ADR 0021 filename corrected to
  `0021-data-history-and-schema-versioning.md`.

---

## CORE-05.2 — Define minimum capability vocabulary and role mapping

**Status:** Complete (2026-08-15)

**Goal:** Introduce a small extensible capability model for Core configuration.

**Initial capabilities should distinguish:** data read/create/update/archive; schema view/edit/publish/retire; Sheet Definition create/edit/publish; Template create/edit/publish; local promotion; Instance share/upgrade; review/submit where already applicable; workspace administration.

**Deliverables:** domain vocabulary; mapping from existing roles so current access does not unexpectedly widen/narrow; server helper/claims strategy; tests.

**Do not:** build a fully custom enterprise RBAC designer in one task.

**ADR trigger:** if capability persistence/claim mapping creates a durable new auth architecture.

**Exit gate:** schema authority can be granted independently of workspace administration and is enforceable server-side.

### Completion evidence

- Vocabulary: `workspace.admin`, `schema.edit`, `schema.publish`, `schema.retire`, `record.link`, `record.create`, `instance.upgrade`.
- Storage: role-mapped resolution from `workspace_memberships`. No persisted grants. No JWT capability claims.
- First-class `steward` role receives governed schema capabilities and not `workspace.admin`.
- Unused `viewer`/`scientist`/`analyst`/`reviewer` keep current member-class data behaviour and are not remapped.
- TypeScript mapping in `src/lib/capability.ts` mirrors `api.has_capability`.
- ADR [`0038-canonical-dataset-schema-definitions.md`](../../decisions/0038-canonical-dataset-schema-definitions.md).

---

## CORE-05.3 — Enforce capabilities in PostgreSQL/RPC/API boundaries

**Status:** Complete (2026-08-15)

**Goal:** Move configuration enforcement beyond owner/admin assumptions while preserving RLS.

**Deliverables:** additive migration/policies/functions; management RPC enforcement; application permission state; denied-operation error contract.

**Tests:** allowed/denied per capability, workspace isolation, direct PostgREST/RPC attempts, regression of current roles.

**Exit gate:** hiding a button is no longer the only protection for configuration actions.

### Completion evidence

- Migration `0094_core_052_capabilities.sql` adds `api.has_capability` / `require_capability` / `list_capabilities`, `steward` CHECKs, CORE-02 management RPCs, and call-site enforcement.
- `has_schema_capability`, `is_model_field_admin`, and `is_sheet_definition_admin` are compatibility wrappers.
- Record RPCs distinguish `record.link` vs `record.create`; Instance upgrade uses `instance.upgrade` without tightening member behaviour.
- Denied operations raise `42501` with `capability required: <name>` (workspace admin RPCs keep SB050–SB061).
- Focused proof: `tests/db/capabilities.test.ts`.

---

## CORE-05.4 — Implement dependency discovery service

**Status:** Complete (2026-08-15)

**Goal:** Answer “what uses this?” before schema/Definition changes.

**Deliverables:** dependency graph/query for Field Definitions, Dataset Schema versions, Sheet Definitions, Sheet Instances/calculations, Notebook Templates and relevant frozen evidence; dependency kinds; active/historical distinction; API/domain representation.

**Do not:** infer dependencies from labels or free-text formulas.

**Tests:** field→formula, schema→Definition, Definition→Template/Instance, retired/historical references.

**Exit gate:** a proposed breaking change can enumerate affected durable objects.

### Completion evidence

- `api.discover_object_dependencies` scans stable UUIDs in CORE-02 FKs and Sheet Definition JSON (`schemaVersionId`, `sourceFieldId`, `requiredFieldIds`, `targetFieldId`).
- Each edge records `liveness` (`active`/`historical`) and `effect` (`blocks_deletion`/`requires_migration`/`informational`).
- Model field impact remains usage-count informational; SCI-010 is not indexed as a second governed graph.

---

## CORE-05.10 — Lifecycle/archive/retirement integration

**Status:** Complete (2026-08-15)

**Goal:** Apply ADR 0023 consistently across configurable objects.

**Deliverables:** archive/restore working objects; retire Definitions/schemas; dependency warnings; block hard-delete when protected; selectors exclude archived/retired objects for new use while existing references resolve.

**Tests:** retired Definition existing Instance; archived Dataset existing consumer; protected evidence delete block; restore.

**Exit gate:** cleanup/lifecycle operations never silently break scientific references.

### Completion evidence

- Dataset archive/restore RPCs; Sheet Instance restore; Sheet Definition and CORE-02 schema restore.
- `preview_hard_delete` / `execute_hard_delete` block protected dependents (`SB072`). Unused draft schema definitions may be removed.
- New Dataset bindings already require `lifecycle='active'` (0075); existing Instances still read archived Datasets (0090).

---

## CORE-05.5 — Implement Model field evolution with impact preview

**Status:** Complete (2026-08-15)

**Goal:** Make add/label-change/description-change/validation-change/retire operations safe and understandable.

**Deliverables:** classify change; impact preview; preserve stable field ID/key rules; retirement semantics; historical values retained; confirmation for consequential changes; revision manifest updates.

**Must preserve:** existing Model lifecycle guarantees from CORE-01.

**Do not:** delete historical field values or silently change fundamental type meaning.

**Tests:** compatible metadata change, added field, validation tightening, retirement, blocked destructive change.

**Exit gate:** authorised stewards can evolve Models without corrupting history/dependencies.

### Completion evidence

- `api.preview_model_field_evolution` / `api.apply_model_field_evolution` classify compatible metadata, require confirmation for retirement, and block identity/type/active-contract changes (`SB072`).
- Impact uses `discover_object_dependencies('model_field', …)`. Historical values remain on Records; retirement does not delete stored values.
- TypeScript client: `src/lib/schema-evolution.ts`. Focused proof: `tests/db/schema-evolution.test.ts`.

---

## CORE-05.6 — Implement Dataset Schema version evolution and migration planning

**Status:** Complete (2026-08-15)

**Goal:** Publish explicit new Dataset Schema versions with compatibility classification.

**Deliverables:** compatible/migration-requiring/breaking classification; new version creation; affected Dataset/Definition/Pipeline-future dependency preview; migration plan representation; no automatic reinterpretation; Dataset binding compatibility updates.

**Tests:** add optional field, add required field, quantity/unit semantic change, relationship change, breaking type/row-identity change.

**Exit gate:** breaking Dataset Schema evolution creates an explicit version/migration boundary.

### Completion evidence

- `internal.classify_dataset_schema_fields` ranks optional add as compatible, required add / validation tightening as migration-requiring, and type/cardinality/quantity/relationship/removal as breaking.
- `apply_dataset_schema_evolution` publishes a new CORE-02 version and does **not** rebind live Datasets (`advancesLiveDatasets=false`). Idempotent retries use `api.configuration_change_log`.
- SCI-010 is unused. Quantity/relationship changes are breaking, not silently converted.

---

## CORE-05.7 — Implement local-field promotion

**Status:** Complete (2026-08-15)

**Goal:** Promote useful Sheet-local fields into reusable/governed configuration safely.

**Targets:** Sheet Definition local column; Dataset Schema field; Model field where semantically appropriate.

**Deliverables:** promotion preview; target selection; compatibility validation of existing local values; permission check; schema/version impact; explicit copy/migration of values where requested; provenance linking source local field to promoted field.

**Do not:** silently promote because a field is frequently used.

**Tests:** valid promotion, invalid existing values, denied permission, new Dataset Schema version, historical snapshot remains local.

**Exit gate:** exploratory data can become governed without losing provenance/history.

### Completion evidence

- `preview_local_field_promotion` / `promote_local_field` require `schema.edit`. Members are denied (`42501`).
- Dataset Schema target creates a next CORE-02 version reusing the local `fieldId`. Model target requires an explicit Model key and creates the field on that Model.
- Existing Instance `localValues` remain local (`historicalValuesRemainLocal=true`; `copiesValues=false`). Invalid values fail preview before apply.

---

## CORE-05.8 — Implement calculation promotion

**Status:** Complete (2026-08-15)

**Goal:** Move a useful calculation between explicit scopes without conflating Sheet analysis and Dataset semantics.

**Deliverables:** Instance → Sheet Definition promotion; Sheet Definition → Dataset-derived-field promotion where semantically valid; dependency/quantity validation; impact preview; provenance.

**Do not:** automatically convert complex transformations into Dataset fields or Pipelines.

**Tests:** Recovery Instance formula → Definition; governed derived field; incompatible dependency/quantity failure.

**Exit gate:** calculation reuse/governance follows the same deliberate promotion philosophy as fields.

### Completion evidence

- Local-field or Instance-calculation dependencies fail with `incompatible_local_dependency` (`SB071` on apply).
- `sheet_definition` target writes a new Definition Version draft/version with a matching calculated column; the Instance stays pinned to its previous version.
- `dataset_schema` target adds a stored CORE-02 field (`storesFormula=false`) and does not copy the formula into Dataset semantics.

---

## CORE-05.9 — Build dense schema/configuration workspace

**Status:** Complete (2026-08-15)

**Goal:** Provide an immersive high-density configuration surface suitable for Data Stewards.

**UX direction:** catalogue/navigation; central field/schema plane; right semantic/dependency inspector; lifecycle/version/impact state; clear capability state; no giant-card/dashboard treatment.

**Deliverables:** Model/Dataset Schema configuration using shared controls; quantity/vocabulary/reference semantics; dependency impact; draft/publish/retire actions; permission-aware controls.

**Do not:** create divergent schema editors for each product module.

**Tests:** key workflows, keyboard/accessibility, denied actions, impact review.

**Exit gate:** delegated schema configuration is practical without requiring direct database/admin intervention.

### Completion evidence

- `/configure` is a three-pane workspace: catalogue, field/schema plane, capability/impact inspector.
- Model fields reuse `AdminModelFields`. Canonical Dataset Schema Definitions use CORE-02 RPCs. SCI-010 `/schemas` remains the compatibility editor.
- Scientists see the same objects with publish/evolve/promote disabled. Stewards can publish without `workspace.admin`. Owners keep schema authority plus Administration.
- Local-field promotion is an explicit plane; historical Instance values stay local.
- Nav: Configure in the app shell. Route tree regenerated.

---

## CORE-05.11 — Role-specific configuration proof and CORE-06 hand-off

**Status:** Complete (2026-08-15)

**Goal:** Prove Scientist, Data Steward and Admin experiences against the same underlying data.

**Evidence:** Scientist can work/add local fields but not publish schemas; Steward can evolve/publish schemas without security administration; Admin retains full management; direct API attempts enforce same rules; promotion/impact/lifecycle flows work.

**Validation:** DB/RLS/API/UI tests, fresh migration/seed, `pnpm validate`.

**Hand-off:** update `NEXT.md` to CORE-06.1.

### Completion evidence

- `tests/db/configuration-roles.test.ts`: scientist cannot publish/evolve CORE-02 schemas; steward publishes without `workspace.admin` and cannot invite members (`SB061`); admin can create/publish the next version; scientist can still create a Sheet Instance for local work.
- UI: `configuration-workspace.test.tsx` disables Publish evolution for scientists and enables it for stewards; capability inspector shows allowed/denied.
- Fresh `pnpm db:fresh --demo`: migrations `0000`–`0096`; 29 demo seed steps; idempotent reseed 29/29.
- `pnpm test:db`: 65 files / 692 tests.
- `pnpm validate`: 172 files / 1,905 tests, zero lint errors, 21 existing warnings, production client/SSR build.
- `NEXT.md` now points at CORE-06.1. CORE-06 implementation was not started.

## CORE-05 review corrections

**Status:** Complete (2026-08-16)

Migration `0097_core_05_idempotency_draft_publish.sql` keeps CORE-05 architecture and closes the review gaps:

- Configuration mutations replay on `(workspace_id, actor_user_id, kind, idempotency_key)`. Same digest returns the previous result; a different digest raises `23505`. Distinct actors never share a log row.
- `create_next_dataset_schema_version` creates a new draft boundary and fails (`SB072`) when a draft already exists. Evolution/promotion that would otherwise reuse that draft also fail unless the caller names the draft version and supplies a matching `revision` (`SB001` on stale/missing revision).
- `promote_local_field` / `preview_local_field_promotion` require an explicit `p_model_key` for `model_field` targets. The key is validated against `api.model_kinds`, included in the request digest, and returned on preview/result.
- Direct table writes to CORE-02 schema tables require `schema.edit`. Publication (`draft` → `active`, or inserting a non-draft) requires `schema.publish` via trigger. Compatibility direct publish remains available to actors who already have `schema.publish`. Migrator/fixture writes (`session_user = 'migrator'`) remain allowed so existing test and seed INSERT/UPDATE paths keep working.
- `sheetbase.capability_mask` is a fail-closed test overlay used to prove `schema.edit` without `schema.publish`. Production must not set it.

Focused proof: `tests/db/core-05-corrections.test.ts`.

## Epic exit gate

A delegated Data Steward can safely evolve governed definitions with dependency/version impact handling while Scientists retain flexible local work and see only permitted configuration; server enforcement and historical interpretation remain intact.
