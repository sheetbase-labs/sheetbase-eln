# SET — Workspace and Account Settings

**Status (2026-09-27):** Proposed; not assigned. Groups in SET-02 follow [DEC-06](DEC.md); lockout in SET-03 follows [DEC-04](DEC.md).

## Programme goal

One settings area, organised the way administrators and individuals think
about it, where every switch is enforced on the server.

## Baseline at `main` `9538f36`

- `/admin/$section` with dashboard, members, project access, API credentials,
  audit explorer, connectors, extensions, deployment, diagnostics, sessions,
  settings and model fields (`components/workspace-admin/`); `/settings` with
  API tokens; `/integrations`.
- `api_credentials` with scopes and expiry; `webhook_subscriptions` and
  `webhook_deliveries` with retry; `workspace_settings`.
- Record identifiers use kind-scoped prefixes assigned by RPC (EXP-, PRT-,
  RPT-); prefixes are not configurable in the UI.

## SET-01 — Workspace general settings

**Status:** proposed.

### Design

`canvas/SettingsGeneral.dc.html`.

### Scope

Name, site, time zone, date and number format (scientific notation); record ID
prefixes and next numbers per kind (IDs never reused); editing rules: require a
reason when a saved value changes, lock records when signed, allow offline
editing (EXP-05).

### Exit

Each editing rule is enforced by the server; changing a prefix affects only new
IDs and is audited.

## SET-02 — Members, roles, groups and project access

**Status:** proposed; groups after [DEC-06](DEC.md), client rows after [DEC-05](DEC.md).

### Design

`canvas/SettingsMembers.dc.html`, `canvas/SettingsAccess.dc.html`,
`canvas/Panels.dc.html` (workspace switcher).

### Scope

Members table with roles, groups, training status (LAB-07), e-signature status
(REV-03) and last active; role descriptions; project access matrix by group
(edit, review, view, client portal); defaults for new projects (private to the
lead, QA can always view, client portal off). Map design roles (Admin, Editor,
Reviewer, Viewer, Client viewer) onto the existing role vocabulary rather than
adding a parallel one.

### Exit

The access matrix is a view of the same grants RLS uses; a change to it takes
effect immediately and is audited.

## SET-03 — Profile, sessions and sign-in security

**Status:** proposed.

### Design

`canvas/SettingsProfile.dc.html`, `canvas/SignedOut.dc.html`,
`canvas/AuditLog.dc.html` (failed sign-in and lockout).

### Scope

Full name (printed on signatures), initials, job title, time zone, appearance
(SHELL-02), signature status; list of sessions by device with sign-out;
inactivity timeout; failed sign-in lockout with an audit entry; signed-out page
explaining kept offline edits.

### Exit

A user can end any of their other sessions; lockout and timeout are enforced by
Better Auth configuration and covered by tests.

## SET-04 — Integrations and API

**Status:** proposed; mostly restyling existing capability.

### Design

`canvas/SettingsIntegrations.dc.html`, `canvas/IntegrationConnect.dc.html`,
`canvas/IntegrationDeliveries.dc.html`, `canvas/SettingsApi.dc.html`,
`canvas/TokenCreate.dc.html`, `canvas/TokenExpired.dc.html`,
`canvas/SettingsInstruments.dc.html`, `design-system/components/Secret/README.md`.

### Scope

- Integrations: connected systems with direction and status, outgoing webhooks
  with last delivery, incoming webhooks owned by pipelines; connect-a-system
  flow with a service identity, allowed actions and token expiry.
- Deliveries page: failures, attempts, next retry, retry now, pause, expiry
  of queued deliveries into the Inbox.
- API tokens: owner, scopes, last used, expiry (90 days maximum), revoke,
  service identities for pipelines; token shown once with `Secret`; expired
  tokens that are still being used are surfaced with refusal counts and
  "create replacement"; unused for 30 days flagged to the owner; SDK snippet.
- Instruments and parsers settings page (LAB-06, DSET-06).
- Move `/admin/*` sections into `/settings/*`; decide which remaining admin
  sections (deployment, diagnostics, extensions) stay.

### Exit

All design settings pages exist under `/settings`; `/admin` and `/integrations`
are removed or redirected; token rules are server-enforced.
