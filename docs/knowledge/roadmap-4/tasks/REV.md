# REV — Review, Signatures and Evidence

**Status (2026-09-27):** Proposed; not assigned. REV-03 and REV-05 follow [DEC-04](DEC.md), which takes GXP-01 / [ADR-0045](../../decisions/0045-regulated-intended-use-control-model.md) to a decision.

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

**Status:** proposed.

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

### Exit

A round-2 review shows only changes since round 1; returning sends all draft
comments at once; checklist completion is stored with the decision.

## REV-02 — Signature meanings and author signing

**Status:** proposed.

### Design

`canvas/NbSigned.dc.html`, `canvas/ReviewApproved.dc.html`,
`canvas/HelpRecords.dc.html`, `canvas/SettingsSignature.dc.html` (meanings).

### Scope

Meanings Authored, Reviewed, Reviewed and approved, Approved, Witnessed;
author signs at submission; witness requests; meanings restricted by role;
signatures table on signed records with signature IDs; signed PDF and
evidence package reflect them.

### Exit

Each meaning is enforced by role on the server; every signature records name,
time, meaning and exact revision digest.

## REV-03 — Signing with password re-entry and signature certification

**Status:** proposed; after [DEC-04](DEC.md).

### Design

`canvas/ReviewSign.dc.html`, `canvas/SettingsSignature.dc.html`,
`canvas/HomeFirstRun.dc.html`, `canvas/SignedOut.dc.html`.

### Scope

Signing dialog asks for the password again (focus starts in the field) and
shows signer, meaning, version and content hash; one-time signature
certification (identity verified by an admin, statement agreed, password) and a
practice signature; signature status per member; failed-attempt lockout.
Requires an authentication method compatible with company SSO (ADR decision).

### Exit

A signature cannot be created from a session alone; certification is required
before first signature; the auth method is recorded on each signature.

## REV-04 — Evidence versus live

**Status:** proposed.

### Design

`canvas/EvidenceCompare.dc.html`, `canvas/EvidencePhone.dc.html`,
`canvas/RecordInstrument.dc.html` (signed name versus current name).

### Scope

Evidence view of a signed revision beside live data: datasets at the cited
snapshot versus latest, other differences (renamed records, comments added
after signing), evidence package contents, integrity (hash verified and when),
cited by; "Create amendment" entry point.

### Exit

The evidence view is reconstructed only from the frozen revision and cited
snapshots (never live state); differences are computed, not stored.

## REV-05 — Tamper-evident audit trail

**Status:** proposed; after [DEC-04](DEC.md).

### Design

`canvas/AuditLog.dc.html`, integrity line in `canvas/EvidenceCompare.dc.html`.

### Scope

Hash-chained audit entries; nightly verification of the chain and of signed
revision digests with results recorded as System entries; workspace audit log
with range, actor, action, project filters and search; retention policy view;
"Export for inspection".

### Exit

Any modification of a stored audit entry or signed revision is detected by the
nightly check (database test); verification results are visible in the log.
