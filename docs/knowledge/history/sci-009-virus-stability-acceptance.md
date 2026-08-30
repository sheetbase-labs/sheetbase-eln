# SCI-009 — Virus Stability Notebook End-to-End Acceptance

This document proves that the Virus Stability experiment can be created,
rendered, searched, and inspected through ordinary UI and API capabilities —
not just the demo seed.

## Portal and deep links

The demo seed (`pnpm db:seed:demo`) creates the Virus Stability experiment
with all 13 block types. After seeding, the experiment is reachable at:

| Resource    | URL                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Portal root | `<portal-url>/`                                                                                                        |
| Project     | `<portal-url>/projects/00000000-0000-4000-8000-000000000100`                                                           |
| Notebook    | `<portal-url>/projects/00000000-0000-4000-8000-000000000100/experiments/00000000-0000-4000-8000-000000000101`          |
| Overview    | `<portal-url>/projects/00000000-0000-4000-8000-000000000100/experiments/00000000-0000-4000-8000-000000000101/overview` |
| Search      | `<portal-url>/search`                                                                                                  |

Replace `<portal-url>` with the orb portal URL (e.g.
`https://t-…-p3000.onamp.dev`).

## Demonstration checklist

1. **Sign in** — authenticate via GitHub OAuth (or use a signed session
   cookie in test).
2. **Navigate to the project** — open the Project page and confirm
   "Virus Stability Study" appears.
3. **Open the notebook** — click the experiment "Virus Stability at 4 °C".
   Verify every block type renders:
   - **Rich text** — Objective heading and paragraph
   - **Materials** — LVV-CAR-T drug substance with SMP-2025-0001
   - **Table** — Timepoint / Replicate / Volume / Storage columns with rows
   - **Checklist** — "Data integrity verified" (checked) and
     "Instrument calibration confirmed" (unchecked)
   - **Callout** — NTC warning with warning styling
   - **Metric** — "Titer at day 0" = 2.31 × 10⁷ copies/mL
   - **Protocol reference** — "Titration Assay" with version and status
   - **Procedure steps** — "Prepare a serial dilution…" and
     "Measure the assay response…"
   - **Scientific sheet** — "Stability readings (qPCR)" with columns
     Time (days), Log titer, Condition and data rows
   - **Chart** — "Vector genome copy number (qPCR)" line chart
   - **Plate map** — "qPCR titration plate" 96-well grid
   - **File** — "stability-run07-4c.csv" with media type and size
   - **Linked record** — SMP-2025-0001 sample link
4. **Open the overview tab** — verify sections compose from the notebook:
   Notes, Materials, Procedures, Tables & data, Visualizations, Metrics,
   Files, Linked records, Tasks.
5. **Open search** — search "virus stability" and confirm the experiment
   appears; search "LVV-CAR-T" and confirm the sample appears.
6. **Verify REST representations** (see REST map below).

## REST representation map

Every major visible object has an approachable PostgREST representation
through the authenticated proxy at `/api/db/…`:

| Object                      | REST path                                                                 |
| --------------------------- | ------------------------------------------------------------------------- |
| Experiment record           | `GET /api/db/records?id=eq.00000000-0000-4000-8000-000000000101`          |
| All blocks (ordered)        | `GET /api/db/blocks?record_id=eq.<id>&order=order.asc`                    |
| Record links                | `GET /api/db/record_links?source_record_id=eq.<id>`                       |
| Samples                     | `GET /api/db/records?kind=eq.sample`                                      |
| Reagents                    | `GET /api/db/records?kind=eq.reagent`                                     |
| Protocol templates          | `GET /api/db/records?kind=eq.protocol_template`                           |
| File objects                | `GET /api/db/file_objects?file_record_id=eq.<id>`                         |
| Scientific table metadata   | `POST /api/db/rpc/scientific_table_metadata` body `{"p_table_id":"<id>"}` |
| Scientific table rows       | `GET /api/db/<resource_name>?order=created_at.asc,id.asc`                 |
| Chart blocks                | `GET /api/db/blocks?type=eq.chart&record_id=eq.<id>`                      |
| Plate-map blocks            | `GET /api/db/blocks?type=eq.plate_map&record_id=eq.<id>`                  |
| Notebook/protocol templates | `GET /api/db/records?kind=in.(protocol_template,notebook_template)`       |
| Search                      | `POST /api/db/rpc/search` body `{"q":"virus stability"}`                  |
| Overview                    | Composed client-side from blocks + record_links via `composeSections`     |

All responses are subject to PostgreSQL row-level security. Requests
require an authenticated session cookie; the proxy injects JWT claims
derived from the session.

## End-to-end acceptance tests

### API acceptance test

`tests/api/sci-009-virus-stability.test.ts` (10 tests) creates a **separate**
Virus Stability notebook entirely through ordinary REST —
`handleProxyRequest` calls to PostgREST RPCs and table endpoints — and
verifies:

- All 13 block types are inserted and render via `BlockPreview`
- Protocol pinning via `pin_protocol_reference` creates procedure-step copies
  with revision provenance
- Scientific sheet creation via `create_scientific_table` with typed columns
  and data rows
- Chart (live and frozen) and plate-map blocks
- File upload metadata and file block
- `record_links` to samples, reagents, protocols, and files
- Overview composition via `composeSections`
- Overview exclusion config
- Search retrieves the experiment and permitted linked objects
- REST map assertions for every major object
- Workspace isolation (cross-workspace access is denied)

### Browser acceptance test

`tests/browser/sci-009-virus-stability.test.ts` (3 tests) uses a signed
Better Auth session and Playwright to:

1. Navigate the notebook and verify every block type renders
2. Navigate the overview and verify section composition
3. Navigate search and verify the experiment and linked objects are findable

Screenshots are captured to `.amp/in/artifacts/`:
`sci-009-notebook.png`, `sci-009-overview.png`, `sci-009-search.png`.

## Integration gaps found and fixed

1. **Callout renderer contract mismatch** — `BlockPreview` read `{body, tone}`
   instead of the canonical `{text, variant}`. Fixed to read `text` and style
   by `variant` (`info|warning|note|danger`). Updated demo seed payloads.

2. **Table renderer payload mismatch** — `renderTable` expected column objects
   with `{key, label}` but the canonical table payload uses string arrays
   (validated by `validateTable`). Fixed to handle both the canonical
   string-array format and the legacy object format.

3. **Sheet block missing from BlockPreview** — `BlockPreview` had no
   `case 'sheet':`, so sheet blocks showed "Unsupported payload version" in
   the overview. Added `SheetBlockPreview` — a lightweight read-only
   component that fetches table metadata and rows via the same data client
   the notebook editor uses.

4. **Overview `useMutation` Rules of Hooks violation** — `useMutation` was
   called after conditional early returns in `ExperimentOverviewRoute`,
   causing "Rendered more hooks than during the previous render." Moved the
   hook before all early returns; `mutationFn` now reads fresh data from the
   query cache.

5. **Demo fixture missing `linked_record` block** — Added an idempotent
   linked-record seed step so the Virus Stability notebook exercises all 13
   block types.
