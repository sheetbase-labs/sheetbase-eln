# Recovery and public clients

Planned at `e5801327`, 2 October 2026. Read [GUIDE.md](../GUIDE.md), `docs/operations/recovery.md`, existing backup manifests, export/evidence contracts and SDK release instructions. The goal is evidence for existing capabilities plus a defined protection boundary, not a new infrastructure platform.

## R5-OPS-01: recover a populated scientific workspace

**Outcome:** a replacement environment reproduces scientific results, files and access boundaries from a real backup set. Priority P0 before real laboratory data depends on the system, effort L, medium risk. Depends on BASE-02's populated fixture.

**Current state and scope:** `src/lib/restore-verification.ts` checks schema, RLS flags, RPC presence, counts and object sizes. `docs/operations/recovery.md:112` records an empty-workspace drill. `scripts/restore-drill.ts:195` extracts into a child directory that the inspected code does not create. Scope: repair/reproduce the drill, fixture backup, populated semantic verification and the recovery runbook. Static findings have high confidence; no drill was executed during this survey.

**Steps:** reproduce the archive extraction path in a temporary fixture and add a focused regression; back up a workspace containing Dataset Versions, composed Sheets, frozen analysis, signed/submitted evidence, files and multiple permission roles; restore into an isolated replacement stack; inspect through ordinary authenticated APIs, not only superuser SQL; compare before/after values, digests and file byte hashes.

**Verification/exit:** run `pnpm exec vitest run src/lib/backup.test.ts`, `pnpm exec vitest run --config vitest.db.config.ts tests/db/restore-verification.test.ts`, the new extraction regression and the restore CLI below. Substitute paths to the disposable fixture's actual backup set, then record the expanded command and elapsed time. Missing/corrupt objects and mismatched scientific evidence fail; denied reads remain denied after restore. Do not run against active data or count nonzero table totals alone as proof. Off-host protection belongs to OPS-02.

```bash
pnpm backup:restore-drill -- --dump '<fixture-db.sql.gz>' --objects '<fixture-objects.tar.gz>' --self-test
```

## R5-OPS-02: make backups survive loss of the primary host

**Outcome:** the workspace can be recovered after the primary host and its local backups are unavailable. Priority P0 before real data adoption; effort L, high risk. Depends on OPS-01 and an explicit backup destination, retention/key-recovery and deployment decision.

**Current state and scope:** the inspected recovery runbook stores backups on the VPS and explicitly documents shared-host loss exposure. Live backup configuration was not inspected. Scope: the existing complete backup-set manifest, off-host copy, separate encryption/key recovery, verification, freshness alerts and replacement-host restore. Reuse the current backup tool; no organisation hierarchy or institutional hosting programme is implied.

**Steps:** confirm live protection state before building; agree recovery-point/time targets and data retention for the intended deployment; add bounded transport and verification for complete sets; keep copy failure visible without destroying the last good set; provide an independently recoverable key procedure and test key rotation/retention; perform OPS-01's semantic restore using only the off-host copy and recovered keys.

**Verification/exit:** add focused transport/manifest tests, exercise corruption, partial upload, unavailable destination and expired-backup alerts, then a disposable off-host restore. Report observed recovery times and achieved backup age, not a guessed SLA. Source tests and runbooks can complete before live rollout; live storage/key/account changes require the authorised rollout and observed result. Deleting primary data is not an acceptance test.

## R5-OPS-03: prove installed Python and TypeScript SDKs against the service

**Outcome:** an integrator can install the packaged client and perform the same supported scientific operations as the application. Priority P2, effort L, medium risk. Depends on BASE-02; workspace Record Model API additions additionally depend on MDL-01.

**Current state and scope:** `sdks/typescript/tests/smoke.test.ts` uses mock transport; `.github/workflows/sdk-release.yml` builds/imports artifacts without exercising them against the service. `sdks/RELEASE.md` also contains an older paused-workflow claim. Scope: clean consumers of packed `.tgz` and wheel artifacts, ephemeral real service fixtures, token lifecycle and canonical operations. Current evidence gap has high confidence; registry publication status is unknown.

**Steps:** pack/build both clients using existing release steps; install artifacts outside their source trees into disposable consumers; exercise token exchange, Dataset write/query, snapshot readback, stale revision, duplicate replay, expired/revoked credentials and cross-workspace refusal; reuse the same expected values across languages; wire acceptance into release-candidate CI and correct the runbook.

**Verification/exit:** run each SDK's existing tests plus the new installed-artifact integration suite against BASE-02 services; run affected OpenAPI/parity checks. Retain artifact hashes, SDK/server versions and scenario outcomes. Imports alone and mutually agreeing mocks do not pass. No business rules duplicated in SDKs, no hidden privileged endpoint use, and no registry publication inferred from acceptance.
