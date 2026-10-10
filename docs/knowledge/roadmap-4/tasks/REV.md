# REV — Review, Signatures and Evidence

**Status (2026-10-02):** Reconciled against `9bbd305c`; see [task evidence](../RECONCILIATION.md#rev) and [live tracker](../CHECKLIST.md). Baseline sections describe the original planning snapshot, not current absence.

**Original scope note (2026-09-27):** Original proposal. Current status is reconciled below. REV-03 and REV-05 follow [DEC-04](DEC.md), which accepted GXP-01 / [ADR-0045](../../decisions/0045-regulated-intended-use-control-model.md) on 2026-09-27.

## Programme goal

Make review fast and precise for the reviewer, make signing mean what it says,
and let anyone see exactly what was signed next to what has changed since.

## Baseline at `main` `9538f36`

- `revisions` with `integrity_digest` (sha256) and reasons submit, sign,
  manual, validate, amend.
- `review_submissions` (submitted, returned, rejected, approved, withdrawn),
  `review_decisions` (request_changes, reject, approve, withdraw),
  `review_check_definitions` and results, `revision-diff-review.tsx`.
- `signatures` bound to a frozen revision digest; meanings
  `approve-for-record` and `witness`; auth method `session+name-confirmation`
  (no password re-entry); `sign-notebook-dialog.tsx`.
- Amendments (`amend-notebook-dialog.tsx`); revision evidence package export
  (`/api/export/revision/$id/package`).
- Audit history exists; no hash chain or integrity verification job.

## REV-01 — Review workspace

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#rev-01).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/ReviewRecord.dc.html`, `canvas/ReviewReturned.dc.html`,
`canvas/ReviewApproved.dc.html`, `canvas/HomeTriage.dc.html` (inspector),
`canvas/Shortcuts.dc.html` (N/P, R).

### Scope

- Review mode of the notebook: "You are reviewing" banner, read-only for the
  reviewer, round number.
- "Show changes since round N" with margin marks, previous/next change (N/P),
  inline diff of changed cells with who, when and reason.
- Reviewer comments drafted privately and sent together: "Return with N
  comments"; author sees returned banner, resolves or replies, resubmits.
- Review panel: template checklist (from `review_check_definitions`), checks
  before signing (required fields, validation, materials in date), decision
  (approve, return), save draft.
- After signing: confirmation, "Next in inbox".

### Start here

`src/routes/reviews/$revisionId.tsx` (2,141), `src/lib/review-workspace.ts`,
`review-lifecycle.ts`, `reviews.ts`, `src/components/review/revision-diff-review.tsx`,
`review-check-results.tsx`, comments (`api.comments` with `diff` targets),
`tests/api/rev-008-review-acceptance.test.ts`, `tests/db/review-checks.test.ts`.

### Steps (PRs)

1. Review mode inside `/records/$recordId/notebook` (banner, read-only for the
   reviewer, round number = count of submissions); `/reviews/$revisionId`
   redirects.
2. Changes since round N: diff between the last reviewed revision and the
   current one, margin marks, N/P navigation (SHELL-03), inline cell diffs with
   reason.
3. Draft comments: comments with `state = draft` visible only to the reviewer;
   "Return with N comments" publishes them with the `request_changes`
   decision in one transaction.
4. Review panel: checklist from `review_check_definitions`, checks before
   signing, decision, save draft; returned state for the author.

### Check it

DB test for draft visibility and atomic return; parity for `ReviewRecord`,
`ReviewReturned`, `ReviewApproved`.

### Exit

A round-2 review shows only changes since round 1; returning sends all draft
comments at once; checklist completion is stored with the decision.

## REV-02 — Signature meanings and author signing

**Status (2026-10-02):** not-started; nod `todo`. [Evidence and remaining work](../RECONCILIATION.md#rev-02).

**Original decision/dependency note:** [DEC-04](DEC.md) accepted 2026-09-27 (meanings Authored, Witnessed, Reviewed, Reviewed and approved; role-restricted).

**Implementation contract (2026-10-04):** The accepted owner decision in
[ADR-0045](../../decisions/0045-regulated-intended-use-control-model.md) governs
the original scope below. There are four new-write meanings, not five. Standalone
Approved is not a signature authority. Historical `approve-for-record` and
`witness` evidence remains unchanged and readable.

Reviewer means the assigned human workflow reviewer with current workspace write
permission, not an unassigned user with an owner, admin, or reviewer label.
Reviewed attests review without approval or locking. Reviewed and approved
requires the canonical approval and locks the exact revision. Witnessed requires
an explicit request to another permitted nonauthor human for that frozen digest.

Authored applies only to workflow versions whose immutable `requiresSignature`
flag is true. `default-scientific-review/v1` remains unchanged and does not
require author signing. `controlled-scientific-review/v1` requires atomic author
submission. Its password grant binds the user, session, digest, record, workflow
key and version, normalised reviewer set, confirmation boolean, canonical due
date, and idempotency key. Failure cannot leave an unsigned frozen submission or
a consumed grant. An identical already-signed retry returns the original result.
Every new signature requires current certification and native password proof.

### Design

`canvas/NbSigned.dc.html`, `canvas/ReviewApproved.dc.html`,
`canvas/HelpRecords.dc.html`, `canvas/SettingsSignature.dc.html` (meanings).

### Scope

Meanings Authored, Reviewed, Reviewed and approved, Approved, Witnessed;
author signs at submission; witness requests; meanings restricted by role;
signatures table on signed records with signature IDs; signed PDF and
evidence package reflect them.

### Start here

`src/lib/signatures.ts` (meanings `approve-for-record`, `witness`),
`api.sign_revision` (search `drizzle/`), `api.signatures`,
`sign-notebook-dialog.tsx`, `submit-notebook-dialog.tsx`,
`tests/db/gov-04-review-signatures.test.ts`.

### Steps (PRs)

1. Widen meanings (authored, reviewed, reviewed-and-approved, approved,
   witnessed) with role rules in `sign_revision`; migrate existing values.
2. Author signature at submission; witness requests (work item).
3. Signatures table on signed records; evidence package includes meanings.

### Check it

DB tests per meaning and role.

### Exit

Each meaning is enforced by role on the server; every signature records name,
time, meaning and exact revision digest.

## REV-03 — Signing with password re-entry and signature certification

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#rev-03).

**Original decision/dependency note:** [DEC-04](DEC.md) accepted 2026-09-27 (password re-entry, signing token, certification, 3-attempt / 15-minute lockout).

### Design

`canvas/ReviewSign.dc.html`, `canvas/SettingsSignature.dc.html`,
`canvas/HomeFirstRun.dc.html`, `canvas/SignedOut.dc.html`.

### Scope

Signing dialog asks for the password again (focus starts in the field) and
shows signer, meaning, version and content hash; one-time signature
certification (identity verified by an admin, statement agreed, password) and a
practice signature; signature status per member; failed-attempt lockout.
Requires an authentication method compatible with company SSO (ADR decision).

### Start here

`sign_revision` auth method `session+name-confirmation`, `src/lib/auth.ts`,
DEC-04's decision.

### Steps (PRs)

1. Re-authentication endpoint (per DEC-04: password verification through
   Better Auth, or provider step-up) returning a short-lived signing token
   bound to user, session and revision digest.
2. `sign_revision` requires the token; records the auth method.
3. Signature certification flow (`SettingsSignature`) and gate before first
   signature; practice signature.
4. Signing dialog per `ReviewSign` (focus in password field).

### Check it

DB/API tests: signing without a valid token fails; token cannot be reused
for another revision.

### Exit

A signature cannot be created from a session alone; certification is required
before first signature; the auth method is recorded on each signature.

## REV-04 — Evidence versus live

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#rev-04).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/EvidenceCompare.dc.html`, `canvas/EvidencePhone.dc.html`,
`canvas/RecordInstrument.dc.html` (signed name versus current name).

### Scope

Evidence view of a signed revision beside live data: datasets at the cited
snapshot versus latest, other differences (renamed records, comments added
after signing), evidence package contents, integrity (hash verified and when),
cited by; "Create amendment" entry point.

### Start here

Evidence package `src/routes/api/export/revision/$id/package.ts`,
`api.revision_sheet_evidence`, frozen reconstruction tests
(`tests/db/core-h3-frozen-composed-evidence.test.ts`), dataset version
queries.

### Steps (PRs)

1. Read model comparing the frozen revision's cited snapshots with the latest
   ones and renamed records (LAB-06 names).
2. Evidence page `/records/$recordId/evidence/$revisionId` and phone view.
3. Nightly digest verification job recording results.

### Check it

Test that the evidence view never reads live rows for cited data; parity for
`EvidenceCompare`, `EvidencePhone`.

### Exit

The evidence view is reconstructed only from the frozen revision and cited
snapshots (never live state); differences are computed, not stored.

## REV-05 — Tamper-evident audit trail

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#rev-05).

**Original decision/dependency note:** [DEC-04](DEC.md) accepted 2026-09-27 (SHA-256 hash chain, nightly verification at 06:00, 15-year retention).

### Design

`canvas/AuditLog.dc.html`, integrity line in `canvas/EvidenceCompare.dc.html`.

### Scope

Hash-chained audit entries; nightly verification of the chain and of signed
revision digests with results recorded as System entries; workspace audit log
with range, actor, action, project filters and search; retention policy view;
"Export for inspection".

### Start here

Audit sources: `src/lib/audit-history.ts`, `api.change_events`,
`internal.record_configuration_change`, `admin-audit-explorer.tsx`,
`tests/db/gov-03-audit-events.test.ts`, DEC-04.

### Steps (PRs)

1. Hash chain: each audit entry stores the hash of the previous entry's hash
   and its own content; insert-only grants.
2. Nightly verification job writing a System entry with the result.
3. Audit log page per `AuditLog` with filters and export for inspection.

### Check it

DB test: altering any stored entry is detected by verification.

### Exit

Any modification of a stored audit entry or signed revision is detected by the
nightly check (database test); verification results are visible in the log.
