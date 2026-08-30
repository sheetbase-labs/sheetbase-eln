# Platform Administration (PLAT-04)

This document is the canonical reference for administering a Sheetbase
workspace through the product UI — the `/admin` surface. It covers roles,
sections, operations, and common workflows.

Routine administration does not require direct database access, shell access,
or internal implementation knowledge. All admin operations use supported
server-side domain APIs with PostgreSQL RLS and capability checks as the
authoritative permission boundary.

## Admin information architecture

All administration lives under `/admin`. The surface is a single-page tabbed
interface with the following sections:

| Section              | Route                  | Capability required          | Purpose                                                    |
| -------------------- | ---------------------- | ---------------------------- | ---------------------------------------------------------- |
| Dashboard            | `/admin/dashboard`     | (any member)                 | Health, activity, usage, and attention indicators         |
| Members              | `/admin/users`         | `workspace.admin`            | Membership, roles, invitations, suspension                 |
| Project access       | `/admin/project-access`| `workspace.admin`            | Explicit per-project access grants                         |
| Workspace settings   | `/admin/settings`      | `workspace.admin`            | Registration, review, signature, retention policies       |
| Sessions             | `/admin/sessions`      | `workspace.admin`            | Authenticated session review and revocation                |
| API credentials      | `/admin/api-credentials`| `workspace.admin`           | Service credential and personal token lifecycle            |
| Connectors           | `/admin/connectors`    | `integrations.manage`        | Connector status, secrets, run health                      |
| Pipelines            | `/admin/pipelines`     | `pipelines.manage`           | Pipeline definitions, schedules, run health                |
| Storage              | `/admin/storage`       | (any member)                 | File storage overview and largest files                    |
| Usage                | `/admin/usage`         | (any member)                 | Workspace counts and capacity indicators                   |
| Audit                | `/admin/activity`      | (any member)                 | Audit trail browser with filters and export                |
| Diagnostics          | `/admin/diagnostics`   | (any member)                 | Health checks, scheduler, executor, configuration state    |
| Deployment           | `/admin/deployment`    | (any member)                 | Version, environment, migration state, operational links   |

The navigation bar only shows sections the current user can access. Direct
URL access to a restricted section shows a permission-denied notice rather
than redirecting silently.

## Capability model

Administration is capability-driven, not UI-hiding. The server enforces
capabilities through `api.has_capability` (PostgreSQL SECURITY DEFINER RPCs
with RLS). The UI mirrors the same capability mapping from
`src/lib/capability.ts`.

| Capability              | Roles                              | Admin sections gated           |
| ----------------------- | ---------------------------------- | ------------------------------ |
| `workspace.admin`       | owner                              | Members, Project access, Settings, Sessions, API credentials |
| `integrations.manage`   | owner, admin, steward              | Connectors                     |
| `pipelines.manage`      | owner, admin, steward              | Pipelines                      |
| (none — member access)  | all workspace members              | Dashboard, Storage, Usage, Audit, Diagnostics, Deployment |

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

The API credentials section (`/admin/api-credentials`, owner-only) manages:

- **Service credentials** — scoped credentials for external automation.
- **Personal access tokens** — user-scoped credentials (also manageable from
  `/settings`).

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

See `docs/public-api-contract.md` and `docs/external-api.md` for the
canonical scope vocabulary.

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

This does not rebuild AUTO-03 authoring. See `docs/pipelines.md` for the
canonical Pipeline model.

### Schedule administration

Schedules are shown with: Pipeline, kind (interval/daily/event), enabled,
next run, last run, timezone, and event selector. Overdue/stale schedules
and repeated failures are highlighted. Schedule state is not silently
"fixed" from the UI.

### Run health overview

A general operational view shows recent pipeline and connector runs grouped
by: Running, Failed, Recently succeeded, Stale/reconciled. Links go to the
canonical detailed run views.

## Storage overview

The Storage section (`/admin/storage`, any member) shows:

- File count and total bytes.
- Dataset count and Dataset Version count.
- Largest files (bounded to 10, ordered by byte_size descending) with name,
  type, size, status, storage backend, and linked Record context.
- Recent files (bounded to 10, ordered by created_at descending) with the same
  metadata.

Estimates are labelled explicitly. Exact physical storage metrics are not
fabricated if the database cannot provide them cheaply.

## Usage overview

The Usage section (`/admin/usage`, any member) shows workspace counts:

- Members, records, datasets, dataset versions, files, file bytes,
  connectors, pipeline definitions, pipeline runs, connector runs.

### Capacity indicators

Practical capacity warnings are shown when values exceed validated scale:

- Datasets above 100k rows — "Above validated scale".
- High file storage (>10 GB) — informational warning.
- High schedule count (>100) — "Above validated scale".

These are informational warnings, not SLO violation alerts. Language uses
explicit terms like "Above validated scale" and "Approaching configured
limit".

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
- **Connector diagnostics** — active/paused counts, recent failures, missing
  secrets, repeated failures, per-connector status. Requires
  `integrations.manage`; non-managers do not see this section.
- **Configuration state** — file backend, auth mode, external API enabled,
  connector secret encryption, metrics enabled, collaboration enabled.
- **Migration state** — current vs expected migration, up to date/behind/unknown.

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

- [Deployment](deployment.md)
- [Recovery](recovery.md)
- [Security](security.md)
- [Performance](performance.md)
- [Observability](observability.md)

No secrets, JWT tokens, internal hostnames, or raw environment dumps are
exposed.

## Attention indicators

The Dashboard includes a deterministic "needs attention" model:

- Failed pipeline/connector runs (last 24 hours).
- Stale running runs (>15 minutes).
- Active connectors missing required secrets.
- Overdue schedules.
- Disabled connectors.

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
history forever." See `docs/testing.md` for pagination conventions.

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
   consult [deployment.md](deployment.md) for migration runbook.

### Export the audit log

1. Navigate to `/admin/activity` (any member can view; owner can export).
2. Apply filters as needed (actor, action, object type, date range).
3. Click "Export audit log" (owner only) to download a JSON file.

## Related documentation

- [Deployment](deployment.md) — deployment, rollback, and migration runbooks.
- [Recovery](recovery.md) — backup, restore, and disaster recovery.
- [Security](security.md) — security posture and surface inventory.
- [Performance](performance.md) — performance budgets and scale gates.
- [Observability](observability.md) — health endpoints, logs, and metrics.
- [Pipelines](pipelines.md) — canonical Pipeline model (AUTO-01/02/03).
- [Agent operations](agent-operations.md) — inspectable agent-authored mutations (AUTO-04).
- [Agent workflows](agent-workflows.md) — sequential plans over those proposals (AUTO-05).
- [Integrations](integrations.md) — connector framework (INT-01/02/03).
- [Authentication](authentication.md) — Better Auth and GitHub OAuth.
- [Governance roles](governance-roles.md) — role and capability reference.
- [File platform](file-platform.md) — file storage model.
- [Public API contract](public-api-contract.md) — external API scopes.
