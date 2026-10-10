# SET — Workspace and Account Settings

**Status (2026-10-02):** Reconciled against `9bbd305c`; see [task evidence](../RECONCILIATION.md#set) and [live tracker](../CHECKLIST.md). Baseline sections describe the original planning snapshot, not current absence.

**Original scope note (2026-09-27):** Original proposal. Current status is reconciled below. Groups in SET-02 follow [DEC-06](DEC.md); lockout in SET-03 follows [DEC-04](DEC.md), accepted 2026-09-27.

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

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#set-01).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/SettingsGeneral.dc.html`.

### Scope

Name, site, time zone, date and number format (scientific notation); record ID
prefixes and next numbers per kind (IDs never reused); editing rules: require a
reason when a saved value changes, lock records when signed, allow offline
editing (EXP-05).

### Start here

`src/routes/admin.tsx` (731) and `src/routes/admin/$section.tsx`,
`src/components/workspace-admin/admin-settings.tsx`, `api.workspace_settings`,
record identifier assignment in `api.create_record` (prefix by kind).

### Steps (PRs)

1. `/settings/general` per `SettingsGeneral`: name, site, time zone, date and
   number format (extend the existing `src/lib/format-numbers.ts` and add date formatting next to it, then replace the scattered `format*` helpers in `notebook-data.ts`, `calendar.ts`, `planner.ts` and `workspace-admin.ts`).
2. ID prefixes and next numbers per kind in `workspace_settings`; identifier
   assignment reads them; IDs never reused (DB test).
3. Editing rules enforced server-side: reason required on changing saved
   values (block and cell RPCs), lock on sign, allow offline (EXP-05).

### Check it

DB tests for prefixes and reason enforcement; parity for `SettingsGeneral`.

### Exit

Each editing rule is enforced by the server; changing a prefix affects only new
IDs and is audited.

## SET-02 — Members, roles, groups and project access

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#set-02).

**Original decision/dependency note:** groups per [DEC-06](DEC.md), accepted 2026-09-27 ([ADR-0050](../../decisions/0050-workspace-groups-and-project-access.md)); client rows per [DEC-05](DEC.md), accepted 2026-09-27 ([ADR-0049](../../decisions/0049-client-users.md)).

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

### Start here

`admin-members.tsx`, `admin-project-access.tsx`, workspace roles check
(`owner, admin, member, steward, scientist, analyst, reviewer, viewer`) in
`schema.ts`, `tests/db/roles.test.ts`, ADR-0044 / DEC-06.

### Steps (PRs)

1. Map design roles to existing roles (document the table here) and show role
   descriptions; training (LAB-07) and e-signature status (REV-03) columns.

   The design's five role names are a **view** of the existing nine-role
   vocabulary, not a parallel one. `WORKSPACE_ROLE_LABELS` and
   `WORKSPACE_ROLE_DESCRIPTIONS` in `src/lib/workspace-admin.ts` carry the
   user-facing names and copy; the mapping is:

   | Design role   | Existing role(s)                            | Why they are the same thing                                                                                        |
   | ------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
   | Admin         | `owner`, `admin`                            | `owner` holds owner-only security (invitations, security settings); `admin` administers the rest.                  |
   | Editor        | `member`, `scientist`, `analyst`, `steward` | Member-class writers with the same data capabilities; `steward` additionally publishes Models and Dataset Schemas. |
   | Reviewer      | `reviewer`                                  | Member-class data capabilities; review _assignment_ is separate from the role, so it is not a permission set.      |
   | Viewer        | `viewer`                                    | Read-only: cannot create, link or upgrade records, Sheets or Datasets.                                             |
   | Client viewer | `client_viewer`                             | External; sees only approved records explicitly shared to their client portal.                                     |

   No design role is added to the vocabulary, and no existing role is renamed.

2. Groups per DEC-06 with project access rules by group; access matrix view
   computed from the same grants RLS uses.
3. Access requests (from `NbViewer`): request, approve, audit.
4. Pages `SettingsMembers`, `SettingsAccess`.

### Check it

DB test: changing a matrix cell changes what the group can read immediately.

### Exit

The access matrix is a view of the same grants RLS uses; a change to it takes
effect immediately and is audited.

## SET-03 — Profile, sessions and sign-in security

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#set-03).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/SettingsProfile.dc.html`, `canvas/SignedOut.dc.html`,
`canvas/AuditLog.dc.html` (failed sign-in and lockout).

### Scope

Full name (printed on signatures), initials, job title, time zone, appearance
(SHELL-02), signature status; list of sessions by device with sign-out;
inactivity timeout; failed sign-in lockout with an audit entry; signed-out page
explaining kept offline edits.

### Start here

`src/lib/auth.ts` (Better Auth config), `admin-sessions.tsx`,
`src/lib/dev-auth.ts`, `tests/db/auth-session.test.ts`.

### Steps (PRs)

1. Profile fields (full name printed on signatures, initials, job title, time
   zone) and appearance (SHELL-02).
2. My sessions list with sign-out per session (Better Auth session API).
3. Inactivity timeout and failed sign-in lockout (per DEC-04: 3 attempts, 15
   minutes) with audit events; signed-out page.

### Check it

Tests for session revocation and lockout; parity for `SettingsProfile`,
`SignedOut`.

### Exit

A user can end any of their other sessions; lockout and timeout are enforced by
Better Auth configuration and covered by tests.

## SET-04 — Integrations and API

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#set-04).

**Original decision/dependency note:** mostly restyling existing capability.

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

### Start here

`src/routes/integrations.tsx`, `src/routes/integrations/$connectorId.tsx`,
`src/components/integrations/`, `admin-webhooks.tsx`, `admin-api-credentials.tsx`,
`src/components/settings/settings-api-tokens.tsx`, `src/lib/api-credentials.ts`,
`api-credential-scopes.ts`, `tests/db/api-credentials.test.ts`.

### Steps (PRs)

1. Move `/admin/*` and `/integrations` into `/settings/*` routes with the
   v3 settings navigation; keep redirects for one release.
2. Tokens: 90-day maximum enforced in the create RPC, `Secret` once, last-4
   display, unused-30-days flag, refused-call counter for expired tokens
   (increment in the credential verification path), "create replacement".
3. Integrations list and connect flow; deliveries page with retry now and
   pause (existing delivery engine).

### Check it

DB tests for token expiry limit and refusal counting; parity for the seven
integration and API boards.

### Exit

All design settings pages exist under `/settings`; `/admin` and `/integrations`
are removed or redirected; token rules are server-enforced.
