# 0049. Client users

- **Status:** accepted
- **Date:** 2026-09-27
- **Ticket:** Roadmap 4, PORTAL-01 (DEC-05)

## Context

The v3 design shows a client portal (`canvas/ClientPortal.dc.html`): a separate
shell in which a client of the CDMO sees approved, shared records and reports
and can message the team. Client rows appear in the workspace members list with
the role **Client viewer** and a client group (`canvas/SettingsMembers.dc.html`),
and each project has a **Client portal** column in project access
(`canvas/SettingsAccess.dc.html`). Clients must never see drafts, comments, raw
data or other clients.

[ADR-0044](0044-organisation-team-domain-model.md) leaves organisation/team
primitives deferred, so client identity must be expressible on the existing
workspace authority boundary.

## Decision

1. **Same workspace, distinct role.** Client users are members of the existing
   workspace with a `client_viewer` role. No separate client organisation or
   second authority boundary is introduced; ADR-0044 stays deferred.
2. **Explicit, per-object sharing.** A client sees an object only when it is
   explicitly shared to their portal, or when the project's portal setting
   shares approved records automatically (PROJ-03). Drafts, unapproved
   revisions, comments, raw dataset rows and files are never shared.
3. **Per-project portal.** The client portal is off by default per project and
   is enabled by the project lead. A client's membership is scoped to the
   projects whose portal they belong to.
4. **Authentication.** Clients are invited by email and sign in with email
   (Better Auth), not company SSO. A client organisation IdP can be added later
   without changing the sharing model.
5. **RLS is the boundary.** `client_viewer` is enforced by row-level security,
   not only the UI: a client can read only shared approved records/reports of
   their own client's projects, and their own messages. Server functions that
   serve the portal run with the client's claims.
6. **RLS test plan.** For a client user the database tests must prove: a shared
   approved record is readable; a draft/unapproved revision is denied; comments,
   dataset rows and files are denied; another client's shared object is denied;
   another workspace is denied; an internal member is unaffected.

## Consequences

- The portal reuses existing membership, RLS and change-event machinery; there
  is no parallel identity system.
- Project access rules gain a client-portal grant that references the same
  workspace group model (DEC-06).
- If a future deployment needs cross-organisation clients, ADR-0044's
  organisation model can be layered on without changing this decision.

## Alternatives considered

- **Separate client workspace/organisation per client.** Rejected for now: it
  needs the deferred organisation model (ADR-0044) and heavier provisioning,
  and the design shows clients inside one workspace's project access.
- **Reuse the existing `viewer` role for clients.** Rejected: `viewer` is an
  internal member-class role and is not isolated to shared approved objects.
