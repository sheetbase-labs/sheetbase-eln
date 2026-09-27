# MDL — Models and Records from Models

**Status (2026-09-27):** Proposed; not assigned. MDL-01 follows [DEC-07](DEC.md).

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

**Status:** proposed; after [DEC-07](DEC.md).

### Design

`canvas/SchemasList.dc.html` (Record and Measurement kinds),
`canvas/ModelRecords.dc.html` (Cell bank, prefix CB-).

### Scope

Allow a workspace to define a new record model (name, description, ID prefix,
fields, rules) hosted in a generic record host, alongside the built-in kinds.
Decide in the ADR how this relates to `model_kinds`, RLS, search, lineage and
the public API, and whether Materials (LAB-04) and cell banks are built-in or
workspace-defined.

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

### Exit

Changing the model changes the form and list without code changes; validation
on the form and the server give the same result.
