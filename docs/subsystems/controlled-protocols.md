# Controlled protocol contract preparation

Status: LAB-07 preparation only. The reconstructed parent baseline has no
`protocol_versions`, per-version acknowledgement or experiment-start contract.
This reference fixes the interfaces for coordinated implementation. The database
tests are deliberately red until the parent releases the serialized schema slot.
It does not record LAB-07 acceptance or a regulated-use compliance claim.

## Canonical identity

Protocols remain `api.records` of kind `protocol_template`. A controlled version
adds lifecycle metadata to an immutable `api.revisions` snapshot.

`api.protocol_versions.id` is both its primary key and a foreign key to
`api.revisions.id`. The version stores `workspace_id`, `protocol_record_id`, an
integer `version`, `status`, `effective_at`, `review_due_at`, `change_summary`,
`created_by_user_id`, and `created_at`. The database verifies revision ownership
and workspace. `UNIQUE(id, protocol_record_id, workspace_id)` supports an exact
project-association foreign key. Neither a record's `active` status nor its
mutable `properties.version` is controlled-version authority.

Lifecycle states are `draft`, `in_review`, `effective`, `superseded`, and
`retired`. Approval and lifecycle are separate. Approval never implicitly makes
a version effective. Effective release has an explicit timestamp and supersedes
the previous effective version atomically. Existing experiment pins do not change.

## Shared approval authority

The approval object is `protocol_revision`, with `object_id = protocol_versions.id`.
Submission, approval, return, and withdrawal use the existing `approval_requests`
RPCs and `approval_request_decisions` rows. No protocol approval engine exists.

Kind-scoped guards on those shared tables enforce the protocol sequence:

1. The author submits the exact frozen version.
2. A Scientist or Steward provides technical review.
3. A Reviewer, Admin, or Owner provides QA approval.

The technical reviewer and QA approver are distinct humans, both independent of
the author. Submission records authorship; it is not an independent approval.
The request fixes the allowed role union, `required_approvals = 2`, and
`require_independence = true`. Request guards reject weaker client policies.
Decision guards enforce order even through generic RPCs. The final approved
state requires the actual ordered decision trail, not a count alone.
Dataset, parser, and Record Model approval semantics remain with their owners.

## Project associations and eligibility

LAB-07 owns creation of the minimal `api.project_protocols` relation alongside
`protocol_versions`, under the parent-approved serialized schema handoff.
PROJ-01 owns its setter and structure-copy operations. One
association per `(project_id, protocol_record_id)` pins the exact
`protocol_version_id`. The composite foreign key is
`(protocol_version_id, protocol_record_id, workspace_id)`.

`internal.protocol_version_is_eligible(p_protocol_version_id uuid,
p_require_effective boolean) RETURNS boolean` evaluates lifecycle only. The
version and record must resolve in the same workspace, with no archived or
deleted protocol, and have a completed shared approval request. Draft,
superseded, and retired versions are ineligible. When effective status is
required, `status = 'effective'` and `effective_at <= now()` are required.
Otherwise an approved `in_review` version may be used. Unknown versions fail
closed. Project copying reuses this predicate and copies reference rows only.
It does not copy protocols, revisions, approvals, signatures, or training.

`internal.assert_protocol_start_eligible(p_protocol_version_id uuid,
p_owner_user_id text, p_project_id uuid) RETURNS void` rechecks the lifecycle
under locks and verifies workspace, project access, protocol access, and the
owner's exact-version acknowledgement. Where the project requires effective
protocols, the version must also match the project's explicit association.
An acknowledgement of a different revision never authorises start.

## Client and server interfaces

The same-origin data client reads `protocol_versions` and
`protocol_acknowledgements` under RLS. The latter records
`protocol_version_id`, `user_id`, and `acknowledged_at`.

Prepared mutation interfaces are:

- `api.create_protocol_version(p_protocol_record_id uuid,
p_change_summary text, p_review_due_at timestamptz)` returns the version row.
  It snapshots the protocol's canonical metadata and ordered blocks once.
- `api.set_protocol_version_status(p_protocol_version_id uuid, p_status text,
p_reason text, p_effective_at timestamptz)` returns the version row. Allowed
  caller targets are `in_review`, `effective`, and `retired`. Supersession is an
  atomic consequence of effective release, never a client bulk update.
- `api.acknowledge_protocol_version(p_protocol_version_id uuid)` returns the
  actor's acknowledgement. The server stamps the human identity and time.
  Clients cannot acknowledge on another person's behalf or invent historical dates.

The experiment-start RPC must invoke the start assertion for each pinned
protocol reference. It must not snapshot the live protocol again, silently
select the latest version, or trust the block's captured approval label.
Periodic review confirmation retains the same immutable version and records
the actor, time, reason, and next due date. Starting a new version creates a new
revision and requires new approval and acknowledgement.

## Scientific and evidence invariants

Frozen blocks retain purpose, parameters with structured units and tolerances,
procedure-step IDs, acceptance criteria, and the linked template identity.
Copies retain source revision and step IDs. Units and tolerances must not be
flattened or dropped by a text-only rendering projection.

Editing linked procedure text in an experiment records an actor-attributed
deviation against the pinned revision and source step. Execution completion
and ordinary notes are not definition changes. Deviations remain visible in
experiment History and review, including frozen evidence. Used-by references
filter by the exact revision, not only a record link to the protocol.

## Verification and outstanding work

`pnpm test src/lib/controlled-protocols.test.ts` checks the prepared client
boundary. `pnpm test:db tests/db/controlled-protocols.test.ts` exercises actual
PostgreSQL version identity, scientific snapshot preservation, shared approval
stage enforcement, effective-date eligibility, per-version acknowledgement,
start refusal, and supersession without acknowledgement transfer.
These database tests are expected to fail on the baseline's absent contracts.

The non-migration native document increment replaces the protocol detail's
lossy text projection with `RichTextContent`, retaining lists, scientific marks,
and procedure block identities. The page labels live content **Working document**,
reports loading and read failure, and rejects non-protocol records. Detail
navigation uses `?section=template`, separate from the parent list's `?tab=`.

`ProtocolVersionTraining` is a prepared native component, not an accepted
endpoint workflow. It filters acknowledgement by exact revision, offers only
self-acknowledgement, retains supplied dates, and handles pending, failed, and
unavailable states. It is not wired to the legacy record-level training route.
The Storybook fixtures are explicitly synthetic, not historical human evidence.

`pnpm test src/components/v3/protocols src/lib/controlled-protocols.test.ts`
checks the native document, prepared acknowledgement UI, and data boundary.
Rendered component fixtures cover light, dark, narrow, invalid-document,
failed-acknowledgement, pending, and unavailable states. A disposable migrated
database fixture also verifies the native protocol route reads procedure text
and retains the Template section after a reload. Neither check establishes
approval, training, experiment-start, or original-board acceptance.

Schema generation, migrations, lifecycle enforcement, exact-version pinning,
experiment start, reminders, periodic review, deviations, used-by queries,
controlled-version route wiring, and original screen acceptance remain pending. Parent trackers
remain unchanged. The original light and dark full-frame acceptance for
ProtocolsList, ProtocolDetail, NewExperiment, and NbNew remains unchanged.
