# Platform Administration (PLAT-04)

This document is the canonical reference for administering a Sheetbase
workspace through the product UI — the `/admin` surface. It covers roles,
sections, operations, and common workflows.

Routine administration does not require direct database access, shell access,
or internal implementation knowledge. All admin operations use supported
server-side domain APIs with PostgreSQL RLS and capability checks as the
authoritative permission boundary.

## Administration planes

Administration spans three planes with one authority each. No configuration
is writable in two places:

| Plane                            | Surface                                                                                                 | Authority                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Steward data-language            | `/configure` (Models, Dataset Schemas, Sheet Definitions, Notebook Templates, vocabularies, promotions) | Stewards publish without `workspace.admin`; owners keep security administration |
| Security and platform operations | `/admin` (this document)                                                                                | Capability-gated per section; server enforcement is authoritative               |
| Personal tokens                  | `/settings`                                                                                             | Each member manages only their own tokens                                       |

Cross-links point users at the right plane: the `/admin` header and the
permission-denied notice link to Configuration and Settings; the
API-credentials section links personal-token holders to `/settings`; and
`/settings` links service-credential work to `/admin/api-credentials`.
The legacy `/admin/model-fields` destination redirects to
`/configure?kind=model` (preserving `?model=`); it is the only redirect that
stays, and stored links should point at `/configure` directly.

## Admin information architecture

| Section            | Route                    | Capability required   | Purpose                                                                            |
| ------------------ | ------------------------ | --------------------- | ---------------------------------------------------------------------------------- |
| Dashboard          | `/admin/dashboard`       | (any member)          | Health, activity, usage, and attention indicators                                  |
| External access    | `/admin/external-access` | (any member)          | Unified lifecycle view over members, credentials, connectors, webhooks, extensions |
| Members            | `/admin/users`           | `workspace.admin`     | Membership, roles, invitations, suspension                                         |
| Project access     | `/admin/project-access`  | `workspace.admin`     | Explicit per-project access grants                                                 |
| Workspace settings | `/admin/settings`        | `workspace.admin`     | Registration, review, signature, retention policies                                |
| Sessions           | `/admin/sessions`        | `workspace.admin`     | Authenticated session review and revocation                                        |
| API credentials    | `/admin/api-credentials` | `workspace.admin`     | Workspace service credentials only (personal tokens live in `/settings`)           |
| Connectors         | `/admin/connectors`      | `integrations.manage` | Connector status, secrets, run health                                              |
| Pipelines          | `/admin/pipelines`       | `pipelines.manage`    | Pipeline definitions, schedules, run health                                        |
| Extensions         | `/admin/extensions`      | `extensions.manage`   | Extension install, update, disable, remove and history                             |
| Webhooks           | `/admin/webhooks`        | `integrations.manage` | Subscriptions, endpoint health, delivery history, replay                           |
| Storage            | `/admin/storage`         | (any member)          | File storage overview and largest files                                            |
| Usage              | `/admin/usage`           | (any member)          | Workspace counts and capacity indicators                                           |
| Audit              | `/admin/activity`        | (any member)          | Audit trail browser with filters and export                                        |
| Diagnostics        | `/admin/diagnostics`     | (any member)          | Health checks, scheduler, executor, configuration state                            |
| Deployment         | `/admin/deployment`      | (any member)          | Version, environment, migration state, operational links                           |

The navigation bar only shows sections the current user can access. Direct
URL access to a restricted section shows a permission-denied notice rather
than redirecting silently; the notice links to Configuration and Settings
so a steward who lands in the wrong plane is never at a dead end.

## Capability model

Administration is capability-driven, not UI-hiding. The server enforces
capabilities through `api.has_capability` (PostgreSQL SECURITY DEFINER RPCs
with RLS). The UI mirrors the same capability mapping from
`src/lib/capability.ts`.

| Capability             | Roles                 | Admin sections gated                                                       |
| ---------------------- | --------------------- | -------------------------------------------------------------------------- |
| `integrations.manage`  | owner, admin, steward | Connectors, Webhooks                                                       |
| `pipelines.manage`     | owner, admin, steward | Pipelines                                                                  |
| `extensions.manage`    | owner, admin, steward | Extensions                                                                 |
| (none — member access) | all workspace members | Dashboard, External access, Storage, Usage, Audit, Diagnostics, Deployment |

Key invariants:

- `viewer` is read-only (GOV-01) — no mutation capabilities.
- `api_client` (credential sessions) do not receive admin UI semantics.
  Capability mask is fail-closed for `api_client` (migration 0139).
- Role changes take effect immediately through server-side capability
  resolution; the UI does not cache capabilities.
- **Server-authoritative enforcement**: every privileged admin server function
  calls `api.has_capability()` directly (via `requireCapability()`), not just
  the route-level capability check. An ordinary member cannot call a privileged
  admin server function directly even if they know the endpoint. The UI
  navigation gating and the server function enforcement use the same canonical
  capability source.

## Workspace settings

The Workspace settings section (`/admin/settings`, owner-only) provides:

- **Registration mode** — `open` or `invitation_only`.
- **Review workflow** — enabled/disabled with JSON configuration.
- **Signature policy** — JSON policy for sign/counter-sign rules.
- **Audit retention days** — how long change events are retained.
- **Integration settings** — JSON blob for workspace-level integration config.

Immutable fields (workspace ID, creation metadata) are shown read-only.

## Member administration

The Members section (`/admin/users`, owner-only) provides:

- **Member list** — name, role, status (active/suspended), joined date.
- **Role change** — change a member's role through canonical RPCs.
- **Suspend/reactivate** — suspend or reinstate a member.
- **Remove member** — remove a member from the workspace.
- **Search** — filter members by name or email.

All mutations produce audit evidence in `change_events`.

### Invitations

If workspace invitations exist, they are shown alongside the member list:

- Pending invitations with email, proposed role, and expiry.
- Revoke a pending invitation.
- Create a new invitation with email, role, and expiry window.

## Credential administration

The API credentials section (`/admin/api-credentials`, owner-only) manages
workspace service credentials — scoped credentials for external automation.
It does not manage personal access tokens: each member manages their own
tokens from `/settings`, and the section links there. The server list
endpoint filters to `kind = 'service'`, so the two surfaces cannot drift
into duplicate authority.

Each credential shows: name, type, scopes, created date, last used, expiry,
and status.

Operations:

- **Create** — generates a new credential; the secret is shown once at
  creation time and never again.
- **Revoke** — permanently revokes a credential (confirmation required).
- **Rotate** — creates a replacement credential with the same scopes and
  expiry; the new secret is shown once.

### Credential scope clarity

Credentials display their actual external API scope allowlist (e.g.
`datasets:read`, `sheets:write`), not internal role names. Credentials do
not inherit human-session privileges. Ambiguous labels like "Full access"
are not used unless that is literally the canonical scope.

See `docs/api/public-api-contract.md` and `docs/api/external-api.md` for the
canonical scope vocabulary.

## External access overview

The External access section (`/admin/external-access`, any member) is the
single operational view over externally-acting identities and integrations.
It joins members/roles, service credentials, connectors, webhooks and
extensions with lifecycle/status metadata and routes every action through
the existing canonical operations — it rebuilds no table.

### Directly available in `/admin/external-access`

- **Members and roles** — role and suspended state per member (owner-only
  panel); membership changes live in `/admin/users`.
- **Service credentials** — Active/Expired/Revoked lifecycle with last use
  (`last_used_at`) and expiry (owner-only panel); rotate/revoke run through
  the canonical credential operations and reveal replacement secrets once.
- **Connectors** — status with last run, last result and secret state
  (`integrations.manage` panel); enable/disable via the canonical connector
  update.
- **Webhooks** — status with 24h endpoint health (`integrations.manage`
  panel); enable/disable via the canonical subscription update. Full
  operations live in `/admin/webhooks`.
- **Extensions** — install status and version (`extensions.manage` panel);
  enable/disable via the canonical extension operations.

Each panel links to its canonical section and to the audit trail
(`/admin/activity`). Panels outside the viewer's capabilities stay hidden,
and every row action remains server-enforced by its home operation — the
overview never substitutes enforcement.

## Connector administration

The Connectors section (`/admin/connectors`, `integrations.manage`) provides
an operational overview with targeted actions. It is not a duplicate of the
connector product surface — detailed configuration and secret management are
delegated to the canonical Integration detail pages.

### Directly available in `/admin/connectors`

- **Connector list** — name, type, direction, status, last run, last result,
  error state.
- **Enable/disable** — toggle connector active/paused state.
- **Retry failed run** — retry the most recent failed run via the canonical
  `api.start_connector_run` RPC (with `retry_of_run_id`). Requires
  `integrations.manage`. Confirmation is not required (non-destructive retry).
- **Secret state** — shows configured/missing for each connector's required
  secrets. Plaintext values are never exposed.

### Delegated to canonical Integration pages

The following operations are available on the existing connector/Integration
detail surfaces (linked from the admin connector list), not duplicated in
`/admin`:

- **Edit non-secret config** — full connector configuration editing.
- **Manage secret references** — set, replace, or remove sealed secrets via
  the canonical encrypted secret model (`internal.connector_secrets`).
- **Run** — trigger a connector run (full run configuration).
- **Inspect run history** — detailed per-run views with logs and output.

### Connector secret administration

Secret state is shown as configured/missing with the secret name/reference in
the admin overview. Plaintext values are never exposed. Setting, replacing,
or removing secrets is performed on the canonical Integration detail page,
which uses the existing encrypted secret model (`internal.connector_secrets`).
This avoids creating connector-specific ad-hoc secret storage.

## Pipeline administration

The Pipelines section (`/admin/pipelines`, `pipelines.manage`) provides
operational administration, not authoring duplication.

### Directly available in `/admin/pipelines`

- **Pipeline definitions** — name, status, current published version.
- **Schedules** — kind, enabled, next run, last run, timezone, event selector.
- **Schedule enable/disable** — toggle pipeline schedules via the canonical

  `api.update_pipeline_schedule` RPC. Requires `pipelines.manage`. Produces
  audit/change evidence.

- **Run health** — recent failed/running/stale counts.
- **Retry/cancel** — links to the canonical pipeline run detail for retry/cancel
  where supported by the pipeline runtime.

### Delegated to canonical Pipeline surface

- **Pipeline authoring** — creating, editing, and publishing Pipeline
  definitions is done at `/pipelines` (AUTO-03). The admin page links to the
  authoring surface.

This does not rebuild AUTO-03 authoring. See `docs/subsystems/pipelines.md` for the
canonical Pipeline model.

### Schedule administration

Schedules are shown with: Pipeline, kind (interval/daily/event), enabled,
next run, last run, timezone, and event selector. Overdue/stale schedules
and repeated failures are highlighted. Schedule state is not silently
"fixed" from the UI.

### Run health overview

A general operational view shows recent pipeline, connector, and webhook runs
grouped by: Running, Failed, Recently succeeded, Stale/reconciled — failed
jobs of every kind (connector/pipeline/webhook dead letters) are visible in
one place. Webhook failures come from EVENT-02 delivery state (`dead_letter`
rows with their subscription key) plus a delivery summary (dead-lettered in
24h, retry debt, auto-disabled endpoints); the per-plane detail stays on the
canonical surfaces (`/admin/pipelines`, `/admin/connectors`,
`/admin/webhooks`). Links go to the canonical detailed run views.

## Webhook administration

The Webhooks section (`/admin/webhooks`, `integrations.manage`) is the
operations surface over the webhook RPC+lib layer: subscriptions previously
had no management UI. It surfaces EVENT-02 delivery operations and never
reimplements them.

### Directly available in `/admin/webhooks`

- **Subscriptions** — key, endpoint URL, event-type filters, status.
- **Endpoint health** — per-subscription 24h success window
  (delivered/total), last error (code, message, time), consecutive failures
  against the auto-disable threshold with an explicit Auto-disabled state,
  and retry debt — all from `api.get_webhook_endpoint_health`.
- **Enable/disable** — status toggle through the canonical
  `api.update_webhook_subscription` RPC; re-enabling resets
  `consecutive_failures`. Archive runs through
  `api.delete_webhook_subscription`.
- **Rotate secret** — new signing secret through
  `api.rotate_webhook_secret`, revealed exactly once.
- **Delivery history** — paginated `api.list_webhook_deliveries` with
  subscription, status (including `dead_letter`), event-type and
  time-window filters; the dead-letter view carries the failure reason
  (`error_code` / `error_message`).
- **Replay** — single terminal-delivery replay via
  `api.replay_webhook_delivery`, plus windowed bulk replay via
  `api.replay_webhook_deliveries` (safe re-runs, one audit event).
  Pending/retrying rows are never replayable — they belong to the retry
  sweep.

Subscription creation stays on the webhooks API; the admin surface operates
existing subscriptions. Signing secrets are never listed.

## Storage overview

The Storage section (`/admin/storage`, any member) shows:

- File count and total bytes.
- Dataset count and Dataset Version count.
- Largest files (bounded to 10, ordered by byte_size descending) with name,
  type, size, status, storage backend, and linked Record context.
- Recent files (bounded to 10, ordered by created_at descending) with the same
  metadata.
- Quota context: no workspace storage quota is configured in this
  deployment, so the section labels figures as observed usage rather than
  quota consumption and states that uploads are never blocked by a quota.
  If a quota is ever configured, the section reports the limit and the
  at-limit behaviour from the server — limits are never invented client-side.

Estimates are labelled explicitly. Exact physical storage metrics are not
fabricated if the database cannot provide them cheaply.

## Usage overview

The Usage section (`/admin/usage`, any member) shows workspace counts:

- Members, records, datasets, dataset versions, files, file bytes,
  connectors, pipeline definitions, pipeline runs, connector runs.
- Limit context per figure: where no limit is configured the section says so
  ("No quota configured — observed usage, nothing blocked") instead of
  showing a theatre number.

### Capacity indicators

Practical capacity warnings are shown when values exceed validated scale.
Each warning links to its corrective-action section and, where an
operational runbook exists, to the runbook:

- High schedule count (>100 enabled) — "Above validated scale" (guidance, not
  a quota; nothing is enforced). Links to `/admin/pipelines`.
- High file storage (>10 GB observed) — informational; states that no quota
  is configured and nothing is blocked. Links to `/admin/storage`.

These are informational warnings, not SLO violation alerts.

## Audit administration

The Audit section (`/admin/activity`, any member) provides a browser over the
canonical audit/change-event system (`change_events`):

- Filter by actor, action/event type, object type, date range.
- Export audit log (owner-only, JSON download).
- Security-relevant event filters for role changes, credential
  creation/revocation, connector secret/config changes, Pipeline
  publish/retire, signature/review events, and workspace setting changes.

This is a filtered view of existing evidence, not a second audit log.
Sensitive audit classes remain subject to existing permissions.
The stable external names for these changes are pinned in the
[event catalogue](../api/event-catalogue.md).

## Diagnostics

The Diagnostics section (`/admin/diagnostics`, any member) surfaces:

- **App health** — status (ready/not_ready/degraded), database probe,
  PostgREST probe.
- **Scheduler diagnostics** — enabled state from `SHEETBASE_SCHEDULER_ENABLED`,
  last evaluated schedule timestamp, sweep interval, enabled schedule count,
  recovered stale count. When the scheduler is disabled, status shows
  "Disabled". When enabled but no schedules have been evaluated, last sweep
  shows "No schedules evaluated yet" rather than a false healthy value.
- **Pipeline executor diagnostics** — active runs, recent failures,
  execution timeout, row/input caps.
- **Webhook delivery diagnostics** — dead-lettered deliveries (24h), retry
  debt, auto-disabled endpoints, with a link to endpoint health in
  `/admin/webhooks` and to the observability runbook.
- **Connector diagnostics** — active/paused counts, recent failures, missing
  secrets, repeated failures, per-connector status. Requires
  `integrations.manage`; non-managers see an explicit notice naming the
  required capability instead of a silently missing section.
- **Configuration state** — file backend, auth mode, external API enabled,
  connector secret encryption, metrics enabled, collaboration enabled.
- **Migration state** — current vs expected migration, up to
  date/behind/unknown, with a link to the deployment runbook when behind or
  unknown.

### Health semantics

Health respects PLAT-01/02 semantics. `live`, `ready`, and `healthy` are not
redefined. If optional subsystems are degraded but the app remains ready,
the status shows `degraded` rather than marking the whole application down.

### Diagnostic checks

Checks are explicit and bounded: database query, PostgREST query, scheduler
heartbeat, pipeline executor stats. No destructive checks. No automatic
probing of external connector systems without user action.

## Deployment/version information

The Deployment section (`/admin/deployment`, any member) shows:

- Sheetbase version and commit SHA.
- Build time and environment.
- Database migration version (expected vs applied).
- PostgreSQL version and PostgREST version (where available).

It also surfaces operational runbook links:

- [Deployment](../operations/deployment.md)
- [Recovery](../operations/recovery.md)
- [Security](../operations/security.md)
- [Performance](performance.md)
- [Observability](../operations/observability.md)

No secrets, JWT tokens, internal hostnames, or raw environment dumps are
exposed.

## Attention indicators

The Dashboard includes a deterministic "needs attention" model. Every item
derives from existing state (no new tracking tables) and carries a
corrective-action link plus a runbook link where an operational runbook
exists:

- Failed pipeline/connector runs (last 24 hours) → `/admin/pipelines`,
  `/admin/connectors`; observability runbook.
- Webhook deliveries dead-lettered (last 24 hours), retry debt
  (pending/retrying), auto-disabled endpoints, and active endpoints with
  consecutive failures → `/admin/webhooks`; observability runbook.
- Stale running runs (>15 minutes) → `/admin/pipelines`; observability
  runbook.
- Active connectors missing required secrets → `/admin/connectors`;
  administration runbook.
- Overdue schedules → `/admin/pipelines`; observability runbook.
- Expired / expiring (30 days) / stale-unused (90 days) service credentials
  → `/admin/api-credentials`; security runbook.
- Incompatible extension installs (declared-range violation against the
  running app version; unknown compatibility never warns) and disabled
  installs → `/admin/extensions`; administration runbook.
- Disabled connectors (info).

These are bounded, deterministic conditions — not AI ranking or an unbounded
notification framework.

## Destructive-action confirmation

Explicit confirmation is required for:

- Revoke credential.
- Remove member.
- Retire connector.
- Delete schedule.
- Destructive workspace-level changes.

Harmless edits do not require confirmation.

## Admin mutation auditability

Every meaningful admin mutation produces canonical audit/change evidence in
`change_events`. This includes: role changes, credential create/revoke/
rotate, connector config changes, Pipeline schedule enable/disable, and
workspace setting changes.

## Pagination and bounded lists

Admin lists are bounded with pagination: members, credentials, connector
runs, pipeline runs, audit events, and files. The system does not load "all
history forever." See `docs/development/testing.md` for pagination conventions.

## Common operational workflows

### Invite a new member

1. Navigate to `/admin/users` (owner only).
2. Use the invitation form with email, role, and expiry.
3. The invitee receives an invitation to join the workspace.

### Change a member's role

1. Navigate to `/admin/users` (owner only).
2. Select the member in the list.
3. Use the role selector in the member details inspector.
4. The change takes effect immediately (server-side capability resolution).

### Suspend a member

1. Navigate to `/admin/users` (owner only).
2. Select the member.
3. Click "Suspend" in the inspector.
4. The member loses access immediately. Reactivate with "Reinstate".

### Create an API credential

1. Navigate to `/admin/api-credentials` (owner only).
2. Click "Create credential".
3. Enter a name, select scopes, and optionally set an expiry.
4. The secret is shown once — copy it immediately.
5. The credential appears in the list with its scopes and status.

### Revoke an API credential

1. Navigate to `/admin/api-credentials` (owner only).
2. Find the credential in the list.
3. Click "Revoke" and confirm.
4. The credential can no longer authenticate.

### Diagnose a failed connector

1. Navigate to `/admin/diagnostics` (any member).
2. Check the connector diagnostics section (requires `integrations.manage`)
   for missing secrets or repeated failures.
3. Navigate to `/admin/connectors` (`integrations.manage`).
4. Review the connector's last run error and status.
5. If the last run failed, click "Retry" to retry via the canonical
   `api.start_connector_run` RPC.
6. For secret management or full configuration changes, follow the link to the
   canonical Integration detail page.

### Check migration state

1. Navigate to `/admin/diagnostics` or `/admin/deployment` (any member).
2. Check the migration state section.
3. "Up to date" means the database matches the expected migration.
4. "Behind" or "Unknown" indicates the app and database are out of sync —
   consult [deployment.md](../operations/deployment.md) for migration runbook.

### Export the audit log

1. Navigate to `/admin/activity` (any member can view; owner can export).
2. Apply filters as needed (actor, action, object type, date range).
3. Click "Export audit log" (owner only) to download a JSON file.

## Related documentation

- [Deployment](../operations/deployment.md) — deployment, rollback, and migration runbooks.
- [Recovery](../operations/recovery.md) — backup, restore, and disaster recovery.
- [Security](../operations/security.md) — security posture and surface inventory.
- [Performance](performance.md) — performance budgets and scale gates.
- [Observability](../operations/observability.md) — health endpoints, logs, and metrics.
- [Pipelines](pipelines.md) — canonical Pipeline model (AUTO-01/02/03).
- [Agent operations](agent-operations.md) — inspectable agent-authored mutations (AUTO-04).
- [Agent workflows](agent-workflows.md) — sequential plans over those proposals (AUTO-05).
- [Integrations](integrations.md) — connector framework (INT-01/02/03).
- [Authentication](../operations/authentication.md) — Better Auth and GitHub OAuth.
- [Governance roles](governance-roles.md) — role and capability reference.
- [File platform](file-platform.md) — file storage model.
- [Public API contract](../api/public-api-contract.md) — external API scopes.
