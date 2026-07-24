# SCI-011 — Dataset schema relationships — implementation plan

**ADR:** [0035-dataset-schema-relationships.md](../decisions/0035-dataset-schema-relationships.md)
**Date:** 2026-07-24
**Status:** ready for implementation

## Overview

Add typed, directed relationships between dataset schemas. Render them as
ReactFlow edges on the `/schemas` canvas. Add a `reference` field type. Extend
`query_dataset` with optional reference expansion.

## Phase 1 — Migration `drizzle/0036_sci_011_schema_relationships.sql`

### New table: `api.dataset_schema_relationships`

```sql
CREATE TABLE api.dataset_schema_relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  source_schema_id   uuid NOT NULL REFERENCES api.dataset_schemas(id) ON DELETE CASCADE,
  target_schema_id   uuid NOT NULL REFERENCES api.dataset_schemas(id) ON DELETE CASCADE,
  relationship_type  text NOT NULL CHECK (relationship_type IN ('references','derives_from','composed_of')),
  label           text NOT NULL DEFAULT '',
  cardinality     text NOT NULL DEFAULT 'one_to_many' CHECK (cardinality IN ('one_to_one','one_to_many','many_to_many')),
  source_field_id uuid REFERENCES api.dataset_schema_fields(id) ON DELETE SET NULL,
  target_field_id uuid REFERENCES api.dataset_schema_fields(id) ON DELETE SET NULL,
  lifecycle       text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','inactive')),
  created_by_user_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_reference CHECK (source_schema_id <> target_schema_id),
  CONSTRAINT unique_relationship UNIQUE (source_schema_id, target_schema_id, relationship_type)
);
```

- RLS: members read, members create, owners delete (set lifecycle=inactive).
- Index on `(workspace_id)`, `(source_schema_id)`, `(target_schema_id)`.

### Extend logical type vocabulary

Add `reference` to `internal.scientific_storage_type`:

```sql
CREATE OR REPLACE FUNCTION internal.scientific_storage_type(p_type text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 RETURN CASE p_type
   WHEN 'text' THEN 'text'
   WHEN 'integer' THEN 'bigint'
   WHEN 'decimal' THEN 'numeric'
   WHEN 'boolean' THEN 'boolean'
   WHEN 'date' THEN 'date'
   WHEN 'timestamp' THEN 'timestamptz'
   WHEN 'category' THEN 'uuid'
   WHEN 'reference' THEN 'uuid'
   ELSE NULL END;
END $$;
```

Update `internal.compile_scientific_column` to accept `reference` as a valid
type (it has no validation rules beyond being a UUID — same as `category`
without options).

### Trigger: update relationships on schema publish

When `publish_dataset_schema` creates a new revision, update all
`dataset_schema_relationships` rows where `source_schema_id` or
`target_schema_id` points to the old revision's `dataset_schemas` row — repoint
them to the new revision's row. This keeps relationships at the latest
published revision without creating duplicate rows.

### RPC: `create_schema_relationship`

```sql
CREATE OR REPLACE FUNCTION api.create_schema_relationship(
  p_source_schema_id uuid,
  p_target_schema_id uuid,
  p_relationship_type text,
  p_label text DEFAULT '',
  p_cardinality text DEFAULT 'one_to_many',
  p_source_field_id uuid DEFAULT NULL,
  p_target_field_id uuid DEFAULT NULL
) RETURNS jsonb
```

SECURITY DEFINER. Validates:

- Both schemas in caller's workspace.
- Source ≠ target.
- Relationship doesn't already exist (active).
- Field IDs belong to the correct schemas (if provided).
- At least one schema is published (draft-to-draft relationships are allowed
  but discouraged — the UI will warn).

### RPC: `delete_schema_relationship`

```sql
CREATE OR REPLACE FUNCTION api.delete_schema_relationship(
  p_relationship_id uuid
) RETURNS jsonb
```

SECURITY DEFINER. Owner-only. Sets `lifecycle = 'inactive'`.

### Journal entry 36

Add to `drizzle/meta/_journal.json`.

### Drizzle schema

Add `datasetSchemaRelationships` to `src/db/schema.ts`.

### TypeScript types

Add `DatasetSchemaRelationshipWire` to `src/lib/dataset-schema-data.ts`.
Add `'reference'` to `ScientificLogicalType` in `src/lib/scientific-sheet-data.ts`.

## Phase 2 — Data layer (`src/lib/dataset-schema-data.ts`)

- `fetchDatasetSchemaRelationships(client, workspaceId)` — list all active
  relationships.
- `createSchemaRelationship(client, input)` — call RPC.
- `deleteSchemaRelationship(client, relationshipId)` — call RPC.
- Query keys: `datasetSchemaQueryKeys.relationships(workspaceId)`.

## Phase 3 — ReactFlow multi-schema graph (`src/routes/schemas.tsx`)

### Graph mode vs. zoom mode

- **Graph mode** (default): all schemas as nodes, relationships as edges.
  Dagre layout. Selecting a node opens the inspector.
- **Zoom mode**: double-click a node to expand it to fill the canvas (current
  single-schema view). Escape or back button returns to graph mode.

### Nodes

Each published schema is a node. Draft schemas appear with dashed border and
lower opacity. Node content: schema name, status badge, field count. Node
handles: top (incoming), bottom (outgoing) for edge drawing.

### Edges

Directed edges with:

- Label: relationship type (`references`, `derives_from`, `composed_of`) or
  custom label.
- Style: solid for `references`, dashed for `derives_from`, dotted for
  `composed_of`.
- Cardinality badge on the edge (`1:1`, `1:N`, `N:M`).
- Animated for `derives_from` (data flow direction).

### Edge creation

Drag from a node's bottom handle to another node's top handle. A dialog
appears:

- Relationship type (select: references / derives_from / composed_of)
- Label (optional text input)
- Cardinality (select: one_to_one / one_to_many / many_to_many)
- Source field (optional, select from source schema's fields)
- Target field (optional, select from target schema's fields)
- Save / Cancel

### Edge deletion

Click an edge → it's selected → press Delete or click a trash icon → confirm.

### Dagre layout

Use `@dagrejs/dagre` for automatic layout. The graph lays out top-to-bottom
(derives_from flows downward). Nodes are positioned automatically; no manual
dragging in the initial implementation (open question #1 in the ADR).

### Dependencies

Add `@dagrejs/dagre` to `package.json` if not already present.

## Phase 4 — `reference` field type in UI

- Add `reference` to the field type selector in the schema editor and the
  add-field toolbar.
- When a `reference` field is selected, the properties panel shows a "Target
  schema" dropdown (select from published schemas in the workspace).
- When a `reference` field is created, a `references` relationship is
  automatically created between the source schema and the selected target
  schema (if one doesn't already exist).
- The icon for `reference` is `Link2` from lucide-react.

## Phase 5 — `query_dataset` reference expansion

Extend `api.query_dataset` with an optional `p_expand` parameter:

```sql
p_expand jsonb DEFAULT '{}'::jsonb
```

Format: `{ "<field_slug>": { "depth": 1 } }` — which reference fields to expand
and to what depth (max 2).

When a reference field is expanded, instead of returning the bare UUID, the
field value becomes:

```json
{
  "referenced_table_id": "...",
  "referenced_record_id": "...",
  "referenced_fields": { "<slug>": "<value>", ... }
}
```

The expansion resolves the UUID by querying the scientific tables bound to the
target schema (via the `references` relationship's `target_schema_id`).

## Phase 6 — Acceptance tests (`tests/db/schema-relationships.test.ts`)

- Create relationship between two published schemas.
- Reject self-reference.
- Reject duplicate relationship.
- Reject cross-workspace relationship.
- Owner can delete (soft); member cannot.
- Relationship persists when source schema is upgraded to a new revision.
- `reference` field type creates a `uuid` physical column.
- `query_dataset` with `p_expand` returns nested referenced fields.
- `query_dataset` without `p_expand` returns bare UUIDs.
- RLS: cross-workspace relationships not visible.

## File inventory

| File                                            | Action                                                |
| ----------------------------------------------- | ----------------------------------------------------- |
| `drizzle/0036_sci_011_schema_relationships.sql` | new                                                   |
| `drizzle/meta/_journal.json`                    | modified (entry 36)                                   |
| `src/db/schema.ts`                              | modified (add table)                                  |
| `src/lib/scientific-sheet-data.ts`              | modified (add `reference` type)                       |
| `src/lib/dataset-schema-data.ts`                | modified (add relationship functions, types)          |
| `src/routes/schemas.tsx`                        | modified (multi-node graph, edge UI, reference field) |
| `tests/db/schema-relationships.test.ts`         | new                                                   |

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm check` (prettier)
- `pnpm vitest run` (900+ tests, no regressions)
- `pnpm test:db` (existing 327+ tests pass, new relationship tests pass)
- `pnpm build`
- Browser QA on `app.sheetbase.co.uk/schemas`: verify graph renders with
  multiple schema nodes and edges, edge creation dialog works, reference field
  type appears in the field type selector.
