# Performance & Scale (PLAT-05)

This document is the canonical performance and scale reference for the current
Sheetbase deployment. The deployment shape is one app container, one PostgREST
instance, and one PostgreSQL database on a single VPS behind a Cloudflare Tunnel.

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

PLAT-05 answers three questions: _How much work can the current architecture
handle? Where are the bottlenecks? Which changes does the evidence justify?_
The repeatable harness in `perf/` measures everything here on a real local
deployment. This document is an engineering reference. It is not a marketing SLA.

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
commit SHA       85270d9 (canonical PLAT-05 baseline; per-run reports embed their SHA)
```

PostgREST is v14.5. `shared_buffers` uses the container default (128 MiB).
The harness writes an environment snapshot with every result file. Numbers
without environment context are not comparable.

## Workload catalogue

This section is the canonical workload inventory. Each row names the workload,
a representative size, the operation, the expected user-facing behaviour, and
the metric that measures it.

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

These targets are initial engineering goals. Revise a target when measurement
shows a better threshold. The targets bound the supported envelope. They are
not customer SLOs.

### Interactive latency (p95, server-side)

| Workload              | Budget                        | Measured baseline                                |
| --------------------- | ----------------------------- | ------------------------------------------------ |
| Common navigation     | < 500 ms                      | notebook and explorer load RPCs are inside       |
| Common metadata reads | < 300 ms                      | dataset page reads 8–237 ms (page 100)           |
| Single-cell save      | < 500 ms                      | 1-row commit p95 38.6 ms                         |
| Filter/sort response  | interactive at supported size | 100k-row filter+sort page p95 237 ms             |
| Search                | < 300 ms                      | 15 ms DB-side after the maintained FTS index     |

### Dataset scale

Supported behaviour (measured, page 100, filter+sort, warm cache):

| Rows | p50   | p95   |
| ---- | ----- | ----- |
| 1k   | 7.9   | 10.0  |
| 10k  | 39.3  | 41.5  |
| 50k  | 116.2 | 137.4 |
| 100k | 235.8 | 236.9 |

Field widths: narrow (5 fields) and medium (14 fields) schemas behave
identically. Wide (60-field) schemas add proportional projection cost; the
measured wide@10k page is about 34 ms. Fields beyond 60 are not benchmarked.

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

The byte routes stream uploads and downloads in 64 KiB chunks up to the
100 MiB cap. The routes never buffer a whole file in memory (see
[Memory behaviour](#memory-behaviour)). Measurements use the local backend
(macOS APFS):

| Scenario      | Throughput   | p50 (ms) |
| ------------- | ------------ | -------- |
| write 10 MiB  | ~1,667 MiB/s | 6        |
| write 50 MiB  | ~980 MiB/s   | 51       |
| write 100 MiB | ~813 MiB/s   | 123      |
| read 10 MiB   | ~1,250 MiB/s | 8        |
| read 50 MiB   | ~2,174 MiB/s | 23       |
| read 100 MiB  | ~2,000 MiB/s | 50       |

A 100 MiB file streams in about 123 ms for write and about 50 ms for read on
local disk. The path is disk-bound, not memory-bound (64 KiB chunks).

### API throughput

Search dominates the mixed-workload throughput because it is the slowest
member. Before the maintained FTS index, search took about 2 s per query.
After the index fix, the DB-side search cost is about 15 ms. The re-measured
API results are in `perf/results/`.

## Benchmark harness

The harness is repeatable, deterministic, and machine-readable. It lives in
`perf/`, and it writes results to `perf/results/` (gitignored). It uses no
paid services and runs entirely against the local Docker
PostgreSQL/PostgREST stack.

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
`PERF_CONFIRM=local-destructive`. The `DATABASE_URL`, `MIGRATION_DATABASE_URL`,
and `PGRST_DB_URI` values must be loopback addresses; the harness refuses
remote hosts. The `migrator` login runs privileged fixture setup and cleanup.
Product-facing measurements use the canonical RPCs through the
`authenticated` role with workspace claims, exactly like the running product.

### Fixtures

`perf/fixtures.ts` creates a fixed-ID benchmark workspace with:

| Shape  | Fields | Datasets                   |
| ------ | ------ | -------------------------- |
| narrow | 5      | 50k rows                   |
| medium | 14     | 1k / 10k / 50k / 100k rows |
| wide   | 60     | 10k rows                   |

The fixtures also include 20k Sample Records (reference targets and search
corpus), direct-seeded Dataset Versions for version-read benchmarks, and a
published Pipeline Definition with an input Dataset Version. All generation is
deterministic (set-based SQL, stable seeds, no randomness).

### Result format

Every run writes one JSON report per section:

```json
{
  "scenario": "dataset-read-100k",
  "rows": 100000,
  "fields": 14,
  "concurrency": 1,
  "iterations": 7,
  "p50_ms": 235.8,
  "p95_ms": 236.9,
  "p99_ms": 236.9,
  "errors": 0
}
```

Each report also has an environment block (CPU, RAM, OS, PostgreSQL version,
Node version, commit SHA) and the query-plan audit
(`EXPLAIN (ANALYZE, BUFFERS)` summaries) for the hot Dataset paths. The
harness never commits generated files.

## Measured results

The canonical baseline was measured on 2026-08-29 on the environment above.
See `perf/results/*.json` for the full per-run reports.

### Dataset reads (`query_dataset_rows`, page 100, filter + sort, warm)

| Scenario                | Rows    | p50 (ms) | p95 (ms) | Notes                 |
| ----------------------- | ------- | -------- | -------- | --------------------- |
| dataset-read-1k         | 1,000   | 7.9      | 10.0     |                       |
| dataset-read-10k        | 10,000  | 39.3     | 41.5     |                       |
| dataset-read-50k        | 50,000  | 116.2    | 137.4    |                       |
| dataset-read-100k       | 100,000 | 235.8    | 236.9    |                       |
| dataset-read-50k narrow | 50,000  | 66.6     | 74.6     | narrow shape ≈ medium |
| dataset-read-10k wide   | 10,000  | 33.8     | 58.0     | 60-field projection   |

The per-page `count(*)` and the per-field correlated value joins dominate the
canonical read path. The path stays interactive at 100k rows. Deep offsets
grow with the scan: offset 9,800 on a 10k match set measured about 485 ms in
the CORE-02.6 gate. Keyset pagination is a documented future option. The
measurements do not yet justify it.

### Dataset Version reads (`query_dataset_version_rows`, page 100)

| Scenario             | Rows    | p50 (ms) | p95 (ms) |
| -------------------- | ------- | -------- | -------- |
| dataset-version-read | 1,000   | 6.8      | 7.1      |
| dataset-version-read | 10,000  | 7.1      | 8.4      |
| dataset-version-read | 50,000  | 23.7     | 27.4     |
| dataset-version-read | 100,000 | 18.5     | 19.4     |

Immutable version pages follow the PK order. The cost stays flat regardless
of size.

### Dataset writes

| Scenario           | Rows  | Validate p50 (ms) | Commit p50 (ms) | Commit p95 (ms) |
| ------------------ | ----- | ----------------- | --------------- | --------------- |
| dataset-write-1    | 1     | 0.8               | 2.3             | 38.6            |
| dataset-write-100  | 100   | 0.7               | 1.8             | 2.0             |
| dataset-write-1000 | 1,000 | 2.5               | 5.3             | 5.4             |

The canonical commit RPC is fast. The 1000-row batch bound is a product
constraint, not a measured limit.

### Dataset Version snapshots

| Scenario             | Rows   | p50 (ms) | p95 (ms) | Rate       |
| -------------------- | ------ | -------- | -------- | ---------- |
| dataset-snapshot-1k  | 1,000  | 165.0    | 170.2    | ~6k rows/s |
| dataset-snapshot-10k | 10,000 | 2,012.1  | 2,037.9  | ~5k rows/s |

Snapshot cost is linear (about 200 ms per 1k rows). A 100k-row snapshot takes
about 20 s. Each snapshot also emits one `change_events` row (GOV-03). This is
the largest write-path cost. The scale envelope sets the "requires caution"
line because of it.

### Pipeline stages (10k input rows, 3 samples)

| Stage              | p50 (ms) |
| ------------------ | -------- |
| materialize_inputs | 127      |
| transform          | 10       |
| output_commit      | 6,557    |
| dataset_commit     | 5,617    |
| dataset_snapshot   | 767      |
| output_overhead    | 156      |
| total              | 6,713    |

Output commit dominates the run. It contains 10 chunked 1000-row commits plus
a 10k-row snapshot. The executor now chunks the canonical 1000-row batch
bound instead of failing on outputs above 1000 rows. The chunked commit takes
about 560 ms per 1000-row chunk inside the run's long-lived transaction; the
canonical commit takes about 5 ms standalone. This is the dominant pipeline
cost. Revisit it first if pipeline throughput matters.

Materialization is set-based: one statement, not one round-trip per row. The
previous implementation issued up to 100k sequential inserts and dominated
large-input runs.

### Pipeline concurrency (10k input rows)

| Concurrency | p50 wall (ms) | Scaling |
| ----------- | ------------- | ------- |
| 1           | 6,926         | 1×      |
| 2           | 13,713        | 2.0×    |
| 5           | 34,551        | 5.0×    |

Scaling is linear. There is no collapse, but there is also no parallelism
benefit (one executor connection per run; the CPU-bound transform is small).
The supported initial limit is **5 concurrent runs** (see
[Known limits](#known-limits)).

### Scheduler sweep (interval schedules, not due)

| Schedules | Sweep p50 (ms) | Per schedule |
| --------- | -------------- | ------------ |
| 10        | 16             | ~1.6 ms      |
| 100       | 180            | ~1.8 ms      |
| 1000      | 1,524          | ~1.5 ms      |

A 1000-schedule sweep completes in about 1.4 s. One sweep is about 2.3% of
the 60 s polling interval, so the cadence stays acceptable.

### Event-trigger bursts

| Events | Drain time | Sweeps | Events consumed |
| ------ | ---------- | ------ | --------------- |
| 10     | 53 ms      | 2      | 10              |
| 100    | 334 ms     | 6      | 100             |
| 1000   | 4,491 ms   | 51     | 1,000           |

Each sweep consumes up to 20 events per schedule (per-sweep bound). 1000
events drain in about 4.5 s. At-least-once delivery and the cursor advance
stay unchanged (the harness asserts the exact consumption count).

### Search (global search over 20k records)

| Query             | Before (ms) | After maintained FTS index (ms) |
| ----------------- | ----------- | ------------------------------- |
| `Plat sample`     | ~2,500      | ~15 (DB-side)                   |
| `qc_0`            | ~2,000      | ~15 (DB-side)                   |
| `zzzz` (no match) | ~2,000      | ~15 (DB-side)                   |

Before the fix, the DATA-04 search computed a tsvector for every workspace
record on every query. Now a partial GIN index on a maintained
`api.records.search_tsv` routes the record branch through the index. Triggers
on records, blocks, files, and links update the column. A change-event guard
stops index maintenance from emitting duplicate record events. Ranking weights
and match semantics are byte-identical. RLS still filters the indexed scan.
See migration `0141`.

### API concurrency (mixed workload: 40% dataset read, 20% list, 20% search, 20% write)

The harness measures PostgREST directly. Each request mints a fresh JWT,
exactly like the same-origin proxy does. Results after the maintained FTS
search index:

| Concurrency | Throughput | p95 (ms) | p99 (ms) | Errors                       |
| ----------- | ---------- | -------- | -------- | ---------------------------- |
| 1           | ~8 req/s   | 482      | 490      | 0                            |
| 5           | ~42 req/s  | 546      | 555      | 0                            |
| 20          | ~44 req/s  | 1,291    | 1,472    | 6 (stale-revision conflicts) |

Throughput is 5–10× the pre-fix baseline. The pre-fix baseline was about
1–10 req/s with p95 up to 8.7 s, because search computed a tsvector for every
record per query. The write share (about 20%) exercises optimistic
concurrency: concurrent commits that read a stale expected revision conflict
(`SB001`), exactly as the product behaves. Conflicts are bounded and
recoverable. They never corrupt state.

## Supported scale envelope

This is the measured initial scale envelope for the current single-node
deployment shape. "Comfortable" means interactive at the p95 budgets above.
"Supported" means it works with known latency and throughput. "Requires
caution" means the measured cost starts to dominate, or correctness semantics
(for example the 1000-row commit cap and the 100k-row pipeline input cap)
need explicit handling.

```text
Dataset interactive use
────────────────────────────────
Comfortable       ≤ 50k rows       (page reads p95 < 140 ms)
Supported         ≤ 100k rows      (page reads p95 < 250 ms)
Requires caution  > 100k rows      (per-page count + projection grow; >100k pipeline inputs are refused)

Concurrent users
────────────────────────────────
Validated         1 / 5 / 20 mixed users (API concurrency benchmark)

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

This guidance is for the current single-VPS deployment (the supported shape).
The CPU/RAM profiles below are **unvalidated starting heuristics**, not
measured capacities. The benchmark suite ran on an Apple M2 Pro / 32 GiB
workstation, not on the VPS hardware. Treat any profile as provisional. Run
`pnpm perf:all` on the target deployment first, and check that its results
reconcile with the baseline in this document. The measured scale envelope
(above) is the authoritative statement of what the software sustains on the
benchmark box. Re-validate capacity on other hardware; do not extrapolate it.

### Development

- Loopback traffic only, with PostgreSQL default sizing. The full benchmark
  suite (including 100k fixtures) needs a workstation; do not run it on the
  dev VPS.

### Small deployment (unvalidated heuristic)

- App: 1 vCPU / 1–2 GiB RAM. Node SSR is lightweight; the app is not the
  bottleneck at the measured envelope.
- PostgreSQL: 2 vCPU / 4 GiB, `shared_buffers` 512 MiB–1 GiB. Give storage
  enough headroom for Dataset Version snapshots (about 5–10× the live Dataset
  size once scientists snapshot routinely).
- Re-validate these measured-envelope targets on this hardware: up to about
  100k rows per Dataset (page reads p95 < 300 ms), 5 concurrent Pipelines,
  and up to 20 concurrent mixed users with search. 20 users is the largest
  tested concurrency; this document makes no claim beyond it.

### Larger single-node deployment (unvalidated heuristic)

- App: 2 vCPU / 2 GiB. Node is single-threaded; the extra vCPU covers
  scheduler sweeps and concurrent HTTP.
- PostgreSQL: 4 vCPU / 8 GiB. The Dataset read path and snapshots are the
  hot paths; keep the Dataset working set cached.
- The connection budget (see below) becomes the first ceiling as users and
  Pipelines grow.

### Connection budget

Measured and estimated per surface:

| Surface             | Connections                                    |
| ------------------- | ---------------------------------------------- |
| App (pool)          | shared `pg` pool; the proxy reuses one pool    |
| PostgREST           | its own pool (default ~10)                     |
| Pipeline executor   | 1 dedicated connection per concurrent run      |
| Scheduler sweep     | 1 connection per sweep + per schedule decision |
| Connector execution | short-lived per-operation connections          |
| Benchmark harness   | its own clients (disposable)                   |

The PostgreSQL default `max_connections` (100) is sufficient at the supported
envelope (about 20–40 in use). Do not raise it without measurement. Measure
the Pooled-to-100 recheck and the scheduler's per-schedule connections first,
before you scale.

### Memory behaviour

- The page caps bound large Dataset responses and page reads (max 1000 rows
  per RPC). Serialisation is per-page.
- Pipeline input materialisation is now set-based in the database. The
  previous per-row implementation buffered the entire version in Node (1.2M
  value rows for a 100k input). The set-based path avoids that buffer.
- Pipeline result rows are still fully buffered in Node before the output
  phase (up to 100k rows × 1 MiB cell cap). This is documented bounded
  buffering.
- File uploads and downloads stream in 64 KiB chunks; the routes never buffer
  a whole file.
- XLSX and Parquet exports materialise in memory (XLSX is unbounded by the
  page loop; Parquet is capped). CSV, TSV, JSON, and NDJSON stream.
- Connector ingestion hashes the full payload into memory for the content
  SHA. The import caps bound this buffer; the buffering is documented.

## Known limits

| Limit                      | Value                                                   | Notes                                                                                                                               |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Dataset page               | 1–1000 rows                                             | `query_dataset_rows` / version RPC                                                                                                  |
| Commit batch               | 1–1000 rows                                             | `commit_dataset_row_batch`; Pipeline output commits chunk; connector imports use `commit_dataset_row_batch_atomic` (all-or-nothing) |
| Pipeline input rows        | 100,000                                                 | fixed, sandboxed executor limit                                                                                                     |
| Pipeline result rows       | 100,000                                                 | fixed                                                                                                                               |
| Pipeline inputs/parameters | 10 / 50                                                 | config limits                                                                                                                       |
| File size                  | 100 MiB                                                 | product cap (`FILE_MAX_BYTES`)                                                                                                      |
| Import                     | 10 MB / 1000 rows                                       | client-side DATA-01 caps                                                                                                            |
| Sheet composition page     | 200 rows                                                | `query_sheet_instance_rows` page bound                                                                                              |
| Scheduler sweep            | 60 s cadence, 20 events/sweep, 5 stale recoveries/sweep | polling; at-least-once                                                                                                              |
| Change events              | unbounded                                               | retention/archival not implemented (no observed pressure yet)                                                                       |
| Record import              | 1 RPC per row                                           | `commitRecordImport` issues one `create_model_record` per row — N+1, documented as a future batch-create candidate                  |
| S3 object import           | 1000 rows/object                                        | delimited parser import cap (preview reads 512 KiB) — a product limit, not a benchmark artifact                                     |

## Diagnosing slow behaviour

1. **Measure first.** Run the harness (`pnpm perf:all`) on the target box and
   compare `perf/results/` against the baseline. Note the environment block.
2. **Read the metrics.** `/api/metrics` (bearer-protected outside
   development) exposes the bounded dataset, pipeline, scheduler, and search
   duration histograms; see the catalogue below. Watch
   `sheetbase_dataset_rpc_duration_seconds`, `sheetbase_pipeline_stage_duration_seconds`,
   and `sheetbase_scheduler_sweep_duration_seconds`.
3. **Follow the request.** Every request carries `x-request-id` into logs and
   upstream PostgREST; connector runs add `connector_run_id`.
4. **Check the plan.** For a slow Dataset path:
   ```sql
   explain (analyze, buffers) select api.query_dataset_rows('…', '{"filters":[…]}'::jsonb, 100, 0);
   ```
   Look for sequential scans on `dataset_row_values` (a missing index), full
   per-page counts, or correlated-subquery cost growth.
5. **PostgreSQL slow statements.** Set `log_min_duration_statement` (for
   example `1s`) on the VPS. Correlate the log with request ids in the app
   logs. Do not log scientific payloads: statements include parameter values.
   Use `log_min_duration_statement` with `log_statement = 'none'` on a
   controlled window.
6. **Common failure modes.** Slow search: check that the plan uses
   `idx_records_search_tsv` (`explain select * from api.search('x', …)`).
   Snapshot-heavy runs: quantify `sheetbase_dataset_snapshot_duration_seconds`.
   Scheduler backlog: check `sheetbase_scheduler_sweep_duration_seconds` and
   `pipeline_runs` rows stuck in `running` (stale-run reconciliation starts
   after 900 s).

## Metrics reference

These metrics are PLAT-05 additions. Labels are bounded; IDs, workspaces,
users, and names are never label values:

| Metric                                            | Type      | Labels (bounded)                                                                                                        |
| ------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `sheetbase_dataset_rpc_duration_seconds`          | histogram | `operation` (query_dataset_rows, query_dataset_version_rows, commit_dataset_row_batch, snapshot_dataset, search, other) |
| `sheetbase_dataset_commit_duration_seconds`       | histogram | `size_bucket` (small/medium/large/xlarge)                                                                               |
| `sheetbase_dataset_snapshot_duration_seconds`     | histogram | `size_bucket`                                                                                                           |
| `sheetbase_pipeline_stage_duration_seconds`       | histogram | `stage` (materialize_inputs, transform, output_commit, dataset_commit, dataset_snapshot, output_overhead, total)        |
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

These triggers are explicit and measurement-driven. Do not build these
systems before a trigger is met.

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

See the Files budget table above for throughput and p50. Over the measured
storage backend, the byte routes add only HTTP framing and auth. Both routes
stream in 64 KiB chunks and never buffer the whole object (the benchmark's
received-bytes check verifies this).

### Connectors

The harness measures against local deterministic fixtures: an in-process
S3-compatible HTTP backend (real SDK + SigV4) and an isolated source
PostgreSQL database in the local cluster. Runs execute in-process and
request-scoped through the canonical commit path. The commit path now runs
**atomically**: `commit_dataset_row_batch_atomic` executes every canonical
≤1000-row chunk inside one database transaction. A failure in any chunk rolls
back every earlier chunk, so scientific imports are never partial. Previously,
a large import failed outright above 1000 rows, and the interim chunked fix
risked partial mutation. Per-stage timings come from the run's durable stage
logs.

| Scenario                   | Rows | Source read | Map+validate | Commit | Total  |
| -------------------------- | ---- | ----------- | ------------ | ------ | ------ |
| postgres ingest 10k        | 10k  | 52 ms       | 6.6 s        | 2.5 ms | 6.7 s  |
| postgres ingest 50k        | 50k  | 211 ms      | 33.1 s       | 6.2 ms | 33.3 s |
| postgres preview 10k / 50k | —    | 12 / 12 ms  | —            | —      | —      |
| s3 ingest 500              | 500  | 21 ms       | 277 ms       | 2.2 ms | 307 ms |
| s3 ingest 1k               | 1k   | 27 ms       | 625 ms       | 2.2 ms | 653 ms |
| s3 preview 500 / 1k        | —    | 5 / 3 ms    | —            | —      | —      |

Replay (digest dedupe) latency is 55–157 ms for postgres and 19–22 ms for s3.
A retried identical import replays the prior receipt instead of re-reading
the source. Map+validate dominates every import (per-row coercion plus
chunked validation). Revisit it first if connector ingest throughput matters.
S3 objects are limited to the delimited parser's 1000-row import cap (a
product limit). The PostgreSQL source scales to 50k+ rows.

### Sheet & Notebook

| Scenario                   | Rows       | p50   | p95   |
| -------------------------- | ---------- | ----- | ----- |
| bound sheet load, page 100 | 10k bound  | 47 ms | 49 ms |
| bound sheet load, page 200 | 10k bound  | 82 ms | 86 ms |
| notebook blocks load, 50   | 50 blocks  | 20 ms | 21 ms |
| notebook blocks load, 200  | 200 blocks | 20 ms | 21 ms |
| notebook blocks load, 500  | 500 blocks | 21 ms | 23 ms |

`query_sheet_instance_rows` hydrates a Dataset-bound grid in about 82 ms p50
for a 200-row page over a 10k-row Dataset. Notebook bodies load in about
20 ms at any tested size (index-backed, about 40 µs per block amortised). The
notebook screen issues 4 data requests (record + blocks + links + files).

### Failure under pressure

| Scenario                              | Result                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------ |
| DB connection exhaustion              | 89 connections opened before `53300`; cluster recovers on close          |
| Pipeline saturation (8 runs, limit 5) | all 8 complete, output rows intact, no corruption (linear cost)          |
| Slow/unreachable source               | bounded `query_failed` after the 10 s connection timeout; retry possible |
| Scheduler backlog (40 due)            | 40/40 occurrences started, zero duplicates                               |

All failure modes are bounded, explicitly surfaced (bounded error codes and
durable run records), and recoverable. They never corrupt state.
