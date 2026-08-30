# CORE-01–06 implementation review

**Reviewer posture:** sceptical, implementation-grounded, no production-code
changes.  
**Source branch:** `agent/core-programme`  
**HEAD:** `49680b449265aa59c85c515a2549429d9474b763`  
**Tip commit:** `feat: CORE-06: notebook evidence, Sheet Instances, and current-product UI (#35)`  
**Migrations present:** `0000`–`0102` (CORE-06.14 exit cited `0101`; `0102` is
the subsequent ad-hoc local-row fix on the same merge).  
**Date:** 16 August 2026

This review treats accepted Core documents and ADRs 0020–0026, 0037 and 0038
as the baseline. Task files marked Complete are evidence of intent, not
proof. Claims below cite code, migrations, APIs or tests.

---

## 1. Executive conclusion

The Core architecture **is coherent at the database and RPC layer**. The
intended object graph is present and mostly wired:

canonical `FieldDefinition` → Models and Dataset Schema Versions → Datasets
with live state and immutable Dataset Versions → Sheet Definitions and
Instances → Notebook blocks that reference Instances → versioned Notebook
Templates → REV-002 submission that copies Instance state and snapshots live
Datasets.

It is **safe to begin product-consolidation work** once a short correction
list is closed or explicitly accepted. The programme did not accumulate a
second competing architecture. It did accumulate **parallel compatibility
surfaces**, **UI that does not expose several finished RPCs**, and **two
documented contracts that the engine does not actually implement**.

**Blockers to fix first (do not defer into a product epic):**

1. `sheetbase.capability_mask` is a caller-writable session GUC consumed by
   `api.has_capability` (P0).
2. The advertised in-place path “ad-hoc Sheet → add Dataset/Record bindings →
   compose on the same Instance” is not implemented and is contradicted by
   composition, upgrade and provenance guards (P1).
3. Frozen Notebook render reconstructs **local** Sheet state only; composed
   Dataset columns are stored as Version IDs beside the envelope, not rendered
   from them (P1).

None of these require an architectural rewrite. Prefer HARDEN / CONVERGE /
FIX / DEPRECATE.

---

## 2. Scorecard

| Epic    | Verdict                       | Why                                                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORE-01 | **STRONG**                    | One TypeScript kernel; Model and CORE-02 Dataset Schema fields consume it; SQL validators exist; leftover aliases are compatibility names, not a second type system.                                                                                                                                           |
| CORE-02 | **STRONG**                    | Independent Dataset identity, typed hybrid storage, RPC-only mutation, schema-version pinning, immutable Versions, field-UUID query API. SCI-010 is still a live parallel registry, but ADR 0038 already classified it.                                                                                        |
| CORE-03 | **ACCEPTABLE WITH HARDENING** | Definition/Instance split, immutability, joins, write-back, local values, calculations, extraction, upgrade and materialisation RPCs are real. Ad-hoc and composed modes both exist, but they are **not** a single lifecycle. Product UI for extract/upgrade/materialise/bind is largely missing.              |
| CORE-04 | **ACCEPTABLE WITH HARDENING** | Record-reference write-back, search, atomic create+link, all-or-nothing bulk commit and Model-owned IDs exist. `record.link` vs `record.create` is encoded in RPC text, not in role mapping. Definition `actions` remain UI chrome.                                                                            |
| CORE-05 | **NEEDS CORRECTION**          | Steward can publish without `workspace.admin`. Helpers converged onto `has_capability`. `schema.edit` vs `schema.publish` is enforced for Dataset Schema lifecycle, but the test overlay GUC can rewrite any capability for the authenticated session. Role mapping still grants edit and publish together.    |
| CORE-06 | **ACCEPTABLE WITH HARDENING** | Canonical `instanceId` blocks, independent Template instantiation, explicit sharing, Template versions, and submit-time Dataset snapshots exist. Historical UI and the golden proof cover local Instance JSON, not composed Dataset reconstruction. Legacy Templates and `insert_sheet_block` remain callable. |

---

## 3. Findings

### P0 — correctness / security / data-loss blockers

#### P0-1. `has_capability` trusts a caller-writable GUC

- **Epics:** CORE-05
- **Path:** `drizzle/0097_core_05_idempotency_draft_publish.sql`
  (`api.has_capability`); proven by
  `tests/db/core-05-corrections.test.ts` (`set_config('sheetbase.capability_mask', …)`
  as `authenticated`)
- **Actual:** After membership and current-workspace checks, the function
  reads `current_setting('sheetbase.capability_mask', true)`. If set, it
  **replaces** role mapping. Any SQL session that can `SET ROLE authenticated`
  can `set_config` the mask to `schema.publish`, `workspace.admin`, or both.
  `create_dataset_schema_definition`, `publish_dataset_schema_version` and
  `create_invitation` all consult this helper.
- **Intended:** Fail-closed test overlay; “production must not set it”.
- **Consequence:** The database capability boundary is not the membership
  table. It is a comment. PostgREST may not currently expose `set_config` on
  the `api` schema, so the HTTP session path may not be exploitable today.
  The authenticated role **is** the security principal for RLS and
  `SECURITY DEFINER` RPCs. That principal can escalate.
- **Correction:** HARDEN. Honour the mask only when `session_user = 'migrator'`
  (or a dedicated test role). Reset/ignore it for `authenticated` /
  `api_client`. Add a focused DB test that a scientist cannot grant themselves
  `schema.publish` or `workspace.admin`.
- **Evidence:** CORE-05.11 corrections document the overlay; the test file
  sets it from an authenticated steward connection.

### P1 — fix before substantial product expansion

#### P1-1. Ad-hoc Instances cannot become compositional in place

- **Epics:** CORE-03, CORE-06; Flows A and D
- **Paths:**
  - `api.query_sheet_instance_rows` (`drizzle/0077_core_036_sheet_composition.sql`)
    raises `SB076` when `source_definition_version_id IS NULL`
  - `internal.build_sheet_instance_definition_upgrade_preview`
    (`drizzle/0088_core_0313_sheet_definition_upgrade.sql`) raises `SB088`
    for ad-hoc Instances
  - `internal.guard_sheet_instance` rejects
    `source_definition_version_id IS NOT NULL` while
    `provenance.createdFrom = 'ad_hoc'`
  - Notebook viewer split
    (`src/components/notebook/notebook-sheet-block.tsx`) keys composed vs
    local editor **only** on `sourceDefinitionVersionId`
- **Actual:** An ad-hoc Notebook Sheet is a durable Instance with local
  fields/rows (migration `0102`). It can store Dataset bindings via
  `update_sheet_instance` when no Definition is pinned. Those bindings do not
  compose. The Instance cannot be upgraded onto a Definition. Extraction
  (`extract_sheet_definition_draft`) creates a **new** Definition; it does not
  retarget the source Instance.
- **Intended (PRODUCT_CORE / CORE-06.2 comments):** an ad-hoc Instance may
  later add Dataset/Record bindings without field promotion; the local-grid
  editor is “a viewer split, not a lifecycle lock”.
- **Consequence:** Scientists who start in a Notebook Sheet cannot grow that
  same Sheet into the Purification-Summary composition. They must extract a
  Definition and create a **different** Instance. Comments and CORE-06.2
  text over-claim the engine.
- **Correction:** CONVERGE documentation and UI copy onto the implemented
  model (ad-hoc Instance stays local; reuse is extract → new Instance), **or**
  FIX with an explicit “attach published Definition / become compositional”
  RPC that is allowed to change provenance. Do not leave both stories live.
- **Evidence:** `SB076` / `SB088` SQL; guard at 0088; UI branch in
  `notebook-sheet-block.tsx`. No test covers in-place ad-hoc → composed.

#### P1-2. Frozen evidence does not reconstruct composed Sheets

- **Epics:** CORE-06; Flow F
- **Paths:** `internal.notebook_sheet_evidence`,
  `internal.persist_revision_sheet_evidence`
  (`drizzle/0101_core_067_sheet_evidence.sql`);
  `src/lib/frozen-sheet-grid.ts`;
  `tests/db/notebook-sheet-evidence.test.ts`
- **Actual:** Submit copies live `instance.state` into the REV-002 envelope
  and, after digest match, snapshots live Dataset bindings into
  `api.revision_sheet_evidence.dataset_versions`. The canonical snapshot’s
  `sheetEvidence` still carries **pre-snapshot** `datasetRevision` values, not
  the new Version IDs. Historical UI builds a grid from `localFields` /
  `localValues` only. Bound Dataset columns, joins and calculations are
  omitted. The golden test uses a local-only Definition (empty bindings) and
  asserts local-field count.
- **Intended:** submitted evidence reconstructs Sheet semantics independently
  of later live edits, including Dataset Versions.
- **Consequence:** Storage is partly reconstructable for a forensic reader of
  `revision_sheet_evidence`. The product historical render of a composed
  Purification Summary would show local observations (if any) and hide
  governed Dataset values. Later live Dataset edits therefore **can** change
  what a naive envelope consumer believes, and **do** change what the UI
  shows for Dataset-backed columns (it shows nothing).
- **Correction:** HARDEN. After persist, write Dataset Version IDs back into
  the stored evidence record used by UI (the envelope is digest-bound, so
  prefer `revision_sheet_evidence` as the render source). Historical render
  should query `query_dataset_version_rows` plus frozen Instance local state
  and pinned Definition configuration. Extend the golden test with a live
  Dataset binding, mutate live rows after submit, and assert Version rows
  unchanged **and** rendered.
- **Evidence:** `frozenSheetGridFromState` comment: “Does not call live
  composition; it only reads localFields / localValues.”

#### P1-3. Compatibility writers still create the old Sheet/schema product

- **Epics:** CORE-02, CORE-05, CORE-06
- **Paths:** `api.insert_sheet_block` still `GRANT EXECUTE TO authenticated`
  (`drizzle/0035_sci_010_dataset_schema_registry.sql`);
  `src/lib/notebook-mutations.ts` still exports `insertSheetBlock`;
  SCI-010 RPCs remain on the external allowlist
  (`src/lib/external-token.ts`: `create_dataset_schema`,
  `instantiate_dataset_schema`, …);
  `/schemas` remains in the app shell beside `/configure`
- **Actual:** New Notebook UI calls `insert_sheet_instance_block` only.
  Authenticated clients and the SCI-010 `/schemas` surface can still create
  generated scientific tables and a second Dataset Schema registry.
- **Intended:** SCI-010 and scientific tables are compatibility, not an
  evolving governed system (ADR 0038). New workflows must not create legacy
  Sheet blocks.
- **Correction:** DEPRECATE for new writes. Revoke or capability-gate
  `insert_sheet_block` / SCI-010 publish for non-migrator use; hide `/schemas`
  from primary navigation or label it compatibility; keep read/convert
  (`convert_legacy_sheet_block`).
- **Evidence:** Notebook route uses `insertSheetInstanceBlock`;
  `ScientificSheetBlock` is no longer mounted from `notebook-document.tsx`
  but remains a full editor.

#### P1-4. Dual Notebook Template catalogues

- **Epics:** CORE-06
- **Paths:** `api.notebook_templates` + `instantiate_notebook_template_version`
  (`drizzle/0099`, `0100`, `src/lib/notebook-template-data.ts`) versus
  `api.records` kinds `notebook_template` / `protocol_template` +
  `instantiate_template` (`src/lib/templates.ts`, `/templates`)
- **Actual:** `/templates` renders **both** the versioned Notebook Template
  panel and the legacy record catalogue (protocol templates remain
  legitimate). Legacy `instantiate_template` still deep-copies block JSON,
  including `{tableId}` if present — the accidental shared-table defect
  CORE-06.1 recorded.
- **Intended:** dedicated Template identity and immutable published versions;
  default instantiation creates independent Sheet Instances.
- **Correction:** CONVERGE. Keep protocol templates as a separate catalogue.
  Stop treating `records.kind = notebook_template` as a Notebook Template
  product. Gate or retire `instantiate_template` for notebook kinds.
- **Evidence:** `src/routes/templates.tsx` composes both libraries;
  CORE-06.1 audit §1.2.

#### P1-5. Finished CORE-03/05 RPCs have no product surface

- **Epics:** CORE-03, CORE-05; Flows B, D, E
- **Missing UI (RPCs exist):** extract-as-Definition, Definition publish
  catalogue, Instance Definition upgrade, materialisation, local-field /
  calculation promotion (promotion plane exists on `/configure` but is not
  reachable from the Sheet), adding Dataset/Record bindings on an Instance,
  Dataset live edit (Explorer is read-only over `query_dataset_rows`)
- **Actual:** Scientists can create ad-hoc Notebook Sheets and composed
  Instances from Templates or `/sheets/$instanceId` if they already have an
  Instance id. They cannot operate the Core reuse loop from the UI.
- **Intended:** configuration is organisational and usable without database
  intervention (`/configure` exit gate).
- **Correction:** product-consolidation should **expose** these RPCs, not
  reimplement them. Treat absence as a product gap, not an engine gap —
  except P1-1, which is an engine gap.

### P2 — important consolidation / hardening

#### P2-1. `schema.edit` and `schema.publish` share the same roles

Owner, admin and steward all receive both capabilities
(`src/lib/capability.ts`, `api.has_capability` CASE). Distinction is
operational (draft writes vs lifecycle trigger) plus the unsafe GUC overlay.
There is no production principal who can draft but not publish. KEEP the
trigger split; do not pretend role mapping already models a two-person rule.

#### P2-2. `record.link` vs `record.create` is not a role distinction

RPCs call `require_capability` correctly (`drizzle/0094_core_052_capabilities.sql`).
Every unsuspended member, including `viewer`, gets both
(`RETURN true` after membership). Definition `actions` still only hide UI
(`src/lib/sheet-record-actions.ts`). KEEP RPC checks; CONVERGE roles when
product decides a link-only scientist exists.

#### P2-3. `viewer` is not read-only

Documented in `SCHEMA_CAPABILITY_AUDIT.md` and still true: `viewer` can
mutate Instance-local state, create Records, and instantiate Templates.
Either rename the role or enforce read-only. This is a behaviour change;
do not silently tighten during consolidation.

#### P2-4. Dataset Explorer still speaks scientific-table language

`fetchDatasetSummaries` lists `api.datasets` and pages through
`query_dataset_rows` (correct). File header, empty-state copy and
`CanonicalDatasetWire extends ScientificTableWire` still describe generated
tables and `/schemas`. Charts still bind `tableId`. CONVERGE copy and chart
identity (CORE-06.12 already deferred this).

#### P2-5. Calculation promotion to Dataset Schema drops the formula

CORE-05.8 stores a CORE-02 field with `storesFormula=false`. That is honest
(Dataset derived fields are not Handsontable formulas) but leaves no Dataset
computation primitive. KEEP; do not call it a governed derived-field engine.

#### P2-6. Envelope vs `revision_sheet_evidence` split

Submit persists Version IDs in a side table and leaves the digest envelope
on live revisions. Review/signature still pin the envelope digest (KEEP
REV-002). Render and audit tools must prefer the side table for Dataset
Version IDs (ties to P1-2).

#### P2-7. Organisation vs workspace configuration

Architecture still says organisation-scoped Models/Schemas/Definitions/
Templates. Persistence remains `workspace_id`. Documented deferral in
`CORE_ARCHITECTURE.md` §2. KEEP until a dedicated tenancy ADR; do not
silently introduce org tables in consolidation.

#### P2-8. Migrator exemptions

`internal.require_schema_publish_for_lifecycle` skips checks when
`session_user = 'migrator'`. Seeds and tests depend on this. KEEP, but do
not add further session-GUC exemptions (P0-1).

#### P2-9. `insert_sheet_block` still on PostgREST schema-readiness poll

`src/lib/postgrest-proxy.ts` `SCHEMA_READINESS_RPCS` still special-cases
legacy DDL RPCs. Harmless for canonical Instance inserts; signals the proxy
is still a scientific-table product path.

#### P2-10. `pnpm validate` is red on reviewed HEAD

Reproduced on this SHA: Prettier drift in
`src/components/sheet/ad-hoc-sheet-workspace.test.tsx` and
`src/lib/sheet-local-data.test.ts`; ESLint errors in the former
(`@typescript-eslint/consistent-type-imports` on `import()` and
`import/first` because `mutateSheetLocalState` is imported after `vi.mock`).
CORE-06.14 completion evidence is therefore stale. Gate hygiene, not a
semantic Core defect.

### P3 — cleanup / debt

- Type aliases `ModelFieldLogicalType` / `ScientificLogicalType` wrap
  `FieldLogicalType` (harmless).
- Model UI table ids `custom:${fieldName}` (`src/lib/model-fields.ts`) are
  presentation addresses; durable identity remains field UUID. Do not use
  them in new dependencies.
- `GRANT EXECUTE` on `internal.ad_hoc_sheet_instance_state()` to
  `authenticated` (`0102`) is an unnecessary helper leak; revoke.
- CORE-03.1 / CORE-06.1 audits are stale relative to later code; they remain
  useful as historical maps, not current truth.
- `docs/core/NEXT.md` still titles CORE-06 as the active task after
  completion (intentional stop before AUTO-01).
- Dataset Explorer `resource_name: ''` shim on canonical rows.
- No Drizzle export for `dataset_versions` was an audit finding; SQL-only
  is acceptable if TypeScript never needs the table.

---

## 4. Cross-epic seams (Flows A–F)

### Flow A — ad-hoc scientific work

**Server:** Notebook “Add Sheet” → `insert_sheet_instance_block` → ad-hoc
Instance with a seed text column (`0102`) → local column/row/value mutation
with revision CAS and retry tokens. No Definition or Dataset required.
Calculations: Instance-local calculation RPC exists; the ad-hoc grid UI does
not expose it.

**Broken relative to the written Core story:** add existing Dataset binding
while retaining local columns **on the same Instance**. Composition refuses
ad-hoc Instances (`SB076`). Upgrade refuses them (`SB088`). Guard forbids
attaching a Definition while provenance remains `ad_hoc`.

**Usable substitute:** extract Definition (RPC only) → publish → instantiate
a **new** Instance with bindings. Local values stay on the original Instance
unless copied by a separate operation.

**Verdict:** ad-hoc capture works. Exploratory-to-governed on one identity
does not. See P1-1.

### Flow B — governed compositional Sheet

**Server:** published Definition Version →
`create_sheet_instance_from_definition` / Template instantiate → parameter
resolution with exact/lineage/semantic checks (`0075`) → bounded joins that
fail closed on duplicate right keys (`0077`) → bound-column projection
(`0078`) → local values (`0081`) → calculations (`0083`) → write-back
dispatch through `commit_dataset_row_batch` /
`update_record_custom_fields` / `mutate_sheet_instance_local_state`
(`0084`) → optional materialisation (`0089`).

**UI:** `/sheets/$instanceId` is a composed grid that requires `projectId`
search for Record actions. Notebook embeds composed Instances when a
Definition is pinned. No in-app Definition authoring beyond tests/configure
RPCs.

**Verdict:** engine STRONG; product surface thin. Safe to build UI on these
RPCs.

### Flow C — Records from Sheet

**Server:** UUID write-back only; notebook `record_links` not auto-created;
`search_sheet_records` requires `record.link`; create+link and bulk commit
require `record.create`; batch is all-or-nothing; write-back failure rolls
back Record create (CORE-04 tests). Idempotency is actor-scoped on
consequential RPCs after `0097`.

**Gaps:** role mapping grants both capabilities to every member; Definition
`actions` are not server enforcement; ad-hoc Sheets have no Record-reference
composed columns unless a local field is a reference (validation exists;
ad-hoc UI is a text grid).

**Verdict:** composed path ACCEPTABLE. Do not treat UI hide as security.

### Flow D — exploratory to governed

Promotion RPCs (`0096` / `0097`) require `schema.edit`, keep historical
Instance local values local (`copiesValues=false`), require explicit Model
key, and create a next Dataset Schema Version for Dataset targets.
Calculation promotion to Dataset does not copy HyperFormula.

This is **not** Dataset binding and **not** materialisation. The missing
piece is in-place composition (P1-1), which people will confuse with
promotion if UI copy stays loose.

**Verdict:** promotion HARDEN (already corrected once in `0097`). Binding vs
promotion vs extract-as-Definition must be three labelled actions in the
eventual UI.

### Flow E — reusable Notebook Template

Dedicated Template identity, immutable published versions, placements pin
Definition Versions, parameters reuse CORE-03 Parameter objects, default
instantiate creates independent Instances, explicit
`insert_sheet_instance_block(..., instance_id)` shares, deleting one
placement does not archive the Instance, publishing v2 does not rewrite v1
Notebooks, explicit preview/apply upgrade exists.

**Gaps:** dual catalogue (P1-4); Template authoring UI is a thin panel, not
a Definition/placement designer; section placeholders are architecture-only
(acceptable).

**Verdict:** server STRONG; product CONVERGE catalogues.

### Flow F — submission

REV-002 submit, digest, lock, amend, signatures remain. Envelope gains
`sheetEvidence`. Live Dataset bindings snapshot via `snapshot_dataset` with
expected revision after digest match, inside the same transaction as persist.

**Gaps:** P1-2 (render and envelope Version IDs). Golden proof does not
mutate a Dataset. Linked Records stay live (ADR 0036 — KEEP). Charts may
still name scientific `tableId` (deferred). No new general Sheet Version
primitive was added (KEEP).

**Verdict:** freeze transaction ACCEPTABLE; reconstructable **product**
evidence for composed Sheets is incomplete.

---

## 5. Security assessment

**What is sound**

- JWT carries `sub`, `workspace_id`, `session_id`, `role: authenticated` —
  not capabilities (ADR 0005). Helpers read membership.
- `has_capability` fails closed on unknown names, null actor, and
  `current_workspace_id() IS DISTINCT FROM p_workspace_id`.
- Core mutation tables typically: member SELECT + RLS; writes via
  `SECURITY DEFINER` + `search_path=''` + REVOKE FROM PUBLIC + GRANT TO
  `authenticated`.
- Dataset rows/values: `REVOKE INSERT, UPDATE, DELETE FROM authenticated`
  (`0067`); validation trigger remains for definer writes.
- Sheet Instances: INSERT/UPDATE/DELETE revoked; trigger requires
  `sheetbase.sheet_instance_write=rpc-v1` set inside RPCs. Direct INSERT
  cannot succeed even if a caller sets the GUC (no GRANT).
- Published Dataset Schema Versions immutable (`SB072`).
- Cross-workspace Dataset/Record/Notebook FKs checked in Instance guard.
- External allowlist still excludes `create_model_record` /
  `update_record_custom_fields` and canonical Dataset/Sheet RPCs
  (fail-closed unknown resources).
- `submit_record_revision` GRANT is `authenticated` only, not `api_client`.

**Security findings (separate from product rough edges)**

| ID          | Issue                                                                  | Severity                                                |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| P0-1        | `capability_mask` GUC overrides role mapping for `authenticated`       | P0                                                      |
| P1-3        | SCI-010 and `insert_sheet_block` remain write-capable compatibility    | P1 (integrity / parallel product)                       |
| P2-2 / P2-3 | `viewer` is a full data-plane writer; Record create not role-separated | P2 (authorisation model)                                |
| —           | UI hide of Record actions vs server allow                              | By design until roles exist; do not call it enforcement |

**UI says no / server says yes (known, not regressions)**

- Definition `record_actions` disabled in UI; RPCs still authorised for
  members with `record.*`.
- Template archive: UI `canManageTemplate` is stricter than `archive_record`.
- `/configure` disables publish for scientists; SCI-010 `/schemas` still
  lets members create drafts.

**RPC says capability required / table write bypasses**

- CORE-02 Dataset Schema tables: write RLS is `schema.edit`; publish
  lifecycle trigger requires `schema.publish`. Direct draft INSERT still
  possible for stewards (compatibility kept in `0097`). Members denied
  (tested). After P0-1 is fixed, this split is acceptable.
- Dataset live rows: no authenticated table DML.
- SCI-010: members may insert draft `dataset_schemas` (legacy policy). That
  **is** a bypass of CORE-05 steward publish semantics for the old registry.

---

## 6. Transaction / concurrency / idempotency assessment

| Operation                    | Transactional    | Optimistic revision                 | Idempotency                                                                                    | Notes                                                    |
| ---------------------------- | ---------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Dataset bulk commit          | Yes              | Dataset + row revisions             | Actor-scoped key (`0097` pattern on later RPCs; Dataset batch has digest/retry from CORE-02.5) | Direct row DML revoked                                   |
| Dataset snapshot             | Yes              | Expected Dataset revision           | New Version per call unless identical path short-circuits                                      | Used at submit                                           |
| Sheet local mutation         | Yes              | Instance revision                   | Retry token + digest; conflict `23505`                                                         | `0102` allows new UUID rows when identity is unset/local |
| Definition publish / retire  | RPC              | Version revision                    | Capability + lifecycle guards                                                                  | Immutable after publish                                  |
| Instance Definition upgrade  | Yes              | Instance revision                   | Provenance row                                                                                 | Ad-hoc excluded (`SB088`)                                |
| Materialisation              | Yes              | Instance + sources                  | Creates Dataset Version                                                                        | Explicit only                                            |
| Record create+link           | Yes              | Write-back revisions                | Actor key                                                                                      | Rollback on write-back failure                           |
| Bulk Record commit           | All-or-nothing   |                                     | Actor key; mixed create/link capability assert                                                 |                                                          |
| Schema evolution / promotion | Yes              | Draft version revision after `0097` | Actor + kind + key; different digest `23505`                                                   | Second draft `SB072`                                     |
| Template publish             | RPC              | Version revision                    |                                                                                                | Does not mutate Notebooks                                |
| Template instantiate         | Yes              |                                     | Request key                                                                                    | Failed required params roll back                         |
| Template upgrade             | Preview/apply    |                                     | Explicit                                                                                       | v1 Notebooks unchanged until apply                       |
| Explicit sharing             | Insert block     | Structure version                   | Same Instance id                                                                               | Delete block ≠ archive Instance                          |
| Notebook submit              | Yes              | Digest match                        | Submission idempotency key; persist skipped on replay                                          | Snapshot after digest                                    |
| Amendment / signature        | Existing REV-002 | Digest pin                          | Unchanged                                                                                      | KEEP                                                     |

**Inconsistencies to HARDEN, not redesign**

- Capability overlay is the only consequential mutation that is neither
  transactional nor authorised (P0-1).
- Dataset Schema publish can still occur by direct UPDATE for actors who
  already have `schema.publish` (`0097` kept this). Prefer RPC-only later.
- Local mutation retry tokens are unique per Instance
  (`sheet_instance_local_mutations_instance_id_retry_token_unique`). KEEP.

---

## 7. Identity / stable-reference assessment

Desired rule: durable semantic identity is UUID.

| Use                                                                                                              | Classification                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Field / row / Dataset / Schema Version / Instance / Definition Version / Template Version / block / Record UUIDs | Semantic identity — KEEP                                                                      |
| Field `key` / Model `field_name` / SCI-010 `slug`                                                                | API/storage key — acceptable local address, not relationship identity                         |
| Labels                                                                                                           | Presentation-only                                                                             |
| A1 coordinates                                                                                                   | Presentation / current dependency slot (calculations persist UUID deps)                       |
| `sb-row-v1` composed row keys                                                                                    | Derived from stable identity spec — acceptable address                                        |
| Visual row numbers                                                                                               | Not used as Dataset row id                                                                    |
| Generated `sheet_*` relation names                                                                               | Compatibility physical names; canonical APIs must not use them (Explorer query path does not) |
| `custom:${fieldName}` Model table ids                                                                            | Presentation-only — do not add new deps                                                       |
| Template parameter mappings by Parameter UUID                                                                    | Semantic — KEEP                                                                               |
| Chart `tableId`                                                                                                  | Compatibility scientific table id — CONVERGE later (CORE-06.12)                               |
| Notebook Template placements `definitionVersionId`                                                               | Semantic — KEEP                                                                               |
| SCI-010 schema slug+revision                                                                                     | Compatibility identity — do not evolve                                                        |

No new general Sheet Version primitive was introduced. Good.

---

## 8. Legacy / compatibility inventory

| Surface                                                          | Classification                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `api.scientific_tables` + generated `sheet_*` + formula cluster  | **COMPATIBILITY** (still fully writable via RPC)                                                 |
| `insert_sheet_block` / `ScientificSheetBlock`                    | **COMPATIBILITY** / **DEAD in Notebook UI**, **ACTIVE via API**                                  |
| SCI-010 `dataset_schemas` / `/schemas` / `query_dataset`         | **COMPATIBILITY** that still looks **ACTIVE PRIMARY** in nav                                     |
| CORE-02 `dataset_schema_definitions` + Versions                  | **ACTIVE PRIMARY**                                                                               |
| `query_dataset_rows` / Dataset Explorer (data tab)               | **ACTIVE PRIMARY** (copy still legacy)                                                           |
| `records.kind = notebook_template` + `instantiate_template`      | **COMPATIBILITY** / parallel **ACTIVE PRIMARY** for notebooks                                    |
| `api.notebook_templates` + versions                              | **ACTIVE PRIMARY**                                                                               |
| Protocol templates (`protocol_template`)                         | **ACTIVE PRIMARY** (separate product)                                                            |
| `convert_legacy_sheet_block`                                     | **MIGRATION TOOLING**                                                                            |
| `/configure`                                                     | **ACTIVE PRIMARY** for CORE-02/Model                                                             |
| `/admin/model-fields`                                            | Overlaps `/configure` — CONVERGE later                                                           |
| HyperFormula scientific-core-v2 + Instance calculations          | **ACTIVE PRIMARY** for Core Sheets; legacy formula cache **COMPATIBILITY** for scientific tables |
| REV-002 envelope wrappers including scientific tables            | **ACTIVE PRIMARY** for legacy sheets + **ACTIVE** Sheet evidence add-on                          |
| Analysis / Planner / Calendar / Storage / Plate / Report Builder | Paused specialist — out of Core scope                                                            |
| `docs/core/audits/*` pre-implementation sections                 | **STALE DOCUMENTATION** (keep as history)                                                        |
| ADR 0019 scientific-table contract                               | Superseded for new work by 0020/0037; still describes compatibility store                        |

**Risk:** SCI-010 + `insert_sheet_block` + legacy Templates can still be used
as a complete second ELN. That is the main threat to “one Core”.

---

## 9. UI / product-surface inventory

Do not redesign. Inventory only.

| Surface                        | Speaks Core?                           | Notes                                                            |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| Notebook document              | Mostly                                 | New Sheets are Instances; frozen local grid; share dialog exists |
| Ad-hoc Sheet embed             | Yes, local-only                        | No bind/extract/calculate chrome                                 |
| Composed Sheet embed           | Yes                                    | Definition-backed only                                           |
| `/sheets/$instanceId`          | Yes                                    | Requires `projectId`; Record actions                             |
| Dataset Explorer `/datasets`   | Canonical reads, legacy copy           | Read-only; empty state points at `/schemas`                      |
| Records `/samples` `/reagents` | Pre-Core Model registry                | Still the Record home                                            |
| `/configure`                   | Yes                                    | Steward workspace; promotion plane                               |
| `/schemas`                     | SCI-010                                | Looks primary in shell                                           |
| `/admin`                       | Workspace admin + Model fields overlap |                                                                  |
| `/templates`                   | Mixed                                  | Versioned panel + legacy library                                 |
| Submission / history / reviews | REV-002 + frozen local Sheet           | Composed historical grid incomplete                              |
| Lifecycle controls             | Archive Instance RPC exists; UI sparse | Retire Definition is RPC/configure                               |

Duplicated jobs: schema editing (`/configure` vs `/schemas` vs admin Model
fields); Templates (two catalogues); Sheets (Instance vs scientific table).

Hidden canonical functionality: extract, upgrade, materialise, Dataset
write, Template placement designer, in-place bind (also not in engine).

---

## 10. Test coverage gaps

**Present and useful (do not blindly trust as e2e product proof)**

- CORE-01: `src/lib/field-definition.test.ts`, Model field DB tests
- CORE-02: `tests/db/datasets.test.ts`, Explorer unit tests, scale gate
  documented not re-run here
- CORE-03: definitions, instances, parameters, composition, local values,
  calculations, extraction, upgrade, reuse lifecycle
- CORE-04: `tests/db/sheet-record-actions.test.ts` plus unit write-back
- CORE-05: `capabilities`, `configuration-roles`, `schema-evolution`,
  `core-05-corrections`, `object-dependencies`
- CORE-06: `sheet-instance-blocks`, `notebook-templates`,
  `notebook-template-instantiate`, `notebook-sheet-evidence`

**Missing or too weak**

- Scientist `set_config` capability escalation (P0-1)
- Ad-hoc Instance + Dataset binding composition (will fail — needs an
  explicit negative test so the contract cannot drift)
- Submit with live Dataset binding, mutate live rows, query Version rows,
  render frozen grid including Dataset columns (P1-2)
- UI/browser proof that Notebook “Add Sheet” never calls `insert_sheet_block`
- `instantiate_template` with a legacy `{tableId}` sheet block (shared mutable
  state)
- Cross-epic Purification Summary **browser** path (CORE-03.16 was server
  proof by design)
- External API cannot call `insert_sheet_block` / SCI-010 publish after
  deprecation

Coverage map by flow: A local-grid unit/DB yes, A bind no; B DB yes, UI
thin; C DB yes; D promotion DB yes, extract UI no; E DB yes, dual catalogue
no; F local freeze yes, Dataset freeze no.

### Review-gate runs (this checkout)

Reviewed HEAD `49680b449265aa59c85c515a2549429d9474b763`. The CORE-02.6 100k
benchmark was not rerun. `pnpm db:fresh --demo` was not rerun.

| Command                                                                                                                       | Result                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Focused DB (capabilities, core-05-corrections, notebook-sheet-evidence, sheet-instance-blocks, notebook-template-instantiate) | 5 files / 20 tests passed                                                |
| `pnpm test:db`                                                                                                                | 70 files / **708** tests passed (CORE-06.14 cited 707)                   |
| `pnpm typecheck`                                                                                                              | passed                                                                   |
| `pnpm test`                                                                                                                   | 179 files / **1937** tests passed                                        |
| `pnpm build`                                                                                                                  | client + SSR production build passed                                     |
| `pnpm check` / `pnpm lint` / therefore `pnpm validate`                                                                        | **failed on HEAD** (P2-10); reproduced, pre-existing vs this review file |

---

## 11. Recommended immediate corrections

Small list. Do these before product-consolidation, or explicitly accept
them in writing.

1. **FIX P0-1** — `has_capability` must ignore `sheetbase.capability_mask`
   unless `session_user` is `migrator` (or equivalent). Prove scientist
   cannot self-grant.
2. **CONVERGE P1-1** — pick one story: (a) document that ad-hoc Instances
   never become Definition-backed, and extract creates a new Definition for
   **new** Instances; or (b) implement attach-Definition with provenance
   change. Update CORE-06.2 comments and `notebook-sheet-block.tsx` comments
   to match. Add a negative DB test for (a) or a positive one for (b).
3. **HARDEN P1-2** — historical Sheet render must use frozen Instance state
   **plus** pinned Dataset Versions; golden test must include a Dataset
   binding.
4. **DEPRECATE P1-3** — stop new `insert_sheet_block` / SCI-010 publish from
   product and from `authenticated` if possible; keep convert/read.
5. **CONVERGE P1-4** — one Notebook Template catalogue (`notebook_templates`).
   Leave protocol templates alone.
6. **FIX P2-10** — restore `pnpm validate` on the CORE-06 ad-hoc test files
   so the programme exit gate is honest.

Do not start AUTO-01. Do not reopen ADR 0020–0026.

---

## 12. What NOT to change

These are already sound. Do not reopen for taste.

- Canonical `FieldDefinition` kernel and quantity/vocabulary ADRs (0025).
- CORE-02 typed hybrid storage, Version copy-on-snapshot, field-UUID query
  API, and revocation of authenticated row DML.
- Sheet Definition vs Instance split; immutable published Definition
  Versions; explicit Instance upgrade with retain/map/defer.
- Constrained joins that fail closed instead of multiplying rows.
- Write-back: exactly one target; calculated read-only; dispatch through
  existing Dataset/Record/local RPCs.
- Local values requiring the mutation RPC (generic `update_sheet_instance`
  cannot edit them).
- UUID Record write-back; no automatic notebook `record_link` from cell
  link; Model-owned `PREFIX-YYYY-NNNN`.
- JWT without capability claims; membership-table resolution.
- Steward without `workspace.admin`.
- Promotion that does not copy historical local values into the new schema.
- Default Template instantiate = independent Instances; sharing explicit.
- REV-002 digest, signature, lock, amend; live linked-Record context
  (ADR 0036).
- Refusal to add a general Sheet Version primitive.
- HyperFormula trust/provenance decisions for calculation execution.
- RLS as the boundary; `SECURITY DEFINER` + empty `search_path` pattern.

---

## 13. Recommended next phase

**Product consolidation and workflow validation** — not AUTO-01, not a Core
rewrite.

Work from the engine that exists:

1. Close §11 corrections (especially P0-1 and the ad-hoc/frozen contracts).
2. Make one primary path visible: Notebook ad-hoc Sheet, Template-backed
   composed Sheet, `/configure` for stewards, `/datasets` for canonical
   Datasets.
3. Demote SCI-010, scientific-table insert, and legacy Notebook Templates
   to labelled compatibility.
4. Expose extract / publish Definition / instantiate / share / submit as
   user actions on the RPCs already tested.
5. Prove Flows A–F in the browser against `dev` only after the contracts in
   §11 are honest.

Pipeline (AUTO-01) should wait until composed frozen evidence and a single
Sheet/Template write path are true in the product, not only in SQL.
