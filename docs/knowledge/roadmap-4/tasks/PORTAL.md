# PORTAL — Client Portal

**Status (2026-09-27):** Proposed; not assigned. Follows [DEC-05](DEC.md), accepted 2026-09-27 as [ADR-0049](../../decisions/0049-client-users.md).

## Programme goal

Let a CDMO share approved work with its client safely: clients see only what
has been approved and shared, and can talk to the team.

## Baseline at `main` `9538f36`

Nothing exists. Workspace roles (`owner`, `admin`, `member`, `steward`,
`scientist`, `analyst`, `reviewer`, `viewer`) are all internal. "External
access" in admin covers connectors and extensions, not people.

## PORTAL-01 — Client identity and access decision

**Status:** accepted 2026-09-27 as [ADR-0049](../../decisions/0049-client-users.md).

### Design

`canvas/ClientPortal.dc.html`, client rows in `canvas/ProjectMembers.dc.html`,
`canvas/SettingsMembers.dc.html` and `canvas/SettingsAccess.dc.html`.

### Scope

Decide how client users are represented (a client-viewer role in the same
workspace, or a separate client organisation), how they authenticate, what
"shared" means (explicit share per record, or automatic for approved records
when the project allows it, PROJ-03), and how RLS guarantees they never see
drafts, comments, raw data or other clients.

### Exit

An accepted ADR with an RLS test plan.

## PORTAL-02 — Portal

**Status:** proposed; depends on PORTAL-01 ([ADR-0049](../../decisions/0049-client-users.md), accepted 2026-09-27), REV-02.

### Design

`canvas/ClientPortal.dc.html`.

### Scope

Separate portal shell; projects with milestones (PROJ-02) and approved records
with PDF and verification code; reports; messages to and from the CDMO team;
"your access" explanation; invite and remove client users from the project.

### Start here

PORTAL-01's ADR; review approvals and signed PDFs (REV-02/04); project
milestones (PROJ-02); `src/lib/auth.ts`.

### Steps (PRs)

1. Client identity and invitation per the ADR; client users table and RLS
   policies granting only shared approved records of their client's projects.
2. Share records (manual and automatic per PROJ-03) and reports; messages
   between client and team (new table with RLS).
3. Portal shell and route `/portal` per `ClientPortal`.

### Check it

RLS test matrix from the ADR (drafts, comments, datasets, files, other clients
all invisible); parity for `ClientPortal`.

### Exit

A client user can read and download only shared approved records of their own
client's projects, proven by RLS tests covering drafts, comments, datasets,
files and other clients.
