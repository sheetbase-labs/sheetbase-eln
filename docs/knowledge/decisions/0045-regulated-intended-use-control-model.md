# 0045. Regulated intended-use and control model

- **Status:** accepted
- **Date:** 2026-09-06
- **Ticket:** GXP-01

## Context

Sheetbase has no production users, no production data and no concrete
regulated intended use. Regulation attaches to an intended use, not to
software in the abstract — so GXP-02..04 (controlled change, e-signatures,
validation packs) cannot be built against real requirements yet. This ADR
proposes the control-model framework: which categories exist, which existing
Sheetbase controls each category maps to, and what evidence would activate
stronger controls. It makes no compliance claim of any kind.

## Decision (proposed)

1. Intended-use categories, least to most controlled:
   - **Exploratory research** (default): working Notebooks/Sheets/Datasets
     with ordinary versioning, provenance and audit. No additional controls.
   - **Controlled development**: published Definitions/Templates/Schemas plus
     review-before-submit flows. Adds: change control on governed
     configuration (publish/retire lifecycle already in the product),
     submission review with human sign-off (existing review contracts).
   - **Regulated record** (activated only with a concrete filing or inspection
     need): the above plus immutable frozen evidence (Dataset Versions,
     revision envelopes), amendment-only correction flows, retention/lock
     behaviour, and exportable evidence packs.
2. Control mapping is to controls that already exist: Definition/Template
   publish-retire lifecycle, review/submit/decide evidence contracts, frozen
   Dataset Versions and revision envelopes, RLS/server enforcement, and the
   append-only audit trail. No parallel compliance subsystem is proposed.
3. Roles follow existing planes: Stewards own scientific configuration,
   owners administer platform controls, and signers are named humans in
   human sessions. Agents and integrations never attest — the AUTO-04/05
   human-only attestation boundary is part of the control model.
4. Audit events remain operational telemetry. Regulated evidence is frozen
   state (versions, envelopes, signatures), never log excerpts.
5. Residual posture is explicit: no 21 CFR Part 11 / Annex 11 blanket claim;
   validation packs (GXP-04) are assembled per intended use from supported
   records when a real use activates the category.

## Activation gate

GXP-02..04 implementation begins only when a concrete regulated intended use
names its category, workflows, objects, roles and retention needs. Completing
other Roadmap 3 waves does not satisfy this gate.

## Owner decision (2026-09-27)

The intended use the v3 design shows is accepted as **controlled development and
regulated record for a CDMO working under client audit** (the Process
Development workspace, `canvas/ReviewSign.dc.html`,
`canvas/SettingsSignature.dc.html`, `canvas/AuditLog.dc.html`). The concrete
controls are decided:

1. **Re-authentication.** Every signature requires **password re-entry** against
   the user's local credential, including when the user signed in through
   company SSO. A provider step-up is used instead only where the IdP exposes
   it and the workspace configures it. A short-lived signing token is bound to
   the user, session and revision digest; `sign_revision` refuses without it.
2. **Certification.** Before the first signature a user certifies: an admin
   confirms identity, the user agrees to the statement, then enters their
   password. A practice signature is offered and is not stored as a real one.
3. **Signature meanings and roles.** Authored (the author, at submission),
   Witnessed (a member asked to witness another's record), Reviewed and
   Reviewed and approved (the Reviewer role). Every signature records the
   signer's full name, date/time, meaning and the exact revision digest.
4. **Lockout.** Three consecutive failed re-authentication attempts lock
   signing for 15 minutes, with an audit entry.
5. **Tamper-evident audit.** Audit entries form an append-only SHA-256 hash
   chain (each entry stores the previous hash and its own content) with
   insert-only grants. A nightly job at 06:00 verifies the chain and the signed
   revision digests and records the result as a System entry. Entries cannot be
   edited or deleted and are retained for 15 years with an "export for
   inspection" path. Audit entries are frozen evidence, not operational
   telemetry.

The GXP-02..04 activation gate still requires a named filing/inspection need
before validation packs are assembled; this decision fixes the control model the
design depends on.

## Consequences

- Exploratory work stays unburdened: stronger controls are configured per
  workflow, never forced globally.
- When a regulated use arrives, its implementation is mapping and activation,
  not architecture.
- Until then, this ADR costs nothing and constrains nothing.
