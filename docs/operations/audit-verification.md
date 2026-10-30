# Audit trail verification

DEC-04 fixes the audit trail as a SHA-256 hash chain with nightly verification at
06:00 and 15-year retention. This runbook covers the verification half.

## What it checks

`api.run_audit_verification(workspace_id)` verifies two things per workspace:

1. **The chain.** Every `api.change_events` row stores `previous_hash` and its own
   `entry_hash` over the canonical field set (workspace, sequence, entity,
   operation, record, project, actor, credential, client, payload, created_at).
   Verification recomputes the chain in sequence order and reports the first entry
   that does not match.
2. **Signed revisions.** For every `api.signatures` row, the digest of the frozen
   `canonical_snapshot` is recomputed and compared with both the digest captured at
   signing and the revision's own `integrity_digest`, so a rewritten revision is
   detected even when the signature row itself is untouched.

Entries are append-only: `UPDATE` and `DELETE` on `api.change_events` raise
`SB121`, so tampering requires bypassing the trigger at the database level — which
is exactly what verification is there to catch.

## Running it

```bash
pnpm audit:verify
```

It connects with `MIGRATION_DATABASE_URL` (falling back to `DATABASE_URL`) and must
use the role that owns the schema — the migrator role in production, because the
function accepts a claim-less caller only when that caller owns it. Workspace
admins can also call `api.run_audit_verification` from a session.

Each workspace prints one line:

```text
workspace=process-development ok=true chainEntries=1000 signedRevisions=2
```

The command exits non-zero if any workspace fails, listing the first bad sequence
or revision.

## Schedule

The server runs the check itself: shortly after it starts and then hourly, it
verifies every workspace whose last check is more than a day old (or that never had
one). A second replica finds the fresh result and skips, so nothing needs
configuring. It connects with `MIGRATION_DATABASE_URL` when set, otherwise
`DATABASE_URL`; set `SHEETBASE_SCHEDULER_ENABLED=false` to turn it off. A failure
is logged as `audit verification failed`.

Administrators can also press **Check now** in Settings → Audit and retention.

A cron entry is still fine for a deployment that wants a fixed hour. On the VPS, add to the crontab of the deploy user:

```text
0 6 * * * cd /opt/sheetbase && pnpm audit:verify >> /var/log/sheetbase-audit.log 2>&1
```

## Where the results live

Every run writes one **System** entry per workspace: `entity_type = 'system'`, no
actor, with the result as its payload. Those entries appear in the workspace audit
log alongside user activity, so a failed verification is visible in the same place
as everything else — and, because the entry is itself chained, the result cannot be
quietly removed.

Everyone in the workspace can read the latest result, through
`api.audit_verification_status()`. Settings → Audit and retention shows it under the
title, and a signed record's Signatures tab says "verified intact, last checked …"
(or that the latest check failed).

## What to do when it fails

1. Read the System entry for the affected workspace; it names the first bad
   sequence or revision.
2. Treat the trail from that point as unreliable. Preserve the database as it is —
   do not repair rows in place.
3. Restore the affected tables from the most recent backup that verifies clean
   (`docs/operations/recovery.md`) and re-run `pnpm audit:verify`.
4. Record the incident, the affected range and the restore point.
