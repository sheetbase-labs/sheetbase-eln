# 0033. Scientific search contract

- **Status:** accepted
- **Date:** 2026-07-23
- **Ticket:** SCI-008

## Context

SCI-008 adds the initial scientific search: a deep-linkable search route that
lets a workspace member find records, file metadata and notebook content by
keyword, filtered by project, type, status, owner and date. Every prior ticket
(SCI-001 through SCI-007) has established the record/block/file/link/template
model that search must index.

Decisions that constrain this one:

- 0006: workspace RLS is authoritative; every workspace-owned table enforces
  `workspace_id = current_workspace_id()` and `is_workspace_member()`.
- 0010: the inspector is a shared content container; routes own data and pass
  typed tab content. Search result preview reuses this pattern.
- 0011: StatusBadge and RecordLink are the shared components for rendering
  status and relationship context in results.
- 0015: records, blocks, record_links; `kind` drives identity; blocks are the
  source of truth for notebook content.
- 0025: rich_text payloads are canonical Tiptap JSON (H2/H3, paragraphs, prose
  lists). H1 is the record title outside prose and is already indexed as record
  metadata — it is not re-indexed from block content.
- 0026: scientific record kinds (sample, reagent, protocol_template) with
  configurable `properties` JSONB; string values are searchable.
- 0028: `file_objects` carries display_name and media_type; file metadata is
  searchable.
- 0031: notebook templates are records with kind `notebook_template`; their
  metadata is searchable.

The Knowledge Search mockup shows a full-page search route with a query input,
faceted type filters, structured filters (project, type, status, owner, date),
a results list with type badges, matched context snippets and status badges, and
a right-hand inspector preview. This ticket implements the initial keyword
search with structured filters; saved searches, search alerts, faceted
navigation beyond the listed filters, and external search services belong to
later tickets.

## Decision

### 1. Real-time search — no index table, no indexing delay

Search is **real-time (query-time)**. A `SECURITY INVOKER` PL/pgSQL function
(`api.search`) builds a `tsvector` at query time from record metadata, block
text, file metadata, configurable properties and record-relationship context.
There is no materialised index table, no triggers, and no async refresh.

**Tradeoff:** this is simplest and correct — results are never stale, there is
no indexing delay, and no index maintenance. For large workspaces the
correlated text aggregation may be slower than a materialised index. When
performance demands it, a future ticket can add a generated `tsvector` column
or a `search_index` table refreshed by triggers or durable change events
(0016/0017) without changing the REST contract.

**Indexing delay and stale-result behaviour:** there is none. Search reads the
live `records`, `blocks`, `file_objects` and `record_links` rows at query time.
A block edit is searchable immediately after the transaction commits. There is
no eventual consistency window to document or warn about.

**Durable change events (0016/0017):** not used for search. Change events drive
live SSE reconciliation of the QueryClient cache; search does not subscribe to
them because it has no index to update. If a materialised index is added later,
change events would be the natural driver for async index updates.

### 2. What is searchable

| Source                          | Text indexed                                              | Weight |
| ------------------------------- | --------------------------------------------------------- | ------ |
| Record metadata                 | `title`, `identifier`                                     | A      |
| Record metadata                 | `kind`, `status`                                          | B      |
| Configurable properties         | String values extracted from `records.properties` JSONB  | C      |
| Notebook block text             | All string values extracted from `blocks.payload` JSONB  | C      |
| File metadata                   | `display_name`, `media_type` from `file_objects`          | C      |
| Record relationships            | `target_identifier`, `target_kind`, `link_type` from `record_links` | C |

**Permitted notebook text boundary:** only text from blocks belonging to
records the caller's workspace can access via RLS. Because the search function
is `SECURITY INVOKER`, all table reads are subject to RLS — blocks from
cross-workspace records are invisible. No text from restricted or
cross-workspace records is indexed or returned.

**Tiptap JSON text extraction:** a PL/pgSQL helper
(`internal.extract_jsonb_text`) recursively walks any JSONB value and extracts
all string-valued leaves. For `rich_text` blocks this produces the plain text of
paragraphs, H2/H3 headings and prose list items (per ADR 0025). H1 is not
present in block content (it is the record title, already indexed as metadata).
The same helper extracts text from checklist items, callout text, procedure
notes, materials notes, metric labels, file display names, protocol reference
identifiers and link target identifiers. Non-string JSONB values (numbers,
booleans) are not indexed; they are filterable through structured filters where
applicable.

**Structured/configurable fields:** `records.properties` is a flat JSONB object.
String values are extracted for full-text search. Structured filtering (by
project, kind, status, owner, date) uses metadata columns, not property values.
Property-specific filters belong to a later ticket.

**Record relationships:** searching for a record by what it is linked to (e.g.
"find experiments that use sample SMP-2025-0001") works because
`record_links.target_identifier` and `target_kind` are indexed as C-weight text.
A hit on a link target identifier returns the source record with matched context
indicating the relationship.

### 3. Result types and deep links

Results are typed with a `result_type` discriminator:

| `result_type` | When                               | Deep link                                                        |
| ------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `record`      | All non-file records               | `/projects/$projectId/experiments/$recordId`                     |
| `file`        | Records with `kind = 'file'`       | `/projects/$projectId/experiments/$recordId`                     |

The `kind` field further discriminates records (experiment, sample, reagent,
protocol_template, report, notebook_template) for UI icons and type badges.
Block/section-level results are not implemented in the initial search; a match
on block text returns the containing record with matched context identifying
the source.

Deep links use the existing `recordPath` convention. Notebook templates link to
`/templates` (the existing templates route). Deep links are stable: they are
derived from the record's `project_id` and `id`, which are immutable.

### 4. Matched context

Each result carries a `matched_context` string produced by PostgreSQL
`ts_headline` over the combined searchable text. The headline is a short
snippet with matched terms highlighted by `<b>` tags (rendered as bold in the
UI). When the query is empty (browsing mode), `matched_context` is an excerpt
of the record's title and identifier.

The result also carries a `matched_field` string identifying which source
matched: `title`, `identifier`, `block_text`, `file_metadata`, `properties`, or
`relationship`. This lets the UI show a label like "Matched in notebook text"
without leaking full content.

### 5. Filters

Structured filters are applied as `WHERE` clauses inside the search function:

| Filter        | Parameter        | Column                      |
| ------------- | ---------------- | --------------------------- |
| Project       | `p_project_id`   | `records.project_id`        |
| Type (kind)   | `p_kind`         | `records.kind`              |
| Status        | `p_status`       | `records.status`            |
| Owner         | `p_owner_id`     | `records.created_by_user_id`|
| Date from     | `p_date_from`    | `records.created_at >=`     |
| Date to       | `p_date_to`      | `records.created_at <=`     |

All filters are optional. `NULL` means "no filter on this dimension". The
function does not invent filters the caller did not request.

### 6. RLS and workspace isolation

The search function is `SECURITY INVOKER` (not `SECURITY DEFINER`). This means:

- All table reads inside the function are subject to RLS.
- `records`, `blocks`, `record_links` and `file_objects` all have RLS policies
  that filter by `current_workspace_id()` and `is_workspace_member()`.
- Cross-workspace records are invisible: the function cannot return them because
  RLS hides them before the tsvector is built.
- No `SECURITY DEFINER` escape hatch is needed; the function never bypasses RLS.

The function explicitly checks `current_workspace_id()` and
`is_workspace_member()` at the top and raises `42501` if the caller has no
active workspace or is not a member. This gives a clear error before any query
runs, but RLS remains the authoritative boundary.

### 7. Archived records

Archived records (`archived_at IS NOT NULL`, `deleted_at IS NULL`) are included
in search results and marked with `archived = true`. This matches the
record-picker pattern (SCI-001): archived records are visible so historical
links and references remain discoverable. Soft-deleted records
(`deleted_at IS NOT NULL`) are excluded.

### 8. No fake relevance, no fake counts

Results are ordered by `ts_rank` descending, then by `updated_at` descending.
The rank is the PostgreSQL full-text rank from the tsvector/tsquery match — it
is not a custom score. Result counts are the actual count of matching rows; no
counts are fabricated. When the query is empty, results are ordered by
`updated_at` descending (recently updated first).

### 9. REST surface

Search is exposed through the existing same-origin `/api/db` boundary as an RPC:

```
POST /api/db/rpc/search
Content-Type: application/json

{
  "p_query": "lentivector stability",
  "p_kind": "experiment",
  "p_limit": 20,
  "p_offset": 0
}
```

The proxy forwards the request to PostgREST `/rpc/search` with the caller's
short-lived authenticated JWT. The response is a JSON array of result objects.

Result object shape (snake_case, as returned by PostgREST):

```json
{
  "result_type": "record",
  "record_id": "00000000-0000-4000-8000-000000000101",
  "kind": "experiment",
  "identifier": "EXP-2025-0001",
  "title": "Virus Stability at 4 °C",
  "status": "in-progress",
  "project_id": "00000000-0000-4000-8000-000000000100",
  "archived": false,
  "created_by_user_id": "00000000-0000-4000-8000-000000000001",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-20T14:30:00Z",
  "matched_context": "Virus <b>Stability</b> at 4 °C ...",
  "matched_field": "title",
  "rank": 0.06079271,
  "deep_link": "/projects/00000000-0000-4000-8000-000000000100/experiments/00000000-0000-4000-8000-000000000101"
}
```

**Restricted-field non-leakage:** results contain only metadata (title,
identifier, kind, status, project, owner, dates) and matched context (a short
snippet). Full record content, block payloads, file bytes, properties values
and restricted fields are not returned. The matched context is a headline
excerpt, not the full text.

### 10. Pagination

The function accepts `p_limit` (default 20, max 100) and `p_offset` (default 0).
The response includes the total count via a separate `p_count` output parameter
so the UI can render pagination without a second request. The count is the
actual number of matching rows after filters, not an estimate.
