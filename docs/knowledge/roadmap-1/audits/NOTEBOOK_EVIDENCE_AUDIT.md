# Notebook, Template, revision and frozen-evidence audit

**CORE-06.1 — completed 2026-08-16**

Handoff base: `agent/core-programme` `1ef4b3046a9fb8a48a39a16056d2d83845019755`
(`feat(core): CORE-05 schema evolution and role-aware configuration (#34)`).
CORE-05 / PR #34 is integrated. This task is audit-only; no production schema,
RPC, RLS or UI behaviour changed.

## Conclusion

A Notebook today is **not a table**. It is a workspace-owned `api.records` row
whose ordered `api.blocks` are the document. Templates are also records
(`notebook_template` / `protocol_template`) with workspace-scoped
`project_id IS NULL` identity (ADR 0031 / migration `0034`). Submitted evidence
is a strong, controlled **revision envelope** (ADR 0036 / REV-002) with
signatures, lock/amend, file-object pinning and a Model-field semantic
manifest — but that envelope still snapshots **legacy scientific tables**, not
CORE-03 Sheet Instances or CORE-02 Dataset Versions.

CORE-03 already implemented the target scientific Sheet primitives
(`sheet_definitions` / `sheet_definition_versions` / `sheet_instances`) with
independent instantiation, Dataset reuse without duplication, explicit
Instance duplication, archive/restore and pinned Definition versions. Those
primitives are **not wired into Notebook blocks, Templates or submission**.

The CORE-06 product gap is therefore a **convergence and embedding** problem,
not a missing Notebook editor:

```text
Current Notebook Sheet block          Target CORE-06 Sheet block
─────────────────────────────         ────────────────────────────
records                               records
  └─ blocks[type=sheet]                 └─ blocks[type=sheet]
       payload.tableId ──────────────────────┐
       └─ scientific_tables (1:1 owner)      │
            └─ generated sheet_* rows        │
                                             v
                                      payload.instanceId (or equivalent)
                                      └─ sheet_instances (independent)
                                           ├─ pinned Definition Version
                                           ├─ Dataset / Dataset Version bindings
                                           └─ local fields / calculations
```

Template instantiation currently **deep-copies block JSON**. For a `sheet`
block that copies `{tableId}`, every Notebook created from that Template
would share the original scientific table. That is accidental shared mutable
state and directly contradicts ADR 0020. Demo Templates currently contain no
`sheet` blocks, so the defect is latent in the RPC rather than in seeded data.

Submission currently freezes:

- record metadata, ordered block payloads, links;
- attached `scientific_tables` schema + rows;
- formula definitions and result-cache values;
- file object identity/checksum/storage key;
- Model `customFields` plus the Model-field manifest (wrapper `0057`);
- Report structure when the record is a Report (wrapper `0059`).

Submission does **not** freeze:

- canonical Dataset live rows or Dataset Versions;
- Sheet Instance state, local values, calculations or presentation;
- Sheet Definition versions except insofar as a future block payload names
  them;
- live linked Records (ADR 0036 treats current linked-record context as live);
- live chart data unless `freeze_chart` ran first.

`tests/db/sheet-local-values.test.ts` already records the embedding gap:
`api.revisions` has no Sheet Instance columns or foreign keys.

This audit meets the CORE-06.1 exit gate: frozen-evidence work can be grounded
in the existing revision/signature contracts, and the KEEP / ADAPT / CONVERGE /
DEPRECATE map below is implementation-ready.

## Sources inspected

- `docs/core/NEXT.md`, `docs/core/tasks/CORE-06.md`, `docs/core/tasks/CORE-05.md`
- `docs/core/PRODUCT_CORE.md`, `CORE_ARCHITECTURE.md`, `CORE_MIGRATION.md`
- ADRs 0015, 0018, 0020–0026 (product), 0021 data-history, 0028 files, 0029
  charts, 0031 templates, 0036 submitted revisions
- Later implementation ADRs that affect evidence: 0023 revision-bound
  calculations (legacy formulas), 0037 Dataset versioning, 0038 canonical
  schemas
- Prior audits: `SHEET_COMPOSITION_AUDIT.md` (CORE-03.1; **stale** on
  Definition/Instance existence), `SCHEMA_CAPABILITY_AUDIT.md` (CORE-05.1)
- Schema: `src/db/schema.ts`
- Migrations: `0009`–`0011` (notebook), `0013`–`0016` (scientific tables),
  `0027` (charts), `0029`/`0034` (templates), `0037`/`0044`/`0045` (revision /
  signature / lock), `0057`/`0059` (envelope wrappers), `0068` (Dataset
  Versions), `0072`–`0090` (Sheet Definition/Instance), `0094`–`0097`
  (capabilities / dependencies / CORE-05 corrections)
- TypeScript: `src/lib/notebook-data.ts`, `notebook-mutations.ts`,
  `templates.ts`, `blocks/index.ts`, `parameter.ts`, `sheet-instance-data.ts`,
  `scientific-sheet-data.ts`, `chart-spec.ts`, `object-dependencies.ts`,
  `signatures.ts`, `external-token.ts`
- UI: experiment notebook route, `scientific-sheet-block.tsx`,
  `/sheets/$instanceId`, `/templates`
- Tests listed in § Validation baseline

## Pre-flight

| Check                 | Result                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch base           | `gwp/core-06-notebook-evidence-d947` from `origin/agent/core-programme` `1ef4b30`                                                                                        |
| CORE-05 integrated    | Yes. Tip commit is PR #34.                                                                                                                                               |
| `NEXT.md` active task | CORE-06.1                                                                                                                                                                |
| CORE-05.11 exit       | Documented: `pnpm db:fresh --demo` migrations `0000`–`0096`, 29 seed steps; `pnpm test:db` 65/692; `pnpm validate` 172/1,905. Review corrections added migration `0097`. |
| Production changes    | None in this task                                                                                                                                                        |

---

## 1. Current persistence map

### 1.1 Notebook (working scientific document)

| Concern                   | Authority                                  | Contract                                                                                                                                                             |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notebook identity         | `api.records`                              | UUID PK; kind `experiment` (also `report`, `study`, …). Stable public id `EXP-YYYY-NNNN` (project-scoped). ADR 0015: the notebook **is** the ordered blocks.         |
| Project/folder            | `records.project_id`, `folder_id`          | Project is required for experiments; Templates use `project_id IS NULL`.                                                                                             |
| Workspace ownership       | `records.workspace_id`                     | Workspace is the tenancy/lifecycle owner (ADR 0023). Users are actors, not owners.                                                                                   |
| Structure concurrency     | `records.structure_version`                | Bumped on insert/move/delete of blocks. CAS via expected version (`SB001`).                                                                                          |
| Metadata concurrency      | `records.metadata_version`                 | Title/status/tags/folder.                                                                                                                                            |
| Block content concurrency | `blocks.version`                           | Payload edits only. ADR 0018 autosave.                                                                                                                               |
| Block identity            | `blocks.id`                                | Stable UUID for comments, deep links, review anchors.                                                                                                                |
| Block order               | `blocks.order`                             | Fractional real; `move_block` rebalances.                                                                                                                            |
| Block types               | `chk_blocks_type`                          | `rich_text`, `checklist`, `linked_record`, `callout`, `table`, `sheet`, `chart`, `plate_map`, `file`, `metric`, `procedure_step`, `protocol_reference`, `materials`. |
| Narrative                 | `rich_text` payload                        | Tiptap JSON; ADR 0025.                                                                                                                                               |
| Sheet block               | `sheet` payload                            | `{ tableId, presentation? }` only (`src/lib/blocks/index.ts`). `tableId` is `scientific_tables.id`. **No Sheet Instance id.**                                        |
| Record links              | `api.record_links`                         | Typed outgoing links; `link_type` includes `template`. Template links require `link_metadata.template_revision_id`.                                                  |
| Files                     | `api.file_objects` 1:1 with `file` records | Checksum, storage key, size. `internal.revision_file_objects` pins those identities into a submitted revision.                                                       |
| Lifecycle                 | `archived_at`, `deleted_at`                | Archive/restore RPCs. Soft-delete tombstone. Revisions `ON DELETE restrict` so evidence outlives the live row.                                                       |
| Lock                      | `locked_at`, `locked_by_revision_id`       | Set by approve-for-record signature (SIGN-002). Ordinary evidence CRUD rejected until `create_amendment`.                                                            |
| Calculation input rev     | `calculation_input_revision`               | Legacy formula/scientific-table calculation generation, not Sheet Instance calculations.                                                                             |

Direct table writes: notebook RPCs are mostly **SECURITY INVOKER** (`create_record`, `insert_block`, `delete_block`, `move_block`, `update_block_payload`) so RLS still applies. Template instantiate, submission, signature, chart freeze and Sheet Instance mutation are **SECURITY DEFINER** with explicit membership/capability checks.

### 1.2 Template persistence

| Concern            | Authority                                                                         | Contract                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity           | `api.records` kinds `notebook_template` (`NBK-`) and `protocol_template` (`PRT-`) | ADR 0031. No dedicated Template table (unlike Sheet Definitions).                                                                                                               |
| Scope              | `project_id IS NULL` + partial unique `(workspace_id, identifier)`                | Migration `0034`. Organisation/workspace configuration, instantiated into a project.                                                                                            |
| Version            | `api.revisions` row with `reason = 'validate'` created **at instantiate time**    | Not a published immutable Template version catalog. Later Template edits do not rewrite the revision or the copied blocks.                                                      |
| Status             | `records.status`                                                                  | Notebook Template: `draft` ↔ `validated` (instantiable when `validated` and not archived). Protocol Template: `draft` / `under_review` / `active` (instantiable when `active`). |
| Instantiate        | `api.instantiate_template` SECURITY DEFINER                                       | Snapshot template → `create_record` → deep-copy blocks (skip `protocol_reference`; rewrite `procedure_step`) → `record_link` `{template_revision_id}`.                          |
| Duplicate          | Client `duplicateTemplate` → `create_record_with_blocks`                          | Copies payloads as-is into a new **draft**. Shares no block row ids; **does share `tableId` if a sheet payload is copied**.                                                     |
| Archive            | `archive_record`                                                                  | Existing instantiations keep their copied blocks + revision. UI warns on usage count; server does not require a Template capability.                                            |
| Parameters         | **Absent** on Templates                                                           | `records.properties` / `custom_fields` exist but are not the CORE-03 Parameter contract.                                                                                        |
| Sheet instructions | **Absent**                                                                        | No `create_instance` / `reference_shared_instance` / `pinned_snapshot` policy. No pinned `sheet_definition_version_id`.                                                         |
| UI                 | `/templates`, `src/lib/templates.ts`                                              | Library, instantiate, archive, duplicate, export JSON, usage inspector. `canManageTemplate` is UI-only (author or owner/admin).                                                 |

### 1.3 Sheet integration (two parallel systems)

**Legacy Notebook Sheet (live in the editor):**

- `api.insert_sheet_block` creates a `sheet` block **and** a `scientific_tables` row with unique `block_id`.
- Optional SCI-010 `p_dataset_schema_id` instantiates bound columns from the **legacy** `api.dataset_schemas` registry, not CORE-02 `dataset_schema_definitions`.
- UI: `ScientificSheetBlock` loads `/api/db/<resource_name>` rows. Presentation widths/order still use browser `localStorage` keys plus optional payload `presentation`.
- A record may contain **multiple** sheet blocks (multiple tables). The same Dataset (canonical) is not what these blocks own; they own generated tables.
- The same `scientific_tables.id` can appear in multiple block payloads if JSON is copied (`instantiate_template`, `duplicateTemplate`). Catalog uniqueness is on `block_id`, not on “one table per payload reference”. Copied payloads therefore create **shared live table state** without an embedding table.
- Client `duplicateBlock` **refuses** `sheet` types (“cannot be duplicated without copying their table”).
- `delete_block` deletes the block row only. `scientific_tables.block_id` is `ON DELETE restrict`, so deleting a sheet block fails while the table (or formula dependency) remains.

**Canonical CORE-03 Sheet (complete, not Notebook-embedded):**

- `api.sheet_definitions` + immutable `sheet_definition_versions`.
- `api.sheet_instances`: workspace-owned; optional `project_id`, optional `notebook_record_id` (context FK, **not unique**, **not an embedding graph**).
- Independent create from Definition; `duplicate_sheet_instance` copies Instance-owned state and keeps Dataset bindings as references.
- CORE-03.15 proves: two Instances, one Dataset, no silent Definition upgrade; deliberate same-Instance reads see the same local edit; archive blocks mutation.
- UI: `/sheets/$instanceId` composed grid. **Not** rendered inside Notebook `sheet` blocks.

### 1.4 Submission / evidence persistence

| Object                             | Role                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.revisions`                    | Immutable snapshot. `canonical_snapshot` + SHA-256 `integrity_digest`. Reasons: `submit`, `sign`, `manual`, `validate`, `amend`. Direct INSERT/UPDATE/DELETE revoked from `authenticated` / `api_client` (`0037`). |
| `internal.build_revision_envelope` | Wrapper chain `0037` → `0057` (customFields + Model-field manifest) → `0059` (report structure).                                                                                                                   |
| `api.review_submissions`           | Binds one revision to a workflow version and first-step reviewers. States: `submitted`, `returned`, `rejected`, `approved`, `withdrawn`. Actor idempotency key.                                                    |
| `api.review_check_results`         | Write-once checks against frozen digest.                                                                                                                                                                           |
| `api.review_decisions`             | Append-only decisions pinning the digest.                                                                                                                                                                          |
| `api.signatures`                   | `approve-for-record` / `witness`; pins digest, session, role, auth method, confirmation phrase. Unique (submission, signer).                                                                                       |
| `api.comments`                     | Anchored to revision + target (`revision` / `block` / `table_region` / `diff`).                                                                                                                                    |
| `internal.revision_file_objects`   | Pins file storage identity/checksum/size so later uploads cannot replace evidence.                                                                                                                                 |
| RPCs                               | `preview_submission_digest`, `submit_record_revision` (idempotent), review transitions, `sign_revision`, `create_amendment`.                                                                                       |

### 1.5 Canonical data that submission does not own

| Object                   | Persistence                                              | Relation to Notebook today                                                                                                                                               |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dataset                  | `api.datasets` + rows/values                             | Independent. Sheet Instance bindings reference `datasetId`. Not in revision envelope.                                                                                    |
| Dataset Version          | `api.dataset_versions` (+ rows/values), migration `0068` | Immutable. Created at explicit snapshot / materialisation. **Not** created by Notebook submit. Drizzle `schema.ts` currently has no `datasetVersions` export (SQL-only). |
| Sheet Instance           | `api.sheet_instances.state` JSONB                        | Optional `notebook_record_id`. Not snapshotted.                                                                                                                          |
| Sheet Definition Version | `api.sheet_definition_versions`                          | Pinned by Instance `source_definition_version_id`. Not snapshotted by submit.                                                                                            |
| Model fields             | `record_field_definitions`                               | Manifest **is** included in the envelope (`0057`). Live Record rows linked by `record_links` are **not** copied (ADR 0036 live context).                                 |

---

## 2. Current authority / RLS map

| Surface                                                   | Write path                                                             | Read                | Cross-workspace                      | Notes                                                                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| records/blocks/links                                      | Invoker RPCs + RLS                                                     | Workspace members   | Denied (`42501`)                     | Locked records reject scientific writes.                                                                                                                                                     |
| revisions / submissions / signatures / checks / decisions | SECURITY DEFINER RPCs only                                             | Member SELECT       | Denied                               | No direct DML for request roles.                                                                                                                                                             |
| scientific_tables / generated rows                        | Invoker + table RLS; schema RPCs                                       | Members             | Denied                               | `insert_sheet_block` authenticated-only.                                                                                                                                                     |
| sheet_definitions / versions                              | Admin/capability RPCs (`schema.publish` after CORE-05)                 | Member SELECT       | Denied                               | Retired Definitions cannot instantiate (`0090`).                                                                                                                                             |
| sheet_instances                                           | SECURITY DEFINER RPCs; `guard_sheet_instance` blocks direct UPDATE     | Member SELECT       | Denied                               | Optimistic `revision` CAS (`SB073`).                                                                                                                                                         |
| datasets / versions                                       | Controlled Dataset RPCs; versions immutable                            | Member SELECT       | Denied                               | Versions have mutation-prevent triggers.                                                                                                                                                     |
| Templates                                                 | Same as records + `instantiate_template` DEFINER                       | Members             | Explicit same-workspace check in RPC | UI manage ≠ server capability.                                                                                                                                                               |
| Capabilities                                              | `api.has_capability` from membership role                              | `list_capabilities` | Fail-closed                          | Vocabulary: `workspace.admin`, `schema.edit/publish/retire`, `record.link`, `record.create`, `instance.upgrade`. **No** `template.publish`, `instance.share`, `evidence.submit`. Not in JWT. |
| External API                                              | `projects:write` allowlist includes `instantiate_template`, block CRUD | scoped              | —                                    | `submit_record_revision` / `sign_revision` are **not** on the external allowlist.                                                                                                            |

PostgreSQL remains authoritative. Client caches and Handsontable state are not the evidence boundary.

---

## 3. Current version / revision model

There are several version axes; they must not be conflated:

| Axis                                                                | What it versions                 | Mutable?                                   | Evidence?                                                                          |
| ------------------------------------------------------------------- | -------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `records.structure_version` / `metadata_version` / `blocks.version` | Live notebook editing CAS        | Yes                                        | No — concurrency only                                                              |
| `api.revisions`                                                     | Immutable notebook envelope      | No                                         | **Yes** — current scientific evidence unit                                         |
| Template `validate` revision                                        | Template document at instantiate | No                                         | Provenance of “which Template document was copied”, not published Template catalog |
| Sheet Definition `version` + `revision`                             | Published configuration document | Version immutable; identity revision CAS   | Needed by CORE-06 snapshots                                                        |
| Sheet Instance `revision`                                           | Working Instance CAS             | Yes                                        | Must be snapshotted at submit                                                      |
| Dataset `revision`                                                  | Live Dataset CAS                 | Yes                                        | Not evidence                                                                       |
| Dataset Version                                                     | Immutable Dataset rows/values    | No                                         | Required evidence for Dataset-backed Sheets                                        |
| SCI-010 `scientific_tables.schema_version` + row `version`          | Legacy table                     | Yes until submit copies rows into envelope | Copied into envelope today                                                         |
| Model field lifecycle                                               | Field identity + retire          | Definitions evolve                         | Manifest in envelope                                                               |

ADR 0021 remains the product rule: audit events answer “what changed?”; Dataset Versions / structured snapshots answer “what exact state was used?”.

---

## 4. Template semantics versus ADRs 0020–0023

| ADR requirement                                               | Today                                                             | Gap                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Templates are reusable versioned organisational configuration | Records with workspace scope; version = instantiate-time revision | No draft/publish/retire **Template version** identity like Sheet Definitions |
| Pin Sheet Definition versions                                 | Not referenced                                                    | Must add                                                                     |
| Default `create_instance`                                     | Deep-copy JSON; no Instance created                               | Must add; current copy is the opposite for sheet payloads                    |
| Explicit `reference_shared_instance`                          | Accidental share via copied `tableId`                             | Must replace accident with explicit policy + UI                              |
| `pinned_snapshot`                                             | Chart `freeze_chart` only; no Sheet snapshot block                | CORE-06.7/06.9                                                               |
| No Template inheritance                                       | Honoured                                                          | Keep; CORE-06.11 only checks Section-shaped references                       |
| Template evolution does not rewrite Notebooks                 | Honoured for copied blocks                                        | Keep; add explicit Template-version upgrade (CORE-06.10)                     |
| Parameters flow into nested Definitions                       | CORE-03 Parameter contract exists on Definitions only             | Reuse `src/lib/parameter.ts`; do not invent a Template language              |
| Capabilities, not a new permission system                     | Membership + `has_capability`                                     | Smallest new verbs if Template publish must not equal `schema.publish`       |

**Duplicate concepts to converge, not extend:**

- `protocol_template` vs `notebook_template` vs future dedicated Template identity.
- SCI-010 `dataset_schemas` vs CORE-02 `dataset_schema_definitions`.
- `scientific_tables` vs `sheet_instances` vs `datasets`.
- Chart `spec.datasets[].tableId` (scientific table) vs canonical Dataset id.
- Template `records.properties` vs CORE-03 Parameters.
- `notebook_record_id` on Instances vs a real block embedding / share graph.
- Envelope `scientificTables` vs future `sheetInstanceSnapshots` / Dataset Versions.

---

## 5. Sheet block semantics

A Notebook `sheet` block today **owns** a locator (`tableId`) to a
record-owned scientific table. It does **not** own:

- a Sheet Instance;
- a Sheet Definition version;
- canonical Dataset bindings;
- Instance-local fields.

Standalone `/sheets/$instanceId` already renders the durable Instance. CORE-06.2
exit gate (“Notebook and standalone/shared contexts render the same durable
Sheet Instance”) is therefore a **wiring** change plus a compatibility
migration for existing `{tableId}` blocks.

Multiple Sheets per Notebook: **yes** (multiple `sheet` blocks / tables).
Multiple embeddings of one Instance: **not modelled**. The closest accidental
behaviour is two blocks/Notebooks holding the same `tableId`.

Instance lifecycle on block delete: **undefined** for Instances (they are not
embedded). For scientific tables, block delete is restrict-blocked.

---

## 6. Sharing semantics

| Mechanism                         | Behaviour                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Two Notebooks from one Template   | Independent record/block rows. Sheet payloads would share `tableId` if present.                                       |
| Two Instances from one Definition | Independent Instance state; Dataset bindings may name the same Dataset (CORE-03.15).                                  |
| Same Instance in two UIs          | Possible only by opening `/sheets/$id` twice. No Notebook multi-embed, no location count, no shared-state badge.      |
| `notebook_record_id`              | Optional context; many Instances may point at one record; one Instance cannot record multiple Notebook locations.     |
| Permissions                       | Workspace membership. No per-embedding permission overlay. A shared Instance would use the same RLS for every viewer. |
| Dataset reuse                     | Already correct at Instance layer: reference, do not copy rows.                                                       |

ADR 0023: submitted Notebooks must snapshot shared Instance state rather than
retain a live evidence pointer. That snapshot does not exist yet.

---

## 7. Submission / evidence semantics

Lifecycle (ADR 0036, implemented):

1. Preview digest of live envelope.
2. `submit_record_revision` in one transaction: insert revision, pin files,
   create submission, emit events. Idempotent on `(workspace, actor, key)`
   when the digest matches.
3. Review / checks / comments bind to revision id + digest.
4. Signatures pin the same digest. Approve-for-record locks the record.
5. Amendment unlocks via `create_amendment` (`reason = 'amend'`), producing a
   new draft; old revision remains readable.

**What “submission” freezes today:** the envelope contents listed in §1.4.
Later edits to live blocks/tables/formulas do not rewrite that JSON.

**What can still change the reconstructed scientific meaning after submit:**

See §9. Audit logs (`api.change_events`) are not a substitute and are not
used as the reconstruction source — this part of ADR 0021 is already honoured
for the objects the envelope actually copies.

GxP/e-signature semantics that must not be weakened: digest pinning, fresh
auth / confirmation phrase, lock/amend, file-object retention, write-once
signature/check/decision rows, no in-place evidence repair.

---

## 8. Immutable vs mutable object map

| Object                               | Classification                                    | Notes                                                                                |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `records` / `blocks` live rows       | Mutable working state                             | Continue after submit                                                                |
| `records.status` / lock columns      | Mutable working state + control flags             | Lock is not itself the snapshot                                                      |
| Template records                     | Configuration (mutable document)                  | Instantiation copies out                                                             |
| Template `validate` revision         | Immutable version (document copy)                 | Not a published version sequence                                                     |
| Sheet Definition identity            | Configuration                                     | Archive/retire                                                                       |
| Sheet Definition Version             | Immutable version                                 | Pin from Templates/Instances                                                         |
| Sheet Instance                       | Mutable working state                             | Needs snapshot at evidence boundary                                                  |
| Instance local fields/values/calcs   | Mutable working state                             | Belong to Instance (ADR 0023)                                                        |
| Instance presentation                | Mutable; evidentially optional                    | Persist on Instance; snapshot only if evidentially relevant (CORE-06.7)              |
| Dataset                              | Mutable working state                             |                                                                                      |
| Dataset Version                      | Immutable version                                 | Required for Dataset-backed evidence                                                 |
| Dataset Schema Version               | Immutable version                                 | Interpretation pin                                                                   |
| Model field definitions              | Configuration with lifecycle                      | Manifest at submit (`0057`)                                                          |
| Sample/reagent Records               | Mutable working state                             | Envelope stores link identities; values remain live unless copied into a block/table |
| `scientific_tables` live             | Mutable working state                             | Copied into envelope at submit                                                       |
| Envelope `canonical_snapshot`        | Immutable evidence snapshot                       | Current authority for review                                                         |
| File bytes + `revision_file_objects` | Immutable evidence (bytes retained)               |                                                                                      |
| Chart `frozen` payload               | Immutable evidence snapshot (optional, per block) | Live charts at submit are **not** data-frozen                                        |
| Signatures / checks / decisions      | Immutable evidence metadata                       |                                                                                      |
| `change_events`                      | Contextual audit                                  | Not reconstruction                                                                   |
| Workflow definition version          | Configuration pin                                 | Stored on submission                                                                 |

---

## 9. Evidence mutability analysis (key CORE-06.1 output)

Paths through which **submitted** scientific evidence can still change, or
appear to change, after submission:

| #   | Path                                                  | After submit?                                                                                   | Severity                                                          | Why                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Live Dataset bound to a Sheet Instance                | **Yes, if that Instance is the scientist’s Sheet**                                              | Critical for CORE-06                                              | Submit does not snapshot Instances or create Dataset Versions. The Notebook UI does not even embed Instances yet; once 06.2 lands without 06.7/06.8, this becomes the default hole.                                   |
| 2   | Live Sheet Instance local values / calculations       | **Yes**                                                                                         | Critical                                                          | Envelope has no Instance embedding seam (executable proof in `sheet-local-values.test.ts`).                                                                                                                           |
| 3   | Later Sheet Definition version                        | Indirect                                                                                        | High                                                              | Existing Instances stay pinned (CORE-03). A Notebook that only stored “latest Definition” would drift; today Notebooks do not store Definition ids at all.                                                            |
| 4   | Later Template edits                                  | **No** for copied blocks                                                                        | OK                                                                | Instantiate-time revision + deep copy. Exception: copied `tableId` still names live shared tables (path 6).                                                                                                           |
| 5   | Live `scientific_tables` rows                         | **No** for objects copied into `canonical_snapshot.scientificTables`                            | OK for legacy sheets                                              | Envelope copies schema + rows at submit.                                                                                                                                                                              |
| 6   | Copied `{tableId}` shared across Notebooks            | Live table mutates for **unsubmitted** copies; submitted copies are frozen in _their_ envelopes | High for working state; OK for already-submitted legacy envelopes | Accidental sharing.                                                                                                                                                                                                   |
| 7   | Live linked Records (sample/study)                    | **Yes** (by design in ADR 0036)                                                                 | Product decision                                                  | CORE-06 asks to audit Record/evidence semantics before inventing snapshots. Current contract: identity + Model-field **manifest** are frozen; Record **values** stay live unless copied into a submitted table/block. |
| 8   | Model field label/option changes                      | Partially mitigated                                                                             | Medium                                                            | `0057` adds active/retired field+option manifest. Confirm CORE-06.7 still wants this plus Dataset Schema manifests.                                                                                                   |
| 9   | Live chart (`frozen: null`) at submit                 | **Yes** if review re-resolves live `tableId`                                                    | High for charts                                                   | ADR 0029: freeze for reproducible review. Envelope stores the payload (live spec) but not necessarily materialised series.                                                                                            |
| 10  | Frozen chart                                          | **No**                                                                                          | OK                                                                | Renders from `frozen.data`.                                                                                                                                                                                           |
| 11  | File replacement                                      | **No** if `revision_file_objects` retained                                                      | OK                                                                | Bytes must remain; operational retention is part of ADR 0036.                                                                                                                                                         |
| 12  | SCI-010 schema registry evolution                     | Indirect for new bound sheets                                                                   | Medium                                                            | Legacy binding ids in live tables; submitted envelope copied columns. Do not broaden SCI-010 unless compatibility for existing blocks requires it (CORE-06.2 migration).                                              |
| 13  | Presentation-only Instance filters                    | Only if treated as evidence                                                                     | Low                                                               | ADR 0024: presentation is not semantic identity. Snapshot if the submitted view must include filters.                                                                                                                 |
| 14  | Reconstructing from `change_events`                   | Must not                                                                                        | —                                                                 | Already not used as envelope source. Do not regress.                                                                                                                                                                  |
| 15  | Reviewer UI reading live Notebook instead of revision | Process/UI risk                                                                                 | High                                                              | Routes must keep review on `canonical_snapshot` (existing review inbox / `$revisionId`). CORE-06.9 must not load live Instance grids for submitted contexts.                                                          |

**Record/evidence recommendation:** keep ADR 0036’s live linked-record context
for inspector/inventory-style references. Where a Sheet cell or block cites a
Record as **scientific evidence** (identity + field values the scientist saw),
CORE-06.7 should pin the Record UUID plus the Model-field manifest already
captured, and copy any cell-cited values that live in Instance/Dataset
snapshots rather than snapshotting entire Record rows by default.

---

## 10. Dependency discovery versus CORE-06 paths

`api.discover_object_dependencies` (`0095`) already understands:

- Dataset Schema definition/version/field → Datasets, Dataset Versions, Sheet
  Definition versions
- Sheet Definition / version → Instances, upgrade provenance
- Dataset → Versions and Instances with `state.bindings[].datasetId`
- Sheet Instance → pinned Definition version (outbound)
- Model field usage counts

**Not represented (CORE-06 must extend):**

| Required path                                       | Today                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Template → Sheet Definition Version                 | No Template configuration document                                                                           |
| Notebook → Template Version                         | `record_links.template` + `template_revision_id` (instantiate-time revision, not published Template version) |
| Notebook block → Sheet Instance                     | No; `tableId` → scientific table only                                                                        |
| Sheet Instance → Dataset Version                    | Only if binding policy `mode=version`; discovery walks `datasetId`, not version policy                       |
| Submission → Notebook revision                      | `review_submissions.revision_id` (exists; not in `discover_object_dependencies`)                             |
| Evidence → Dataset Version / Sheet snapshot / files | Envelope JSON; no first-class dependency rows                                                                |
| Hard-delete protection for revisions                | Revisions restrict-delete; `execute_hard_delete` does not cover Notebooks/Templates/revisions                |

CORE-05 lifecycle (archive/restore, retire Definitions, protected hard-delete)
should be reused, not forked.

---

## 11. Reusable contracts (KEEP)

- Notebook record/block/link/folder model, fractional order, split CAS
  versions, event names (`record.block_*`, `record.revision_created`, …).
- REV-002 envelope + digest + submission idempotency + review/signature/lock
  /amend. **Extend the envelope; do not replace it.**
- File object + `revision_file_objects`.
- Model-field manifest wrapper in `build_revision_envelope`.
- CORE-03 Sheet Definition / Instance / Parameter / composition / local
  mutation / calculation / write-back / materialisation / upgrade.
- CORE-02 Dataset + Dataset Version snapshot RPC.
- CORE-05 `has_capability` / steward mapping / `discover_object_dependencies`.
- `src/lib/parameter.ts` kinds: `scalar`, `record`+`modelKey`, `dataset`,
  `dataset-version` with exact/lineage/semantic contracts.
- Chart freeze RPC as a precedent for `pinned_snapshot` (adapt identity from
  `tableId` toward canonical objects in CORE-06.12).
- Workspace RLS, no capability claims in JWT.

---

## 12. KEEP / ADAPT / CONVERGE / DEPRECATE

| Item                                                             | Action                  | Notes                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.records` as Notebook                                        | KEEP                    | Do not add a parallel notebooks table.                                                                                                                                                                                                                                                  |
| `notebook_template` / `protocol_template` as records             | ADAPT                   | Add immutable published Template **versions** (new tables or a disciplined version of `revisions`). Prefer Sheet Definition–like identity+version tables if Template parameters/block instructions cannot honestly live in live `blocks` rows without mixing draft and published state. |
| `instantiate_template` deep-copy of narrative/checklist/callout  | KEEP                    | Correct for configuration that is not shared live state.                                                                                                                                                                                                                                |
| `instantiate_template` copy of `sheet` `{tableId}`               | DEPRECATE / replace     | Replace with `create_instance` / explicit share / pinned snapshot.                                                                                                                                                                                                                      |
| `insert_sheet_block` + `scientific_tables` as the Notebook Sheet | CONVERGE                | CORE-06.2: block references Instance. Compatibility migrate existing tables (see risks).                                                                                                                                                                                                |
| `/sheets/$instanceId`                                            | KEEP                    | Same Instance renderer as Notebook embed.                                                                                                                                                                                                                                               |
| SCI-010 `insert_sheet_block(..., dataset_schema_id)`             | DEPRECATE for new work  | Do not expand. Migrate only as required to preserve existing Notebook data.                                                                                                                                                                                                             |
| Envelope `scientificTables`                                      | ADAPT                   | Keep for historical revisions; new submits must add Instance/Dataset Version snapshots.                                                                                                                                                                                                 |
| Linked-record live context                                       | KEEP                    | Do not snapshot entire registries.                                                                                                                                                                                                                                                      |
| Chart `tableId`                                                  | CONVERGE in 06.12       | Point at Dataset / Instance / File Artifact identities.                                                                                                                                                                                                                                 |
| `records.properties` as Template parameters                      | DEPRECATE for that role | Reuse Parameter contract.                                                                                                                                                                                                                                                               |
| `notebook_record_id`                                             | ADAPT                   | Keep as primary-context hint; add explicit embedding/share rows or block payload policy so location count is possible.                                                                                                                                                                  |
| Template UI manage vs server membership                          | ADAPT                   | Smallest capability if publish must be steward-grade.                                                                                                                                                                                                                                   |
| Section inheritance                                              | DEPRECATE               | CORE-06.11: ensure block/reference model can later point at a versioned Section id; do not build Sections now.                                                                                                                                                                          |
| Audit-log reconstruction                                         | DEPRECATE as evidence   | Already not used.                                                                                                                                                                                                                                                                       |
| Per-edit Dataset Versions                                        | DEPRECATE               | ADR 0021. Create Versions at submit/materialise boundaries only.                                                                                                                                                                                                                        |

---

## 13. Migration risks

1. **Existing `sheet` blocks** uniquely own `scientific_tables`. CORE-06.2
   must preserve data. Options (open decision): wrap each table as an ad-hoc
   Instance with migrated local values; keep dual-read during transition;
   freeze historical tables into the existing envelope shape only.
2. **`instantiate_template` is SECURITY DEFINER** and copies payloads
   blindly. Changing sheet handling is a behavioural break; Templates with
   sheet blocks (if any exist outside demo) would stop sharing tables.
3. **`delete_block` vs restrict FKs** on scientific tables/formulas. Instance
   embed must define archive-vs-delete when a block is removed (ADR 0023:
   archive, do not casually destroy).
4. **Envelope size.** Copying composed Instance windows + Dataset Versions
   can be large. CORE-06.7 ADR trigger: physical snapshot/dedup strategy.
5. **SQL/TypeScript parity.** `dataset_versions` exists in SQL (`0068`) but
   not in `src/db/schema.ts`. Any evidence RPC must close that gap rather
   than grow another ad-hoc type.
6. **Idempotency.** Submission already has digest-bound retry. Instance
   create during Template instantiate needs compensating/atomic semantics
   (CORE-06.5) matching Dataset bulk and Instance local-mutation tokens.
7. **Historical revisions** must remain readable after envelope format
   widens (`formatVersion` is currently `1`). Bump format; readers must
   branch.
8. **Locked records** and SIGN-002 write guards must apply to Instance
   mutation when the Instance is evidence-bound to a locked Notebook.
9. **Demo seed** Templates have no sheet blocks; golden CORE-06.13 must add
   Purification Summary Template configurations without breaking SCI-006
   fixtures.

---

## 14. Answers to the required questions

1. **What is a Notebook today?** A `records` row (typically `experiment`) plus
   ordered `blocks`. No `notebooks` table.
2. **What is a Notebook Template today?** A `records` row with
   `kind=notebook_template`, workspace-scoped, instantiable when
   `status=validated`.
3. **Are Templates versioned?** Only by creating a `revisions` row at
   instantiate (`reason=validate`). There is no published version sequence.
4. **Are Notebooks tied to Template identity/version?** Via
   `record_links` (`link_type=template`, `template_revision_id`). Not via a
   pinned published Template version FK. Later Template edits do not rewrite
   the Notebook’s copied blocks.
5. **What does a Sheet block own?** A `{tableId}` locator to a
   `scientific_tables` cluster. Not an Instance.
6. **Does a Sheet block reference a Sheet Instance?** No.
7. **Notebook duplication?** No first-class `duplicate_notebook` RPC.
   Template duplicate copies block JSON. Block duplicate refuses sheets.
8. **Template reuse?** Each instantiate creates a new record and new block
   rows; sheet `tableId` would be reused (shared table).
9. **Can one Sheet Instance appear in multiple Notebooks?** Not as an
   embedding. API allows many `notebook_record_id` pointers _to_ a record
   from many Instances, not many Notebooks to one Instance.
10. **What does submission freeze?** The REV-002 envelope (metadata, blocks,
    links, scientific tables/rows, formulas/results, files, Model
    customFields + field manifest, report structure).
11. **Can a submitted Notebook change because a Dataset changes?** Not via
    the current envelope (Datasets are absent). **Yes** for any future
    Instance-backed Sheet until Dataset Versions are attached at submit.
12. **Because a Sheet Instance changes?** Yes — Instances are not in the
    envelope.
13. **Because a Record changes?** Linked Record **values** can; identity and
    Model-field **manifest** cannot. Values copied into submitted
    scientific-table cells cannot.
14. **Because a Template/Definition changes?** Copied Template blocks: no.
    Unpinned Definition: Instances already pin versions. Notebooks do not
    currently store Definition ids.
15. **Evidence/signature tables?** `revisions`, `review_submissions`,
    `review_check_results`, `review_decisions`, `signatures`, `comments`,
    `revision_file_objects`.
16. **Revision manifests?** `canonical_snapshot` JSON + integrity digest;
    Model-field manifest; report structure; chart `frozen` payload.
17. **Stable IDs to preserve?** `records.id`, public identifiers,
    `blocks.id`, `revisions.id`, `scientific_tables.id` / row / column ids
    (historical), `sheet_instances.id`, `sheet_definition_versions.id`,
    `datasets.id`, `dataset_versions.id`, file object ids/checksums,
    Parameter/field UUIDs.
18. **Conflicts with ADRs 0020–0023?** Template-as-live-blocks without
    published versions; Definition reuse not modelled on Templates; default
    instantiate can share sheet tables; no explicit share graph; submitted
    evidence still live for Instances/Datasets; local data not owned by
    Instance in the Notebook path.
19. **CORE-03/04/05 reuse?** Definitions, Instances, Parameters,
    composition, local values, calculations, write-back, Record actions,
    capabilities, dependency discovery, Dataset Versions, Model manifests.
20. **What CORE-06 must add vs converge?** Add: Template version documents,
    block InstantiationPolicy, embedding/share graph, structured evidence
    snapshot, historical Instance renderer, dependency kinds, possibly two
    capabilities. Converge: sheet blocks, charts, instantiate_template,
    envelope contents. Do not add: Pipelines, View subsystem, inheritance,
    new Dataset primitive, new parameter language.

---

## 15. Open architectural decisions (for review; not implemented)

1. **Template identity:** evolve `notebook_template` records in place with a
   new `notebook_template_versions` table (mirrors Sheet Definitions), versus
   treating `revisions` as the published version catalog. Recommendation:
   **dedicated version table**, because instantiate-time `validate` revisions
   are the wrong lifecycle (they are created per use, not per publish).
2. **Sheet-block payload:** `{ instanceId, policy, presentation? }` versus a
   sidecar `notebook_sheet_embeddings` table. Recommendation: **payload
   identity + optional embeddings table** if location count / sharing must be
   queried without scanning JSONB.
3. **Legacy scientific-table migration:** wrap-as-ad-hoc-Instance versus
   dual-stack read versus freeze-only. Needs a short CORE-06.2 spike on
   actual demo/month seed volume; SCI-010 should not be expanded.
4. **Physical snapshot storage (CORE-06.7 ADR trigger):** embed Dataset
   Version ids + Instance state JSON in `canonical_snapshot` versus
   normalised evidence tables with dedup. Recommendation: **reference
   Dataset Versions by id** (they already exist); **embed or normalised-copy
   Instance local state** because Instances remain mutable. Avoid duplicating
   Dataset row storage.
5. **Shared-instance permission:** workspace RLS only versus
   `instance.share` capability. Recommendation: **reuse membership** for v1;
   add capability only if steward/scientist split requires it.
6. **Record evidence:** keep ADR 0036 live context (recommended default)
   versus snapshotting cited Record field values into the envelope when they
   appear in composed cells (those values should already sit in Dataset
   Version / Instance snapshots).
7. **Template publish capability:** map to `schema.publish` versus a new
   `template.publish`. Recommendation: **new verb** only if Template authors
   must not be Dataset schema publishers; otherwise reuse `schema.publish`
   to avoid vocabulary sprawl.

---

## 16. Validation baseline (CORE-06.1)

Focused existing DB tests on this checkout, **no** `pnpm validate`, **no**
CORE-02.6 benchmark:

```text
pnpm test:db \
  tests/db/notebook-schema.test.ts \
  tests/db/notebook-rpcs.test.ts \
  tests/db/notebook-rls.test.ts \
  tests/db/templates.test.ts \
  tests/db/submitted-revisions.test.ts \
  tests/db/signatures.test.ts \
  tests/db/sheet-block.test.ts \
  tests/db/sheet-reuse-lifecycle.test.ts \
  tests/db/sheet-local-values.test.ts \
  tests/db/object-dependencies.test.ts
```

Result: **10 files / 106 tests passed** (2026-08-16).

These suites prove: notebook RLS/RPC/CAS, template instantiate independence
for non-sheet blocks, revision immutability and submission idempotency,
signatures, legacy sheet-block insert, CORE-03 reuse/lifecycle, the missing
Instance embedding seam, and CORE-05 dependency discovery kinds.

---

## 17. Proposed implementation bundles

Five bundles preserve CORE-06.2–06.14 order. Do **not** start CORE-06.2 until
this audit is reviewed.

### Bundle A — CORE-06.1 (this document)

Covered: **06.1**.

User-visible: none. Planning artefact only.

Surfaces: `docs/core/audits/NOTEBOOK_EVIDENCE_AUDIT.md`.

Migrations/RLS: none.

Evidence: this file + focused baseline.

### Bundle B — Notebook Sheet blocks become Instance embeddings

Covered: **06.2** (foundation for 06.5–06.9).

User-visible: a Notebook Sheet block loads the same durable Sheet Instance as
`/sheets/$instanceId`; archived/missing/permission states are honest.

Surfaces: `blocks` payload contract; `insert_sheet_block` successor RPC;
`notebook-mutations.ts` / `blocks/index.ts`; `notebook-document.tsx`;
compatibility migration for `{tableId}`.

DB: migration; RLS unchanged in spirit; grants on new RPC; possibly
SECURITY DEFINER only if multi-table atomic wrap is required.

Revision: live CAS on Instance `revision` + record `structure_version`.

Transactions: atomic block insert + Instance create (or attach). Idempotent
retry token if Instance create is retryable.

Provenance/events: `record.block_inserted`; Instance created event if any.

Immutable evidence: **not yet**; tests must record that submit still lacks
Instance snapshots (do not pretend 06.2 closes 06.7).

Tests: create/embed/reload/move; archived Instance; existing Notebook
migration; cross-workspace deny; stale structure version.

Risks: SCI-010 dual-stack; delete/archive semantics; accidentally treating
Definition as live state.

Evidence: focused DB + UI load of one Instance from Notebook and standalone
route.

### Bundle C — Versioned Templates and typed parameter flow

Covered: **06.3, 06.4, 06.11**.

User-visible: publish a Notebook Template version that is a stable
composition dependency; parameters declared once.

Surfaces: Template version persistence; RLS/capabilities; `/templates`;
`templates.ts`; Parameter reuse; documentation that block ids can later
reference a Section without inheritance.

DB: Template identity/version tables or equivalent; publish/retire;
member-read; steward/admin publish. No JWT claims.

Revision: published Template version immutable; live Template draft CAS.

Transactions: publish is monotonic version insert; no silent rewrite of
existing Notebooks.

Provenance: Template version id stored on instantiate link (replace or
accompany `template_revision_id`).

Evidence: none yet beyond configuration.

Tests: pin/publish/retire; historical version resolution; permission;
Study Record / Dataset parameter mapping; missing/incompatible parameter;
Section-shaped reference possible (architecture test or documented seam).

Risks: conflating protocol templates; inventing a second parameter
language; Template inheritance.

### Bundle D — Independent instantiate and explicit sharing

Covered: **06.5, 06.6, 06.10**.

User-visible: two Notebooks from one Template get independent Instances;
optional shared-live embed is obvious; updating a Template’s Definition pin
publishes a **new** Template version and leaves old Notebooks alone.

Surfaces: instantiate RPC rewrite; share policy; location count UI;
Definition-upgrade impact on Template drafts.

DB: atomic instantiate (record + N Instances + bindings) with compensation
on failure; share embeddings; capability if required.

Concurrency: lock Template version row; Instance revision CAS on share
edits.

Idempotency: instantiate retry must not create extra Instances for the same
client token.

Provenance: source Definition version on each Instance; Template version on
the Notebook link.

Evidence: still live until Bundle E.

Tests: independent Instances; Dataset reuse without row copy; failed
required binding leaves no misleading partial Notebook; two Notebooks see
the same local edit when shared; permissions; archive; compatible vs
incompatible Template Definition update; existing Notebook unchanged.

Risks: partial instantiate; hidden share; silently following latest
Definition.

### Bundle E — Frozen evidence, historical rendering, consumers, golden proof

Covered: **06.7, 06.8, 06.9, 06.12, 06.13, 06.14**.

User-visible: submit captures reconstructable structured evidence; reviewers
see frozen Sheets; later Dataset/Instance/Definition/Template edits do not
change that view; charts/files point at stable identities for the golden
workflow.

Surfaces: envelope `formatVersion` bump; Dataset Version create-at-submit
for live Dataset bindings; Instance snapshot; `pinned_snapshot` renderer;
chart/file identity adaptation; CORE programme `NEXT.md` / AUTO-01 skeleton
reconciliation.

DB: transactional submit extended; snapshot failure aborts submission;
file retention unchanged; possibly new evidence tables (ADR if needed).

Concurrency: expected source digest remains the CAS; Instance/Dataset
revisions included in digest.

Idempotency: keep submission actor key + digest equality.

Provenance: actor/session/role already on submission/signature; extend
digest over new snapshot ids.

Immutable evidence: Dataset Versions + Instance snapshots + existing
manifests/files. Not audit replay.

Tests: mutate live Dataset/Instance/Definition/Template/Record after submit
and reconstruct; snapshot failure; reviewer frozen view; signature linkage;
chart/file stable ids; Purification Summary golden (two Templates, two
independent Notebooks, one optional share, submit one, mutate, reconstruct);
fresh migrate/seed; `pnpm validate` at epic end only.

Risks: envelope bloat; digest incompatibility; weakening lock/amend;
creating Dataset Versions per cell; historical UI showing live grids.

Do not start AUTO-01 implementation in this bundle; 06.14 only reconciles
the skeleton if the Core exit gate passes.

---

## 18. Bundle traceability

| Task                                     | Bundle |
| ---------------------------------------- | ------ |
| 06.1 Audit                               | A      |
| 06.2 Sheet block → Instance              | B      |
| 06.3 Template versions                   | C      |
| 06.4 Template parameters                 | C      |
| 06.5 `create_instance`                   | D      |
| 06.6 `reference_shared_instance`         | D      |
| 06.7 Structured snapshot                 | E      |
| 06.8 Submit/review/signature integration | E      |
| 06.9 `pinned_snapshot` rendering         | E      |
| 06.10 Template dependency update         | D      |
| 06.11 Section boundary (architecture)    | C      |
| 06.12 Charts/files stable identities     | E      |
| 06.13 Golden proof                       | E      |
| 06.14 Core exit / AUTO-01 hand-off       | E      |

Dependency order inside implementation: **B before D and E**; **C before D**;
**D’s instantiate before E’s golden path**; **06.7 before 06.8/06.9**.
