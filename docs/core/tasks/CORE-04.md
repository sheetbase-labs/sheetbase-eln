# CORE-04 — Records from Sheets

**Status:** Planned / implementation-ready after CORE-03  
**Blocked by:** CORE-03 epic exit gate.  
**Normative decisions:** ADRs 0020–0026.

## Epic goal

Make the normal compositional Sheet a first-class Record search/link/create/update surface without introducing a separate registration spreadsheet architecture.

## Invariants

- Relationships persist stable Record UUIDs, not names/display IDs.
- Human Record ID, UUID and Name remain distinct.
- Model validation and PostgreSQL/RLS remain authoritative.
- Bulk creation is a controlled server operation, not row-at-a-time HTTP loops.
- Record actions respect the Sheet row identity and write-back model.
- Partial/failed operations return precise row/field evidence.

---

## CORE-04.1 — Audit existing Record selection/creation/import flows

**Status:** Complete (2026-08-15). Accepted in review; CORE-04.2 may proceed.

**Goal:** Map Samples/Reagents/other registries, reference editors, imports and Model management operations to reusable Record actions.

**Deliverables:** `docs/core/audits/RECORD_SHEET_ACTIONS_AUDIT.md` with exact UI/data/RPC/test paths, duplication/uniqueness rules, current Record-ID behaviour, and keep/adapt/deprecate map.

**Data/API changes:** None.

**Exit gate:** subsequent tasks can reuse existing Model validation and Record CRUD rather than inventing parallel flows.

### Completion evidence

- Added [`docs/core/audits/RECORD_SHEET_ACTIONS_AUDIT.md`](../audits/RECORD_SHEET_ACTIONS_AUDIT.md)
  covering registry create/link/search, Model admin, Definition `actions`,
  CORE-03 Record vs Dataset composition seams, Record ID policy, RLS/allowlist,
  CSV/import/coercion (ADR 0024 is table-row import), Dataset bulk
  idempotency as the pattern to mirror, keep/adapt/deprecate, and four
  proposed implementation bundles for CORE-04.2–04.11.
- Samples create: `CreateSampleDialog` / `createSample` → `create_model_record`.
  Reagents: movements-only UI (no create). Link: `RecordPicker` +
  `create_record_link`. Field update/write-back: `update_record_custom_fields`.
- Explicit gaps: Record-reference cell editor; column→Model mapping; bulk
  validate/commit; idempotency; create+link atomicity; Model Record-ID policy
  beyond generated `PREFIX-YYYY-NNNN`. Scientific CSV is not a Record-import
  path. Review later accepted the audit and four-bundle plan.

---

## CORE-04.2 — Define typed Record-reference cell contract

**Blocked by:** CORE-04.1.

**Status:** Complete (2026-08-15).

**Goal:** Make Record references a canonical Sheet cell/editor type.

**Deliverables:** reference display/search value contract; UUID as persisted identity; Record ID/Name display; target Model constraint; nullability/cardinality; read-only/permission states; provenance/inspector behaviour.

**Do not:** persist labels/names as relationship identity.

**Tests:** render/select/reload/rename target Record; invalid Model target; missing/archived target behaviour.

**Exit gate:** a Sheet cell can safely represent a Record relationship independent of a registry page.

### Completion evidence

- Typed contract in `src/lib/record-reference-cell.ts`: persist Record UUID
  only; display identifier + title; empty/present/archived/missing/invalid-
  Model states; select/clear; write-target kind `dataset` | `local` | `model`.
  Does not create notebook `record_link`.
- `fieldEditorPresentation('reference', { relationshipTarget: 'model' })`
  selects `record-picker`. Legacy `fieldEditorPresentation('reference')`
  remains text so scientific sheets are unchanged.
- Bound Model-reference columns project `record-picker` presentation.
- `ModelFieldInput` accepts a UUID and refuses generated Record IDs as
  identity. Search picker remains CORE-04.3.

---

## CORE-04.3 — Implement existing-Record search and linking

**Blocked by:** CORE-04.2.

**Goal:** Let scientists efficiently resolve existing permitted Records from the grid.

**Deliverables:** server-backed search by Record ID/Name/relevant configured fields; Model-scoped results; keyboard-first picker; archived/permission handling; link write-back; no full registry load.

**Tests:** search scale, RLS isolation, exact Record ID, fuzzy/name search as supported, keyboard selection, link/unlink.

**Exit gate:** users can link existing Records without leaving the Sheet.

---

## CORE-04.4 — Implement inline single-Record creation

**Blocked by:** CORE-04.2.

**Goal:** Create a missing Record from a Record-reference cell while preserving context.

**Deliverables:** compact creation flow using canonical Model fields; required-field validation; generated/user-supplied Record-ID policy as implemented; duplicate detection; create + link atomicity where appropriate; structured errors.

**Must preserve:** protected fields, server validation, RLS, reference integrity.

**Do not:** duplicate Model-specific creation forms for every Model.

**Tests:** valid create/link; missing required; duplicate ID; permission denied; server failure leaves cell unlinked.

**Exit gate:** a missing Sample/Record can be created and linked without navigating away.

---

## CORE-04.5 — Define bulk row-to-Record mapping

**Blocked by:** CORE-04.1/04.2.

**Goal:** Map pasted/selected Sheet rows into prospective Records deterministically.

**Deliverables:** column→Model-field mapping; constants/defaults; Record ID policy; existing-record matching key; required-field completeness; local/calculated-field eligibility rules; preview representation.

**Do not:** infer mappings from labels without user-visible semantic confirmation.

**Tests:** explicit mapping, missing field, incompatible type/quantity/category/reference, duplicate input rows.

**Exit gate:** Sheetbase can explain exactly what each row would create/link before writing.

---

## CORE-04.6 — Implement bulk validate operation

**Blocked by:** CORE-04.5.

**Goal:** Validate a proposed bulk Record operation without mutation.

**Deliverables:** controlled RPC/service; per-row/per-field errors; existing-match classification; duplicate/uniqueness conflicts; permission/required-field checks; bounded payloads; deterministic preview result.

**Tests:** mixed valid/invalid rows, duplicates, existing matches, RLS, large realistic batch.

**Exit gate:** users receive actionable in-grid errors before commit.

---

## CORE-04.7 — Implement bulk commit with explicit atomicity/idempotency

**Blocked by:** CORE-04.6.

**Goal:** Create/link Records efficiently and safely after validation.

**Deliverables:** commit operation; explicit all-or-nothing or documented batch semantics; idempotency/retry token; created/existing Record mapping back to Sheet row identity; audit events; structured failure result.

**ADR trigger:** only if atomicity semantics remain genuinely unsettled by existing bulk-operation contracts.

**Do not:** issue one HTTP create per row.

**Tests:** retry, duplicate request, transaction failure, large batch, created IDs mapped to rows.

**Exit gate:** substantial Record batches can be safely committed and linked back into the Sheet.

---

## CORE-04.8 — Implement in-grid validation/error resolution UX

**Blocked by:** CORE-04.6/04.7.

**Goal:** Make bulk registration errors fixable where the data already is.

**Deliverables:** cell/row error markers; summary; focus/navigation to failures; distinguish validation, duplicate, permission and conflict errors; rerun validation after edits; preserve pasted data.

**UX:** dense and spreadsheet-native; avoid modal workflows for every error.

**Tests:** keyboard navigation, mixed error types, corrected rerun, accessibility.

**Exit gate:** users can fix registration problems without exporting/restarting the operation.

---

## CORE-04.9 — Record action permissions and Definition configuration

**Blocked by:** CORE-04.3/04.4/04.7.

**Goal:** Allow Sheet Definitions to expose appropriate Record actions while execution remains capability/RLS controlled.

**Deliverables:** configured allowed/default actions; target Model restrictions; UI hides/disables honestly; server rejects unauthorised operations; ordinary linking separable from create/update authority.

**Do not:** treat UI visibility as enforcement.

**Tests:** link-only user, create-capable user, denied update, cross-workspace isolation.

**Exit gate:** the same Sheet Definition behaves correctly for different roles.

---

## CORE-04.10 — Record ID policy integration

**Blocked by:** CORE-04.1; coordinate with existing Model capabilities.

**Status:** Complete (2026-08-15) for the current generated policy.

**Goal:** Ensure Sheet creation flows honour Model-configured human Record-ID rules without conflating them with UUID identity.

**Deliverables:** generated/user-supplied/override behaviour supported to the extent the Model system implements it; uniqueness scope enforced server-side; display/search uses Record ID appropriately.

**Do not:** make CORE-04 invent a second ID generator if Model infrastructure already owns it.

**Exit gate:** Record creation from Sheets produces the same identifiers as creation elsewhere.

### Completion evidence

- `src/lib/record-id-policy.ts` documents `CURRENT_RECORD_ID_POLICY`:
  generated `PREFIX-YYYY-NNNN`, project uniqueness, owner
  `api.create_model_record`. No Sheet-specific generator and no
  user-supplied/override IDs. `mode` is the seam for future Model-
  configurable policies.

---

## CORE-04.11 — Golden bulk-registration proof and CORE-05 hand-off

**Blocked by:** CORE-04.2–04.10.

**Goal:** Prove realistic Sample creation/linking inside the golden purification Sheet.

**Workflow:** paste rows → match existing Samples → create missing Samples → surface/fix invalid rows → commit → Record UUIDs linked to Sheet rows → reload.

**Evidence:** DB/RLS/API/UI tests; realistic batch size; `pnpm validate`; no row-at-a-time write loop.

**Hand-off:** record completion evidence and update `NEXT.md` to CORE-05.1.

## Epic exit gate

A scientist can paste realistic data, resolve existing Records, create missing Records singly or in bulk, fix precise validation issues in-grid, and continue working without leaving the Sheet or bypassing Model/RLS guarantees.
