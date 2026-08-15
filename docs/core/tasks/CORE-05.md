# CORE-05 — Schema Evolution and Role-aware Configuration

**Status:** CORE-05.1 complete; CORE-05.2 blocked on audit decisions
**Blocked by:** CORE-05.1 epic-start audit (complete). Remaining tasks blocked as specified.
**Normative decisions:** ADRs 0021, 0023, 0025, 0026 plus CORE architecture.

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

**Blocked by:** CORE-05.1.

**Goal:** Introduce a small extensible capability model for Core configuration.

**Initial capabilities should distinguish:** data read/create/update/archive; schema view/edit/publish/retire; Sheet Definition create/edit/publish; Template create/edit/publish; local promotion; Instance share/upgrade; review/submit where already applicable; workspace administration.

**Deliverables:** domain vocabulary; mapping from existing roles so current access does not unexpectedly widen/narrow; server helper/claims strategy; tests.

**Do not:** build a fully custom enterprise RBAC designer in one task.

**ADR trigger:** if capability persistence/claim mapping creates a durable new auth architecture.

**Exit gate:** schema authority can be granted independently of workspace administration and is enforceable server-side.

---

## CORE-05.3 — Enforce capabilities in PostgreSQL/RPC/API boundaries

**Blocked by:** CORE-05.2.

**Goal:** Move configuration enforcement beyond owner/admin assumptions while preserving RLS.

**Deliverables:** additive migration/policies/functions; management RPC enforcement; application permission state; denied-operation error contract.

**Tests:** allowed/denied per capability, workspace isolation, direct PostgREST/RPC attempts, regression of current roles.

**Exit gate:** hiding a button is no longer the only protection for configuration actions.

---

## CORE-05.4 — Implement dependency discovery service

**Blocked by:** CORE-05.1; benefits from CORE-03/04 stable identities.

**Goal:** Answer “what uses this?” before schema/Definition changes.

**Deliverables:** dependency graph/query for Field Definitions, Dataset Schema versions, Sheet Definitions, Sheet Instances/calculations, Notebook Templates and relevant frozen evidence; dependency kinds; active/historical distinction; API/domain representation.

**Do not:** infer dependencies from labels or free-text formulas.

**Tests:** field→formula, schema→Definition, Definition→Template/Instance, retired/historical references.

**Exit gate:** a proposed breaking change can enumerate affected durable objects.

---

## CORE-05.5 — Implement Model field evolution with impact preview

**Blocked by:** CORE-05.3/05.4.

**Goal:** Make add/label-change/description-change/validation-change/retire operations safe and understandable.

**Deliverables:** classify change; impact preview; preserve stable field ID/key rules; retirement semantics; historical values retained; confirmation for consequential changes; revision manifest updates.

**Must preserve:** existing Model lifecycle guarantees from CORE-01.

**Do not:** delete historical field values or silently change fundamental type meaning.

**Tests:** compatible metadata change, added field, validation tightening, retirement, blocked destructive change.

**Exit gate:** authorised stewards can evolve Models without corrupting history/dependencies.

---

## CORE-05.6 — Implement Dataset Schema version evolution and migration planning

**Blocked by:** CORE-05.3/05.4 and CORE-02 versioning.

**Goal:** Publish explicit new Dataset Schema versions with compatibility classification.

**Deliverables:** compatible/migration-requiring/breaking classification; new version creation; affected Dataset/Definition/Pipeline-future dependency preview; migration plan representation; no automatic reinterpretation; Dataset binding compatibility updates.

**Tests:** add optional field, add required field, quantity/unit semantic change, relationship change, breaking type/row-identity change.

**Exit gate:** breaking Dataset Schema evolution creates an explicit version/migration boundary.

---

## CORE-05.7 — Implement local-field promotion

**Blocked by:** CORE-03 local fields, CORE-05.3/05.5/05.6.

**Goal:** Promote useful Sheet-local fields into reusable/governed configuration safely.

**Targets:** Sheet Definition local column; Dataset Schema field; Model field where semantically appropriate.

**Deliverables:** promotion preview; target selection; compatibility validation of existing local values; permission check; schema/version impact; explicit copy/migration of values where requested; provenance linking source local field to promoted field.

**Do not:** silently promote because a field is frequently used.

**Tests:** valid promotion, invalid existing values, denied permission, new Dataset Schema version, historical snapshot remains local.

**Exit gate:** exploratory data can become governed without losing provenance/history.

---

## CORE-05.8 — Implement calculation promotion

**Blocked by:** CORE-03 calculation scopes, CORE-05.3/05.4.

**Goal:** Move a useful calculation between explicit scopes without conflating Sheet analysis and Dataset semantics.

**Deliverables:** Instance → Sheet Definition promotion; Sheet Definition → Dataset-derived-field promotion where semantically valid; dependency/quantity validation; impact preview; provenance.

**Do not:** automatically convert complex transformations into Dataset fields or Pipelines.

**Tests:** Recovery Instance formula → Definition; governed derived field; incompatible dependency/quantity failure.

**Exit gate:** calculation reuse/governance follows the same deliberate promotion philosophy as fields.

---

## CORE-05.9 — Build dense schema/configuration workspace

**Blocked by:** CORE-05.3–05.8.

**Goal:** Provide an immersive high-density configuration surface suitable for Data Stewards.

**UX direction:** catalogue/navigation; central field/schema plane; right semantic/dependency inspector; lifecycle/version/impact state; clear capability state; no giant-card/dashboard treatment.

**Deliverables:** Model/Dataset Schema configuration using shared controls; quantity/vocabulary/reference semantics; dependency impact; draft/publish/retire actions; permission-aware controls.

**Do not:** create divergent schema editors for each product module.

**Tests:** key workflows, keyboard/accessibility, denied actions, impact review.

**Exit gate:** delegated schema configuration is practical without requiring direct database/admin intervention.

---

## CORE-05.10 — Lifecycle/archive/retirement integration

**Blocked by:** CORE-05.4.

**Goal:** Apply ADR 0023 consistently across configurable objects.

**Deliverables:** archive/restore working objects; retire Definitions/schemas; dependency warnings; block hard-delete when protected; selectors exclude archived/retired objects for new use while existing references resolve.

**Tests:** retired Definition existing Instance; archived Dataset existing consumer; protected evidence delete block; restore.

**Exit gate:** cleanup/lifecycle operations never silently break scientific references.

---

## CORE-05.11 — Role-specific configuration proof and CORE-06 hand-off

**Blocked by:** CORE-05.2–05.10.

**Goal:** Prove Scientist, Data Steward and Admin experiences against the same underlying data.

**Evidence:** Scientist can work/add local fields but not publish schemas; Steward can evolve/publish schemas without security administration; Admin retains full management; direct API attempts enforce same rules; promotion/impact/lifecycle flows work.

**Validation:** DB/RLS/API/UI tests, fresh migration/seed, `pnpm validate`.

**Hand-off:** update `NEXT.md` to CORE-06.1.

## Epic exit gate

A delegated Data Steward can safely evolve governed definitions with dependency/version impact handling while Scientists retain flexible local work and see only permitted configuration; server enforcement and historical interpretation remain intact.
