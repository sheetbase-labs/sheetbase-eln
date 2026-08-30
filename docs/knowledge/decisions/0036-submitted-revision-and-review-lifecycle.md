# 0036. Submitted revision and review lifecycle

- **Status:** accepted
- **Date:** 2026-07-26
- **Ticket:** REV-001
- **Builds on:** 0013, 0015, 0023, 0028

## Context

The live notebook, generated scientific tables, calculations, links and files
can all change independently. A reviewer must see one coherent submission and
be able to prove later what was reviewed, without presenting feature presence
as regulatory compliance. The Review Inbox and Review & Approvals mockups also
require assigned steps, version comparison, comments, checks, signatures and a
readable history.

## Decision

### Submitted evidence

A submission creates one immutable revision envelope in a single database
transaction. It records the record and workspace identity, author, submission
time, source structure and metadata versions, workflow definition version and
an integrity digest over a canonical representation containing:

- record metadata and the ordered block identities, types, schema versions,
  versions and complete payloads;
- record links with stable source and target identities, link type, link
  metadata and an explicitly pinned target revision when the link claims a
  particular version;
- each attached scientific table's identity, schema version, ordered column
  definitions and rows keyed by stable row and column identities;
- formula definitions, bindings and versions plus the calculation input
  revision, calculation status and current result or structured error used at
  submission time;
- attached file identity, filename, media type, size, checksum, storage
  identity and attachment target. The file bytes remain in object storage but
  retention must protect every object referenced by submitted evidence.

The digest covers the canonical envelope, not mutable database row layout.
Presentation-only values such as display formatting may be stored for faithful
rendering, but they never replace stable identities or source scientific data.

### Live context

Current user profile labels, workspace settings, later comments and review
events, and the current state of linked records remain live context. Inventory
quantity, location, custody, expiry and availability also remain live unless a
value was copied into a submitted block or table; the envelope preserves the
value actually cited without pretending the external inventory record stopped
changing. Later calculations, schemas, links, files and notebook edits belong
to the next draft and never rewrite the submitted envelope.

### Lifecycle

The review lifecycle is:

1. `draft` may be edited and becomes `submitted` only through the transactional
   snapshot operation. Submission requires at least one assigned first-step
   reviewer and a versioned workflow definition.
2. `submitted` may move to `changes_requested`, `rejected` or `approved`.
   Requesting changes and rejecting require a comment. Approval requires the
   assigned actor for the active step, all required checklist items and no
   blocking integrity check failures.
3. `changes_requested` opens a new mutable draft derived from the submitted
   revision. Resubmission creates a new revision; it does not reopen or modify
   the old one.
4. `approved` becomes `locked` only after every required signature is present
   and still references the same revision digest. `locked` is terminal.
5. A rejected or locked revision can be followed only by an explicit new draft
   or amendment linked to it. There is no unlock or in-place evidence repair.

A submitter may withdraw a `submitted` or `changes_requested` review before it
is approved. Withdrawal requires a reason and is a retained terminal outcome
for that review attempt. The associated immutable revision stays readable.

Submitting, requesting changes, rejecting, withdrawing, approving, signing,
locking and opening an amendment are append-only attributed events. Retried
commands must be idempotent and stale transitions must fail against an expected
state or version.

### Intent and authentication

Submission and approval require explicit confirmation in a valid session.
Requesting changes, rejection and withdrawal require both confirmation and a
comment. Applying an electronic signature requires fresh authentication and an
explicit statement of signing meaning; locking requires fresh authentication
or a still-valid signature ceremony and a final digest comparison. The exact
signature assurance mechanism is owned by SIGN-001.

Workflow roles are assignments, not labels. Only the actor assigned to the
active step, or an authorised reassignment role, may complete that step. Actor,
session identity, role, workflow version and revision digest are recorded with
every consequential action.

### History and product language

Withdrawn, rejected and superseded submissions remain ordered in history with
their comments, checks, assignments and integrity digest. A superseding
revision points back to the revision it replaces; the older revision may point
forward for navigation, but remains independently readable.

The production UI may say that configured checks passed or that a workflow is
complete. It must not show a generic `Compliant`, `Part 11 compliant` or similar
badge based only on these features. Compliance depends on configuration,
validation and operating process outside this lifecycle.

## Consequences

- REV-002 must extend the existing lightweight `revisions` snapshot into the
  canonical envelope and add submission/workflow state without permitting
  ordinary updates to frozen evidence.
- Diffs, comments, checks and signatures bind to stable revision identities and
  digests, so later live edits cannot move or reinterpret their targets.
- Object retention and calculation evidence become part of submission
  correctness, while live inventory and current linked-record context can
  continue to evolve honestly.
- The approved mockup composition remains useful, but its compliance badges are
  treated as non-authoritative concept content and are not production status.
