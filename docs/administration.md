# Platform Administration (PLAT-04)

This document is the reference for administering a Sheetbase workspace through
the product UI. The admin surface lives at `/admin`. It covers roles,
sections, operations, and common workflows.

Routine administration does not need database access, shell access, or
internal implementation knowledge. All admin operations use supported
server-side domain APIs. PostgreSQL RLS and capability checks are the
authoritative permission boundary.

## Admin sections

All administration lives under `/admin`. The admin surface is a single-page
tabbed interface with these sections:

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

The navigation bar shows only sections the current user can access. Direct
URL access to a restricted section shows a permission-denied notice. It does
not redirect silently.

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

The model has these invariants:

- `viewer` is read-only (GOV-01) and has no mutation capabilities.
- `api_client` (credential sessions) do not get admin UI semantics. The
  capability mask is fail-closed for `api_client` (migration 0139).
- Role changes take effect immediately through server-side capability
  resolution. The UI does not cache capabilities.
- **Server-authoritative enforcement**: every privileged admin server
  function calls `api.has_capability()` directly (through
  `requireCapability()`), not only the route-level capability check. A member
  cannot call a privileged admin server function directly, even if they know
  the endpoint. UI navigation gating and server function enforcement use the
  same canonical capability source.

## Workspace settings

The Workspace settings section (`/admin/settings`, owner-only) provides:

- **Registration mode** — `open` or `invitation_only`.
- **Review workflow** — enabled or disabled, with JSON configuration.
- **Signature policy** — a JSON policy for sign and counter-sign rules.
- **Audit retention days** — how long the system retains change events.
- **Integration settings** — a JSON blob for workspace-level integration
  configuration.

Immutable fields (workspace ID, creation metadata) are shown read-only.

## Member administration

The Members section (`/admin/users`, owner-only) provides:

- **Member list** — name, role, status (active or suspended), joined date.
- **Role change** — change a member's role through canonical RPCs.
- **Suspend or reinstate** — suspend or reinstate a member.
- **Remove member** — remove a member from the workspace.
- **Search** — filter members by name or email.

All mutations produce audit evidence in `change_events`.

### Invitations

If the workspace has invitations, they appear beside the member list:

- Pending invitations show email, proposed role, and expiry.
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

- **Create** — generate a new credential. The secret shows once at creation
  time and never again.
- **Revoke** — permanently revoke a credential (confirmation required).
- **Rotate** — create a replacement credential with the same scopes and
  expiry. The new secret shows once.

### Credential scopes

Credentials show their external API scope allowlist (for example
`datasets:read`, `sheets:write`), not internal role names. Credentials do not
inherit human-session privileges. Ambiguous labels like "Full access" are not
used unless that is the canonical scope.

See `docs/public-api-contract.md` and `docs/external-api.md` for the
canonical scope vocabulary.

## Connector administration

The Connectors section (`/admin/connectors`, `integrations.manage`) gives an
operational overview with targeted actions. It is not a copy of the connector
product surface. Detailed configuration and secret management stay on the
canonical Integration detail pages.

### Available in `/admin/connectors`

- **Connector list** — name, type, direction, status, last run, last result,
  error state.
- **Enable/disable** — toggle the connector between active and paused.
- **Retry failed run** — retry the most recent failed run through the
  canonical `api.start_connector_run` RPC (with `retry_of_run_id`). Requires
  `integrations.manage`. No confirmation is required (the retry is not
  destructive).
- **Secret state** — show configured or missing for each connector's required
  secrets. Plaintext values are never exposed.

### Delegated to the Integration pages

These operations are available on the existing connector and Integration
detail surfaces (linked from the admin connector list). They are not
duplicated in `/admin`:

- **Edit non-secret config** — edit the full connector configuration.
- **Manage secret references** — set, replace, or remove sealed secrets
  through the canonical encrypted secret model
  (`internal.connector_secrets`).
- **Run** — trigger a connector run with full run configuration.
- **Inspect run history** — open detailed per-run views with logs and output.

### Connector secret administration

The admin overview shows secret state as configured or missing, with the
secret name or reference. Plaintext values are never exposed. You set,
replace, or remove secrets on the canonical Integration detail page. That
page uses the existing encrypted secret model (`internal.connector_secrets`).
Sheetbase does not create connector-specific ad-hoc secret storage.

## Pipeline administration

The Pipelines section (`/admin/pipelines`, `pipelines.manage`) gives
operational administration. It does not duplicate authoring.

### Available in `/admin/pipelines`

- **Pipeline definitions** — name, status, current published version.
- **Schedules** — kind, enabled, next run, last run, timezone, event selector.
- **Schedule enable/disable** — toggle pipeline schedules through the
  canonical `api.update_pipeline_schedule` RPC. Requires `pipelines.manage`.
  Produces audit and change evidence.
- **Run health** — recent failed, running, and stale counts.
- **Retry and cancel** — links to the canonical pipeline run detail for retry
  or cancel where the pipeline runtime supports it.

### Delegated to the Pipeline surface

You create, edit, and publish Pipeline definitions at `/pipelines` (AUTO-03).
The admin page links to the authoring surface.

This does not rebuild AUTO-03 authoring. See `docs/pipelines.md` for the
canonical Pipeline model.

### Schedule administration

Each schedule shows: Pipeline, kind (interval, daily, or event), enabled,
next run, last run, timezone, and event selector. The UI highlights overdue
or stale schedules and repeated failures. The UI does not silently fix
schedule state.

### Run health overview

An operational view shows recent pipeline and connector runs grouped by:
Running, Failed, Recently succeeded, and Stale/reconciled. Links go to the
canonical detailed run views.

## Storage overview

The Storage section (`/admin/storage`, any member) shows:

- File count and total bytes.
- Dataset count and Dataset Version count.
- Largest files (bounded to 10, ordered by byte_size descending) with name,
  type, size, status, storage backend, and linked Record context.
- Recent files (bounded to 10, ordered by created_at descending) with the
  same metadata.

Estimates are labelled as estimates. The UI does not fabricate exact physical
storage metrics when the database cannot provide them cheaply.

## Usage overview

The Usage section (`/admin/usage`, any member) shows workspace counts:

- Members, records, datasets, dataset versions, files, file bytes,
  connectors, pipeline definitions, pipeline runs, and connector runs.

### Capacity indicators

The UI shows capacity warnings when values exceed validated scale:

- Datasets above 100k rows — "Above validated scale".
- File storage above 10 GB — an informational warning.
- More than 100 schedules — "Above validated scale".

These are informational warnings, not SLO violation alerts. The language
uses explicit terms like "Above validated scale" and "Approaching configured
limit".

## Audit administration

The Audit section (`/admin/activity`, any member) is a browser over the
canonical audit and change-event system (`change_events`):

- Filter by actor, action or event type, object type, and date range.
- Export the audit log (owner-only, JSON download).
- Use security-relevant event filters for role changes, credential creation
  and revocation, connector secret and config changes, Pipeline publish and
  retire, signature and review events, and workspace setting changes.

This is a filtered view of existing evidence, not a second audit log.
Sensitive audit classes remain subject to existing permissions.

## Diagnostics

The Diagnostics section (`/admin/diagnostics`, any member) shows:

- **App health** — status (ready/not_ready/degraded), database probe,
  PostgREST probe.
- **Scheduler diagnostics** — enabled state from `SHEETBASE_SCHEDULER_ENABLED`,
  last evaluated schedule timestamp, sweep interval, enabled schedule count,
  and recovered stale count. When the scheduler is disabled, the status shows
  "Disabled". When the scheduler is enabled but no schedules are evaluated
  yet, the last sweep shows "No schedules evaluated yet", not a false healthy
  value.
- **Pipeline executor diagnostics** — active runs, recent failures,
  execution timeout, row and input caps.
- **Connector diagnostics** — active and paused counts, recent failures,
  missing secrets, repeated failures, and per-connector status. Requires
  `integrations.manage`; non-managers do not see this section.
- **Configuration state** — file backend, auth mode, external API enabled,
  connector secret encryption, metrics enabled, collaboration enabled.
- **Migration state** — current versus expected migration: up to date,
  behind, or unknown.

### Health semantics

Health follows PLAT-01/02 semantics. The meanings of `live`, `ready`, and
`healthy` do not change. If optional subsystems are degraded but the app
remains ready, the status shows `degraded`. It does not mark the whole
application down.

### Diagnostic checks

Checks are explicit and bounded: database query, PostgREST query, scheduler
heartbeat, and pipeline executor stats. No check is destructive. External
connector systems are not probed without user action.

## Deployment information

The Deployment section (`/admin/deployment`, any member) shows:

- Sheetbase version and commit SHA.
- Build time and environment.
- Database migration version (expected versus applied).
- PostgreSQL version and PostgREST version (where available).

It also shows links to operational runbooks:

- [Deployment](deployment.md)
- [Recovery](recovery.md)
- [Security](security.md)
- [Performance](performance.md)
- [Observability](observability.md)

It exposes no secrets, JWT tokens, internal hostnames, or raw environment
dumps.

## Attention indicators

The Dashboard includes a deterministic "needs attention" model:

- Failed pipeline or connector runs (last 24 hours).
- Stale running runs (more than 15 minutes).
- Active connectors missing required secrets.
- Overdue schedules.
- Disabled connectors.

These are bounded, deterministic conditions. They are not AI ranking or an
unbounded notification framework.

## Destructive-action confirmation

Confirmation is required for:

- Revoke credential.
- Remove member.
- Retire connector.
- Delete schedule.
- Destructive workspace-level changes.

Harmless edits do not require confirmation.

## Admin mutation auditability

Every meaningful admin mutation produces canonical audit evidence in
`change_events`. This includes role changes; credential create, revoke, and
rotate; connector config changes; Pipeline schedule enable and disable; and
workspace setting changes.

## Pagination and bounded lists

Admin lists are bounded with pagination: members, credentials, connector
runs, pipeline runs, audit events, and files. The system does not load all
history. See `docs/testing.md` for pagination conventions.

## Common operational workflows

### Invite a new member

1. Go to `/admin/users` (owner only).
2. Use the invitation form. Enter email, role, and expiry.
3. The invitee receives an invitation to join the workspace.

### Change a member's role

1. Go to `/admin/users` (owner only).
2. Select the member in the list.
3. Use the role selector in the member details inspector.
4. The change takes effect immediately (server-side capability resolution).

### Suspend a member

1. Go to `/admin/users` (owner only).
2. Select the member.
3. Click "Suspend" in the inspector.
4. The member loses access immediately. To reactivate, click "Reinstate".

### Create an API credential

1. Go to `/admin/api-credentials` (owner only).
2. Click "Create credential".
3. Enter a name, select scopes, and optionally set an expiry.
4. The secret shows once. Copy it immediately.
5. The credential appears in the list with its scopes and status.

### Revoke an API credential

1. Go to `/admin/api-credentials` (owner only).
2. Find the credential in the list.
3. Click "Revoke" and confirm.
4. The credential can no longer authenticate.

### Diagnose a failed connector

1. Go to `/admin/diagnostics` (any member).
2. Check the connector diagnostics section (requires `integrations.manage`)
   for missing secrets or repeated failures.
3. Go to `/admin/connectors` (`integrations.manage`).
4. Review the connector's last run error and status.
5. If the last run failed, click "Retry" to retry through the canonical
   `api.start_connector_run` RPC.
6. For secret management or full configuration changes, follow the link to
   the canonical Integration detail page.

### Check migration state

1. Go to `/admin/diagnostics` or `/admin/deployment` (any member).
2. Check the migration state section.
3. "Up to date" means the database matches the expected migration.
4. "Behind" or "Unknown" means the app and database are out of sync. Follow
   the migration runbook in [deployment.md](deployment.md).

### Export the audit log

1. Go to `/admin/activity` (any member can view; only the owner can export).
2. Apply filters as needed: actor, action, object type, date range.
3. Click "Export audit log" (owner only) to download a JSON file.

## Related documentation

- [Deployment](deployment.md) — deployment, rollback, and migration runbooks.
- [Recovery](recovery.md) — backup, restore, and disaster recovery.
- [Security](security.md) — security posture and surface inventory.
- [Performance](performance.md) — performance budgets and scale gates.
- [Observability](observability.md) — health endpoints, logs, and metrics.
- [Pipelines](pipelines.md) — canonical Pipeline model (AUTO-01/02/03).
- [Integrations](integrations.md) — connector framework (INT-01/02/03).
- [Authentication](authentication.md) — Better Auth and GitHub OAuth.
- [Governance roles](governance-roles.md) — role and capability reference.
- [File platform](file-platform.md) — file storage model.
- [Public API contract](public-api-contract.md) — external API scopes.
