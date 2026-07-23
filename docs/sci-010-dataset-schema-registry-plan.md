# SCI-010 — Dataset schema registry — implementation plan

> **Status:** implemented. ADR 0034 is accepted (2026-07-23). This plan
> refines ADR 0034 into ordered, deliverable phases.

## Phase 1 — Schema registry schema and RPCs (no UI)

**Migration `0035_sci_010_dataset_schema_registry.sql`:**

- `api.dataset_schemas` (id, workspace_id, slug, name, description, revision,
  status, created_by_user_id, timestamps). Constraints: unique
  `(workspace_id, slug, revision)`; `status IN ('draft','published','retired')`;
  `revision > 0`.
- `api.dataset_schema_fields` (id, schema_id, workspace_id, slug, label,
  description, display_order, logical_type, nullable, default_value, unit,
  validation, lifecycle, timestamps). Constraints: unique
  `(schema_id, slug)`; `logical_type` reuses the 0019 vocabulary check;
  `lifecycle IN ('active','retired')`.
- Identity guard trigger: `workspace_id`, `slug`, `logical_type` immutable
  after creation (same pattern as `guard_record_field_definitions_identity`).
- RLS: members read; members insert drafts; owners update/retire/publish.
  Mirror the `record_field_definitions` policy shape.
- `ALTER TABLE api.scientific_tables ADD COLUMN dataset_schema_id uuid
REFERENCES dataset_schemas(id) ON DELETE SET NULL, ADD COLUMN
dataset_schema_revision integer` (both nullable).
- `ALTER TABLE api.scientific_columns ADD COLUMN dataset_schema_field_id uuid
REFERENCES dataset_schema_fields(id) ON DELETE SET NULL` (nullable).
- `emit_change_event` for create/publish/retire.

**RPCs (all `SECURITY DEFINER`, `internal.assert_scientific_actor`):**

- `api.create_dataset_schema(p_slug, p_name, p_description, p_fields jsonb)`
  → creates a draft revision 1 with fields.
- `api.add_dataset_schema_field(p_schema_id, p_label, p_slug, p_logical_type,
...)` → add field to a draft.
- `api.retire_dataset_schema_field(p_schema_field_id)` → owner, sets retired.
- `api.publish_dataset_schema(p_schema_id)` → owner, freezes revision,
  sets `published`.
- `api.instantiate_dataset_schema(p_block_id, p_schema_id, p_name)` →
  creates a `scientific_tables` row bound to the published revision, clones
  columns from `dataset_schema_fields`, links each
  `scientific_column.dataset_schema_field_id`.
- `api.upgrade_scientific_schema(p_table_id, p_target_revision)` → explicit
  upgrade; additive-only fast path; type-change/retire requires confirmation.

**Tests:** schema creation, field immutability, publish/retire permissions
(owner vs member), instantiate creates bound columns, RLS isolation.

## Phase 2 — Cross-sheet query RPC

- `api.query_dataset(p_schema_id, p_revision, p_filters jsonb, p_limit,
p_offset)` → `SECURITY INVOKER`, RLS-filtered, UNION ALL of per-table
  projections into stable JSONB keyed by field slug. No physical names
  exposed.
- Filters: field-value equality/range on stable slugs, not physical columns.
- Returns `{ row_id, table_id, record_id, field_values: {slug: value} }`.
- Tests: cross-sheet union, RLS isolation, filter by slug, empty schema,
  legacy unbound sheets excluded, pagination.

## Phase 3 — Sheet-block UI: schema picker

- When creating a sheet block, the user can:
  - **Select a published workspace schema** (dropdown of `dataset_schemas`
    where `status = published`).
  - **Create a schema on the fly** (opens the schema editor inline; creates a
    draft schema, then instantiates it).
  - **Continue ad-hoc** (existing behaviour — no binding).
- The sheet editor shows the bound schema name + revision badge.
- "Upgrade available" indicator when a newer published revision exists.

## Phase 4 — Schema management UI (Dataset Explorer / Workspace Settings)

- A schema browser: list published/draft schemas, inspect fields, publish,
  retire, edit drafts.
- This maps to the Dataset Explorer mockup's `Schema` tab and the
  `Fields` button.
- Permission-gated: owners see publish/retire controls; members see read-only
  for published schemas and edit for their own drafts.

## Phase 5 — Backfill legacy sheets (opt-in)

- `api.bind_legacy_sheet(p_table_id, p_schema_name)` → creates a
  `dataset_schemas` row (published, revision 1) from the sheet's existing
  `scientific_columns`, links the table and columns.
- Explicit RPC, not automatic — avoids disrupting the live demo database.
- Tests: backfill preserves existing data and column IDs, bound sheet appears
  in `query_dataset`.

## Phase 6 — Acceptance

- End-to-end: create a reusable "Stability Study Result" schema, instantiate
  it in two experiments, enter data, run `query_dataset`, verify cross-sheet
  union returns rows from both sheets with stable field slugs.
- Upgrade a sheet from revision 1 to revision 2 (additive) and verify.
- Workspace isolation: cross-workspace `query_dataset` returns nothing.
- Permission: member cannot publish; owner can.

## What does NOT change

- The existing per-sheet physical storage model (generated tables, RLS,
  HyperFormula, `apply_scientific_row_edits`) is unchanged.
- `create_scientific_table` without a schema argument still works (ad-hoc).
- Legacy unbound sheets continue to work through existing per-table RPCs.
- `record_field_definitions` (ADR 0026) is untouched — it covers
  `records.properties`, a separate concern.
