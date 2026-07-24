# 0035. Dataset schema relationships — typed links between schemas

- **Status:** accepted
- **Date:** 2026-07-24
- **Ticket:** SCI-011 (to be added to TODO.md)

## Context

ADR 0034 introduced the dataset schema registry: workspace-level, versioned,
typed schema definitions that sheets can bind to. Each schema is a flat list of
fields. The ReactFlow canvas on `/schemas` renders a single schema node at a
time.

The user asked: "How do I link one schema to another?" The Dataset Explorer
mockup shows a "Joins 3" indicator and dedicated Relationships / Lineage tabs.
The Lineage Explorer mockup shows a radial graph with directed, labelled edges
between entity nodes. The intent is clear: schemas are not isolated column
lists — they are connected data models. A "Stability Study Result" schema
references a "Sample" schema; a "Calculated Titer" schema derives from a "Raw
qPCR Result" schema. These relationships must be visible, editable, and
queryable.

Today there is no way to express that schema A relates to schema B. The only
linking mechanism is `record_links` (ADR 0016), which connects individual
records, not schema definitions. `record_links` is row-level lineage; this
decision is about schema-level relationships — the data model layer.

## Decision

Add a **dataset schema relationships** layer: directed, typed, versioned
relationships between dataset schemas, rendered as ReactFlow edges on the
`/schemas` canvas and queryable through the API.

### New table: `api.dataset_schema_relationships`

| Column               | Type                         | Notes                                            |
| -------------------- | ---------------------------- | ------------------------------------------------ |
| `id`                 | uuid PK                      | stable relationship identity                     |
| `workspace_id`       | uuid → workspaces            | cascade                                          |
| `source_schema_id`   | uuid → dataset_schemas       | the "from" schema                                |
| `target_schema_id`   | uuid → dataset_schemas       | the "to" schema                                  |
| `relationship_type`  | text                         | `references` \| `derives_from` \| `composed_of`  |
| `label`              | text                         | human-readable, e.g. "measured on"               |
| `cardinality`        | text                         | `one_to_one` \| `one_to_many` \| `many_to_many`  |
| `source_field_id`    | uuid → dataset_schema_fields | nullable; the specific source field (FK column)  |
| `target_field_id`    | uuid → dataset_schema_fields | nullable; the specific target field (usually the |
|                      |                              | target schema's primary identifier field)        |
| `created_by_user_id` | text → user                  |                                                  |
| `...timestamps`      |                              |                                                  |

**Constraints:**

- `(source_schema_id, target_schema_id, relationship_type)` is unique — one
  relationship of each type between any two schemas.
- `source_schema_id ≠ target_schema_id` (no self-references in the initial
  implementation; can be relaxed later).
- `source_field_id` and `target_field_id`, when provided, must belong to the
  source and target schema respectively.
- Both schemas must be in the same workspace.

**Relationship types** are a closed vocabulary:

| Type           | Semantics                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `references`   | Source schema has a field that points to rows in the target schema (foreign key).                           |
| `derives_from` | Source schema is computed/derived from the target schema (e.g. "Calculated Titer" derives from "Raw qPCR"). |
| `composed_of`  | Source schema includes or embeds the target schema's fields as a sub-component.                             |

`cardinality` is informational metadata — it does not enforce a physical
constraint. The physical enforcement (if any) happens through the `reference`
field type and sheet-level validation, not at the schema relationship level.

### Versioning

Relationships are defined on **published schema revisions**, but the
relationship itself is not versioned in the initial implementation. When a
schema is upgraded to a new revision, the relationship persists (it references
the schema slug, not a specific revision — see "Why slug-level, not
revision-level" below). If a schema is retired, its relationships are marked
inactive but not deleted (soft delete, same pattern as field retirement).

**Why slug-level, not revision-level:** A relationship between "Stability
Study Result" and "Sample" is conceptual — it doesn't change when a new
revision of either schema is published. Linking to specific revisions would
create a combinatorial maintenance burden (every revision pair would need its
own relationship row) and would break the graph view every time a schema is
upgraded. The relationship is between schema concepts (identified by slug),
not between frozen snapshots. The `source_schema_id` / `target_schema_id`
columns point to the **latest published revision** of each schema; when a new
revision is published, a trigger updates the relationship to point to the new
revision's `dataset_schemas` row.

### New field type: `reference`

The existing logical type vocabulary (`text`, `integer`, `decimal`, `boolean`,
`date`, `timestamp`, `category`) gains a new member: **`reference`**.

A `reference` field stores a `uuid` physically (same storage as `category`),
but its semantic meaning is "a pointer to a row in a scientific table bound to
a specific schema." The `dataset_schema_relationships.source_field_id` links
the reference field to its target schema.

When a sheet bound to a schema with a `reference` field is instantiated, the
physical column is `uuid` (same as `category`), and the column's
`dataset_schema_field_id` links it to the reference field. The reference is
soft — no physical FK constraint is enforced on the generated table (RLS and
the generated-table model make hard FKs impractical across dynamic tables).
Validation that the referenced UUID exists in a table bound to the target
schema is done at write time by an RPC, not by a database constraint.

This is intentionally simpler than a hard FK. The goal is metadata-level
linking with soft validation, not physical referential integrity — the same
posture as `record_links`.

### ReactFlow canvas: multi-schema graph

The `/schemas` canvas changes from single-node to multi-node:

1. **All published schemas** in the workspace appear as nodes, positioned by a
   simple layout (dagre or manual). Draft schemas appear in a "draft" state
   (dashed border, lower opacity).
2. **Relationships** appear as directed edges with labels (`references`,
   `derives_from`, `composed_of`) and cardinality badges.
3. **Selecting a schema** opens it in the existing inspector (field table,
   properties panel). The graph remains visible — the selected node is
   highlighted, others dim.
4. **Drawing a new edge** — drag from a schema node's handle to another node.
   A dialog appears to select relationship type, cardinality, and optional
   source/target fields.
5. **Deleting an edge** — click the edge, confirm deletion.

The existing single-schema canvas is preserved as a "zoom" mode — double-click
a node to expand it to fill the canvas (current behaviour), double-click again
or press Escape to return to the graph.

### RPCs

| RPC                                           | Purpose                                   |
| --------------------------------------------- | ----------------------------------------- |
| `POST /api/db/rpc/create_schema_relationship` | Create a relationship between two schemas |
| `POST /api/db/rpc/delete_schema_relationship` | Delete a relationship (soft delete)       |

`create_schema_relationship` validates that both schemas exist in the caller's
workspace, at least one is published, and the relationship doesn't already
exist. Returns the created relationship row.

`delete_schema_relationship` sets `lifecycle = 'inactive'` (soft delete). The
relationship remains in the table for audit but is excluded from the graph and
queries.

### Cross-schema query

`query_dataset` is extended with an optional `p_expand` parameter. When
provided, reference fields in the result are expanded: instead of returning a
bare UUID, the field value includes `{ referenced_table_id, referenced_record_id, referenced_fields: { ... } }` — a nested object with the
referenced row's field values, resolved through the target schema's
`query_dataset`.

This is opt-in (default: no expansion, return bare UUIDs) to avoid
unintentional N+1 queries. The caller specifies which reference fields to
expand and at what depth (max depth 2 in the initial implementation).

### Permission model

Same as ADR 0034: any workspace member can create relationships; only owners
can delete them. This mirrors the schema publish/retire split.

| Action                  | Who                  |
| ----------------------- | -------------------- |
| List/view relationships | any workspace member |
| Create a relationship   | any workspace member |
| Delete a relationship   | workspace owner      |

### REST resources

| Resource                                                            | Purpose                               |
| ------------------------------------------------------------------- | ------------------------------------- |
| `GET /api/db/dataset_schema_relationships?source_schema_id=eq.<id>` | list relationships from a schema      |
| `GET /api/db/dataset_schema_relationships?target_schema_id=eq.<id>` | list relationships to a schema        |
| `GET /api/db/dataset_schema_relationships?workspace_id=eq.<id>`     | list all relationships in a workspace |
| `POST /api/db/rpc/create_schema_relationship`                       | create                                |
| `POST /api/db/rpc/delete_schema_relationship`                       | soft delete                           |

## Alternatives considered

1. **Extend `record_links` to schema-level.** Rejected — `record_links` is
   row-level (connects individual records). Schema relationships are
   type-level (connect schema definitions). Conflating the two would break the
   `record_links` contract and its RLS.

2. **Hard physical FKs on generated tables.** Rejected — generated tables are
   created dynamically, and Postgres FKs between dynamically created tables in
   the same schema are fragile (dropping/recreating a table cascades). RLS
   makes cross-table FK enforcement unreliable. Soft references with RPC
   validation are the same posture as `record_links`.

3. **Relationships as field metadata only (no separate table).** Rejected —
   would require adding `references_schema_id` to `dataset_schema_fields` and
   would not support `derives_from` or `composed_of` relationships that exist
   between schemas as a whole, not between specific fields.

4. **Revision-level relationships.** Rejected — creates O(N×M) relationship
   rows for N revisions of schema A and M revisions of schema B, and breaks the
   graph view on every upgrade. Slug-level relationships are stable across
   revisions (see "Why slug-level, not revision-level").

5. **A separate graph/lineage service.** Rejected for now — the relationships
   are simple metadata that fit naturally in the existing schema registry. A
   dedicated graph engine could be added later if the lineage view (ADR 0016's
   `record_links` graph) and the schema graph converge.

## Consequences

**Easier:**

- Schemas as connected data models, not isolated column lists — the core
  "better Benchling" requirement.
- Visual graph of schema relationships on `/schemas` using the existing
  ReactFlow canvas.
- Cross-schema queries with reference expansion — query a "Stability Study
  Result" and automatically pull in the referenced "Sample" fields.
- `derives_from` relationships provide the metadata for a future automated
  lineage view (connecting to the Lineage Explorer mockup).

**Harder:**

- One more metadata table and its lifecycle (create, soft delete, workspace
  isolation).
- The ReactFlow canvas becomes multi-node with layout management — more complex
  than the current single-node view.
- Reference expansion in `query_dataset` adds query complexity and potential
  N+1 risk (mitigated by opt-in and max depth 2).

**Forbidden:**

- Hard physical FKs between generated tables.
- Self-referential relationships (initial implementation).
- Relationship types outside the closed vocabulary.
- Cross-workspace relationships.
- Deleting a relationship without audit (soft delete only).

## Open questions (to settle before implementation)

1. Should the graph layout use dagre (automatic DAG layout) or manual
   positioning with persisted coordinates? (Proposal: dagre for automatic
   layout, with optional manual override persisted to a future
   `dataset_schema_node_positions` table if the user wants drag-to-position.)
2. Should `reference` field validation (checking the UUID exists in a target
   table) be synchronous on write or async? (Proposal: synchronous on write —
   the RPC validates existence before accepting the row. Same posture as
   category option validation.)
3. Should `composed_of` relationships imply field inheritance (the source
   schema automatically includes the target schema's fields)? (Proposal: no —
   `composed_of` is metadata only in the initial implementation. Field
   inheritance is a larger feature that can be built on top later.)
