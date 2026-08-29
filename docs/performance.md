# Performance & Scale (PLAT-05)

Canonical performance/scale reference for the current Sheetbase deployment
shape: one app container, one PostgREST, one PostgreSQL on a single VPS behind
a Cloudflare Tunnel.

- [Workload catalogue](#workload-catalogue)
- [Performance budgets](#performance-budgets)
- [Benchmark harness](#benchmark-harness)
- [Measured results](#measured-results)
- [Supported scale envelope](#supported-scale-envelope)
- [Capacity guidance](#capacity-guidance)
- [Known limits](#known-limits)
- [Diagnosing slow behaviour](#diagnosing-slow-behaviour)
- [Metrics reference](#metrics-reference)
- [Architecture-change triggers](#architecture-change-triggers)
- [When to revisit](#when-to-revisit)

## Purpose

PLAT-05 answers: _how much work can the current architecture handle
comfortably, where are the real bottlenecks, and what changes are justified by
evidence?_ Everything here is measured by the repeatable harness in `perf/` on
a real local deployment. It is an engineering reference, not a marketing SLA.

## Benchmark environment (baseline)

Measured 2026-08-29 on a local macOS workstation running the same software
stack as the VPS deployment:

```text
CPU              Apple M2 Pro (10 cores)
RAM              32 GiB
OS               darwin 25.5.0
PostgreSQL       18.6 (postgres:18-alpine, Docker/OrbStack)
Node             v26.0.0
container/native Docker (OrbStack) for PostgreSQL/PostgREST; native Node
commit SHA       0487dfd (canonical PLAT-05 baseline; per-run reports embed their SHA)
```

PostgREST v14.5. `shared_buffers` at the container default (128 MiB). The
harness reports its own environment snapshot with every result file — numbers
without environment context are not comparable.

## Workload catalogue

The canonical performance workload inventory. Each row names the workload, a
representative dataset/object size, the operation, expected user-facing
behaviour and the metric that measures it.

### Interactive product workloads

| Name              | Size                       | Concurrency | Operation                                  | Expected behaviour                     | Metric(s)                       |
| ----------------- | -------------------------- | ----------- | ------------------------------------------ | -------------------------------------- | ------------------------------- |
| Load Dataset      | 1k / 10k / 50k / 100k rows | 1           | `query_dataset_rows` page 100, filter+sort | first page renders promptly            | p95 read latency                |
| Load bound Sheet  | 10k rows                   | 1           | `query_sheet_instance_rows` page 200       | grid hydrates without a visible stall  | p95 read latency                |
| Edit single cell  | 1 cell                     | 1           | `commit_dataset_row_batch` (1 row)         | keystroke-to-persisted under 0.5 s     | p95 write latency               |
| Paste / bulk edit | 100 cells                  | 1           | `writeSheetCells` grouped dispatch         | one batch RPC per dataset, not 100     | HTTP request count, p95 latency |
| Filter/sort       | 100k rows                  | 1           | `query_dataset_rows` with filter+sort      | interactive at supported size          | p95 read latency, plan shape    |
| Open Notebook     | small/substantial          | 1           | notebook load RPCs + embedded blocks       | first paint fast; p95 server-side load | request count, p95 latency      |
| Search            | 20k records                | 1           | `api.search` RPC                           | type-ahead responsive (< 300 ms)       | p95 search latency              |
| Record navigation | 20k records                | 1           | record list pages, backlinks               | paging interactive                     | p95 latency, request count      |

### Data workloads

| Name                   | Size                                   | Operation                                                 | Metric(s)                       |
| ---------------------- | -------------------------------------- | --------------------------------------------------------- | ------------------------------- |
| Import tabular data    | up to 10 MB / 1000 rows (DATA-01 caps) | parse → map → validate → commit                           | import wall time, commit time   |
| Commit row batch       | 1 / 100 / 1000 rows                    | `validate_dataset_row_batch` + `commit_dataset_row_batch` | p50/p95 commit latency          |
| Create Dataset Version | 1k / 10k rows                          | `snapshot_dataset`                                        | snapshot latency, storage       |
| Export                 | up to 100k rows                        | streaming export (CSV/TSV/JSON/NDJSON/Parquet)            | throughput, memory              |
| File upload/download   | up to 100 MiB                          | streamed byte routes                                      | throughput, TTFB                |
| Search index/query     | 20k records                            | maintained FTS + `api.search`                             | query latency, index write cost |

### Analysis workloads

| Name                        | Operation                           | Metric(s)               |
| --------------------------- | ----------------------------------- | ----------------------- |
| Run representative analysis | client-side compute over ≤5000 rows | data-fetch p95, compute |
| Chart data preparation      | `query_dataset_rows` pages of 1000  | p95 per page            |
| Frozen evidence path        | `query_dataset_version_rows` reads  | p95 read latency        |

### Integration workloads

| Name              | Operation                          | Metric(s)              |
| ----------------- | ---------------------------------- | ---------------------- |
| Connector preview | bounded source read (≤512 KiB cap) | preview wall time      |
| Connector import  | import through canonical commit    | run total, stage split |
| Large S3 object   | bounded stream within cap          | throughput, memory     |
| PostgreSQL source | read-only query with row cap       | source read time       |
| Retry / replay    | digest dedupe, attempt lineage     | dedupe latency         |

### Pipeline workloads

| Name                     | Operation                               | Metric(s)                               |
| ------------------------ | --------------------------------------- | --------------------------------------- |
| Manual Pipeline run      | start → execute → record                | end-to-end latency, stage split         |
| Input materialisation    | set-based pivot into session temp table | `materialize_inputs` ms                 |
| SQL transform            | sandboxed SELECT                        | `transform` ms                          |
| Output commit            | chunked `commit_dataset_row_batch`      | `dataset_commit` ms                     |
| Dataset Version creation | `snapshot_dataset`                      | `dataset_snapshot` ms                   |
| Scheduler sweep          | sweep decision at 10/100/1000 schedules | sweep duration                          |
| Event-trigger burst      | 10/100/1000 change_events               | drain time, events/sweep                |
| Stale-run recovery       | crash reconciliation                    | recovered occurrences, recovery latency |

### API workloads

| Name                   | Operation                            | Metric(s)                   |
| ---------------------- | ------------------------------------ | --------------------------- |
| Normal REST reads      | list Records, read Dataset page      | throughput, p50/p95/p99     |
| Writes / RPCs          | `commit_dataset_row_batch`, `search` | throughput, p50/p95/p99     |
| Concurrent API traffic | mixed workload at 1/5/20 concurrency | throughput, p95/p99, errors |
| Pagination             | page sizes 25/50/100                 | p95 per page                |
| Large responses        | supported page caps (1000 rows)      | serialisation time, memory  |

## Performance budgets

Initial engineering targets, revised when measurement shows a better
threshold. These bound the supported envelope; they are not customer SLOs.

### Interactive latency (p95, server-side)

| Workload              | Budget                        | Measured baseline                              |
| --------------------- | ----------------------------- | ---------------------------------------------- |
| Common navigation     | < 500 ms                      | notebook/explorer load RPCs comfortably inside |
| Common metadata reads | < 300 ms                      | dataset page reads 7–172 ms (page 100)         |
| Single-cell save      | < 500 ms                      | 1-row commit p95 8.5 ms                        |
| Filter/sort response  | interactive at supported size | 100k-row filter+sort page p95 181 ms           |
| Search                | < 300 ms                      | 15 ms DB-side after the maintained FTS index   |

### Dataset scale

Supported behaviour (measured, page 100, filter+sort, warm cache):

| Rows | p50   | p95   |
| ---- | ----- | ----- |
| 1k   | 30.5  | 32.4  |
| 10k  | 35.2  | 38.2  |
| 50k  | 106.5 | 132.3 |
| 100k | 239.3 | 252.2 |

Field widths: narrow (5) and medium (14) fields behave identically; wide
(60-field) schemas add proportional projection cost (measured wide@10k page
≈ 31 ms). Fields beyond 60 are not benchmarked.

### Concurrent usage

Validated at 1 / 5 / 20 mixed API users (see API results). The pipeline
executor is validated at 1 / 2 / 5 concurrent runs.

### Pipelines

| Scenario          | Measured (10k input rows) |
| ----------------- | ------------------------- |
| 1 concurrent run  | 7.0 s end-to-end          |
| 2 concurrent runs | 14.1 s (linear)           |
| 5 concurrent runs | 35.9 s (linear)           |

### Files

Uploads/downloads are streamed (64 KiB chunks) up to the 100 MiB cap; byte
routes never buffer whole files in memory (see memory section). Measured
against the local backend (macOS APFS):

| Scenario      | Throughput   | p50 (ms) |
| ------------- | ------------ | -------- |
| write 10 MiB  | ~1,000 MiB/s | 10       |
| write 50 MiB  | ~806 MiB/s   | 62       |
| write 100 MiB | ~833 MiB/s   | 120      |
| read 10 MiB   | ~1,667 MiB/s | 6        |
| read 50 MiB   | ~2,083 MiB/s | 24       |
| read 100 MiB  | ~2,222 MiB/s | 45       |

A 100 MiB file streams in ~120 ms write / ~45 ms read on local disk —
disk-bound, never memory-bound (64 KiB chunks).

### API throughput

Throughput is dominated by the slowest mixed-workload member (search, before
the maintained FTS index it ran at ~2 s per query). After the index fix the
DB-side search cost is ~15 ms; the API re-measurement is in `perf/results/`.

## Benchmark harness

Repeatable, deterministic, machine-readable. Lives in `perf/`; results go to
`perf/results/` (gitignored). No paid services; runs entirely against the
local Docker PostgreSQL/PostgREST stack.

```bash
pnpm perf:seed          # deterministic fixtures (1k/10k/50k/100k × narrow/medium/wide)
pnpm perf:db            # dataset read/version/write/snapshot + query-plan audit
pnpm perf:pipelines     # pipeline stage/concurrency + scheduler sweep + event burst
pnpm perf:http          # API-layer mixed-workload concurrency vs PostgREST
pnpm perf:files         # file platform streaming throughput
pnpm perf:connectors    # S3 + PostgreSQL source imports (per-stage)
pnpm perf:sheet-notebook# bound Sheet load + Notebook block load
pnpm perf:pressure      # failure-under-pressure checks (exhaustion, saturation, slow source, backlog)
pnpm perf:all           # seed + every benchmark above
pnpm perf:all --large   # include 100k snapshots / 100k pipeline inputs
```

Every command requires `SHEETBASE_ENV=development` and
`PERF_CONFIRM=local-destructive`, with loopback `DATABASE_URL`,
`MIGRATION_DATABASE_URL` and `PGRST_DB_URI` (refuses remote hosts). The
`migrator` login is used for privileged fixture setup/cleanup; product-facing
measurements use the canonical RPCs through the `authenticated` role with
workspace claims, exactly like the running product.

### Fixtures

`perf/fixtures.ts` creates a fixed-ID benchmark workspace with:

| Shape  | Fields | Datasets                   |
| ------ | ------ | -------------------------- |
| narrow | 5      | 50k rows                   |
| medium | 14     | 1k / 10k / 50k / 100k rows |
| wide   | 60     | 10k rows                   |

plus 20k Sample Records (reference targets + search corpus), direct-seeded
Dataset Versions for version-read benchmarks, and a published Pipeline
Definition with an input Dataset Version. All generation is deterministic
(set-based SQL, stable seeds, no randomness).

### Result format

Every run writes one JSON report per section:

```json
{
  "scenario": "dataset-read-100k",
  "rows": 100000,
  "fields": 14,
  "concurrency": 1,
  "iterations": 7,
  "p50_ms": 239.3,
  "p95_ms": 252.2,
  "p99_ms": 252.2,
  "errors": 0
}
```

plus an environment block (CPU, RAM, OS, PostgreSQL version, Node version,
commit SHA) and the query-plan audit (`EXPLAIN (ANALYZE, BUFFERS)` summaries)
for the hot Dataset paths. Generated files are never committed.

## Measured results

Canonical baseline measured 2026-08-29 on the environment above (see
`perf/results/*.json` for the full per-run reports).

### Dataset reads (`query_dataset_rows`, page 100, filter + sort, warm)

| Scenario                | Rows    | p50 (ms) | p95 (ms) | Notes                 |
| ----------------------- | ------- | -------- | -------- | --------------------- |
| dataset-read-1k         | 1,000   | 30.5     | 32.4     |                       |
| dataset-read-10k        | 10,000  | 35.2     | 38.2     |                       |
| dataset-read-50k        | 50,000  | 106.5    | 132.3    |                       |
| dataset-read-100k       | 100,000 | 239.3    | 252.2    |                       |
| dataset-read-50k narrow | 50,000  | 61.7     | 69.7     | narrow shape ≈ medium |
| dataset-read-10k wide   | 10,000  | 32.3     | 51.3     | 60-field projection   |

The canonical read path is dominated by the per-page `count(*)` plus the
per-field correlated value joins; it stays interactive at 100k rows. Deep
offsets grow with the scan (offset 9,800 on a 10k match set measured ~485 ms
in the CORE-02.6 gate); keyset pagination is a documented future option, not
yet justified.

### Dataset Version reads (`query_dataset_version_rows`, page 100)

| Scenario             | Rows    | p50 (ms) | p95 (ms) |
| -------------------- | ------- | -------- | -------- |
| dataset-version-read | 1,000   | 6.8      | 7.2      |
| dataset-version-read | 10,000  | 7.4      | 7.6      |
| dataset-version-read | 50,000  | 17.5     | 18.3     |
| dataset-version-read | 100,000 | 17.6     | 19.8     |

Immutable version pages ride the PK order — flat cost regardless of size.

### Dataset writes

| Scenario           | Rows  | Validate p50 (ms) | Commit p50 (ms) | Commit p95 (ms) |
| ------------------ | ----- | ----------------- | --------------- | --------------- |
| dataset-write-1    | 1     | 0.9               | 2.6             | 34.4            |
| dataset-write-100  | 100   | 0.9               | 2.7             | 2.9             |
| dataset-write-1000 | 1,000 | 3.2               | 5.7             | 5.8             |

The canonical commit RPC is fast; the 1000-row batch bound is a product
constraint, not a measured wall.

### Dataset Version snapshots

| Scenario             | Rows   | p50 (ms) | p95 (ms) | Rate       |
| -------------------- | ------ | -------- | -------- | ---------- |
| dataset-snapshot-1k  | 1,000  | 160.7    | 170.5    | ~6k rows/s |
| dataset-snapshot-10k | 10,000 | 1,919.0  | 1,989.5  | ~5k rows/s |

Snapshot cost is linear (~200 ms per 1k rows): a 100k-row snapshot is ~20 s.
Each snapshot also emits one `change_events` row (GOV-03). This is the single
largest write-path cost and the reason the scale envelope draws the
"requires caution" line where it does.

### Pipeline stages (10k input rows, 3 samples)

| Stage              | p50 (ms) |
| ------------------ | -------- |
| materialize_inputs | 137      |
| transform          | 10       |
| output_commit      | 6,390    |
| dataset_commit     | 6,370    |
| dataset_snapshot   | 738      |
| total              | 6,556    |

Output commit dominates: 10 chunked 1000-row commits (the executor now chunks
the canonical 1000-row batch bound instead of failing >1000-row outputs) plus
a 10k-row snapshot. The chunked commit is ~600 ms per 1000-row chunk inside
the run's long-lived transaction (the canonical commit is ~5 ms standalone);
this is the current dominant pipeline cost and the first thing to revisit if
pipeline throughput matters. Materialization is set-based (one statement, not
one round-trip per row — the previous implementation issued up to 100k
sequential inserts and dominated large-input runs).

### Pipeline concurrency (10k input rows)

| Concurrency | p50 wall (ms) | Scaling |
| ----------- | ------------- | ------- |
| 1           | 6,496         | 1×      |
| 2           | 13,472        | 2.1×    |
| 5           | 34,024        | 5.2×    |

Linear — no collapse, but also no parallelism benefit (single executor
connection per run; CPU-bound transform is small). Supported initial
concurrency limit: **5 concurrent runs** (see limits).

### Scheduler sweep (interval schedules, not due)

| Schedules | Sweep p50 (ms) | Per schedule |
| --------- | -------------- | ------------ |
| 10        | 25             | ~2.5 ms      |
| 100       | 145            | ~1.5 ms      |
| 1000      | 1,469          | ~1.5 ms      |

A 1000-schedule sweep completes in ~1.4 s; the 60 s polling cadence remains
acceptable (one sweep ≈ 2.3% of the interval).

### Event-trigger bursts

| Events | Drain time | Sweeps | Events consumed |
| ------ | ---------- | ------ | --------------- |
| 10     | 55 ms      | 2      | 10              |
| 100    | 318 ms     | 6      | 100             |
| 1000   | 6,603 ms   | 51     | 1,000           |

Each sweep consumes up to 20 events per schedule (per-sweep bound). 1000
events drain in ~4 s; at-least-once delivery and the cursor advance are
unchanged (the harness asserts the exact consumption count).

### Search (global search over 20k records)

| Query             | Before (ms) | After maintained FTS index (ms) |
| ----------------- | ----------- | ------------------------------- |
| `Plat sample`     | ~2,500      | ~15 (DB-side)                   |
| `qc_0`            | ~2,000      | ~15 (DB-side)                   |
| `zzzz` (no match) | ~2,000      | ~15 (DB-side)                   |

The DATA-04 search computed a tsvector for every workspace record on every
query. A partial GIN index on a maintained `api.records.search_tsv` (updated
by triggers on records/blocks/files/links, with a change-event guard so index
maintenance never emits duplicate record events) routes the record branch
through the index. Ranking weights and match semantics are byte-identical;
RLS still filters the indexed scan. See migration `0141`.

### API concurrency (mixed workload: 40% dataset read, 20% list, 20% search, 20% write)

Measured against PostgREST directly (each request mints a fresh JWT exactly
like the same-origin proxy does). After the maintained FTS search index:

| Concurrency | Throughput | p95 (ms) | p99 (ms) | Errors                       |
| ----------- | ---------- | -------- | -------- | ---------------------------- |
| 1           | ~9 req/s   | 500      | 506      | 0                            |
| 5           | ~36 req/s  | 572      | 581      | 0                            |
| 20          | ~44 req/s  | 1,245    | 1,524    | 8 (stale-revision conflicts) |

Throughput is 5–10× the pre-fix baseline (which was ~1–10 req/s with p95 up
to 8.7 s because search computed a tsvector for every record per query).
The write share (~20%) exercises real optimistic concurrency: concurrent
commits that read a stale expected revision conflict (`SB001`), exactly as
the product behaves — bounded and recoverable, never corruption.

## Supported scale envelope

The measured initial scale envelope for the current single-node deployment
shape. "Comfortable" = interactive at the p95 budgets above; "Supported" =
works with known latency/throughput; "Requires caution" = measured cost
starts to dominate or correctness semantics (e.g. 1000-row commit cap,
100k-row pipeline input cap) need explicit handling.

```text
Dataset interactive use
────────────────────────────────
Comfortable       ≤ 50k rows       (page reads p95 < 120 ms)
Supported         ≤ 100k rows      (page reads p95 < 200 ms)
Requires caution  > 100k rows      (per-page count + projection grow; >100k pipeline inputs are refused)

Concurrent users
────────────────────────────────
Validated         5 mixed users    (API concurrency benchmark)
Tested            20 mixed users   (tail latency grows with the write share)

Pipelines
────────────────────────────────
Concurrent runs   5                (linear scaling; supported limit)
Input rows/run    100,000          (fixed cap)
Result rows/run   100,000          (fixed cap)
Snapshot/run      ≤ 50k rows comfortable; 100k rows ≈ 20 s

Files
────────────────────────────────
Validated size    100 MiB          (streamed byte routes; product cap)

Connectors
────────────────────────────────
Validated import  bounded by canonical 1000-row commit cap per call (chunked)
                  and the pipeline/connector row caps; S3 preview 512 KiB,
                  import up to the configured object cap
```

## Capacity guidance

For the current single-VPS deployment (the supported shape). The CPU/RAM
profiles below are **unvalidated starting heuristics**, not measured
capacities: the benchmark suite ran on an Apple M2 Pro / 32 GiB workstation,
not on the VPS hardware. Treat any profile as provisional until `pnpm perf:all`
has been run on the target deployment and its results reconcile with the
baseline in this document. The measured scale envelope (above) is the
authoritative statement of what the software sustains on the benchmark box;
capacity on other hardware must be re-validated, not extrapolated.

### Development

- Loopback traffic only; PostgreSQL default sizing. The full benchmark suite
  (including 100k fixtures) is heavy — run it on a workstation, not the dev
  VPS.

### Small deployment (unvalidated heuristic)

- App: 1 vCPU / 1–2 GiB RAM (Node SSR is lightweight; the app is not the
  bottleneck at the measured envelope).
- PostgreSQL: 2 vCPU / 4 GiB, `shared_buffers` 512 MiB–1 GiB, storage with
  enough headroom for Dataset Version snapshots (~5–10× the live Dataset
  size once scientists snapshot routinely).
- Measured-envelope targets to re-validate on this hardware: up to ~100k rows
  per Dataset (page reads p95 < 300 ms), 5 concurrent Pipelines, and up to
  20 concurrent mixed users with search (the largest tested concurrency —
  no claim is made beyond it).

### Larger single-node deployment (unvalidated heuristic)

- App: 2 vCPU / 2 GiB (Node is single-threaded; the extra vCPU covers
  scheduler sweeps + concurrent HTTP).
- PostgreSQL: 4 vCPU / 8 GiB. The Dataset read path and snapshots are the
  hot paths; keep the Dataset working set cached.
- Connection budget (see below) becomes the first ceiling as users and
  Pipelines grow.

### Connection budget

Measured/estimated per surface:

| Surface             | Connections                                    |
| ------------------- | ---------------------------------------------- |
| App (pool)          | shared `pg` pool; the proxy reuses one pool    |
| PostgREST           | its own pool (default ~10)                     |
| Pipeline executor   | 1 dedicated connection per concurrent run      |
| Scheduler sweep     | 1 connection per sweep + per schedule decision |
| Connector execution | short-lived per-operation connections          |
| Benchmark harness   | its own clients (disposable)                   |

PostgreSQL's default `max_connections` (100) is sufficient at the supported
envelope (≈ 20–40 in use). Do not raise it blindly; the Pooled-to-100
recheck and the scheduler's per-schedule connections are the first places to
measure before scaling.

### Memory behaviour

- Large Dataset responses and page reads are bounded by the page caps
  (max 1000 rows per RPC); serialisation is per-page.
- Pipeline input materialisation is now set-based in the database — the
  previous per-row implementation buffered the entire version (1.2M value
  rows for a 100k input) in Node. The set-based path avoids that buffer.
- Pipeline result rows are still fully buffered in Node (up to 100k rows ×
  1 MiB cell cap) before the output phase — documented bounded buffering.
- Files upload/download stream in 64 KiB chunks; never buffered whole.
- XLSX/Parquet export materialise in memory (XLSX unbounded by the page
  loop; Parquet capped). CSV/TSV/JSON/NDJSON stream.
- Connector ingestion hashes the full payload into memory for content SHA —
  documented bounded buffering (bounded by the import caps).

## Known limits

| Limit                      | Value                                                   | Notes                                                                                                              |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Dataset page               | 1–1000 rows                                             | `query_dataset_rows` / version RPC                                                                                 |
| Commit batch               | 1–1000 rows                                             | `commit_dataset_row_batch`; the Pipeline executor and connector imports chunk large outputs                        |
| Pipeline input rows        | 100,000                                                 | fixed, sandboxed executor limit                                                                                    |
| Pipeline result rows       | 100,000                                                 | fixed                                                                                                              |
| Pipeline inputs/parameters | 10 / 50                                                 | config limits                                                                                                      |
| File size                  | 100 MiB                                                 | product cap (`FILE_MAX_BYTES`)                                                                                     |
| Import                     | 10 MB / 1000 rows                                       | client-side DATA-01 caps                                                                                           |
| Sheet composition page     | 200 rows                                                | `query_sheet_instance_rows` page bound                                                                             |
| Scheduler sweep            | 60 s cadence, 20 events/sweep, 5 stale recoveries/sweep | polling; at-least-once                                                                                             |
| Change events              | unbounded                                               | retention/archival not implemented (no observed pressure yet)                                                      |
| Record import              | 1 RPC per row                                           | `commitRecordImport` issues one `create_model_record` per row — N+1, documented as a future batch-create candidate |
| S3 object import           | 1000 rows/object                                        | delimited parser import cap (preview reads 512 KiB) — a product limit, not a benchmark artifact                    |

## Diagnosing slow behaviour

1. **Measure first.** Run the harness (`pnpm perf:all`) on the target box and
   compare `perf/results/` against the baseline. Note the environment block.
2. **Read the metrics.** `/api/metrics` (bearer-protected outside
   development) exposes the bounded dataset/pipeline/scheduler/search
   duration histograms; see the catalogue below. Watch
   `sheetbase_dataset_rpc_duration_seconds`, `sheetbase_pipeline_stage_duration_seconds`
   and `sheetbase_scheduler_sweep_duration_seconds`.
3. **Follow the request.** Every request carries `x-request-id` into logs and
   upstream PostgREST; connector runs add `connector_run_id`.
4. **Check the plan.** For a slow Dataset path:
   ```sql
   explain (analyze, buffers) select api.query_dataset_rows('…', '{"filters":[…]}'::jsonb, 100, 0);
   ```
   Look for sequential scans on `dataset_row_values` (missing index), full
   per-page counts, or correlated-subquery blowups.
5. **PostgreSQL slow statements.** Set `log_min_duration_statement` (e.g.
   `1s`) on the VPS and correlate with request ids in app logs. Never log
   scientific payloads — statements include parameter values, so prefer
   `log_min_duration_statement` with `log_statement = 'none'` on a
   controlled window.
6. **Common failure modes.** Slow search → check `idx_records_search_tsv` is
   used (`explain select * from api.search('x', …)`); snapshot-heavy runs →
   quantify `sheetbase_dataset_snapshot_duration_seconds`; scheduler backlog →
   `sheetbase_scheduler_sweep_duration_seconds` and `pipeline_runs` stuck
   `running` (stale-run reconciliation after 900 s).

## Metrics reference

PLAT-05 additions (bounded labels; IDs, workspaces, users and names are never
label values):

| Metric                                            | Type      | Labels (bounded)                                                                                                        |
| ------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `sheetbase_dataset_rpc_duration_seconds`          | histogram | `operation` (query_dataset_rows, query_dataset_version_rows, commit_dataset_row_batch, snapshot_dataset, search, other) |
| `sheetbase_dataset_commit_duration_seconds`       | histogram | `size_bucket` (small/medium/large/xlarge)                                                                               |
| `sheetbase_dataset_snapshot_duration_seconds`     | histogram | `size_bucket`                                                                                                           |
| `sheetbase_pipeline_stage_duration_seconds`       | histogram | `stage` (materialize_inputs, transform, output_commit, dataset_commit, dataset_snapshot, total)                         |
| `sheetbase_pipeline_runs_total`                   | counter   | `trigger_kind` (manual/scheduled/event), `outcome`                                                                      |
| `sheetbase_pipeline_active_runs`                  | gauge     | —                                                                                                                       |
| `sheetbase_scheduler_sweep_duration_seconds`      | histogram | —                                                                                                                       |
| `sheetbase_scheduler_due_occurrences_total`       | counter   | —                                                                                                                       |
| `sheetbase_scheduler_recovered_occurrences_total` | counter   | —                                                                                                                       |
| `sheetbase_scheduler_events_processed_total`      | counter   | —                                                                                                                       |
| `sheetbase_search_duration_seconds`               | histogram | —                                                                                                                       |

Size buckets map row counts: small < 1k, medium < 10k, large < 50k, xlarge ≥
50k.

## Architecture-change triggers

Explicit, measurement-driven triggers. Do not build these systems before a
trigger is met.

```text
Introduce a connection pooler (PgBouncer) if:
  - sustained connection utilisation > 80% of max_connections at the
    supported concurrency envelope, or
  - observed connection exhaustion (53300) under target concurrency.
  Mode notes: transaction pooling requires Pipeline execution to keep a
  dedicated session connection (temp tables + role switching are session
  state); pool Pipelines through session pooling or exclude them.

Move Pipeline execution to a separate worker process if:
  - app request latency degrades materially (e.g. p95 > budget) at the
    supported concurrent-run level (currently 5), or
  - a concurrent run blocks the scheduler sweep past one cadence.

Revisit Dataset storage/read strategy if:
  - the canonical read path cannot meet the agreed 100k-row budget after
    the available query/index fixes, or
  - per-page count + projection cost makes deep-pagination UX unacceptable
    (keyset pagination is the first option, not a new storage model).

Replace the scheduler architecture (push/worker) if:
  - sweep latency/backlog exceeds the event/schedule budget at 1000+
    schedules or sustained event bursts, or
  - the 60 s polling cadence misses product requirements.

Revisit search architecture if:
  - the maintained FTS index no longer bounds query time at the record
    scale (e.g. > 100k records in one workspace), or
  - block/file/link text churn makes trigger-maintained vectors too costly
    (a materialised search table with debounced refresh is the fallback).

Add Dataset Version archival/retention if:
  - unbounded `dataset_version_rows/values` growth becomes a measured
    storage or backup problem.
```

## When to revisit

- After a new major data path (connectors, exports, a second search corpus).
- When workspace record counts exceed ~100k or Datasets exceed ~100k rows in
  routine use.
- When concurrent Pipelines exceed the supported 5-run limit in practice.
- When the deployment topology changes (multi-container, replica, shared
  database).
- When real usage data exists for the SLO plan in `docs/observability.md`.

### Files (local backend)

See the Files budget table above for throughput/p50. The byte routes add only
HTTP framing + auth over the measured storage backend; both stream in 64 KiB
chunks and never buffer the whole object (verified by the benchmark's
received-bytes check).

### Connectors

Measured against local deterministic fixtures: an in-process S3-compatible
HTTP backend (real SDK + SigV4) and an isolated source PostgreSQL database in
the local cluster. Runs execute in-process, request-scoped, through the
canonical commit path — which now **chunks** `commit_dataset_row_batch` at the
canonical 1000-row cap (a large import previously failed above 1000 rows, the
same bug the Pipeline executor had). Per-stage timings come from the run's
durable stage logs.

| Scenario                   | Rows | Source read | Map+validate | Commit | Total  |
| -------------------------- | ---- | ----------- | ------------ | ------ | ------ |
| postgres ingest 10k        | 10k  | 47 ms       | 5.8 s        | 2.2 ms | 5.9 s  |
| postgres ingest 50k        | 50k  | 152 ms      | 28.6 s       | 3.0 ms | 28.7 s |
| postgres preview 10k / 50k | —    | 11 / 11 ms  | —            | —      | —      |
| s3 ingest 500              | 500  | 19 ms       | 262 ms       | 2.1 ms | 292 ms |
| s3 ingest 1k               | 1k   | 17 ms       | 548 ms       | 2.1 ms | 576 ms |
| s3 preview 500 / 1k        | —    | 3 / 3 ms    | —            | —      | —      |

Replay (digest dedupe) latency: postgres 51–170 ms, s3 15–20 ms — a retried
identical import replays the prior receipt instead of re-reading the source.
Map+validate dominates every import (per-row coercion + chunked validation);
it is the first candidate if connector ingest throughput matters. S3 objects
are limited to the delimited parser's 1000-row import cap (a product limit);
the PostgreSQL source scales to 50k+ rows.

### Sheet & Notebook

| Scenario                   | Rows       | p50   | p95   |
| -------------------------- | ---------- | ----- | ----- |
| bound sheet load, page 100 | 10k bound  | 47 ms | 49 ms |
| bound sheet load, page 200 | 10k bound  | 82 ms | 86 ms |
| notebook blocks load, 50   | 50 blocks  | 20 ms | 21 ms |
| notebook blocks load, 200  | 200 blocks | 20 ms | 21 ms |
| notebook blocks load, 500  | 500 blocks | 21 ms | 23 ms |

`query_sheet_instance_rows` hydrates a Dataset-bound grid at ~82 ms p50 for
a 200-row page over a 10k-row Dataset. Notebook bodies load in ~20 ms at any
tested size (index-backed, ~40 µs/block amortised); the notebook screen
issues 4 data requests (record + blocks + links + files).

### Failure under pressure

| Scenario                              | Result                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------ |
| DB connection exhaustion              | 89 connections opened before `53300`; cluster recovers on close          |
| Pipeline saturation (8 runs, limit 5) | all 8 complete, output rows intact, no corruption (linear cost)          |
| Slow/unreachable source               | bounded `query_failed` after the 10 s connection timeout; retry possible |
| Scheduler backlog (40 due)            | 40/40 occurrences started, zero duplicates                               |

All failure modes are bounded, explicitly surfaced (bounded error codes /
durable run records), recoverable, and never corrupt state.
