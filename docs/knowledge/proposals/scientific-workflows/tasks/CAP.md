# Traceable capture

Planned at `e5801327`, 2 October 2026. Read [GUIDE.md](../GUIDE.md), ADR-0037, the canonical Sheet write-back contracts and R4 DSET/LAB/MOB tasks. PostgreSQL Dataset storage remains the scientific value authority. Current boundaries below have high confidence; new domain choices need their stated design step.

## R5-CAP-01: carry a bench observation into frozen evidence

**Outcome:** a scientist records a planned measurement once and can follow it from sample to Dataset, analysis and submitted Notebook. Priority P1, effort L, high risk. Depends on BASE-02 and reconciliation of DSET-01, LAB-03 and MOB-02.

**Current state and scope:** `src/routes/readings/new.tsx:68` calls `record_sample_measurement`; `src/db/schema.ts:3414` stores standalone name/value/unit observations; the Measurements tab reads them. Original LAB-03 requires Dataset/integration source-row links. Scope: the measurement contract, planned Dataset rows, bench form, sample projection, canonical writers and migration/history. Start with `tests/db/sample-measurements.test.ts` and `tests/db/planned-dataset-rows.test.ts`.

**Steps:**

1. Decide the authoritative mapping from an observation to Dataset/row/field identity. Recommended approach: canonical Dataset values plus observation/source metadata and a sample projection. Preserve prior IDs/authors/timestamps; mark historical provenance unknown where necessary rather than inventing it.
2. Implement the canonical mutation and read projection. Bind sample, planned row, method/version, units, instrument when supplied, actor, raw value and any explicit dilution calculation. Correction records history and respects expected revision/idempotency.
3. Wire the phone flow and source links; add range/unit validation and existing file-upload attachment support. Demonstrate snapshot → analysis → submission through the existing evidence path.

**Verification/exit:** run the named DB tests, add `tests/browser/bench-to-evidence.spec.ts` and run it at 390px, plus `pnpm validate`. Duplicate submission produces one observation; stale/denied writes produce none; an old submitted result survives a corrected live reading. Stop if the solution needs two writable copies of the scientific value. Offline sync and instrument fleet integration are out of scope.

## R5-CAP-02: persist large imports with recoverable progress

**Outcome:** a user can upload a representative instrument export, close the tab, resume review and publish exactly one complete Dataset result. Priority P1, effort XL, high risk. Depends on BASE-02 and DSET-05's raw-file provenance contract. CAP-01 is required only when fulfilling its planned measurement rows.

**Current state and scope:** `src/lib/import-parse.ts:5` caps browser parsing at 10 MiB/1,000 rows; `src/components/import/import-wizard.tsx` owns transient preview/mapping state; `src/lib/import-commit.ts` already validates and commits canonically. Scope: existing import/file contracts, durable job state, bounded server parsing, resume/cancel, row outcomes and import-history UI. Large raw-file/parser work remains owned by DSET-05; durable lifecycle is the extension.

**Steps:**

1. Define job states, source hash, mapping/schema pins, actor permissions, retention and publication semantics. Default proposal: staged rows remain unpublished until validation succeeds, followed by a guarded publish. If atomic publication cannot fit existing contracts, record the revised design before writing batches into user data.
2. Stream/chunk CSV validation into bounded work, persist progress/errors, and recover workers with leases and stable idempotency. Reuse current storage and workers where suitable; do not introduce another general job platform by assumption.
3. Add progress, rejected-row download, explicit cancellation and historical inspection. Protect retries across process restart and changed schema/permissions.

**Verification/exit:** add `tests/db/import-jobs.test.ts`, API and browser import-job cases. Run them using the documented DB/API/browser configs and `pnpm validate`. Test a proposed 100,000-row/50-MiB CSV target plus one real-shaped plate-reader and bioreactor fixture; report duration/memory. Interrupted, repeated, cancelled and invalid imports cannot publish duplicate or silently partial results. Raising browser limits alone does not meet the exit.

## R5-CAP-03: reuse reviewed intake mappings

**Outcome:** repeated instrument exports use a named reviewed mapping and validation policy, and historical imports retain the exact version used. Priority P2, effort L, medium risk. Depends on CAP-02 and DSET-06 reconciliation.

**Current state and scope:** `src/lib/import-mapping.ts`, `src/lib/import-commit.ts` and R4 DSET-05/06 provide mapping/schema/parser foundations. Scope: extend the existing parser/mapping configuration to pin field identities, units, format expectations and validation policy; connect selection and dry preview to durable import jobs. Do not create another schema or connector registry.

**Steps:** inventory existing reusable mapping/parser storage and make that the sole owner; define publish/retire and explicit upgrade; store each job's configuration version and source checksum; preview renamed/missing fields and unit conversions before committing; expose a concise reject/accept summary.

**Verification/exit:** extend `src/lib/import-mapping.test.ts` and CAP-02's DB/API tests; run focused suites and `pnpm validate`. Two equivalent exports use the same pinned profile; a changed header or incompatible unit fails clearly; publishing v2 leaves v1 job reconstruction unchanged. Begin with one instrument family. Automatic learned mappings, vendor fleets and silently accepting schema drift are out of scope.
