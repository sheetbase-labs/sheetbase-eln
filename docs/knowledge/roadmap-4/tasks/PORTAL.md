# PORTAL — Client Portal

**Status (2026-09-27):** Proposed; not assigned. Follows [DEC-05](DEC.md) (client users, reconciled with [ADR-0044](../../decisions/0044-organisation-team-domain-model.md)).

## Programme goal

Let a CDMO share approved work with its client safely: clients see only what
has been approved and shared, and can talk to the team.

## Baseline at `main` `9538f36`

Nothing exists. Workspace roles (`owner`, `admin`, `member`, `steward`,
`scientist`, `analyst`, `reviewer`, `viewer`) are all internal. "External
access" in admin covers connectors and extensions, not people.

## PORTAL-01 — Client identity and access decision

**Status:** proposed; this task is [DEC-05](DEC.md)'s ADR.

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

**Status:** proposed; depends on PORTAL-01, REV-02.

### Design

`canvas/ClientPortal.dc.html`.

### Scope

Separate portal shell; projects with milestones (PROJ-02) and approved records
with PDF and verification code; reports; messages to and from the CDMO team;
"your access" explanation; invite and remove client users from the project.

### Exit

A client user can read and download only shared approved records of their own
client's projects, proven by RLS tests covering drafts, comments, datasets,
files and other clients.
