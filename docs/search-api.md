# Scientific search API (SCI-008, decision 0033)

Search is exposed through the existing same-origin `/api/db` boundary as a
PostgREST RPC. PostgreSQL and RLS remain authoritative.

## Resource

```
POST /api/db/rpc/search
Content-Type: application/json
```

The proxy forwards the request to PostgREST `/rpc/search` with the caller's
short-lived authenticated JWT. The response is a JSON array of result objects.

## Parameters

| Parameter       | Type            | Default | Description                              |
| --------------- | --------------- | ------- | ---------------------------------------- |
| `p_query`       | text            | `''`    | Search text (plain English, no tsquery syntax needed). Empty = browse all. |
| `p_project_id`  | uuid            | NULL    | Filter by project.                        |
| `p_kind`        | text            | NULL    | Filter by record kind (experiment, sample, reagent, protocol_template, report, file, notebook_template). |
| `p_status`      | text            | NULL    | Filter by status.                         |
| `p_owner_id`    | text            | NULL    | Filter by `created_by_user_id`.           |
| `p_date_from`   | timestamptz     | NULL    | Filter by `created_at >=`.                |
| `p_date_to`     | timestamptz     | NULL    | Filter by `created_at <=`.                |
| `p_limit`       | int             | 20      | Page size (clamped to 1–100).             |
| `p_offset`      | int             | 0       | Page offset.                              |

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

| Column               | Type    | Description                                                       |
| -------------------- | ------- | ----------------------------------------------------------------- |
| `result_type`        | text    | `record` or `file` (kind = `file`).                               |
| `record_id`          | uuid    | Record id.                                                        |
| `kind`               | text    | Record kind (experiment, sample, reagent, etc.).                  |
| `identifier`         | text    | Stable public identifier (EXP-2025-0001, SMP-…).                  |
| `title`              | text    | Record title.                                                     |
| `status`             | text    | Free-form status string.                                          |
| `project_id`         | uuid    | Project id.                                                       |
| `archived`           | boolean | `true` if `archived_at` is set. Soft-deleted records are excluded. |
| `created_by_user_id` | text    | Owner id.                                                         |
| `created_at`         | timestamptz | Creation timestamp.                                           |
| `updated_at`         | timestamptz | Last update timestamp.                                        |
| `matched_context`    | text    | `ts_headline` snippet with `<b>` highlights, or a title excerpt in browse mode. |
| `matched_field`      | text    | Which source matched: `title`, `identifier`, `kind`, `status`, `tags`, `block_text`, `file_metadata`, `properties`, `relationship`. |
| `rank`               | real    | PostgreSQL `ts_rank` (0 in browse mode).                          |
| `deep_link`          | text    | Stable route path.                                                |
| `total_count`        | bigint  | Total matching rows before pagination (same on every row).        |

## Deep link formats

| Kind               | Deep link                                        |
| ------------------ | ------------------------------------------------ |
| `notebook_template`| `/templates`                                     |
| All other kinds    | `/projects/$projectId/experiments/$recordId`     |

## Matched context

The `matched_context` is a short `ts_headline` excerpt with matched terms
highlighted by `<b>` tags. The UI renders these as bold segments without
`dangerouslySetInnerHTML`. In browse mode (empty query), it is an excerpt of
the record's title and identifier.

## Archived-result behaviour

Archived records (`archived_at IS NOT NULL`, `deleted_at IS NULL`) are included
in search results with `archived = true`. Soft-deleted records
(`deleted_at IS NOT NULL`) are excluded.

## Indexing delay and stale-result behaviour

**None.** Search is real-time (query-time). The `api.search` function builds a
`tsvector` at query time from live `records`, `blocks`, `file_objects` and
`record_links` rows. A block edit is searchable immediately after the
transaction commits. There is no materialised index, no triggers, and no
eventual consistency window.

## Restricted-field non-leakage

Results contain only metadata (title, identifier, kind, status, project, owner,
dates) and matched context (a short snippet). Full record content, block
payloads, file bytes, storage keys, checksums, property values and restricted
fields are not returned.

## Error shapes

| Condition                          | HTTP status | Error category      |
| ---------------------------------- | ----------- | ------------------- |
| Unauthenticated                    | 401         | `unauthenticated`   |
| No active workspace in claims      | 42804       | `upstream_error`    |
| Caller not a workspace member      | 42501       | `permission_denied` |
| PostgREST upstream failure         | 500         | `upstream_error`    |

Errors use the same `{ error: { category, message, request_id } }` envelope as
all other `/api/db` resources.

## Known FTS tokenizer limitation

PostgreSQL's default full-text search parser treats dot/hyphen-delimited
strings that resemble file paths or URLs (e.g. `stability-run07-4c.csv`) as
single `host` tokens. Words within such tokens are not individually searchable.
Display names with spaces tokenize correctly. This is a PostgreSQL FTS
behaviour, not a Sheetbase-specific limitation. Record titles, identifiers and
notebook text (which use natural-language spacing) are unaffected.
