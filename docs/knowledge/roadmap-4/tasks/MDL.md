# MDL — Models and Records from Models

**Status (2026-09-27):** Proposed; not assigned. MDL-01 follows [DEC-07](DEC.md), accepted 2026-09-27 as [ADR-0051](../../decisions/0051-workspace-defined-record-models.md).

## Programme goal

Let stewards define the kinds of records and measurements their lab uses, with
versions, rules and approval, and give scientists forms and lists generated
from those definitions.

## Baseline at `main` `9538f36`

- `model_kinds` is a fixed, migration-owned list of 14 kinds (experiment,
  sample, reagent, instrument, protocol template, dataset schema, and so on).
- Workspaces add fields to a kind via `record_field_definitions`, options and
  relationship rules; values live in each host's `custom_fields`.
- Dataset schemas have definitions and versions with a `lifecycle`
  (draft/published) and evolution preview (MODEL-01..04, ADR-0038).
- `/configure` is the configuration workspace. There is no approval step before
  publishing a model or schema version.

## MDL-01 — Workspace-defined record models

**Status:** proposed; [DEC-07](DEC.md) accepted 2026-09-27 ([ADR-0051](../../decisions/0051-workspace-defined-record-models.md)): generic record host, versioned schemas, cell banks workspace-defined, materials built-in.

### Design

`canvas/SchemasList.dc.html` (Record and Measurement kinds),
`canvas/ModelRecords.dc.html` (Cell bank, prefix CB-).

### Scope

Allow a workspace to define a new record model (name, description, ID prefix,
fields, rules) hosted in a generic record host, alongside the built-in kinds.
Decide in the ADR how this relates to `model_kinds`, RLS, search, lineage and
the public API, and whether Materials (LAB-04) and cell banks are built-in or
workspace-defined.

### Start here

`api.model_kinds` (14 fixed, migration-owned rows), `api.model_base_fields`,
`api.record_field_definitions`, `api.model_field_options`,
`api.model_relationship_rules` in `src/db/schema.ts`; ADR-0026;
`src/lib/model-fields.ts`, `model-relationships.ts`; `api.create_model_record`;
`tests/db/model-fields.test.ts`, `model-relationships.test.ts`; public API
table schemas in `src/lib/public-api-table-schemas.ts`.

### Steps (PRs)

Follow the design chosen in DEC-07. Typical split:

1. Workspace-owned model kinds (name, description, ID prefix, record kind,
   host) with RLS and `create_workspace_model` RPC (capability
   `schema.edit`); identifier sequence per prefix.
2. Records of a workspace model created through `create_model_record` with
   field validation from its fields; searchable, linkable, in lineage.
3. Public API and SDK exposure (`public-api-table-schemas.ts`, `sdks/`) with
   tests.

### Check it

DB tests: two workspaces cannot see each other's models or records; prefix
uniqueness; `tests/api` coverage for the public API.

### Exit

An accepted ADR, then: a steward can create a "Cell bank" model with prefix
CB-, create records from it, and those records work with links, search,
history and the API like built-in kinds.

## MDL-02 — Model editor

**Status:** proposed.

### Design

`canvas/SchemaEditor.dc.html`, `canvas/ModelFields.dc.html`,
`canvas/ModelVersions.dc.html`.

### Scope

Tabs Fields, Rules, Relations, Versions, Usage; draggable field order; field
inspector (key locked once published, type, unit, precision, required, allowed
range, reason for change); rules with effect (flag and block submission, warn,
block); relations with cardinality; changes since the published version;
impact (records on each version, open experiments, templates) with "new
records only" or "also migrate open experiments"; per-version record of what
happened to existing records.

### Start here

`src/routes/configure.tsx` → `src/components/configuration/configuration-workspace.tsx`
(2,483 lines), `src/components/workspace-admin/admin-model-fields.tsx`
(1,915), `src/lib/model-impact.ts`, `src/lib/schema-evolution.ts`
(`preview_*_evolution`, `apply_*_evolution`), `src/lib/field-definition.ts`,
`field-value-validation.ts`, `tests/db/model-evolution.test.ts`.

### Steps (PRs)

1. Routes `/models` (list with kinds, versions, records counts) and
   `/models/$modelId/{fields,rules,relations,versions,usage,records}`,
   replacing `/configure` screens that the design covers.
2. Rules: `api.model_rules` (applies to field(s), condition, effect
   `flag_block_submit | warn | block`) evaluated in validation and submit
   RPCs; DB tests per effect.
3. Field editor with reason-for-change, impact (from `model-impact.ts`) and
   "new records only / also migrate open experiments"; migration RPC applies
   to open experiments only, audited.
4. Versions tab: per-version "what happened to records".

### Check it

DB tests for rules and migration; parity for `SchemasList`, `SchemaEditor`,
`ModelFields`, `ModelVersions`.

### Exit

Editing a published model always creates a draft version; existing values are
never rewritten; migration of open experiments is explicit and audited.

## MDL-03 — Approval of model versions

**Status:** proposed; may interact with GXP-01.

### Design

`canvas/SchemaPending.dc.html`, `canvas/PromoteRejected.dc.html`.

### Scope

Submitting a draft version for approval by named roles (model owner, QA);
locked while pending; withdraw; approve or return with a reason; the published
version stays current until approval; work items for approvers (WORK-01).

### Start here

Version lifecycles (`lifecycle` draft/published on dataset schema versions),
publish RPCs (`api.publish_dataset_schema_version` and siblings),
`src/lib/capability.ts` (`schema.publish`), `tests/db/configuration-roles.test.ts`.

### Steps (PRs)

1. `api.approval_requests` (object kind, version id, required approver roles,
   state `pending | approved | returned | withdrawn`, reasons) reusable by
   models, parsers (DSET-06), protocols (LAB-07) and promotions (SHEET-02).
2. Publish RPCs refuse without a completed approval request; submit,
   withdraw, approve, return RPCs; work items for approvers (WORK-01).
3. Pending state UI (`SchemaPending`).

### Check it

DB tests: cannot publish without approval; approver cannot approve own
submission when the rule requires independence.

### Exit

A version cannot be published without the required approvals (server-enforced);
the approval trail is part of the model's history.

## MDL-04 — Model lists, generated forms and record pages

**Status:** proposed; depends on MDL-01.

### Design

`canvas/ModelRecords.dc.html`, `canvas/RecordNew.dc.html`,
`canvas/RecordDetail.dc.html`, `canvas/RecordPhone.dc.html`.

### Scope

Records list whose columns are the model's fields; "new record" form generated
from the model (types, units, choices, record links, rules shown inline, ID
preview); record page grouped by field sections with a banner when a later
model version added a field; used-by and history; integrations writing results
as history entries.

### Start here

`src/components/scientific/model-field-input.tsx`, `model-properties.tsx`,
`property-list.tsx`, `record-picker.tsx`; `src/lib/field-presentation.ts`.

### Steps (PRs)

1. Records list per model with columns from fields (TanStack Table), search,
   filter, export CSV.
2. Generated form from field definitions (types, units, choices, record
   links, rules inline, ID preview); the same validation module runs on the
   client and in the RPC.
3. Record page with sections, "field added in version n" banner, used-by,
   history, integration results as history entries.

### Check it

Unit test: form and server validation give identical errors for the same
input; parity for `ModelRecords`, `RecordNew`, `RecordDetail`, `RecordPhone`.

### Exit

Changing the model changes the form and list without code changes; validation
on the form and the server give the same result.
