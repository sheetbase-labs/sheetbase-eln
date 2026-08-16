# CORE-06 — Notebook Templates, Sharing and Frozen Evidence

**Status:** Complete.  
**Blocked by:** CORE-05 complete.  
**Normative decisions:** ADRs 0020–0024 and existing Notebook revision/signature architecture.

## Epic goal

Make Sheet Instances native Notebook working objects, make Notebook Templates safely reusable, and make submitted/reviewed Notebook evidence reconstruct exact structured state.

## Invariants

- Notebook is context, not hidden owner of all embedded data.
- Template composition does not use inheritance.
- Templates pin Sheet Definition versions by default.
- Normal Template instantiation creates independent Sheet Instances.
- Shared live Instances are deliberate and visibly shared.
- Submitted evidence never depends on mutable live state.
- Dataset evidence resolves to immutable Dataset Versions.
- Model/Field semantic manifests remain reconstructable.
- Existing revision/signature/audit guarantees are preserved.

---

## CORE-06.1 — Audit Notebook, Template, revision and submission persistence

**Goal:** Map current Notebook blocks, Templates, revision envelopes, signatures/review state, Sheet/table blocks, charts/files and submission flow to the target semantics.

**Deliverables:** `docs/core/audits/NOTEBOOK_EVIDENCE_AUDIT.md`; exact files/tables/RPCs; current live/copy/snapshot behaviour; keep/adapt/deprecate map; evidence gaps.

**Data/API changes:** None.

**Exit gate:** frozen-evidence implementation is grounded in existing revision/signature contracts.

---

## CORE-06.2 — Make Notebook Sheet blocks reference durable Sheet Instances

**Blocked by:** CORE-06.1, CORE-03.

**Goal:** Ensure a Notebook Sheet block embeds/references a Sheet Instance rather than owning a parallel scientific table truth.

**Deliverables:** block contract; Instance identity; presentation/embed state; load/error/permission states; migration/compatibility for existing Sheet blocks.

**Must preserve:** existing Notebook layout/editor behaviour and Sheet data.

**Do not:** copy Dataset/local values into block JSON as authoritative state.

**Tests:** create/embed/reload/move block; deleted/archived permission states; existing Notebook migration.

**Exit gate:** Notebook and standalone/shared contexts render the same durable Sheet Instance.

**Status:** Implemented in Bundle B. Canonical payload is `{ instanceId }`;
legacy `{ tableId }` remains valid. New inserts use
`insert_sheet_instance_block`. Explicit conversion is
`convert_legacy_sheet_block`. Do not start CORE-06.3 until review.

Live Notebook editing splits the viewer only: Definition-bound Instances use
composition; Instances without a source Definition use the local grid. That
split is not a lifecycle lock. An ad hoc Sheet must remain able to become
compositional later by adding Dataset/Record bindings (and/or extracting a
Definition). Field promotion is a separate explicit path, not the only one.

---

## CORE-06.3 — Implement organisation-level Notebook Template versions

**Blocked by:** CORE-06.1, CORE-05 capabilities.

**Goal:** Make Notebook Templates reusable versioned organisational configuration.

**Deliverables:** stable Template identity; immutable published versions; draft/publish/retire; block instructions; parameters; pinned dependency references; RLS/capabilities/API.

**Do not:** use Template inheritance; store experiment-specific working values.

**Tests:** version pinning, publish/retire, permission, historical Template version resolution.

**Exit gate:** a published Template version is a stable composition dependency.

**Status:** Implemented. Identity is `api.notebook_templates`; versions are
`api.notebook_template_versions`. `api.revisions` is not the catalogue.

---

## CORE-06.4 — Implement Template parameter flow

**Blocked by:** CORE-06.3 and shared Parameter contract.

**Goal:** Resolve Template parameters once and pass them to nested Sheet Definitions/other blocks where compatible.

**Deliverables:** parameter declaration/binding; defaults; required prompts; nested mapping; validation; resolution provenance.

**Do not:** create a separate Template-only parameter language.

**Tests:** Study Record passed to Sheet Definition; Dataset parameter; missing/incompatible parameter; default.

**Exit gate:** reusable Templates can instantiate meaningful scientific work without hard-coded project data.

**Status:** Implemented. Template parameters reuse CORE-03 Parameter objects
and map to Sheet Definition parameters by stable IDs.

---

## CORE-06.5 — Implement default `create_instance` Sheet Template blocks

**Blocked by:** CORE-06.2–06.4.

**Goal:** Instantiate independent Sheet Instances from pinned Sheet Definition versions during Notebook creation.

**Deliverables:** atomic/compensating Template instantiation semantics; resolved parameters/bindings; source Definition/version provenance; independent local values; failure reporting.

**Tests:** two Notebooks from one Template create independent Instances; same Dataset may be reused; failed required binding does not leave misleading partial state.

**Exit gate:** standard Template use never accidentally shares working Sheet state.

**Status:** Implemented. `instantiate_notebook_template_version` creates a
new experiment Notebook and independent Sheet Instances from pinned
Definition Versions. Failed required parameters roll back the transaction.

---

## CORE-06.6 — Implement explicit shared-live Sheet blocks

**Blocked by:** CORE-06.2, CORE-03 sharing/lifecycle.

**Goal:** Allow deliberate embedding of an existing live Sheet Instance in multiple locations.

**Deliverables:** `reference_shared_instance` contract; permission check; obvious shared-state indicator/location count where practical; edit semantics; archive/lifecycle state.

**UX:** users must reasonably understand that editing here changes the same Sheet elsewhere.

**Tests:** two Notebooks see same local edit; permissions differ; archive behaviour.

**Exit gate:** shared working state is useful but never accidental/hidden.

**Status:** Implemented. Embedding an existing Instance is
`insert_sheet_instance_block(..., instance_id)`.
`sheet_instance_notebook_embeddings` reports placement count. Deleting one
block does not archive the Instance.

---

## CORE-06.7 — Define and implement structured evidence snapshot contract

**Blocked by:** CORE-06.1/06.2 and CORE-02/03 versioning.

**Goal:** Capture exactly the structured state required for reconstructable Notebook submission/review.

**Snapshot must reference/capture as relevant:** Dataset Versions; Model/Field semantic manifests; Sheet Definition versions; Sheet Instance local-field definitions/values; resolved bindings; calculations and required results/evidence; presentation state only where evidentially relevant; File Artifact identities/checksums where applicable.

**ADR trigger:** physical snapshot storage/dedup strategy if multiple viable durable approaches exist.

**Do not:** rely on replaying the audit log to reconstruct exact evidence; retain live Dataset pointers as sole evidence.

**Tests:** mutate live sources after snapshot and prove submitted state remains unchanged/reconstructable.

**Exit gate:** a structured evidence package can reconstruct the submitted Sheet semantics/data independently of later live edits.

**Status:** Implemented. Canonical envelopes include `sheetEvidence`
(Instance state, pinned Definition Version, Dataset binding freeze points).
Live Dataset bindings are snapshotted to Dataset Versions on submit only.

---

## CORE-06.8 — Integrate snapshotting with Notebook submission/review/signature flow

**Blocked by:** CORE-06.7.

**Goal:** Make frozen structured evidence part of the existing controlled Notebook revision/submission lifecycle.

**Deliverables:** submission transaction/orchestration; snapshot IDs/manifests attached to Notebook revision; review/signature sees frozen revision; failure prevents false submitted state; audit events.

**Must preserve:** current revision/signature semantics.

**Tests:** successful submission; snapshot failure; post-submission live edit; reviewer sees frozen state; signature/revision linkage.

**Exit gate:** submission creates immutable reconstructable evidence rather than merely changing status.

**Status:** Implemented inside `api.submit_record_revision`. Preview digest
still comes from the STABLE envelope. Live Dataset Versions are created only
after the digest matches. Signature/lock/amend RPCs are unchanged.

---

## CORE-06.9 — Implement pinned-snapshot Sheet blocks/read-only rendering

**Blocked by:** CORE-06.7.

**Goal:** Render frozen Sheet state intentionally, including historical/submitted contexts.

**Deliverables:** `pinned_snapshot` reference; read-only grid; Definition/schema/version provenance; archived/retired source independence; clear frozen-state UI.

**Tests:** render old snapshot after live Dataset/Definition changes; no mutation path; permission to historical evidence.

**Exit gate:** users can inspect exactly what was submitted without confusing it with current live data.

**Status:** Implemented. Locked/archived Notebooks and revision envelopes
render `Frozen submitted Sheet evidence` from `sheetEvidence`, not the live
Instance.

---

## CORE-06.10 — Template dependency update and impact flow

**Blocked by:** CORE-06.3 and CORE-03 Definition upgrades.

**Goal:** Update a Template to a newer Sheet Definition version explicitly and safely.

**Deliverables:** dependency diff/impact; parameter compatibility; new Template version publication; existing Template versions/Notebooks unchanged.

**Do not:** silently follow latest Definition.

**Tests:** compatible update; incompatible parameter/binding; existing Notebook unchanged.

**Exit gate:** reusable Templates evolve without retroactively changing scientific work.

**Status:** Implemented. Draft `retarget_notebook_template_sheet_placement`
pins a newer Definition Version. Publishing Template v2 does not mutate
Notebooks created from v1. Explicit `preview_notebook_template_upgrade` /
`apply_notebook_template_upgrade` is required.

---

## CORE-06.11 — Reusable Template Section boundary (architecture only unless needed)

**Blocked by:** CORE-06.3.

**Goal:** Ensure Template persistence can later support explicit reusable versioned Sections without introducing inheritance now.

**Deliverables:** verify block/reference model does not prevent future Section references; document deferred contract if no immediate use case.

**Do not:** build a Section management product solely to satisfy this task.

**Exit gate:** no architectural dead-end forces Template inheritance for future reuse.

**Status:** Architecture only. `section_placeholder` placements reserve a
named, versioned Section reference without Template inheritance.

---

## CORE-06.12 — Charts/files/other consumers use stable structured identities

**Blocked by:** CORE-06.2/06.7.

**Goal:** Ensure important Notebook consumers reference canonical Dataset/Sheet/File Artifact identities rather than hidden copied data where feasible.

**Deliverables:** adapt core chart/data/file relationships needed for golden workflow; preserve raw File Artifact identity/checksum direction; document deferred specialist consumers.

**Do not:** broaden into full Report Builder/Analysis rewrite.

**Exit gate:** the Notebook evidence graph points to stable canonical objects.

**Status:** File Artifact identity and checksum remain in the REV-002
`files` envelope. Canonical Sheet blocks pin Instance IDs. Chart specs may
still name a scientific `tableId`; rewriting chart/report consumers onto
Dataset Version / Instance identities is deferred specialist work.

---

## CORE-06.13 — Golden Template and frozen-evidence proof

**Blocked by:** CORE-06.2–06.12.

**Goal:** Prove reuse and submission end to end.

**Workflow:** publish `Purification Summary` Definition; reference it from at least two Notebook Template configurations; create independent Notebooks/Instances; optionally embed one deliberate shared Instance elsewhere; perform scientific work; submit one Notebook; mutate live Dataset/shared Sheet/Definition afterwards; reconstruct submitted state unchanged.

**Evidence:** DB/RLS/API/UI tests, fresh migration/seed, `pnpm validate`, documented snapshot manifest.

**Exit gate:** Template reuse, shared-live behaviour and immutable submission evidence all behave exactly as ADRs require.

**Status:** Implemented as a focused DB proof: Purification Summary Definition
in two Templates, independent Notebooks, one explicit shared embedding,
submit one Notebook, mutate the live Instance, reconstruct submitted state
from `sheetEvidence`.

---

## CORE-06.14 — CORE-06 exit gate

**Blocked by:** CORE-06.13.

**Goal:** Prove CORE-06 on a fresh database, focused DB suite and full validate
gate. Do not start AUTO-01 or any Pipeline work.

**Deliverables:** `pnpm db:fresh --demo`; `pnpm test:db` covering instantiate,
share, freeze and upgrade isolation; `pnpm validate` excluding the out-of-scope
CORE-02.6 100k benchmark; Core completion evidence in `NEXT.md` that stays on
completed CORE-06.

**Do not:** create `docs/core/tasks/AUTO-01.md`; point `NEXT.md` at AUTO-01.1;
reconcile or start Pipeline contracts.

**Status:** Exit gate passed. `pnpm db:fresh --demo` applied migrations
`0000`–`0101` and 29 idempotent demo seed steps (reseed also 29/29).
`pnpm test:db` 70 files / 707 tests. `pnpm validate` 176 files / 1,916 tests,
zero lint errors (21 existing warnings), production client/SSR build.
AUTO-01 is **not** started; `NEXT.md` stays on completed CORE-06.

---

## Epic exit gate

A Notebook can contain live compositional Sheet work, reusable Templates safely instantiate/pin/share as declared, and submission produces immutable structured evidence that remains reconstructable after live data/definitions continue evolving.
