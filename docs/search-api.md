# Scientific search API (SCI-008, decision 0033; DATA-04 extension)

Search runs through the existing same-origin `/api/db` boundary as a
PostgREST RPC. PostgreSQL and RLS remain authoritative.

## Resource

```
POST /api/db/rpc/search
Content-Type: application/json
```

The proxy forwards the request to PostgREST `/rpc/search` with the caller's
short-lived authenticated JWT. The response is a JSON array of result objects.

## Parameters

| Parameter       | Type        | Default | Description                                                                                           |
| --------------- | ----------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `p_query`       | text        | `''`    | Search text (plain English, no tsquery syntax needed). Empty = browse all.                            |
| `p_project_id`  | uuid        | NULL    | Filter by project. Scopes records, datasets and sheet instances.                                      |
| `p_result_type` | text        | NULL    | Object-class facet: `record`, `file`, `dataset`, `sheet` or `template`. NULL = all classes.           |
| `p_kind`        | text        | NULL    | Record kind (experiment, sample, reagent, protocol_template, report, file, notebook_template, study). |
| `p_status`      | text        | NULL    | Filter by status. Record-scoped.                                                                      |
| `p_owner_id`    | text        | NULL    | Filter by `created_by_user_id`. Record-scoped.                                                        |
| `p_date_from`   | timestamptz | NULL    | Filter by `created_at >=`.                                                                            |
| `p_date_to`     | timestamptz | NULL    | Filter by `created_at <=`.                                                                            |
| `p_limit`       | int         | 20      | Page size. Above 100 clamps to 100. Below 1 resets to 20.                                             |
| `p_offset`      | int         | 0       | Page offset.                                                                                          |

All filters are optional. `NULL` (or omitted) means "no filter on this
dimension".

## Request example

```json
{
  "p_query": "lentivector stability",
  "p_kind": "experiment",
  "p_limit": 20,
  "p_offset": 0
}
```

## Response example

```json
[
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
    "deep_link": "/projects/00000000-0000-4000-8000-000000000100/experiments/00000000-0000-4000-8000-000000000101",
    "total_count": 42
  }
]
```

## Result columns

| Column               | Type        | Description                                                                                                                                        |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result_type`        | text        | `record`, `file`, `dataset`, `sheet` or `template`.                                                                                                |
| `record_id`          | uuid        | Stable id of the matched object.                                                                                                                   |
| `kind`               | text        | Fine-grained type: record kind, `dataset`, `sheet_instance` or `notebook_template`.                                                                |
| `identifier`         | text        | Stable public identifier (EXP-2025-0001); datasets and sheets use their UUID, templates their key.                                                 |
| `title`              | text        | Object title or name.                                                                                                                              |
| `status`             | text        | Status or lifecycle string.                                                                                                                        |
| `project_id`         | uuid        | Project id (NULL for workspace-level templates).                                                                                                   |
| `archived`           | boolean     | Archived/retired flag; see below.                                                                                                                  |
| `created_by_user_id` | text        | Owner id.                                                                                                                                          |
| `created_at`         | timestamptz | Creation timestamp.                                                                                                                                |
| `updated_at`         | timestamptz | Last update timestamp.                                                                                                                             |
| `matched_context`    | text        | `ts_headline` snippet with `<b>` highlights, or a title excerpt in browse mode.                                                                    |
| `matched_field`      | text        | Which source matched: `title`, `identifier`, `kind`, `status`, `tags`, `block_text`, `file_metadata`, `properties`, `relationship`, `description`. |
| `rank`               | real        | PostgreSQL `ts_rank` (0 in browse mode).                                                                                                           |
| `deep_link`          | text        | Stable route path.                                                                                                                                 |
| `total_count`        | bigint      | Total matching rows before pagination (same on every row).                                                                                         |

## Deep link formats

| Result class                                    | Deep link                                    |
| ----------------------------------------------- | -------------------------------------------- |
| `dataset`                                       | `/datasets?dataset=$recordId`                |
| `sheet`                                         | `/sheets/$recordId`                          |
| `template`                                      | `/templates`                                 |
| `record` / `file` with kind `notebook_template` | `/templates`                                 |
| All other records                               | `/projects/$projectId/experiments/$recordId` |

## Coverage

One canonical RPC searches every scientific object class:

- **Records** — titles, identifiers, tags, status, properties, block text,
  linked-record context; files via their `file_objects` metadata.
- **Datasets** — name, description and schema definition name/key.
- **Sheet Instances** — name and description.
- **Notebook Templates** — name, key and description.

Analysis artefacts, plate designs and instrument runs are not indexed yet.

## Archived-result behaviour

Archived records (`archived_at IS NOT NULL`, `deleted_at IS NULL`) appear in
results with `archived = true`. Archived Datasets and Sheet Instances appear
with `status = 'archived'` and `archived = true`. Retired Notebook Templates
appear with `archived = true`. Soft-deleted records
(`deleted_at IS NOT NULL`) are excluded.

## Record-only filter semantics

`p_kind`, `p_status` and `p_owner_id` apply to the record branch only. When
you supply any of them, the Dataset/Sheet/Template branches are suppressed.
A kind-filtered query keeps its exact previous meaning. Use `p_result_type`
instead to facet across object classes.

## Indexing delay and stale-result behaviour

**None.** Search is real-time. The record branch reads the persisted
`api.records.search_tsv` column (PLAT-05). Triggers on `records`, `blocks`,
`file_objects` and `record_links` maintain that column. A partial GIN index
accelerates the match. The Dataset, Sheet and Template branches build their
`tsvector` at query time. Trigger updates run inside the edit transaction. An
edit is searchable immediately after the transaction commits. There is no
eventual consistency window.

## Restricted-field non-leakage

Results contain only metadata (title, identifier, kind, status, project,
owner, dates) and matched context (a short snippet). The response does not
contain full record content, block payloads, file bytes, storage keys,
checksums, property values or restricted fields.

Counts, facets and result rows all derive from the same permission-filtered
set: the RPC is SECURITY INVOKER, every source table enforces workspace RLS,
and the system rejects non-members before any branch runs. Objects outside
the caller's workspace never surface through totals either.

## Error shapes

| Condition                     | SQLSTATE | Category              |
| ----------------------------- | -------- | --------------------- |
| Unauthenticated               | —        | `unauthenticated`     |
| No active workspace in claims | 42804    | `validation_error`    |
| Caller not a workspace member | 42501    | `permission_denied`   |
| PostgREST upstream failure    | —        | `service_unavailable` |

Errors use the same `{ error: { category, message, request_id } }` envelope
as all other `/api/db` resources.

## Known FTS tokenizer limitation

PostgreSQL's default full-text search parser treats dot/hyphen-delimited
strings that resemble file paths or URLs (e.g. `stability-run07-4c.csv`) as
single `host` tokens. Words within such tokens are not individually
searchable. Display names with spaces tokenize correctly. This is a
PostgreSQL FTS behaviour, not a Sheetbase-specific limitation. Record titles,
identifiers and notebook text (which use natural-language spacing) are
unaffected.
