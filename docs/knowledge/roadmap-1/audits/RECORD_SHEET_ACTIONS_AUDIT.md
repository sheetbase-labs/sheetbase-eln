# Record selection / creation / import audit (for Sheet Record actions)

**CORE-04.1 — completed 2026-08-15**

Handoff base: PR #29 `agent/core-programme` tip `5899fad` (rebased equivalent of
`134981e`; trees differ only by Cloud Agent env files from `#30`).

## Conclusion

Sheetbase already has reusable Record search, link, create, Model-field edit,
and composed-Sheet write-back seams. CORE-04 should **reuse** those contracts
inside compositional Sheets — not invent a parallel registry, ID generator, or
import architecture.

| Capability                     | Status                                | Primary authority                                                |
| ------------------------------ | ------------------------------------- | ---------------------------------------------------------------- |
| Sample create + registry       | Production UI + RPC                   | `api.create_model_record`, `/samples`                            |
| Reagent registry + movements   | Production UI; **no create dialog**   | `record_reagent_movement`, `/reagents`                           |
| Protocol / notebook templates  | Template library                      | `api.create_record_with_blocks`                                  |
| Record picker / notebook link  | Shared cmdk picker + linker           | `searchRecords` → PostgREST `records`; `api.create_record_link`  |
| Model field admin + value edit | Admin + inspector                     | `create_and_activate_model_field`, `update_record_custom_fields` |
| Composed Sheet Record sources  | Server composition + write-back       | `query_sheet_instance_rows`, `update_record_custom_fields`       |
| Definition `record_actions`    | **Schema/validator only** (`actions`) | `create-record` / `link-record` / `open-record`                  |
| Bulk Record import from Sheets | **Missing**                           | Scientific CSV imports table rows, not Model Records             |
| Record-reference cell editor   | **Missing**                           | `fieldEditorPresentation('reference')` is plain text             |

Exit gate: subsequent tasks can reuse Model validation and Record CRUD rather
than inventing parallel flows.

## Accepted review decisions (binding)

CORE-04.1 and the four-bundle plan are accepted. Binding product decisions:

1. Write the Record UUID only to the column's authoritative Sheet write-back
   target (Dataset reference field, Instance-local field, or Model reference
   field). Do not add a second persistence location for the cell type, and do
   not auto-duplicate the UUID.
2. Notebook `create_record_link` stays a separate contextual concern. Sheet
   cell link/create must not create a notebook `record_link` as a side effect.
3. CORE-04.10 uses the existing generated `PREFIX-YYYY-NNNN` Model policy.
   No user-supplied/override IDs and no Sheet-specific generator.
4. Bulk Record commit is all-or-nothing. Validate may return mixed
   per-row/per-field errors; commit must not partially create.
5. Inline create + link is one transaction. Failed write-back must not leave
   a newly created Record behind.
6. CORE-04 adds a minimal composed-Sheet browser/grid (Handsontable + existing
   CORE-03 composition/write-back). Prove the workflow; do not redesign Sheets.
7. Golden workflow is Sample-only. Stay Model-generic; no dedicated Reagent
   create product flow.
8. Keep current Record RLS/membership. Definition `actions` still configure
   create/link/open in the UI. Richer link-only vs create-capable server
   capabilities belong in CORE-05.
9. Do not add `create_model_record` or `update_record_custom_fields` to the
   external API allowlist.
10. CORE-04.11 requires a fully green `pnpm validate` / full DB gate.

Three CORE-03 Sheet Definition DB failures were corrected before CORE-04.2
(migration `0091` and aligned test fixtures).

---

## Sources inspected

- Product / architecture: `docs/core/PRODUCT_CORE.md` (Record creation from
  Sheets), `CORE_ARCHITECTURE.md` §§4–9 and 24–25, `CORE_MIGRATION.md`,
  ADRs 0020–0026 (especially 0025 quantities/vocabularies and 0026 Record
  identity), CORE-03.16 completion evidence in `docs/core/tasks/CORE-03.md`
- Routes: `src/routes/samples.tsx`, `reagents.tsx`, `search.tsx`, `admin.tsx`,
  `templates.tsx`, `projects/$projectId/experiments/$recordId.tsx`
- Components: `src/components/scientific/*` (picker, linker, model fields),
  `samples/`, `reagents/`, `workspace-admin/admin-model-fields.tsx`,
  `notebook/block-editor.tsx`, `registry/registry-composition.tsx`,
  `sheet/scientific-transfer-panel.tsx`
- Lib: `scientific-records.ts`, `samples.tsx`, `reagent-data.ts`,
  `model-fields.ts`, `field-definition.ts`, `field-presentation.ts`,
  `scientific-csv.ts`, `scientific-sheet-data.ts`, `sheet-local-data.ts`,
  `sheet-definition.ts`, `parameter.ts`, `sheet-composition-data.ts`,
  `sheet-bound-columns.ts`, `sheet-write-back.ts`, `search.ts`,
  `external-token.ts`
- Schema / SQL: `src/db/schema.ts` (`records`, `record_links`,
  `record_field_definitions`); migrations `0009`/`0010`/`0012`/`0020`/`0030`/
  `0034`/`0045`/`0057`/`0060`/`0065`/`0069`/`0072`/`0075`/`0078`/`0081`/`0084`
- ADR `docs/knowledge/decisions/0024-transactional-csv-interchange.md`
- Tests listed in §9

---

## CORE-03 composition seam (read this before inventing a grid)

There is still **no canonical composed-Sheet browser route**. CORE-03.16 is
server/API contract proof over a bounded 200-row virtual window.

The golden `Purification Summary` fixture names three **Datasets**:
`Sample Records`, `Upstream Results`, `Purification Results`. They join on a
Sample UUID **reference field**. That is not a Sample registry and it does not
create Records.

A separate optional **Record parameter binding**
(`parameter.type.kind === 'record'`, `modelKey`) projects **one** resolved
Sample Record as a constant governed source across composed rows
(`sourceKind:'record'` + `metadataVersion` + `fieldNames`). Write-back of that
source calls `update_record_custom_fields`. Deleted bound Records fail
composition with `SB076`.

CORE-04 per-row search/create/link must produce the UUIDs Dataset joins already
consume. It is a new write path. It must not be confused with:

- constant Record parameter bindings;
- notebook `record_links`;
- legacy scientific-table CSV import.

---

## 1. Registry pages and create dialogs

### Samples (`kind='sample'`)

| Layer        | Path                                               | Names                                                                  |
| ------------ | -------------------------------------------------- | ---------------------------------------------------------------------- |
| Route        | `src/routes/samples.tsx`                           | `Route` (`/samples`), `CreateSampleDialog`                             |
| Composition  | `src/components/registry/registry-composition.tsx` | `RegistryComposition`                                                  |
| Inspector    | `src/components/samples/sample-inspector.tsx`      | `SampleInspector` → `ModelProperties`                                  |
| Lib          | `src/lib/samples.tsx`                              | `createSample`, `fetchSamplesPage`, `buildSamplesFilter`, custody RPCs |
| Model inputs | `src/components/scientific/model-field-input.tsx`  | `ModelFieldInput`                                                      |

**Create:** `CreateSampleDialog` → `createSample()` → RPC `create_model_record`
(`p_kind='sample'`, properties + optional `p_custom_fields`). Human ID is
**server-generated** (`SMP-YYYY-NNNN`); the dialog does not accept a
user-supplied identifier. Required custom fields (`nullable: false`) block
submit in the UI; the server re-validates.

**Registry search:** `buildSamplesFilter` — identifier/title/barcode OR,
status, storage, sample type, archived inclusion, and `custom:<field>`
eq/contains on `custom_fields`.

### Reagents (`kind='reagent'`)

| Layer     | Path                                            | Names                                                          |
| --------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Route     | `src/routes/reagents.tsx`                       | `ReagentsRegistryRoute`, `ReagentActions`, `QuantityDialog`    |
| Inspector | `src/components/reagents/reagent-inspector.tsx` | `ReagentInspector`                                             |
| Lib       | `src/lib/reagent-data.ts`                       | `fetchReagentsPage`, `recordReagentMovement`, `archiveReagent` |

**Create UI: none.** Mutations are receive / consume / quarantine / archive.
Creation today is seed, tests, or `create_model_record`. CORE-04 inline create
must share the Model create form, not invent a reagent-only dialog.

### Other surfaces

| Surface             | Path                                                 | Notes                                                    |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Templates           | `src/routes/templates.tsx`, `src/lib/templates.ts`   | `create_record_with_blocks`                              |
| Notebook            | `…/experiments/$recordId.tsx`                        | Hosts `ScientificRecordLinker`                           |
| Workspace search    | `src/routes/search.tsx`, `src/lib/search.ts`         | `api.search` discovery — not a link picker               |
| Plate CSV           | `src/routes/plate-designer.tsx`                      | Layout import — not Records                              |
| Scientific transfer | `importScientificRows` in `scientific-sheet-data.ts` | `import_scientific_rows` — table rows, not Model Records |

---

## 2. CSV / import, mapping, coercion, bulk writes

There is **no** Samples/Reagents/Records CSV import. The only production
transactional CSV→server path imports **scientific table rows** (ADR 0024).
Dataset bulk validate/commit is the pattern to **mirror** for Record batches,
not a Record-create RPC.

### Scientific CSV (ADR 0024) — wrong domain, useful UX pattern

| Layer     | Path                                                   | Symbols                                                                               |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| ADR       | `docs/knowledge/decisions/0024-transactional-csv-interchange.md` | ≤10 MB / 5,000 rows; UTF-8 / UTF-16LE / Windows-1252; `,` / `;` / tab; all-or-nothing |
| UI        | `src/components/sheet/scientific-transfer-panel.tsx`   | `ScientificTransferPanel`, `previewFile`, `runImport`                                 |
| Parse/map | `src/lib/scientific-csv.ts`                            | `parseScientificCsv`, `prepareScientificImport`, `CSV_LIMITS`, `CsvMapping`           |
| Coerce    | `src/lib/scientific-sheet-data.ts`                     | `decodeScientificValue` (throws before RPC)                                           |
| RPC       | `importScientificRows` → `api.import_scientific_rows`  | `drizzle/0020_data_005_csv_interchange.sql`                                           |

**Mapping:** source column → `ignore` | `existing` (column UUID) | `new`.
UI auto-suggests when the header matches a column **label**. New-column picker
**excludes** `category` and `reference`.

**Transaction:** one PostgreSQL transaction; locks the table; may add columns;
inserts rows; writes transfer provenance. Failure rolls back DDL + rows +
provenance. Not chunked or resumable. **No idempotency token.**

**Duplicates:** file-internal only (`allow` / `reject_file` / `skip_file` on
md5 of mapped jsonb). Does **not** match existing DB rows. ADR 0024 deferred
record-key matching.

**Preview / validate-without-commit:** client only
(`prepareScientificImport`). No server validate-only CSV RPC.

### Plate CSV

`src/components/plate-designer/csv-import-dialog.tsx` +
`src/lib/plate-designer.ts`. Well/role/sample-identifier **strings** → plate
assignments. Not Record create.

### Field mapping vs Model `custom_fields`

| Exists today               | Target                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Scientific CSV             | Scientific column UUID                                                                |
| Sample create / Model edit | `custom_fields[field_name]` via `create_model_record` / `update_record_custom_fields` |
| Sheet write-back           | Same, when the composed row already has a Record UUID                                 |
| Dataset bulk               | Field UUID keys in `values`                                                           |
| CORE-04.5 need             | Column/paste → Model fieldId / constants / Record-ID policy / match key — **absent**  |

### Coercion matrix

**`decodeScientificValue`:** empty→null if nullable; integer/decimal/boolean
strict; category match option **id or label** → store **id**; date
`YYYY-MM-DD`; timestamp must start `YYYY-MM-DDT`; **reference falls through to
text** (`default`); min/max/length/pattern; **no quantity unit conversion**.

**`internal.validate_model_fields` (`0057`, SECURITY DEFINER, not
client-callable):** defaults for omitted keys; required; types; category by
option **key**; reference UUID + `targetModelKey` + same workspace
(`SB070`/`SB071`). Quantity metadata is **not** enforced on write. Vocabulary
product tables do not exist; category writes still require
`model_field_options`.

**`sheetLocalValueError` / Dataset batch:** category and reference as UUID
**ids**. `many` allowed for Dataset and Sheet-local; Model canonicalize
**rejects** `cardinality='many'` (`0060`, `SB071`).

**Hazard:** scientific/Sheet-local/Dataset category stores option **id**; Model
stores option **key**. Bulk Record mapping must use Model semantics. Do not
invent silent unit equivalence.

### Dataset bulk pattern (adapt for 04.6–04.7)

| RPC                              | Behaviour                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `api.validate_dataset_row_batch` | `{ ok, errors[] }` without mutation; 1–1000 rows                                                                                  |
| `api.commit_dataset_row_batch`   | re-validate; all-or-nothing; idempotency `(workspace, actor, key)` + SHA-256 digest in `api.dataset_bulk_commits` (`0065`/`0069`) |

Sheet write-back already passes retry tokens into **Dataset** commits. The
Record branch of `writeSheetCell` parses `retryToken` then **discards it** —
`update_record_custom_fields` has no idempotency key.

---

## 3. Reference editors / pickers / link pickers

### Canonical Record picker (**keep**)

| Component                 | Path                                          | Role                                                           |
| ------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| `RecordPicker`            | `src/components/scientific/record-picker.tsx` | cmdk keyboard picker; select-only; no create                   |
| `ScientificRecordLinker`  | `scientific-record-linker.tsx`                | Kind tabs + debounced `searchRecords` + `createScientificLink` |
| `ScientificRecordSummary` | `scientific-record-summary.tsx`               | Linked-target property summary                                 |
| `RecordLink`              | `record-link.tsx`                             | Display chip                                                   |

**Consumers:** notebook inspector (`$recordId.tsx`); `ProtocolReferenceEditor`,
`MaterialsEditor` (`sample`\|`reagent`), `PlateMapBlockEditor` in
`src/components/notebook/block-editor.tsx`.

### Not Record pickers

| Component                       | Path                                               | Role                                                |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| `FormulaReferenceEditor`        | `src/components/sheet/formula-reference-editor.ts` | A1 formula refs                                     |
| Dataset schema “Reference”      | `src/routes/schemas.tsx`                           | Dataset-schema relationships                        |
| `ModelFieldInput` + `reference` | `model-field-input.tsx` + `field-presentation.ts`  | Falls through to **plain text** — gap for CORE-04.2 |

---

## 4. Search APIs

### Picker search (link flows) — primary for CORE-04.3

| Function                            | Path                            | Behaviour                                                                                                            |
| ----------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `searchRecords`                     | `src/lib/scientific-records.ts` | PostgREST `records`: kind, `deleted_at IS NULL`, default `archived_at IS NULL`, `(identifier,title) ilike` prefix OR |
| `fetchRecordById`                   | same                            | Resolve existing links (incl. archived)                                                                              |
| `identifierPattern` / `KIND_PREFIX` | same                            | `SMP`/`RGT`/`PRT`-`YYYY`-`NNNN`                                                                                      |

The file comment historically said archived rows are included; the
**default is to exclude them**. The linker passes `includeArchived: true`.
Soft-deleted rows are always excluded. Keyboard: cmdk with
`shouldFilter={false}`.

**Custom fields:** picker search does **not** query `custom_fields` /
`properties`. Samples registry filters are richer — adapt those patterns for
Model-scoped Sheet search; do not load the full registry.

### Workspace search (discovery only)

`src/lib/search.ts` → RPC `api.search` (title/identifier/tags/blocks/
properties). Wrong contract for Sheet cell linking.

---

## 5. Model management and Record ID policy

### Field definitions / required fields

| Concern           | Implementation                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage           | `record_field_definitions`, `model_field_options`, `model_kinds`, `model_base_fields`                                                                                   |
| Browser           | `fetchModelFields`, `fetchModelKinds`, `fetchModelFieldsWithUsage` (`model-fields.ts`)                                                                                  |
| Admin RPCs        | `create_and_activate_model_field`, `update_model_field`, `retire_model_field` — owner/admin via `is_model_field_admin`; **SECURITY DEFINER** except the INVOKER wrapper |
| Required          | `nullable: false` → UI `*`; Samples create blocks missing required                                                                                                      |
| Protected         | `model_base_fields` collision → `SB070`                                                                                                                                 |
| Types             | Includes `reference` with `relationship.target.modelKey`                                                                                                                |
| Value edit        | `updateRecordModelFieldValues` → `update_record_custom_fields`                                                                                                          |
| Server validation | `internal.validate_model_fields` via `guard_model_custom_fields` trigger (`0057`)                                                                                       |
| Kernel            | `src/lib/field-definition.ts`, `field-presentation.ts`                                                                                                                  |

### Record ID policy (current vs ADR 0026)

ADR 0026 distinguishes UUID / human Record ID / Name and allows generated,
user-supplied, and generated-with-authorised-override policies. **Only
generated exists today.**

| Rule                    | Evidence                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| UUID = durable identity | `records.id`; Model references store UUID strings; composition/write-back use UUID                                           |
| Human ID generated      | `create_model_record` / `create_record`: `{PREFIX}-YYYY-NNNN`; **no user-supplied param**                                    |
| Prefixes                | EXP, PRT, RPT, SMP, RGT, FILE, NBK (`create_model_record` does not create `study`)                                           |
| Uniqueness              | `uq_records_project_identifier` on `(project_id, identifier)` — **same human ID can exist in two projects in one workspace** |
| Templates / studies     | Additional workspace-scoped unique indexes (`0034`/`0058`/`0059`)                                                            |
| Locking                 | `create_model_record` takes `SHARE ROW EXCLUSIVE` then `count(*)+1`; classic `create_record` does not lock                   |
| Override policy         | **None** — CORE-04.10 must extend Model/`create_model_record`, not Sheets                                                    |
| Immutability            | Documented; **no trigger blocks `identifier` UPDATE** (gap vs ADR 0026)                                                      |

`create_record_link` uniqueness is
`(source_record_id, target_identifier, link_type)` — identifier string, not
UUID. CORE-04 Sheet relationships must persist UUID like Model references.

---

## 6. Sheet write-back to Records

| Piece              | Path                                          | Names                                                                         |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| Resolve / dispatch | `src/lib/sheet-write-back.ts`                 | `resolveSheetWriteTarget`, `writeSheetCell`                                   |
| Model branch       | same                                          | `update_record_custom_fields` with CAS `metadata_version`; **no retry token** |
| Composition        | `sheet-composition-data.ts`                   | `fetchComposedSheetRows`, `recordSourceSchema`                                |
| Projection         | `sheet-bound-columns.ts`                      | Provenance `sourceKind:'record'`, field name, metadata version                |
| Definition rules   | `sheet-definition.ts`                         | `writeBackRules` (`mode:'update'` only)                                       |
| SQL                | `drizzle/0084_core_0310_sheet_write_back.sql` | Attaches `metadataVersion` + `fieldNames` (fieldId→`field_name`)              |

Write-back **updates** existing Record custom fields only — no create/link.
Concurrent cell writes on the same Record conflict on whole-record CAS.

---

## 7. Sheet Definition `record_actions` and CORE-03 seams

Architecture (`CORE_ARCHITECTURE.md` §8) says `record_actions[]`. The
implemented JSON key is **`actions`**.

| Layer   | Path                                          | Contract                                                                                            |
| ------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Zod     | `src/lib/sheet-definition.ts`                 | `actions[]`: `kind ∈ {create-record, link-record, open-record}`, optional `bindingId`/`parameterId` |
| SQL     | `drizzle/0072_core_032_sheet_definitions.sql` | Same enum; `SB071` on invalid; unique ids/keys                                                      |
| Fixture | `tests/fixtures/sheet-definition.ts`          | Example `open-record`                                                                               |
| Tests   | `tests/sheet-definition.test.ts`              | Parser uniqueness/refs                                                                              |

No runtime UI reads `configuration.actions`. CORE-04.9 owns wiring +
permission honesty (UI hide ≠ enforcement).

### CORE-03 Record source seams (**reuse**)

| Seam         | Contract                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Parameter    | `parameter.type.kind === 'record'` + `modelKey` — `src/lib/parameter.ts`                                                                       |
| Resolution   | `0075`: supplied `{kind:'record', recordId}` must match Model/workspace/lifecycle                                                              |
| Binding      | `{kind:'record', recordId, policy:'live', modelKey}`                                                                                           |
| Composition  | `query_sheet_instance_rows` (DEFINER) → `sourceKind:'record'` + `metadataVersion` + `fieldNames`; rechecks workspace + `deleted_at` + modelKey |
| Golden proof | Purification Summary Dataset joins — `tests/db/sheet-composition.test.ts`                                                                      |

---

## 8. Browser vs external API; RLS; events

Both browser and external clients use `/api/db/*` → PostgREST. Difference is
auth + allowlist.

| Path     | Auth                                                | Record mutation access                                                                                                                                                                                              |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser  | Better Auth → `authenticated`                       | Full grants: `create_model_record`, `update_record_custom_fields`, sample/reagent RPCs                                                                                                                              |
| External | Bearer → `api_client` + `src/lib/external-token.ts` | Allowlisted: `create_record`, `create_record_with_blocks`, `create_record_link`, archive/restore, `transition_record_status`, `instantiate_template`; **not** `create_model_record` / `update_record_custom_fields` |

`create_model_record` / `update_record_custom_fields` already revoke
`PUBLIC`/`anon`/`api_client`. External parity is a separate allowlist task,
not a second create contract.

**RLS** (`0009`, lock in `0045`): workspace member select/insert/update; owner
delete; update/delete require `locked_at IS NULL`. Isolation is **workspace**,
not project. `project_access` (`0054`) is **not** in `records_*` policies.
Any workspace **member** can mutate `custom_fields` today. CORE-04.9 must add
real capabilities if create/update must be narrower than link.

**Direct grants:** authenticated SELECT/INSERT/UPDATE/DELETE on `records`.
Product identity generation must use RPCs (sequence + validation). Tests
sometimes `INSERT` as migrator and bypass the identifier RPC.

**Events:** INSERT/UPDATE/DELETE on `api.records` →
`internal.trg_change_event_records` (`0012`, payload refined in `0030`) →
`internal.emit_change_event` (JWT `sub`/`client_id`; skipped if no claims).
Gap: `changedMetadata` watches title/status/tags/folder/`properties` and
**omits `custom_fields`**. Link inserts emit `record_link` events.

---

## 9. Record mutation RPC catalogue

Default `LANGUAGE plpgsql` without `SECURITY DEFINER` = **SECURITY INVOKER**.

| RPC                                        | Latest wrapper                         | Judgement                          | Notes                                                                       |
| ------------------------------------------ | -------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `create_model_record`                      | `0057`                                 | **Keep / primary**                 | Samples UI; custom_fields + table lock; INVOKER; grant `authenticated` only |
| `create_record`                            | `0034`                                 | **Keep** (non-Model / legacy)      | No `custom_fields` param; templates may use NULL project                    |
| `create_record_with_blocks`                | `0022` (calls current `create_record`) | **Keep**                           | Templates — not Sheet Sample create                                         |
| `create_record_link`                       | `0010`                                 | **Keep**                           | UUID preferred; `SB002` cross-workspace; `p_label` unused in body           |
| `update_record_custom_fields`              | `0057`                                 | **Keep**                           | Write-back + Model editors; CAS `SB001`; archived `SB004`; locked `SB011`   |
| `edit_sample`                              | `0057` (widens `0041`)                 | **Keep / adapt**                   | Title/props/tags/notes/custom + `sample_events`                             |
| `archive_record` / `restore_record`        | `0010`                                 | **Keep**                           | Generic CAS                                                                 |
| Sample custody                             | `0041`                                 | **Keep**                           | Out of bulk create scope                                                    |
| `record_reagent_movement`                  | `0040`                                 | **Keep** (DEFINER)                 | Not create                                                                  |
| `create_study` / file upload / instantiate | `0058`/`0026`/`0029`                   | **Keep**                           | Other domains                                                               |
| Bulk validate/commit Records               | **Absent → Add**                       | Mirror Dataset bulk; no HTTP loops |
| User-supplied Record ID                    | **Absent**                             | Model policy later (04.10)         |
| Scientific CSV as Record import            | **Deprecate as candidate**             | Wrong domain                       |

### `api.create_model_record` (primary)

Signature: `(p_project_id uuid, p_kind text, p_title text, p_status text
DEFAULT 'draft', p_tags text[] DEFAULT '{}', p_properties jsonb DEFAULT '{}',
p_custom_fields jsonb DEFAULT '{}') RETURNS api.records`.

INVOKER, `SET search_path=''`. Membership + project-in-workspace checks
(`42501`). Unsupported kind `23514`. `LOCK TABLE api.records IN SHARE ROW
EXCLUSIVE MODE` → sequence → INSERT. BEFORE INSERT trigger validates
`custom_fields`. No idempotency token. No create+link helper.

### `api.create_record_link`

Signature: `(p_source_record_id, p_target_kind, p_target_identifier,
p_link_type, p_target_record_id uuid DEFAULT NULL, p_label text DEFAULT NULL)`.
If UUID set, target must exist in `current_workspace_id()` else `SB002`.
Does not create Records.

---

## 10. Tests (authoritative for later bundles)

### Unit / component

| Area                           | Paths                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Picker / linker                | `src/components/scientific/record-picker.test.tsx`, `scientific-record-linker.test.tsx`                                  |
| Domain                         | `src/lib/scientific-records.test.ts`, `samples.test.ts`, `reagent-data.test.ts`                                          |
| Model                          | `src/lib/model-fields.test.ts`, `model-field-input.test.tsx`, `model-properties.test.tsx`, `admin-model-fields.test.tsx` |
| Write-back / composition       | `src/lib/sheet-write-back.test.ts`, `sheet-composition-data.test.ts`, `sheet-bound-columns.test.ts`                      |
| Definition actions             | `tests/sheet-definition.test.ts`                                                                                         |
| CSV (wrong domain, mapping UX) | `src/lib/scientific-csv.test.ts`                                                                                         |
| FieldDefinition kernel         | `src/lib/field-definition.test.ts`                                                                                       |

### DB / API

| Area                   | Paths                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| Scientific records     | `tests/db/scientific-records.test.ts`, `tests/api/scientific-records.test.ts` |
| Samples / reagents     | `tests/db/samples.test.ts`, `tests/db/reagents.test.ts`                       |
| Model + create/update  | `tests/db/model-fields.test.ts`                                               |
| Composition write-back | `tests/db/sheet-composition.test.ts`                                          |
| Record parameters      | `tests/db/parameter-resolution.test.ts`                                       |
| Identifiers            | `tests/db/notebook-schema.test.ts`                                            |
| Dataset bulk pattern   | `tests/db/datasets.test.ts`                                                   |
| Scientific row import  | `tests/db/scientific-rest.test.ts` (not Records)                              |

### Browser E2E

`tests/browser/` has scientific/dataset proofs only — **no** Samples create,
RecordPicker, or Model-admin E2E. CORE-04.8/04.11 should add composed-Sheet
coverage when a grid route exists; until then follow CORE-03.16 and treat UI
as server-contract proof unless a route is added.

**Missing tests CORE-04 must add:** bulk Record validate/commit; Sheet-row ↔
created UUID map; retry/idempotency; permission denial on Sheet create;
workspace isolation of bulk create; create+link atomic failure leaving the
cell unlinked.

---

## Duplication / uniqueness rules

| Concern                    | Rule                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| UUID                       | Durable identity for links, composition, write-back, Model references |
| Human identifier           | Generated display/search key; unique per **project**, not workspace   |
| Name (`title`)             | Not unique                                                            |
| Model field keys           | Unique per model; no `model_base_fields` collision                    |
| Definition action keys/IDs | Unique within `actions`                                               |
| Write-back                 | One mapping per source field; CAS metadata/dataset revisions          |
| Composition joins          | Scalar reference equality; duplicate right keys fail                  |
| Notebook links             | Unique `(source, target_identifier, link_type)`                       |

---

## Keep / adapt / deprecate map

### Keep

| Asset                                                         | Why                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `RecordPicker` + `searchRecords`                              | Keyboard picker; RLS-safe; archived honesty                  |
| `ScientificRecordLinker` / `create_record_link`               | Canonical notebook link persistence                          |
| `create_model_record` + `validate_model_fields`               | Canonical Model create                                       |
| `update_record_custom_fields`                                 | Shared edit + Sheet write-back                               |
| Model admin / required `nullable`                             | Authoritative Model surface                                  |
| Definition `actions` kinds + SQL validator                    | Config vocabulary for 04.9                                   |
| Parameter `kind:'record'` + composition `sourceKind:'record'` | CORE-03 seams                                                |
| `writeSheetCell` model branch                                 | Existing **update** path                                     |
| Samples custom-field filters                                  | Pattern for richer 04.3 search                               |
| Dataset `validate_*` / `commit_*` + `dataset_bulk_commits`    | Blueprint for Record bulk — do not call it to create Records |

### Adapt

| Asset                                         | Change                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `searchRecords`                               | Model-scoped custom-field/name search; keep archived/RLS behaviour |
| `RecordPicker`                                | Compact Sheet cell variant; target Model constrained               |
| `ModelFieldInput` / `fieldEditorPresentation` | `reference` → picker, not text                                     |
| `CreateSampleDialog` field set                | Extract shared Model-create form (04.4)                            |
| Definition `actions`                          | Wire UI + server capability checks (04.9)                          |
| External allowlist                            | Add Model RPCs only if API parity is in scope                      |
| Reagent create                                | First-class `create_model_record` entry (registry + Sheet)         |
| Scientific CSV transfer panel                 | Preview/mapping UX pattern for 04.5; retarget to Model fields      |
| Change-event `changedMetadata`                | Include `custom_fields` when Sheets mutate Model fields            |
| `writeSheetCell` Record branch                | Pass through retry/idempotency once Record commit has a token      |

### Deprecate / do not use

| Asset                                                      | Why                                |
| ---------------------------------------------------------- | ---------------------------------- |
| Per-Model create forms for Sheets                          | Forbidden by 04.4                  |
| Labels/names as relationship identity                      | UUID only (ADR 0026)               |
| `import_scientific_rows` / plate CSV as Record bulk create | Wrong domain                       |
| `api.search` as Sheet link picker                          | Wrong contract                     |
| `FormulaReferenceEditor` for Record linking                | Formula A1 only                    |
| Sheet-local ID generator                                   | IDs owned by `create_model_record` |
| Definition `actions` as sole enforcement                   | Server must reject                 |
| N× HTTP `create_model_record` for bulk                     | Forbidden by epic invariants       |
| Misusing `project_access` as Record RLS                    | Not wired; CORE-05 owns finer ACL  |
| Constant Record bindings as per-row Sample create          | Different composition seam         |

---

## Recommended reuse recipe

```text
Sheet cell (Record reference)
  ├─ persist: Record UUID
  ├─ display: identifier + title
  ├─ search: adapt searchRecords + Samples filter patterns (Model-scoped)
  ├─ pick: adapt RecordPicker (cmdk)
  ├─ link existing: write UUID to the Sheet write-back target
  │                 (Dataset reference field / local field / bound Record field)
  ├─ notebook link (optional): create_record_link — not Sheet row identity
  ├─ create: create_model_record (+ required Model fields)
  ├─ update values: update_record_custom_fields (existing write-back)
  ├─ bulk: new validate/commit RPCs mirroring Dataset bulk
  └─ configure: Definition.actions {create-record, link-record, open-record}
```

---

## Proposed implementation bundles (CORE-04.2–04.11)

The four-bundle plan is accepted. Adjust within a bundle if implementation
evidence makes that sensible. No further planning checkpoint before CORE-04.2.
Each bundle is one reviewable commit after focused validation. No
`pnpm validate` until CORE-04.11 unless a change requires an earlier broad
check. Do not rerun the CORE-02.6 100k+80k benchmark.

### Bundle 2 — Record-action contract and persistence foundation

**Requirements:** CORE-04.2; CORE-04.10 inspection and any Model-owned ID-policy
hooks that 04.4/04.7 must call (generated-only is acceptable if documented;
do not invent a second generator). Confirm Definition `actions` schema is
sufficient (likely keep `0072` enum; no migration if unchanged).

**Production surfaces:** `field-presentation.ts` / Sheet cell value contract;
`sheet-definition.ts` action docs; composition projection types; possibly
`scientific-records.ts` display helpers. No bulk RPC yet.

**Migrations / permissions:** none expected unless the cell contract needs a
new typed wire field. Do not weaken RLS.

**Focused tests:** render/select/reload/rename target Record; invalid Model
target; missing/archived target; UUID vs identifier vs title distinction;
TypeScript parser tests for the cell contract.

**Risks:** persisting labels; conflating notebook `record_links` with Sheet
row identity; treating constant Record bindings as per-row references.

**Evidence:** typed contract + tests; audit cross-links; no Record-create RPC
fork.

### Bundle 3 — Selection, mapping, validation, and preview

**Requirements:** CORE-04.3, CORE-04.5, CORE-04.6.

**Production surfaces:** Model-scoped search RPC or PostgREST query (no full
registry load); Sheet picker; column→Model-field mapping; constants/defaults;
match-key classification; `validate` RPC returning per-row/per-field errors
without mutation.

**Migrations / permissions:** new `api.validate_…_record_batch` (INVOKER,
`authenticated`; revoke `PUBLIC`/`anon`/`api_client`); grants only. Reuse
`internal.validate_model_fields`. Bound payloads (mirror Dataset 1–1000).

**Focused tests:** search scale/RLS/exact ID/name; mapping explicit vs
incompatible type/quantity/category/reference; mixed valid/invalid rows;
duplicates; existing matches; permission denial; workspace isolation.

**Risks:** category key vs UUID; quantity claimed but not converted; search
bypassing RLS; inferring mappings from labels; validate RPC as DEFINER
without membership recheck.

**Evidence:** validate-without-commit preview; no writes; SQL/TS parity.

### Bundle 4 — Transactional create/import with provenance and liveness

**Requirements:** CORE-04.4, CORE-04.7.

**Production surfaces:** compact inline create+link using the shared Model
field set; bulk commit RPC; Sheet-row ↔ created/existing UUID map; retry
token; `change_events` including `custom_fields`; write-back of UUIDs through
existing Dataset/local/Record targets.

**Migrations / permissions:** `api.commit_…_record_batch` + idempotency table
analogue of `dataset_bulk_commits`; possibly extend `create_model_record` with
optional ID policy rather than forking; `trg_change_event_records` payload
fix. Prefer INVOKER + RLS; if DEFINER is required, re-check membership,
project, workspace, and Model kind like current create.

**Focused tests:** valid create/link; missing required; duplicate ID;
permission denied; server failure leaves cell unlinked; retry same digest;
conflicting token reuse; transaction failure; created IDs mapped to
`sb-row-v1` keys; large realistic batch; no N× HTTP create.

**Risks:** partial commits; identifier sequence races; whole-Record CAS
conflicts in mixed update/create; create+link split; SECURITY DEFINER
privilege; external API still on `create_record` without custom_fields.

**Evidence:** atomic documented semantics; idempotent retry; provenance
events; SQL/TS wire parity.

### Bundle 5 — Product integration and final acceptance proof

**Requirements:** CORE-04.8, CORE-04.9, CORE-04.11 (and any remaining 04.10
display/search alignment).

**Production surfaces:** in-grid error markers/navigation if a composed-Sheet
route exists, otherwise honest server-contract + picker UX on existing
notebook/registry seams (same limitation as CORE-03.16); Definition `actions`
UI hide/disable; server rejection independent of UI; Purification Summary
paste → match → create → fix → commit → UUID link → reload.

**Migrations / permissions:** capability checks only if 04.9 cannot honestly
use current member-vs-admin split; do not pretend `project_access` is Record
RLS. Fresh migrate + `pnpm validate` at this gate.

**Focused tests:** mixed error types; corrected rerun; link-only vs
create-capable vs denied update; cross-workspace isolation; golden bulk
workflow. No CORE-02.6 benchmark rerun.

**Risks:** treating UI visibility as enforcement; claiming browser-grid
acceptance without a route; broadening into Views/Pipelines.

**Evidence:** CORE-04.md + `NEXT.md` hand-off to CORE-05.1; validate gate;
golden workflow named in tests.

---

## Unresolved decisions (blockers for later bundles, not for this audit)

1. **Bulk atomicity:** Dataset commit is all-or-nothing. CORE-04.7 allows
   all-or-nothing **or** documented batch semantics. Prefer mirroring Dataset
   unless preview evidence shows a scientific need for partial commit. ADR
   only if that fork is genuine.
2. **Where created UUIDs are written:** Dataset Sample-reference column vs
   Instance-local field vs future Record-reference cell. Bundle 2 must name
   the write-back target; Bundle 4 must use it.
3. **Human Record ID policy:** generated-only is the live contract. Bundle 2
   should document that 04.10 is a no-op until Model infrastructure grows
   user-supplied/override modes — unless product insists on shipping
   user-supplied IDs in CORE-04.
4. **Create+link atomicity:** no helper today. Bundle 4 should make create+
   Sheet write-back one transaction; notebook `create_record_link` is a
   different identity.
5. **External API parity:** allowlist omits Model RPCs. Out of CORE-04 unless
   explicitly pulled in; browser Sheets must still use the same PostgreSQL
   RPCs as registries.
6. **Composed-Sheet UI:** no route. 04.8/04.11 must not invent a general grid
   product; follow CORE-03.16 honesty.
7. **Capabilities vs member write:** any member can create/update Records
   today. 04.9 cannot honestly separate link-only vs create without new
   capability storage (CORE-05 direction). Call that out in Bundle 5 rather
   than silently weakening or inventing a parallel ACL.

No new ADR is warranted by this audit alone.

---

## Appendix A — FieldDefinition / validation / auth depth

### A.1 Canonical FieldDefinition across hosts

**Authority:** `src/lib/field-definition.ts` —
`FieldDefinition`, `validateFieldDefinition`, `assertFieldDefinition`,
`fieldDefinitionFromModelField`, `fieldDefinitionFromDatasetSchemaField`.

| Host                     | Adapter / validator                                                                                        | Durable id                               | Storage key                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------ |
| Models                   | `fieldDefinitionFromModelField`; SQL `internal.canonicalize_model_field_definition` (`0060`)               | `record_field_definitions.id`            | `field_name` → `custom_fields`       |
| Datasets                 | `fieldDefinitionFromDatasetSchemaField`; SQL `internal.assert_publishable_dataset_schema_version` (`0069`) | `dataset_schema_version_fields.field_id` | field UUID in row `values`           |
| Sheet Definition / local | embedded JSON; SQL `internal.validate_sheet_field_definition` (`0072`)                                     | `field.fieldId`                          | `field.key` / localValues by fieldId |

**Shared contract checks:** non-blank id/key/label; quantity only on
integer/decimal with kind/dimension/storageUnit; category source iff
category; relationship iff reference with matching cardinality; `many`
forbids non-null defaults; computed forbids defaults.

**Host divergence:** Model canonicalize **rejects** `cardinality='many'`.
Dataset + Sheet local accept ordered arrays. Model category values store
option **keys**; Dataset/Sheet local store option **ids**.

### A.2 Value-write validators

| Host        | Function                                                         | Migration | Quantity on write       | Vocabulary                             | Category value |
| ----------- | ---------------------------------------------------------------- | --------- | ----------------------- | -------------------------------------- | -------------- |
| Record      | `internal.validate_model_fields` via `guard_model_custom_fields` | `0057`    | **No**                  | **No**                                 | option **key** |
| Dataset     | `internal.dataset_batch_cell_error`                              | `0069`    | Publish-time shape only | Rejected at Schema publish             | option **id**  |
| Sheet local | `internal.sheet_local_cell_error`                                | `0081`    | Shape at define only    | Vocabulary → `invalid_category_option` | option **id**  |

### A.3 Auth

| Concern                 | Mechanism                                                                    |
| ----------------------- | ---------------------------------------------------------------------------- |
| Model field admin       | `api.is_model_field_admin` — owner/admin; DEFINER RPCs                       |
| Definition table grants | `SELECT` only for `authenticated`/`api_client`                               |
| Record create/update    | INVOKER + workspace RLS                                                      |
| Composition read        | DEFINER `query_sheet_instance_rows`; rechecks workspace + deleted + modelKey |

### A.4 Bulk Record-from-Sheet migration hazards

| Hazard                                     | Implication                                                    |
| ------------------------------------------ | -------------------------------------------------------------- |
| No Model `many`                            | Sheet/Dataset `many` cannot map 1:1 into `custom_fields`       |
| Category key vs UUID                       | Explicit option lookup required                                |
| Quantity unused on write                   | Do not claim unit conversion                                   |
| Constant Record bindings ≠ per-row Samples | Row-local create/link is new                                   |
| Whole-Record CAS                           | Bulk should update once per Record                             |
| Identifier sequencer                       | Prefer one locked bulk pass over N× `create_model_record`      |
| No Record bulk idempotency table           | Add analogue of `dataset_bulk_commits`                         |
| DEFINER bulk temptation                    | Must re-check membership/project/workspace like INVOKER create |
| Direct INSERT grants                       | Bypass sequence and validation if used from product code       |
| Human ID uniqueness is per-project         | Search/match must not assume workspace-unique identifiers      |

---

## Verification evidence

Documentation-only change. Migrations through `0090` are applied on this
environment (91 journal rows). No production code, RPC, or permission change.

Commands and decisive results:

```text
pnpm test
  155 files passed; 1,869 tests passed.
  Matches the CORE-03.16 unit/component gate.

pnpm exec vitest run --config vitest.db.config.ts \
  tests/db/scientific-records.test.ts \
  tests/db/model-fields.test.ts \
  tests/db/samples.test.ts
  3 files passed; 36 tests passed.

pnpm exec vitest run --config vitest.db.config.ts \
  tests/db/sheet-composition.test.ts
  1 file passed; 7 tests passed.

pnpm exec prettier --check docs/core/audits/RECORD_SHEET_ACTIONS_AUDIT.md \
  docs/core/NEXT.md docs/core/tasks/CORE-04.md
  formatted.
```

Reproduced against this same PR #29 tip (docs-only working tree; `src/`,
`drizzle/`, and `tests/` identical to `5899fad`):

```text
pnpm exec vitest run --config vitest.db.config.ts \
  tests/db/parameter-resolution.test.ts \
  tests/db/sheet-definitions.test.ts
  3 failed / 17 passed / 20 total.
```

Failures: fixture `rowIdentity` Zod rejection in parameter-resolution; one
malformed-section case returns PostgreSQL `22023` instead of `SB071`; one
parity case hits CORE-03.10 `write-back must target its exact bound source
field`. These are CORE-03 Sheet Definition fixture/validator mismatches, not
Record CRUD regressions and not introduced by this audit. They are **not** a
CORE-04.1 blocker. They were not silently labelled pre-existing: they
reproduce on the agreed `5899fad` code. CORE-04.1 does not fix them.
