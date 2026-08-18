# Sheetbase public API contract (API-01)

> **Status:** Contract v0.1.2 — **intended** public surface.  
> **Implementation:** API-07 cut over the Core Dataset/Sheet/Notebook
> external allowlist. Schema-authoring RPCs, files, and specialist surfaces
> remain fail-closed.  
> **Authority:** PC-00 accepted decisions; Core ADRs 0020–0024, 0031, 0036–0038;
> `docs/notebook-api.md` for notebook RPC detail.

Sheetbase is programmable through a **deliberate domain API**, not through
raw PostgreSQL table exposure. The browser session path (`/api/db/*` with
Better Auth cookies) is one client of the same Core operations; it is **not**
the public contract and has **no resource allowlist**. External clients use
scoped credentials (`POST /api/token`) and a **fail-closed allowlist**
(`src/lib/external-token.ts`).

---

## 1. Transport and authentication

| Step | Endpoint | Purpose |
| --- | --- | --- |
| Exchange | `POST /api/token` | `{ credential, scopes }` → `{ token }` |
| Data | `/api/db/*` | Same-origin PostgREST proxy with `Authorization: Bearer <jwt>` |

Credential format, exchange errors, revocation, rate limiting and enforcement
layers are documented in `docs/external-api.md`.

**JWT claims (external):** `workspace_id`, `credential_id`, `scopes`,
`role: 'api_client'`. Default TTL 300s. No capability claims in the token
(ADR 0005); RLS and proxy allowlist enforce access.

**Versioning (planned):** Contract v0.1 uses unversioned `/api/db` paths
matching the browser proxy. A future `/api/v1/…` prefix (API-03) will
introduce explicit version negotiation without breaking v0.1 during a
deprecation window.

---

## 2. Current vs intended implementation

### 2.1 Implemented today (external allowlist)

Verified in `src/lib/external-token.ts` (API-07):

**Project-domain tables (unchanged):**

| Resource | Read scope | Write scope |
| --- | --- | --- |
| `projects` | `projects:read` | `projects:write` |
| `folders` | `projects:read` | `projects:write` |
| `records` | `projects:read` | `projects:write` |
| `blocks` | `projects:read` | `projects:write` |
| `record_links` | `projects:read` | `projects:write` |
| `revisions` | `projects:read` | — (GET only; creation via RPC) |
| `record_field_definitions` | `projects:read` | `projects:write` |

**Core catalogue tables (API-07):**

| Resource | Read scope | Write scope |
| --- | --- | --- |
| `datasets` | `datasets:read` | `datasets:write` (INSERT; mutations use RPCs) |
| `dataset_versions` | `datasets:read` | — |
| `sheet_instances` | `sheets:read` | — (mutations use RPCs) |
| `dataset_schema_definitions` | `schema:read` | — (authoring RPCs stay denied) |
| `dataset_schema_versions` | `schema:read` | — |
| `dataset_schema_version_fields` | `schema:read` | — |
| `sheet_definitions` | `schema:read` | — |
| `sheet_definition_versions` | `schema:read` | — |
| `notebook_templates` | `templates:read` | — |
| `notebook_template_versions` | `templates:read` | — |

**Project-domain RPCs (`projects:write`):**

`create_project`, `create_record`, `create_record_with_blocks`,
`update_block_payload`, `move_block`, `archive_record`, `restore_record`,
`create_record_link`, `insert_block`, `delete_block`,
`transition_record_status`, `instantiate_template`.

**Dataset RPCs:** `query_dataset_rows`, `query_dataset_version_rows`
(`datasets:read`); `validate_dataset_row_batch`, `commit_dataset_row_batch`,
`snapshot_dataset`, `archive_dataset`, `restore_dataset` (`datasets:write`).

**Sheet Instance RPCs:** `query_sheet_instance_rows`,
`read_sheet_instance_calculation_results`,
`resolve_sheet_instance_row_identity`,
`preview_sheet_instance_composition_adoption`,
`preview_sheet_materialization`,
`preview_sheet_instance_definition_upgrade` (`sheets:read`);
`create_sheet_instance`, `create_sheet_instance_from_definition`,
`update_sheet_instance`, `archive_sheet_instance`, `restore_sheet_instance`,
`duplicate_sheet_instance`, `mutate_sheet_instance_local_state`,
`mutate_sheet_instance_calculations`, `insert_sheet_instance_block`,
`duplicate_sheet_instance_block`,
`apply_sheet_instance_composition_adoption`, `materialize_sheet_instance`,
`apply_sheet_instance_definition_upgrade`, `validate_sheet_record_batch`
(`sheets:write`).

**Notebook / model / search:** `search` (`projects:read`);
`search_sheet_records` (`models:read`); `update_record_custom_fields`,
`create_and_link_sheet_record`, `commit_sheet_record_batch` (`models:write`);
`preview_submission_digest`, `run_revision_checks` (`reviews:read`);
`submit_record_revision` (`reviews:write`);
`preview_notebook_template_upgrade` (`templates:read`);
`instantiate_notebook_template_version`,
`apply_notebook_template_upgrade` (`templates:write`).

**Explicit denials:** Unknown tables and RPCs fail closed. Schema-authoring
RPCs (`create_dataset_schema_definition`, Dataset Schema publish/retire,
`create_sheet_definition`, `extract_sheet_definition_draft`, notebook
template authoring) stay denied even with `schema:*` or `sheets:write`.
Removed scientific-table resources stay denied. File RPCs stay denied
(DATA-02).

**Vestigial scopes:** `scientific:read`, `scientific:write`, `scientific:schema`
are **removed**. They are not in `VALID_SCOPES`, cannot be stored, and token
exchange rejects them as `invalid_scope`. See §9.

### 2.2 Remaining public surface

API-07 implemented the Dataset, Sheet Instance, Notebook submit/instantiate
and search operations from this map. Still queued: Sheet Definition and
Dataset Schema **authoring**, notebook template **authoring**, files, and
specialist surfaces.

The product converges on **Core RPCs** the UI already calls. External clients
reach those operations through scoped credentials — not direct table writes
where RPCs exist.

| Domain | Stable identity | Primary operations (RPC-first) |
| --- | --- | --- |
| **Projects** | `project.key`, UUID | `create_project`; table reads |
| **Models / Records** | `{PREFIX}-YYYY-NNNN`, UUID | `create_record`, `create_record_with_blocks`, `create_model_record`, `update_record_custom_fields`, `transition_record_status`, `create_record_link`; registry reads |
| **Notebooks** | record UUID (`kind=experiment`), block order | Block RPCs above; `insert_sheet_instance_block`, `duplicate_sheet_instance_block`; `preview_submission_digest`, `submit_record_revision` |
| **Sheet Definitions** | definition `key`, version UUID | `create_sheet_definition`, draft/version publish/retire RPCs, `extract_sheet_definition_draft`, … |
| **Sheet Instances** | instance UUID, `revision` | `create_sheet_instance`, `create_sheet_instance_from_definition`, `update_sheet_instance`, `query_sheet_instance_rows`, `mutate_sheet_instance_local_state`, composition adoption, definition upgrade, materialize, Record write-back RPCs |
| **Dataset Schemas** | schema definition `key`, version UUID | `create_dataset_schema_definition`, publish/retire/version RPCs (steward) |
| **Datasets / Versions** | dataset UUID, version UUID | `query_dataset_rows`, `commit_dataset_row_batch`, `snapshot_dataset`, … |
| **Notebook Templates** | template `key`, version UUID | `create_notebook_template`, version publish, `instantiate_notebook_template_version`, upgrade preview/apply |
| **Files** | file object UUID, checksum | `finalize_file_upload`; `/api/files/*` (session today; `api_client` queued) |
| **Search** | — | `search`, `search_sheet_records` (read-only) |

Specialist surfaces (calendar, planner, instruments, plate designer, report
builder, analysis studio) are **not** part of the v0.1 public contract.

---

## 3. URL and resource structure

### 3.1 Base URL

Production: `https://app.sheetbase.co.uk`  
Development demo: `https://dev.sheetbase.co.uk`

All data operations: `{base}/api/db/…`  
Token exchange: `{base}/api/token`  
Files (when exposed): `{base}/api/files/…`

External clients **never** call PostgREST directly.

### 3.2 Path shapes

| Kind | Pattern | Example |
| --- | --- | --- |
| Table read/write | `GET\|POST\|PATCH\|DELETE /api/db/{resource}` | `/api/db/projects?select=key,title` |
| RPC | `POST /api/db/rpc/{name}` | `/api/db/rpc/create_record` |

PostgREST query parameters (`select`, `order`, `limit`, `offset`, filters)
apply to table resources. RPC bodies use `p_*` argument names matching
PostgreSQL function signatures.

### 3.3 Domain-oriented grouping (documentation model)

Integrators should think in **resources**, not SQL table names:

```text
Workspace
├── Projects
├── Models (record kinds + field definitions)
│   └── Records (samples, reagents, experiments, …)
├── Notebooks (experiment records + blocks + revisions)
│   └── Sheet Instances (embedded or linked)
├── Sheet Definitions (reusable configuration)
├── Dataset Schema Definitions
├── Datasets (+ immutable Versions)
├── Notebook Templates (+ versions)
└── Files
```

HTTP paths remain PostgREST-shaped for v0.1; OpenAPI (API-03) will publish
friendly resource names mapped to these RPCs.

---

## 4. Stable identity semantics

| Object | Primary id | Human-stable id | Concurrency token |
| --- | --- | --- | --- |
| Project | UUID | `key` (unique per workspace) | row `version` where applicable |
| Record (Model instance) | UUID | `{PREFIX}-YYYY-NNNN` identifier | record metadata version |
| Notebook block | UUID | — | block `version`; record `structure_version` for ordering |
| Sheet Instance | UUID | name (non-unique) | `revision` (integer, monotonic) |
| Sheet Definition | UUID | `key` | definition `revision`; version `revision` |
| Dataset | UUID | name | dataset `revision` |
| Dataset Version | UUID | — | immutable snapshot |
| Dataset Schema Definition | UUID | `key` | definition `revision` |
| Notebook Template | UUID | `key` | template `revision` |
| File object | UUID | — | checksum + storage key |

**Rules:**

- UUIDs are opaque, stable for the lifetime of the object.
- Identifier strings (`EXP-2026-0001`) are assigned by Core RPCs, not client-supplied sequences.
- Definition/template `key` values are unique per workspace; use UUID when ambiguity exists.
- Never use removed `sheet_{base32}` scientific-table resource names in new integrations.

---

## 5. Pagination, filtering and sorting

### 5.1 Table resources (PostgREST)

| Mechanism | Parameters | Notes |
| --- | --- | --- |
| Page size | `limit`, `offset` | Prefer explicit limits; default PostgREST cap applies |
| Sort | `order=column.asc\|desc` | Multi-column: repeat `order` |
| Filter | `{column}=eq.{value}`, `gte`, `lte`, `in`, … | RLS restricts to workspace |
| Column selection | `select=a,b,c` | Reduces payload size |
| Count | `Prefer: count=exact` + `limit=0` | Optional total (where granted) |

### 5.2 RPC data windows

| RPC | Pagination | Filtering |
| --- | --- | --- |
| `query_sheet_instance_rows` | `p_limit` (max 200), `p_offset` | Server-side composition window |
| `query_dataset_rows` | `limit`, `offset` in query JSON | Field filters in query object |
| `search` | `p_limit` (1–100), `p_offset` | `p_kind`, `p_project_id`, date range, … |
| `search_sheet_records` | `p_limit` | `p_model_key`, `p_query` |

**Contract rule:** List endpoints that can return large sets **must** use
bounded windows. Clients iterate with offset/limit or cursor-style paging
(API-04/05 SDKs should expose iterators).

---

## 6. Error contract

### 6.1 Envelope

Proxy and PostgREST failures:

```json
{
  "error": {
    "category": "stale_version",
    "message": "Block version mismatch.",
    "request_id": "01J…"
  }
}
```

Token exchange (`POST /api/token`):

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "Credential lacks scope: projects:write"
  }
}
```

Branch on **`category`** (data path) or **`code`** (exchange path), not on
raw PostgreSQL messages.

### 6.2 Stable categories

| Category | HTTP | Meaning |
| --- | --- | --- |
| `validation_error` | 400 | Bad input, constraint violation |
| `not_found` | 404 | Resource missing or filtered by RLS |
| `permission_denied` | 403 | RLS, scope, or revoked credential |
| `unauthenticated` | 401 | Missing/invalid session or bearer token |
| `stale_version` | 409 | Optimistic concurrency mismatch (SQLSTATE SB001) |
| `conflict` | 409 | Unique violation, serialization failure |
| `missing_link` | 422 | Unresolved record link (SB002) |
| `invalid_transition` | 422 | Disallowed lifecycle transition (SB004) |
| `invalid_properties` | 422 | Configurable property validation failed (SB005) |
| `template_not_instantiable` | 422 | Template wrong lifecycle (SB006) |
| `rate_limited` | 429 | Exchange brute-force lockout |
| `service_unavailable` | 502/503 | PostgREST or upstream down |
| `server_error` | 500 | Unclassified |

Implementation: `src/lib/errors.ts`, `src/lib/postgrest-proxy.ts`.

### 6.3 Rate limits

- **Credential exchange:** 5 failed attempts per prefix / 15 minutes → 15-minute lock (`src/lib/api-credentials.ts`).
- **General API:** Not yet enforced (PLAT-03 backlog). Contract reserves `rate_limited` for future use.

---

## 7. Idempotency and concurrency

### 7.1 Optimistic concurrency

| Surface | Client supplies | Failure category |
| --- | --- | --- |
| Block payload edit | `p_expected_version` | `stale_version` |
| Block move / insert | `p_expected_structure_version` | `stale_version` |
| Sheet Instance mutation | `p_expected_revision` | `stale_version` |
| Definition/version publish | `p_expected_revision` | `stale_version` |
| Dataset row commit | expected dataset `revision` | `stale_version` |

Clients **must** read current version/revision before mutating and retry on
`stale_version` after re-fetching.

### 7.2 Command idempotency

| RPC | Idempotency key | Behaviour |
| --- | --- | --- |
| `submit_record_revision` | `p_idempotency_key` | Same key + same inputs → same revision/submission with `idempotent: true` |
| `commit_dataset_row_batch` | client idempotency key + digest | Stored in `dataset_bulk_commits`; safe retry |

Other RPCs: treat POST as **at-most-once** unless documented otherwise; use
client-generated UUID command ids when adding idempotency in later API work.

### 7.3 Retry guidance

| Condition | Retry? |
| --- | --- |
| `stale_version` | Yes, after re-read |
| `rate_limited` | Yes, with backoff |
| `service_unavailable` | Yes, with exponential backoff |
| `validation_error`, `permission_denied` | No, fix input or credentials |
| `conflict` (unique) | Only if semantics allow deduplication |

---

## 8. Proposed credential scopes (Core-domain)

Retires `scientific:*` as the future model (PC-00 decision). Scopes are
**capabilities on domain operations**, not SQL grants.

### 8.1 Scope vocabulary (target)

| Scope | Grants (when implemented) |
| --- | --- |
| `projects:read` | Read projects, folders, notebook tables, revisions (GET) |
| `projects:write` | Project/notebook/record/block mutations in project domain (current allowlist) |
| `models:read` | Read model field definitions, search records by model |
| `models:write` | Create/update model records, custom fields, lifecycle transitions |
| `datasets:read` | Query datasets, versions, and rows. Does **not** include Dataset Schema catalogues. |
| `datasets:write` | Create datasets, commit rows, snapshot versions. Does **not** include schema stewardship. |
| `schema:read` | Read governed catalogues: Dataset Schema, Sheet Definition, Model fields. |
| `schema:write` | Draft governed schema/configuration edits. Maps to session capability `schema.edit`. |
| `schema:publish` | Publish or retire governed schema/configuration. Maps to `schema.publish` / `schema.retire`. |
| `sheets:read` | Read Sheet Instances and composed rows. Definition catalogues use `schema:read`. |
| `sheets:write` | Instance mutations, write-back, materialize, definition upgrade of an instance (`instance.upgrade`). Does **not** author Sheet Definitions. |
| `templates:read` | Read notebook templates and versions |
| `templates:write` | Author/publish/instantiate/upgrade notebook templates |
| `reviews:read` | Read review submissions, run checks (read-only) |
| `reviews:write` | Submit revisions, sign, amend (workflow actors) |
| `files:read` | Download file objects |
| `files:write` | Upload and finalize files |

**Invariant:** data-editing scopes (`datasets:*`, `sheets:write`, `models:write`)
never grant governed schema/configuration authority. Schema stewardship RPCs
(`create_dataset_schema_definition`, Dataset Schema publish/retire, Sheet
Definition draft/publish, Model field create/update,
`extract_sheet_definition_draft`) require `schema:write` and/or
`schema:publish`, matching CORE-05 `schema.edit` vs `schema.publish`. Do not
collapse those into `datasets:write`.

**Mapping note:** Today's `projects:read` / `projects:write` remain valid
during migration. New scopes subdivide the project domain without implying
scientific-table access. `schema:*` is the future replacement for the
retired `scientific:schema` *idea* (catalogue authority), not a restoration of
scientific-table RPCs.

### 8.2 Allowlist cut-over (API-07)

**Done.** `requiredScopes()` maps Core Dataset/Sheet/Notebook RPCs and
catalogue tables to canonical scopes, with `api_client` EXECUTE grants and
workspace-pinned RLS on those tables (`drizzle/0114_api_07_core_external_allowlist.sql`).

Principles held:

- Fail closed for unknown paths.
- RPC allowlist mirrors product UI capabilities, not every `api.*` function.
- No DELETE on projects for `api_client` (existing Phase 1 rule).
- `schema:*` does not author Dataset Schema Versions in this cut-over.
- `sheets:write` does not author Sheet Definitions.

Write RPCs that require a session `sub` (human actor_user_id) may still fail
at SQL until a later identity epic; the proxy allowlist and EXECUTE grants
are in place.

---

## 9. Compatibility and deprecation

### 9.1 Removed: scientific-table REST

The following are **removed from the product** (Core H4/H5) and **must not**
appear in new integrations:

- Generated resources `sheet_{…}`
- RPCs: `create_scientific_table`, `scientific_table_metadata`,
  `apply_scientific_row_edits`, `add_scientific_column`, `bind_legacy_sheet`, …
- Scopes: `scientific:read`, `scientific:write`, `scientific:schema`

Historical ADR 0019/0020 describe the retired architecture. `docs/external-api.md`
previously documented CLI examples for this surface — that was a documentation
defect (P1-A2).

### 9.2 Removed `scientific:*` scopes

`scientific:read`, `scientific:write`, and `scientific:schema` are **removed**
from the credential vocabulary. Sheetbase is pre-release with no production
credentials: there is no deprecation window and no compatibility exchange path.

Token exchange returns `invalid_scope` if they are requested. The database
CHECK rejects storing them. Historical ADR 0019/0020 remain archival.

### 9.3 Browser-only routes

Not part of the public contract:

- `/api/sheet-calculations`, `/api/formulas`, `/api/calculations`
- `/api/events` (SSE; webhooks are API-06)
- Admin/session routes

### 9.4 Deprecation policy (forward)

Once API-03 publishes versioned docs:

1. Announce deprecated scopes/paths in changelog and `Sunset` header (planned).
2. Minimum 90-day notice for breaking scope renames.
3. Digest-pinned server deploys remain the rollback unit (see `docs/deployment.md`).

---

## 10. Implementation backlog (later API epics)

| Epic | Work |
| --- | --- |
| **API-02** | Workspace service credentials. **Done** (`#47`). |
| **API-07** | Core Dataset/Sheet/Notebook `requiredScopes()` cut-over; `api_client` grants/RLS. **Done**. |
| **API-03** | OpenAPI 3.1 from this contract; error reference; version prefix; pagination examples |
| **API-04** | Python SDK — pagination iterators, pandas, idempotent helpers |
| **API-05** | TypeScript SDK — typed resources, isomorphic fetch |
| **API-06** | Webhooks — signed delivery, retries, event schema (`record.submitted`, `dataset.versioned`, …) |
| **DATA-02/PLAT-01** | `api_client` file access; S3 backend |
| **GOV-01** | `viewer` read-only semantics (affects RLS, not contract shape) |

**Out of API-07:** schema/template **authoring** RPCs, personal tokens, named
service-account principals, credential activity-audit events, OpenAPI.

---

## 11. Related documentation

| Document | Contents |
| --- | --- |
| `docs/external-api.md` | Credential exchange, **current** allowlist, CLI examples |
| `docs/notebook-api.md` | Notebook/block/revision RPC reference |
| `docs/search-api.md` | `search` RPC |
| `docs/authentication.md` | Browser session auth |
| `docs/decisions/0005-postgrest-claim-set-and-proxy.md` | Proxy architecture |
| `docs/core/PRODUCT_CORE.md` | Domain model principles |

---

## 12. Evidence (API-01 audit + API-07)

Audited 17 August 2026 against `main` @ `f2dfa25`; contract v0.1.1
corrects Dataset Schema stewardship out of `datasets:write` into `schema:*`.
API-07 (v0.1.2) cut over the Core external allowlist.

- Allowlist: `src/lib/external-token.ts`
- Scope minting: `src/lib/api-credentials.ts` (`VALID_SCOPES`)
- Fail-closed + Core mapping tests: `src/lib/external-token.test.ts`
- Scope split lock: `src/lib/public-api-contract.test.ts`
- Grants: `drizzle/0114_api_07_core_external_allowlist.sql`
- Integration: `tests/db/external-api.test.ts`, `tests/db/api-credentials.test.ts`
- Proxy errors: `src/lib/errors.ts`, `src/lib/postgrest-proxy.ts`
