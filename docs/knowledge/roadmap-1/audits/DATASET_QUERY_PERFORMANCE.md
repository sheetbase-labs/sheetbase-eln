# CORE-02.6 Dataset query performance evidence

Measured 2026-08-14 in the local Amp orb on PostgreSQL 18.6 with:

```sh
pnpm db:fresh
SHEETBASE_ENV=development \
  CORE_DATASET_BENCHMARK_CONFIRM=local-destructive \
  pnpm exec tsx scripts/benchmark-dataset-query.ts
```

The benchmark is a correctness and local-baseline gate, not a reporting-only
script. It exits nonzero on a wrong result, revision/idempotency failure, window
semantic failure or threshold violation. A successful run removes its fixed-ID
fixture. A second consecutive run also passed, proving repeatability and
cleanup; the tables below report the final run after `pnpm db:fresh`.

The script refuses to construct either database client unless
`SHEETBASE_ENV=development`, the destructive confirmation has the exact value
shown above, and both `DATABASE_URL` and `PGRST_DB_URI` parse with a literal
`localhost`, `127.0.0.1` or `::1` host. Docker service names, remote hosts,
missing environment identity and production/preview identities are rejected
without printing a URL or credentials. Omitting the confirmation was exercised
directly and exited 1 before a connection with:

```text
Set CORE_DATASET_BENCHMARK_CONFIRM=local-destructive to confirm the destructive local Dataset benchmark
```

## Fixture and trust boundaries

The fixture uses an isolated workspace and explicit stable IDs rooted at
`02600000-...`. It creates two independent published Schema Versions and
Datasets:

| Dataset   | Dataset ID     |    Rows | Fields | Populated values |
| --------- | -------------- | ------: | -----: | ---------------: |
| Primary   | `...000000004` | 100,000 |     14 |        1,200,000 |
| Secondary | `...000000007` |  80,000 |     14 |          960,000 |

Each schema contains reference, decimal, date, category, text, timestamp,
integer, boolean and `many` field definitions. Twelve fields per row are
populated. The fixture also creates 100,000 stable Sample Records with IDs
rooted at `02610000-...`; both Datasets store those Record UUIDs in their
canonical reference value slots. The secondary Dataset references Samples
1–80,000, giving an intentional one-to-one 80,000-row composition result.
Labels and row/display positions are never join keys.

Fixture creation is deliberately privileged local setup. Product-contract
measurements use an `authenticated` role, workspace claims, RLS and
`api.query_dataset_rows` or the canonical validate/commit RPCs. The 12-field
projection, composition and aggregate are privileged database-level queries
that prove the storage shape for CORE-03; they are not exposed as arbitrary SQL
or a premature composition API.

Cleanup runs before and after the fixture. Trigger disable/delete/restore is a
single transaction. Before returning, cleanup asserts that the fixed
workspace, user, Schemas, Schema Versions, Datasets, Sample Records, bulk
receipts and Dataset rows are absent and that both Schema immutability triggers
have `tgenabled='O'`. The guarded run emitted
`cleanup_status=PASS remaining=0 immutability_triggers_enabled=2` at both
boundaries; any failed postcondition exits nonzero.

## Local thresholds

The script enforces these intentionally conservative orb baselines:

| Gate                          |  Threshold |
| ----------------------------- | ---------: |
| Fixture create + `ANALYZE`    | 240,000 ms |
| Authenticated canonical read  |   5,000 ms |
| Each explained storage query  |   5,000 ms |
| 1,000-row batch validation    |  10,000 ms |
| 1,000-row atomic batch commit |  30,000 ms |

These thresholds detect gross plan/correctness regressions on the qualified
orb; they are not production SLOs.

## Authenticated query results

The first post-seed query is labelled cold-ish: the fixture has just been
written and analysed, so PostgreSQL and the OS have already touched pages. It
is not a true cold-cache test. Runs 2 and 3 are warm repeats of the same typed
numeric range (`titre >= 900,000,000`), descending date sort and 200-row window.

| Scenario                          |         Time | Result and complete-data semantics         |
| --------------------------------- | -----------: | ------------------------------------------ |
| Fixture create + `ANALYZE`        | 102,482.4 ms | 180,000 rows; 2,160,000 values             |
| Range/date/window, cold-ish       |      97.6 ms | 200 loaded / 10,000 total; `hasMore=true`  |
| Range/date/window, warm 1         |      72.0 ms | 200 loaded / 10,000 total                  |
| Range/date/window, warm 2         |      72.1 ms | 200 loaded / 10,000 total                  |
| QC category filter                |      45.6 ms | 200 loaded / 20,000 total                  |
| Representative later offset 5,000 |     293.2 ms | 200 loaded / 10,000 total; `hasMore=true`  |
| Final offset 9,800                |     485.1 ms | 200 loaded / 10,000 total; `hasMore=false` |

The authoritative total remains 10,000 at later offsets. The script checks
both a representative later page and the exact full final page, so a 200-row
loaded window cannot be mistaken for the complete filtered Dataset.

## Projection, composition and aggregate proof

| Scenario                                  |    Time | Correctness result                                        |
| ----------------------------------------- | ------: | --------------------------------------------------------- |
| 12-field projected filtered/sorted window | 33.2 ms | 200 rows, exactly 12 stable field UUID keys per row       |
| 100k/80k Sample-reference composition     | 36.4 ms | 80,000 matches, 80,000 distinct Sample UUIDs              |
| QC-filtered numeric aggregate             | 56.0 ms | count 20,000; min 0; max 995,000,000; average 497,500,000 |

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` is executed and thresholded for all
three storage proofs. The final fresh-database summaries were:

| Plan                | Execution / planning | Root      | Indexes                                   | Shared buffers (hit/read) |
| ------------------- | -------------------: | --------- | ----------------------------------------- | ------------------------: |
| 12-field projection |    38.452 / 0.761 ms | Aggregate | row-value PK, field/numeric, Dataset rows |               527,044 / 0 |
| Sample composition  |    45.518 / 0.194 ms | Aggregate | field/category prefix                     |                12,405 / 0 |
| Numeric aggregate   |    41.891 / 0.251 ms | Aggregate | row-value PK, field/category              |           403,213 / 2,695 |

The high summed hit count includes blocks reported at nested plan nodes and is
therefore useful for comparing this script over time, not as a count of unique
pages. The script emits each summary as JSON so a failing/local run retains its
exact plan evidence in command output.

## Controlled bulk writes

Both scenarios use one JSON batch and one canonical RPC invocation per phase;
there is no row-at-a-time HTTP or SQL loop. Commit revalidates, so commit time
includes its authoritative validation pass.

| Scenario                     | Validate |   Commit | Correctness result                                                      |
| ---------------------------- | -------: | -------: | ----------------------------------------------------------------------- |
| Create 1,000 rows × 4 values | 162.6 ms | 721.0 ms | Dataset revision 2; 1,000 row revisions at 1                            |
| Exact create retry           |        — |   8.6 ms | stored result; `idempotent=true`; revision remains 2                    |
| Update 1,000 rows × 1 value  |  64.7 ms | 365.7 ms | Dataset revision 3; all row revisions 2; values 600,000,000–600,000,999 |
| Exact update retry           |        — |   6.3 ms | stored result; `idempotent=true`; revision remains 3                    |

The script verifies the persisted count, revision range and numeric min/max
after commit, as well as actor-scoped idempotency on exact retry.

## Index and API conclusion

No migration is justified by these measurements. Existing indexes provide the
measured access paths:

- `idx_dataset_row_values_field_numeric` for numeric filtering/projection;
- `idx_dataset_row_values_field_category` for QC filtering and aggregate
  membership;
- the Sample composition hash-joins stable `reference_id` values after a
  field-prefix index scan. PostgreSQL selected the category index's identical
  leading `field_id` in the final run and selected the dedicated reference
  index in the preceding repeat; both plans remained below 80 ms;
- the row-value primary key and `idx_dataset_rows_dataset` for bounded row
  reconstruction;
- the existing date/timestamp indexes remain available for canonical typed
  predicates and sorts, although the measured selective range plan sorts the
  10,000 numeric matches rather than scanning the whole date index.

The current authenticated RPC returns all active schema fields. It reconstructed
14 fields inside the measured canonical windows without approaching the local
threshold. A field-ID projection parameter would add product surface without a
current CORE-02 consumer need, so no speculative API was added. Dataset
Explorer remains on the unchanged canonical query shape.

## Qualification and limitations

- This is one local orb (PostgreSQL 18.6, 128 MiB default shared buffers,
  durability tuned off for ephemeral development), not production hardware or
  concurrent capacity testing.
- “Cold-ish” does not flush PostgreSQL or OS caches. Warm/cold labels are
  explicit to avoid claiming a true cold-cache measurement.
- Composition and aggregation prove the selected storage/index strategy for a
  future controlled consumer. They are not public Dataset or Sheet APIs.
- Offset paging is correct and comfortably below the gate at offset 9,800;
  keyset paging may still be operational hardening for much deeper offsets.
- The benchmark does not weaken RLS, direct-write revocations, 1–1,000 batch
  bounds, atomicity, deterministic locking, revisions or idempotency.
