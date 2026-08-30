# Sheet composition persistence audit

**CORE-03.1 — completed 2026-08-14**

## Conclusion

There is no current Sheet Definition or Sheet Instance primitive. The object
called a scientific Sheet is a record-owned persistence cluster:

```text
api.records (Notebook/lifecycle/concurrency owner)
  └─ api.blocks[type=sheet, payload={tableId}]
       └─ api.scientific_tables (catalog/schema-version owner)
            ├─ api.scientific_columns / scientific_category_options
            ├─ api.sheet_<generated> (UUID rows and typed physical cells)
            └─ api.formula_definitions / formula_dependencies
                 └─ internal.formula_result_cache (derived only)
```

`api.scientific_tables.block_id` is unique and `record_id` is required. Thus a
scientific table cannot currently exist independently of one owning Notebook
block and Record. A block is only an embedding locator; its JSON payload does
not own table schema, rows, values, formulas or calculation results.

The current implementation nevertheless supplies strong compatibility assets:
stable table/row/column/formula/category UUIDs, row and schema optimistic
versions, deterministic formula bindings below A1 display, PostgreSQL type and
constraint enforcement, RLS, atomic row writes, revision-bound result-cache
semantics and complete submitted-revision snapshots assembled by the current
wrapper chain. CORE-03.2/03.3 can add Definition and Instance identities
without redesigning those contracts.

The important discontinuities are equally concrete:

- generated sheet relations remain record/block-owned legacy storage, not
  canonical independent Datasets;
- all current columns and rows belong to that one table cluster; there is no
  distinction between reusable configuration, bound source data and
  Instance-local data;
- column widths/order are browser `localStorage`, not shared durable state;
- Template instantiation copies Sheet block JSON without instantiating Sheet
  storage, so a copied `{tableId}` still names the original table cluster;
- the Sheet's `Explore dataset` link passes a legacy scientific-table UUID to
  a Dataset Explorer that now lists only canonical `api.datasets`; and
- `api.query_dataset_rows` is a bounded complete active-field window. It is
  not a public projection, composition, join or aggregate API. Cardinality
  `many` values are arrays reconstructed in persisted `ordinal` order, not
  repeated scalar columns.

This audit meets the CORE-03.1 exit gate: the authoritative owners, retained
identities, compatibility termination points and implementation questions for
CORE-03.2/03.3 are identified below.

## Sources and current ownership

Submitted evidence has cumulative migration ownership. Migration
`0037_rev_002_submitted_revisions.sql` introduced the base
`internal.build_revision_envelope`; `0057_model_fields_foundation.sql` renamed
that body to `build_revision_envelope_without_model_fields` and wrapped it with
canonical Record `customFields` plus the active/retired Model FieldDefinition
and option manifest; `0059_report_identity.sql` then renamed that wrapper to
`build_revision_envelope_without_report_structure` and installed the current
`build_revision_envelope`, which also adds `reportStructure` for Report Records.
The current owner is therefore the complete `0037 → 0057 → 0059` wrapper chain,
not the 0037 body alone.

### PostgreSQL catalog, schema, rows and cells

| Concern                   | Current authority                                                                                                                                                                                            | Exact implementation contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sheet catalog             | `api.scientific_tables`                                                                                                                                                                                      | Drizzle `scientificTables` in `src/db/schema.ts`; created in `drizzle/0013_data_002_scientific_tables.sql`, with active wrappers/record locks in `0014_data_003_scientific_rest.sql` and `0016_sheet_003_table_display.sql`. UUID `id`, `workspace_id`, required `record_id`, unique required `block_id`, generated immutable `resource_name`, display `name`/`description`/`display_settings`, `lifecycle`, integer `schema_version`, optional legacy Dataset-Schema binding and actor timestamps. |
| Columns                   | `api.scientific_columns`                                                                                                                                                                                     | Drizzle `scientificColumns`; UUID `id` is the durable cell-field identity. `field_name` is a generated physical locator; `label` and `display_order` are mutable presentation. Logical type/null/default/unit/validation/width/lifecycle and optional `dataset_schema_field_id` are persisted.                                                                                                                                                                                                      |
| Categories                | `api.scientific_category_options`                                                                                                                                                                            | Drizzle `scientificCategoryOptions`; option UUID is the stored cell value, with label/order/lifecycle metadata. Exact-column membership is trigger-validated.                                                                                                                                                                                                                                                                                                                                       |
| Physical rows/cells       | generated `api.sheet_<base32>` relation named by `scientific_tables.resource_name`                                                                                                                           | Built by `internal.create_scientific_table_impl`. No static Drizzle row type exists because columns are dynamic. Every row has stable UUID `id`, `workspace_id`, bigint `version`, timestamps/actor IDs and `formula_column_ids`; typed physical columns use `scientific_columns.field_name`. Values are PostgreSQL columns, not Handsontable state.                                                                                                                                                |
| Schema reads              | `api.scientific_table_metadata(uuid)`                                                                                                                                                                        | Active definition in `drizzle/0035_sci_010_dataset_schema_registry.sql`; RLS/security-invoker projection of active table, ordered active columns/options and optional Dataset-Schema metadata. Browser type is `ScientificTableWire`/`ScientificColumnWire` in `src/lib/scientific-sheet-data.ts`.                                                                                                                                                                                                  |
| Schema mutation           | `api.update_scientific_table_display`, `api.add_scientific_column`, `api.update_scientific_column_display`, `api.convert_scientific_column`, `api.retire_scientific_column`, `api.upgrade_scientific_schema` | PostgreSQL locks the catalog/owning Record, checks expected `schema_version`, validates evidence for destructive changes, performs DDL, increments schema version and emits events. `src/lib/scientific-sheet-data.ts` is the typed browser adapter.                                                                                                                                                                                                                                                |
| Row reads                 | direct generated resource through `/api/db/<resource_name>`                                                                                                                                                  | `fetchScientificRows` pages 200; `fetchAllScientificRows` requests up to 10,001 ordered by `created_at,id` for workbook/grid reconstruction. RLS remains authoritative.                                                                                                                                                                                                                                                                                                                             |
| Row writes                | `api.apply_scientific_row_changes`                                                                                                                                                                           | Current RPC in `drizzle/0015_sheet_002_insert.sql`; stable row UUID + expected row version and stable column UUID + expected table schema version. It validates edits before inserts and returns canonical physical rows. `ScientificEdit`/`ScientificEditResult` and `applyScientificRowChanges` are in `src/lib/scientific-sheet-data.ts`.                                                                                                                                                        |
| Record freeze/write guard | `internal.assert_scientific_record_writable` and generated-row triggers                                                                                                                                      | Archived/deleted or signed/locked owning Records reject row/schema/formula writes. `internal.scientific_row_before` owns row-version increments, reserved metadata, category integrity, formula-cell exclusion and calculation-input revision changes.                                                                                                                                                                                                                                              |
| Audit history             | `api.change_events`                                                                                                                                                                                          | Table/schema/row/formula/calculation mutations emit attributed events. Events describe changes; they are not Sheet versions or Dataset Versions.                                                                                                                                                                                                                                                                                                                                                    |

`dataset_schema_id`, `dataset_schema_revision` and
`scientific_columns.dataset_schema_field_id` are the SCI-010 compatibility
binding to the pre-Core Dataset Schema registry. A null field binding denotes a
table-local column. These IDs must not be confused with the canonical CORE-02
`dataset_schema_definitions`, `dataset_schema_versions`,
`dataset_schema_version_fields`, `datasets`, `dataset_rows` and
`dataset_row_values` identities in `src/db/schema.ts` and migrations
`0062`–`0070`.

### Atomic Sheet creation and Notebook embedding

The active `api.insert_sheet_block(record, afterBlock, expectedStructureVersion,
datasetSchemaId?)` in `drizzle/0035_sci_010_dataset_schema_registry.sql` is the
only Sheet-specific Notebook insertion contract:

1. `api.insert_block` creates an ordered `api.blocks` row of type `sheet` and
   checks the Record's expected `structure_version`.
2. With no schema ID, `api.create_scientific_table` creates an empty table;
   with a published legacy Dataset Schema ID,
   `api.instantiate_dataset_schema` creates bound columns.
3. The block payload is replaced with `{ "tableId": <scientific table UUID> }`.
4. The RPC returns canonical `block`, `table`, `columns`, `resourceName` and
   the once-incremented `structure_version`; every step rolls back together.

`insertSheetBlock` in `src/lib/notebook-mutations.ts` maps this result to
`NotebookBlock` plus `tableId`/`structureVersion`. The experiment route
`src/routes/projects/$projectId/experiments/$recordId.tsx` reads the latest
Record query-cache version before insertion, installs the returned block and
version on success, and invalidates canonical block/Record queries on
`stale_version`.

Notebook persistence itself is `api.records` plus ordered `api.blocks`, not a
separate notebook table. Drizzle `records` owns `structureVersion`,
`metadataVersion`, `calculationInputRevision`, lifecycle and lock state;
Drizzle `blocks` owns block UUID, Record UUID, type, JSON payload,
`payloadSchemaVersion`, fractional order and content `version`. The wire/domain
types are `RecordWire`/`NotebookRecord` and `BlockWire`/`NotebookBlock` in
`src/lib/notebook-data.ts`.

`NotebookDocument` in `src/components/notebook/notebook-document.tsx` dispatches
a Sheet block directly to `ScientificSheetBlock`; it deliberately omits generic
duplicate/delete menu actions. `duplicateBlock` in
`src/lib/notebook-mutations.ts` also rejects Sheet duplication because copying
the payload would not copy its table. In overview/read-only contexts,
`SheetBlockPreview` in `src/components/notebook/block-preview.tsx` resolves the
same `tableId` and renders metadata plus the first physical row page as HTML;
it does not evaluate formulas or create a second data owner.

### Handsontable projection and local interaction state

`ScientificSheetBlock` in
`src/components/sheet/scientific-sheet-block.tsx` owns the current browser
projection:

- TanStack Query caches table metadata, complete rows, formulas, dependencies
  and result statuses under `scientificQueryKeys`;
- `gridData` detaches canonical rows, maps category UUIDs to labels and overlays
  persisted formula expressions/results for Handsontable;
- Handsontable's internal data source gives immediate editor/formula behavior;
- React `drafts`, `issues`, provisional `prov:<uuid>` rows, selection,
  formula-bar text and `SaveStatus` are transient interaction state;
- `localRows` overlays drafts for callbacks/footer but is intentionally not
  passed back as authoritative grid data;
- a dedicated HyperFormula engine backs Handsontable's formulas plugin for
  same-sheet interaction, while the Notebook workbook handles stable
  cross-sheet reconstruction; and
- column widths and visual order are written by stable column UUID to browser
  `localStorage` keys `sheetbase:column-widths:<tableId>` and
  `sheetbase:column-order:<tableId>`. They are per-browser cache, omit
  workspace/user identity and are not durable collaborative presentation
  state. Table `display_settings` exists but this component does not use it.

Handsontable row numbers, visual column indexes, A1 references, labels,
formula-bar text and local-storage preferences are never authoritative
identity.

### Save, autosave and optimistic concurrency

`GridOperationCoordinator` in `src/lib/grid-operation-coordinator.ts` is the
save coordinator. It coalesces the latest cell draft for about 300 ms, groups
literal cells by stable row, sends one `apply_scientific_row_changes` batch,
then serially persists formula writes against each updated row version. Empty
or edited provisional rows are inserted first; the returned database UUID
replaces the provisional token before a formula can target it.

The database, not the coordinator, commits truth. Successful canonical rows
replace query-cache rows and clear only matching draft generations. A
`stale_version` conflict is not retried: rows are refetched, entered drafts
remain visible and the affected row is identified. 400/401/403 errors are not
retried. Transient failures retry with bounded backoff, then refetch and expose
`error`; unload warns while writes remain pending. Save labels
`idle/saving/retrying/error/saved` are UI state only.

Formula-bar commits use the same expected table/row/formula versions but call
`mutateScientificFormula` directly for persisted rows. Optimistic formula
entries are placeholders in the TanStack cache until server refetch; they are
not valid persisted artifacts.

### Formula definition, dependencies, cache and reconstruction

| Concern                   | Persisted owner and contract                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Definition identity       | `api.formula_definitions.id`; one definition per stable `(target_table_id,target_row_id,target_column_id)`. It stores source expression, normalized template/bindings/engine expression, fixed syntax/function/literal/engine profiles, supported status and independent bigint `version`. Drizzle type: `formulaDefinitions`.                               |
| Semantic dependencies     | `api.formula_dependencies` primary key `(formula_id,source_table_id,source_row_id,source_column_id)`. Dependencies survive labels/display order because they use UUIDs. Drizzle type: `formulaDependencies`.                                                                                                                                                 |
| Formula-owned cell marker | generated row `formula_column_ids`; the target physical literal is null and ordinary row writes cannot mutate a formula-owned cell.                                                                                                                                                                                                                          |
| Input version             | `api.records.calculation_input_revision`; row/schema/formula input changes advance it.                                                                                                                                                                                                                                                                       |
| Derived cache             | `internal.formula_result_cache`, Drizzle `formulaResultCache`; pinned to formula version, input revision, table schema-version map, engine/profile/runtime fingerprints. `api.formula_results` projects `pending/current/stale/failed/unavailable`, suppresses stale scalar values and states `value_is_authoritative=false`.                                |
| Trusted writes            | Browser POST `/api/formulas` (`src/routes/api/formulas.ts`) delegates to `src/lib/formula-write.server.ts`, which parses/normalizes and invokes `internal.apply_trusted_formula_write` through the narrow formula role. Trusted recalculation POST `/api/calculations` reconstructs current inputs and commits through `internal.apply_trusted_calculation`. |

The migrations owning the current formula contract are
`0017_calc_002_formula_persistence.sql`,
`0018_calc_003_cross_sheet_dependencies.sql`,
`0019_calc_004_trusted_result_cache.sql`,
`0055_calc_005_function_profile_v2.sql` and
`0056_calc_006_drop_stale_v1_profile_constraint.sql`.

`ScientificTableWire`, `ScientificRowWire`, `FormulaDefinitionWire`,
`FormulaDependencyWire`, `FormulaResultWire` and `FormulaMutationInput` in
`src/lib/scientific-sheet-data.ts` are the browser boundary.
`PersistedFormulaArtifact`/formula IR is validated in `src/lib/formula-ir.ts`.
`WorkbookTable`, `WorkbookRow`, `WorkbookColumn`, `WorkbookCellAddress` and
`ScientificWorkbook` in `src/lib/scientific-workbook.ts` reconstruct a
disposable HyperFormula workbook after sorting rows/columns by `(createdAt,id)`.
Stable IDs map to engine coordinates at runtime; A1 is emitted presentation,
not persisted dependency meaning.

`ScientificWorkbookProvider` in
`src/components/notebook/scientific-workbook-provider.tsx` registers each
rendered Sheet by Notebook block ID, waits one browser turn for registrations,
builds one Notebook-wide workbook and destroys replaced engines. Workbook
registration/render order and engine sheets are caches. Persisted formula
definitions/dependencies plus canonical literals are the reload authority.

Cross-sheet dependencies are restricted to active scientific tables in the
same Record. Current formula scope is therefore Record/workbook-local; it is
not yet Definition, Instance or canonical Dataset-derived calculation scope.

### Revision and provenance boundaries

The exact current boundaries are:

| Boundary                | Identity/version/provenance carried                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record/Notebook         | Record UUID plus human identifier; `structure_version` for block topology, `metadata_version` for metadata, `calculation_input_revision` for calculation inputs, lifecycle/lock and actor timestamps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Block embedding         | Block UUID/version/order and payload schema version; Sheet payload preserves the scientific table UUID. Block identity is not Sheet identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Scientific table/schema | Table UUID, immutable physical `resource_name`, integer `schema_version`, optional legacy Dataset-Schema row UUID/revision and owning Record/block UUIDs. Schema version is an optimistic counter, not an immutable Sheet Definition version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Rows/cells              | Stable row UUID/version and stable column UUID; generated field name is physical location. A cell has no separate UUID: its durable address is table/row/column.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Formulas                | Formula UUID/version, stable target/dependency addresses, actor timestamps and deterministic profile metadata. Result cache adds input/schema/profile/runtime provenance but is non-authoritative.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit                   | `change_events` sequence/entity/operation/actor/payload. It is history, not an immutable version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Submitted evidence      | Current `internal.build_revision_envelope` is the `0037_rev_002_submitted_revisions.sql` base wrapped by `0057_model_fields_foundation.sql` and then `0059_report_identity.sql`. The base snapshots Record properties, ordered blocks, links, complete owned scientific-table metadata/columns/options/rows, formulas/dependencies/current cache and files; 0057 adds canonical Record `customFields` and the active/retired Model FieldDefinition/option manifest; 0059 adds Report definition/sections/latest-generation `reportStructure` for Report Records. The resulting `api.revisions.canonical_snapshot` is protected by SHA-256 integrity and immutability and is the strongest existing data-preserving boundary. |

Because submitted revision collection selects scientific tables by
`scientific_tables.record_id`, a copied block that merely references another
Record's `tableId` does not make that table part of the copied Record's frozen
scientific-table evidence.

### Template identity, lifecycle, version and instantiation

Templates have no separate table. `api.records.kind` is
`notebook_template`/`protocol_template`; UUID is durable identity, `NBK-…` or
`PRT-…` is the human identifier, status is lifecycle and Record
structure/metadata counters are optimistic versions. Workspace-level templates
use nullable `project_id` and a workspace-scoped identifier index from
`drizzle/0034_workspace_scoped_templates.sql`.

`src/lib/templates.ts` owns `TemplateKind`, status vocabularies,
`TemplateRecord`, `TemplateLink`, fetch/lifecycle/instantiate/duplicate/export
adapters and local favourite state. `src/routes/templates.tsx` and
`src/components/templates/template-library.tsx` own Template Library
selection/actions. PostgreSQL remains authoritative.

The current `api.instantiate_template` in
`drizzle/0029_sci_006_templates.sql`:

1. requires an unarchived `validated` Notebook Template or `active` Protocol
   Template and a permitted same-workspace target;
2. creates an immutable `api.revisions` snapshot of the source's current
   metadata and blocks with reason `validate`;
3. creates a draft target Record;
4. inserts new block UUIDs with copied payload JSON (skipping
   `protocol_reference`; adapting `procedure_step` execution fields); and
5. records provenance in `api.record_links.link_type='template'` with
   `link_metadata.template_revision_id`.

The source snapshot is created at instantiation time; validation status does
not identify one reusable immutable published Template version. Ordinary block
payloads become independent JSON copies, but embedded object IDs remain
references. There is no Sheet-specific branch. Consequently a source Sheet
block's `{tableId}` is copied unchanged, while `scientific_tables.block_id` and
`record_id` still identify the source block/Record. Existing tests prove deep
copy only with rich-text/checklist/procedure blocks; no DB or API test proves
correct Sheet instantiation. `duplicateTemplate` similarly uses
`create_record_with_blocks` with copied payloads and therefore has the same
Sheet-reference seam.

### Dataset Explorer handoff

`ScientificSheetBlock` renders `Explore dataset` as
`/datasets?dataset=<scientificTableId>`. The link contract is asserted in
`src/components/sheet/scientific-sheet-block.test.tsx`.

The current Explorer does not consume that legacy table catalog. In
`src/lib/dataset-explorer-data.ts`:

- `fetchDatasetSummaries` reads canonical `api.datasets` and attaches active
  fields from `api.dataset_schema_version_fields`;
- `fetchDatasetRowPage` calls only `api.query_dataset_rows(datasetId, query,
limit, offset)` and maps canonical row UUID/revision/field-UUID values to the
  grid wire shape;
- the RPC's `totalCount` is authoritative for the filter/window;
- the query supports bounded filters and one stable-field sort, but no public
  projection, composition, join or aggregate contract; and
- canonical Dataset `many` values remain ordinal-ordered arrays.

`src/routes/datasets.tsx` selects the requested UUID only if it exists in the
canonical summaries; otherwise it falls back to the first Dataset and replaces
the URL. Thus the Sheet handoff currently has no identifier adapter from a
legacy scientific table to a canonical Dataset. Older `query_dataset` and
generated-resource code/tests are compatibility evidence only and must not be
presented as the CORE-02 canonical or future composition API.

## Representative contracts reproduced

### Create

`tests/db/sheet-block.test.ts` proves that
`insert_sheet_block(record,NULL,1)` returns structure version 2, one block
payload containing the new table UUID, matching block/table Record ownership
and an existing generated relation. Stale version `SB001`, cross-workspace/API
client `42501` and forced table-creation failure leave block/table/event counts
and Record structure version unchanged.

### Edit and autosave

The same DB suite adds a constrained integer column, edits an existing row at
expected version 1 and inserts a row in one RPC. Returned row versions are 2
and 1. An out-of-range insert rolls back the valid edit; a stale row version
raises `SB001` and preserves both row value/version and count.

`src/lib/grid-operation-coordinator.test.ts` and
`src/components/sheet/scientific-sheet-block.test.tsx` reproduce 300 ms
coalescing, one literal batch, ordered formula writes, provisional UUID
replacement, local validation, stale-draft preservation/refetch, bounded retry,
mixed literal/formula saves, formula-preserving clipboard/autofill and explicit
save state.

### Formula evaluation, persistence and reload

`tests/db/formula-persistence.test.ts` proves exact nested dependency
derivation, stable target ownership, formula/row version increments, result
`pending` before trusted calculation, `current` value after matching revision,
`stale` with no projected value after an input change, protected source
rows/columns and update/remove concurrency.

`src/lib/scientific-workbook.test.ts` proves deterministic reconstruction,
literal/formula distinction, arithmetic/errors/cycles, stable bindings across
reorder and display rename, unsupported-formula durability, malformed-artifact
rejection and local recalculation. The Sheet component test reconstructs a
persisted `=A1*2`, installs its normalized engine expression and still shows
the source expression in the formula bar.

### Notebook rendering

`src/components/notebook/scientific-workbook-provider.test.tsx` proves one
workbook engine sheet for every registered Notebook Sheet block.
`src/components/sheet/scientific-sheet-block.test.tsx` proves loading/error/
invalid payload/read-only and full editor states. `SheetBlockPreview` uses the
same table UUID and server reads but intentionally renders a lightweight
read-only first page without Handsontable/HyperFormula.

### Template instantiation

`tests/db/templates.test.ts` proves NBK/PRT identity, lifecycle, optimistic
metadata versioning, new block UUIDs for supported ordinary blocks, immutable
source revision, provenance link, independence from later template JSON edits,
archive/status/cross-workspace rejection and procedure-step adaptation. It does
not prove Sheet storage copy/instantiation; inspection of the RPC proves only
payload copying for Sheet blocks.

## Definition versus Instance responsibility map

| Current state                                         | Future Definition responsibility                                                                                                         | Future Instance responsibility                                                                                           | Dataset/Notebook responsibility                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `scientific_columns` schema metadata/order            | Reusable column declarations, typed parameters/binding specs, calculations and presentation defaults when explicitly extracted/published | Durable local field definitions and overrides; resolved source-column projection                                         | Canonical Dataset Schema/version remains governed independently.                  |
| generated rows and physical cells                     | **Never** experiment values                                                                                                              | Existing legacy row values must become or remain Instance-owned local data unless explicitly bound/migrated to a Dataset | Bound canonical Dataset values remain Dataset-owned and use controlled writes.    |
| `dataset_schema_id/revision` and per-column field IDs | Binding requirement may point to canonical semantic/schema-version contracts, not this physical table                                    | Resolved binding records the exact Dataset/schema version/live policy                                                    | Dataset identity/version is independent and reusable.                             |
| formula definitions/dependencies                      | Only calculations explicitly promoted/extracted as reusable definitions                                                                  | Existing formulas default to Instance-local definitions/overrides with preserved formula UUID/provenance mapping         | Dataset-derived fields remain separately governed; cached results remain derived. |
| table name/column label/order/width                   | Optional defaults                                                                                                                        | Mutable current presentation and overrides                                                                               | Notebook only embeds/references the Instance.                                     |
| block UUID and `{tableId}`                            | No Definition identity                                                                                                                   | Block must reference an Instance UUID; it must not equal that UUID                                                       | Notebook owns block order/content/version, not Sheet data.                        |
| Record lifecycle/lock/revision snapshot               | Definition publish/retire has separate lifecycle                                                                                         | Instance archive/share/snapshot has separate lifecycle                                                                   | Notebook submission pins/snapshots referenced Instance evidence.                  |
| Template Record/revision/link                         | Template version pins a Sheet Definition version plus instantiation policy                                                               | Normal instantiation creates a new independent Instance; explicit shared/snapshot policies remain explicit               | Template remains reusable composition/instructions, not local-value owner.        |
| localStorage widths/order                             | Definition may provide defaults                                                                                                          | Durable collaborative presentation overrides                                                                             | Browser cache may accelerate rendering only.                                      |

## Keep, adapt and deprecate

| Direction                       | Exact contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep**                        | PostgreSQL/RLS authority; `/api/db` and trusted formula server boundaries; scientific table/row/column/category/formula UUIDs; row/schema/formula optimistic versions; typed DB constraints; stable formula dependency addresses and profiles; atomic deterministic row changes; attributed events; complete revision snapshots; current Handsontable interaction, formula bar, clipboard/autofill, provisional rows, save/conflict states and lightweight Notebook preview.                                                                                                                                                                                                                                                     |
| **Adapt**                       | Treat each legacy scientific cluster as compatibility input to an ad hoc Instance; map schema-bound columns to explicit resolved canonical bindings only when identity compatibility is proven; map unbound columns/rows to Instance-local fields/values; give Notebook blocks an Instance reference; reconstruct current formula IDs/dependencies through Instance/source semantic addresses; persist presentation as Definition defaults plus Instance state; make Template blocks pin Definition versions and instantiate independent Instances; route Dataset writes through CORE-02 bulk/revision/idempotency contracts; extend submitted evidence to pin/snapshot the new primitives while preserving the legacy envelope. |
| **Deprecate for new contracts** | Required one-block/one-record ownership as Sheet identity; `resource_name`, `field_name`, labels, visual indexes or A1 as public semantic identity; generated relation reads/writes as the new Sheet composition API; `scientific_tables.schema_version` as a Definition version; localStorage as collaborative presentation truth; unchanged `{tableId}` copying during Template instantiation; the legacy-table UUID Explorer handoff; `query_dataset`, benchmark SQL or `query_dataset_rows` as a composition/join/aggregate API; result caches or Handsontable state as authority.                                                                                                                                           |

## Data-preserving compatibility path

This is a boundary map, not a migration design.

1. **Inventory before cutover.** Resolve every `api.blocks[type=sheet]`
   `payload.tableId`, every `api.scientific_tables` owner/binding, active and
   retired column/option, generated relation row, formula target/dependency,
   result-cache row, template/revision block snapshot, canonical Record
   `custom_fields`, applicable active/retired Model FieldDefinitions/options,
   applicable Report definition/sections/latest generation structure and
   submitted canonical snapshot. Detect copied blocks whose `tableId` does not
   match the catalog's `block_id`/`record_id`; do not assume they are independent
   or intentionally shared.
2. **Preserve exact legacy identifiers.** The compatibility mapping must retain
   scientific table UUID and `resource_name`; owning Record/block UUID; schema
   version and legacy Dataset-Schema UUID/revision; column UUID, physical
   `field_name`, optional schema-field UUID and lifecycle; category-option
   UUID; row UUID/version/order timestamps and actor metadata; formula UUID,
   version, target/dependency table-row-column UUIDs, artifact/profiles/status;
   Record calculation revision; cache revision/schema/profile provenance; and
   revision/template-link UUIDs and integrity snapshots. Frozen envelopes also
   retain canonical Record `custom_fields`, Model FieldDefinition and option
   UUIDs/lifecycle/semantics, and applicable Report definition, section and
   latest-generation identities/structure exactly as captured.
3. **Adopt without reinterpretation.** An unbound legacy column cannot be
   inferred as a governed Dataset field from label or position. Its existing
   rows remain Instance-local scientific values. A legacy schema binding is
   evidence for compatibility resolution, not permission to merge/copy it into
   a canonical Dataset silently. Existing row UUIDs remain row identity unless
   an explicit, validated source/composite identity mapping is recorded.
4. **Preserve formula meaning.** Keep existing formula source and artifact
   intact while mapping each stable legacy address to its new Instance/source
   address. Never persist A1 as the semantic dependency. Keep unsupported and
   error states; do not convert a current cached scalar into authority.
5. **Preserve embedding and evidence.** Existing live blocks continue to
   resolve during transition. Existing `api.revisions.canonical_snapshot`
   envelopes remain immutable and renderable without depending on mutable new
   state, including their canonical Record `customFields`, Model
   FieldDefinition/option manifest and Report structure where applicable, as
   well as the base Record/block/scientific-table/formula/file evidence. New
   snapshots must include Definition version, Instance state/local values and
   Dataset Versions where required, rather than weakening the current complete
   wrapped envelope.
6. **Handle Template Sheet references explicitly.** Existing copied
   `{tableId}` references must first be classified as original owner,
   accidental alias or deliberate shared-live intent; identity must not be
   guessed. New normal Template instantiation follows ADR 0020 and creates an
   independent Instance from a pinned Definition version. Existing scientific
   values must never be copied into a Definition.
7. **Terminate compatibility at the new semantic APIs.** Generated relations
   and legacy IDs may remain behind a read/write adapter until every live block,
   formula, Template dependency and frozen reference resolves. New Definition,
   Instance, composition, Template and Explorer APIs expose their own UUIDs and
   canonical Dataset field/row identities only. No new consumer may depend on
   `resource_name`, `field_name` or legacy block ownership. Remove an adapter
   only after live reload/write/formula/Notebook/Template/evidence parity and
   dependency checks prove zero unresolved legacy references.

Composition remains virtual throughout. Compatibility does not create a
Dataset unless the user invokes an explicit future materialisation operation.

## Settled forks versus implementation questions

### Already settled by ADRs 0020–0026

Do not reopen these during CORE-03.2/03.3:

- Definition and Instance are separate; reuse does not share local values.
- Datasets are independently addressable and are not owned/copied by Sheets or
  Templates.
- Definitions/Templates do not inherit; versions are pinned and upgrades are
  explicit/data-preserving.
- local/ad hoc values are durable and Instance-owned, not browser-only.
- normal Template instantiation creates an independent Instance; shared live or
  pinned snapshot behavior is explicit.
- workspace is lifecycle ownership; archive/retire preserve dependants and hard
  deletion is exceptional/dependency-aware.
- one typed Parameter language and semantic compatibility replace label-based
  binding.
- presentation state is lightweight; calculations have explicit scope; virtual
  composition does not materialise automatically.
- stable UUID/Record IDs are distinct from names/labels; relationships use
  UUIDs; quantity/category compatibility uses semantic identities.

### Genuine questions CORE-03.2/03.3 must settle

1. **Physical identity/version layout:** what additive Definition identity,
   immutable Definition-version and Instance tables represent the accepted
   model while preserving workspace RLS and dependency checks? This is the ADR
   trigger already named by CORE-03.2 only if implementation presents more
   than one materially durable physical layout.
2. **Legacy adoption key:** does a legacy `scientific_tables.id` become an
   external alias to a newly minted Instance UUID, or is it adopted one-to-one
   as the initial Instance UUID where constraints permit? Either must preserve
   all mappings and frozen evidence; labels/block IDs cannot decide it.
3. **Legacy source classification:** for schema-bound legacy columns, which
   exact compatibility proof maps current rows to canonical Dataset rows, and
   which remain Instance-local? CORE-03.3 must not claim a canonical Dataset
   binding merely because `dataset_schema_id` exists.
4. **Copied Template Sheet aliases:** how are already-instantiated blocks with
   a foreign owner/table pair represented during compatibility—explicit shared
   legacy Instance, independent reconstructed Instance, or unresolved state
   requiring user/admin choice? ADR 0020 settles new default behavior but not
   the factual intent of existing aliases.
5. **Formula identity mapping:** what durable mapping lets existing formula and
   table/row/column UUIDs resolve after Instance adoption and later canonical
   bindings, including current same-Record cross-sheet dependencies? Existing
   formulas should default to Instance-local scope unless explicit provenance
   proves a governed reusable scope.
6. **Notebook/evidence reference shape:** what block payload/version transition
   references an Instance UUID without equating block and Instance identity,
   and how does new submitted evidence coexist with immutable legacy revision
   envelopes?
7. **Presentation import:** whether and how to offer a one-time import of
   existing table-width metadata and browser-local stable-ID preferences into
   Instance presentation state. Absence/corruption must remain non-semantic.
8. **Explorer handoff:** what explicit compatibility lookup resolves a legacy
   scientific-table UUID to an adopted Instance and/or canonical Dataset, and
   what honest state is shown when no canonical Dataset exists? Falling back to
   the first Dataset is not a valid provenance-preserving handoff.

No new ADR is warranted by the audit alone. The evidence confirms the accepted
architecture and identifies implementation mappings; it does not reveal a new
durable product fork beyond CORE-03.2's already-declared physical-persistence
trigger.

## Verification evidence

Environment setup used the checked-in `.agents/setup`: PostgreSQL 18.6,
PostgREST 14.5, all migrations through `0070` and the 29-step idempotent demo
seed.

Commands and decisive results:

```text
pnpm test -- <focused Sheet/data/workbook/Template/Explorer files>
  Vitest executed the full configured unit/component set:
  142 files passed; 1,718 tests passed.

pnpm test:db tests/db/scientific-tables.test.ts \
  tests/db/sheet-block.test.ts tests/db/formula-persistence.test.ts \
  tests/db/templates.test.ts
  4 files passed; 32 tests passed.

pnpm test:api tests/api/scientific-rest.test.ts
  1 file passed; 6 tests passed.

pnpm check
  All matched files use Prettier code style.

pnpm lint
  0 errors; 19 pre-existing warnings.

pnpm typecheck
  TypeScript no-emit check passed.

pnpm build
  Client and SSR production builds passed (5,230 and 927 modules).
```

The focused API attempt is recorded rather than misreported as evidence:

```text
pnpm test:api tests/api/templates.test.ts tests/api/dataset-explorer.test.ts \
  tests/api/formula-column-order.test.ts tests/api/scientific-rest.test.ts
  17 tests passed; 1 failed; 6 skipped; 3 files failed.
```

The combined command exposed fixture/isolation debt outside this
documentation-only task: API files mutate one shared database concurrently;
`dataset-explorer.test.ts` exercises the superseded legacy scientific-table
Explorer path and sends a minted PostgREST JWT as an external bearer token,
which the current proxy rejects with 401 before its six tests; Template
assertions pass but cleanup attempts to delete immutable submitted-revision
evidence; and `formula-column-order.test.ts` assumes a fixed generated relation
absent from a fresh seed. An isolated rerun confirms
`scientific-rest.test.ts` passes 6/6. An isolated Template rerun cannot enter
its tests because the cleanup helper attempts to delete immutable submitted
revision evidence. The DB and unit/component contracts cited by this audit are
green; no API behavior is claimed from the blocked suites. These fixture and
legacy-API issues are existing test debt, not evidence of a Sheet persistence
contract failure or a blocker to the CORE-03.1 ownership map.
