# 0050. Workspace groups and project access

- **Status:** accepted
- **Date:** 2026-09-27
- **Ticket:** Roadmap 4, SET-02 / PROJ-03 (DEC-06)

## Context

The v3 design shows workspace groups and project access by group:
`canvas/SettingsMembers.dc.html` lists a **Groups** column per member
("Process Development leads", "Upstream", "Analytical", "QA") and
`canvas/SettingsAccess.dc.html` grants each project **Edit**, **Review**,
**View** and **Client portal** to named groups. Today access is per user and by
workspace role only.

[ADR-0044](0044-organisation-team-domain-model.md) defers organisation-level
teams to ENT-ORG-03 and explicitly does not invent a team primitive. Groups
here are a different thing: a workspace-scoped convenience over explicit grants,
not an organisation hierarchy.

## Decision

1. **Groups are workspace-scoped.** A group has a workspace, a name, members
   and timestamps. It is not an organisation team and never crosses the
   workspace authority boundary.
2. **Groups only grant through project access rules.** A group grants nothing
   by itself; access flows only through explicit per-project rules that
   reference groups (and individual users) for Edit, Review, View or the client
   portal. A member of two groups gets the union of the rules that name those
   groups, never more.
3. **Membership is explicit.** Adding or removing a member is an explicit
   action; a workspace role never implies group membership.
4. **Access is resolved from rules at query time.** RLS and the access RPC
   resolve a caller's project permissions from the rules and the caller's group
   memberships, so a membership change takes effect on the next request.
5. **RLS test plan.** Prove: a member of a group named by a rule can access the
   project per the rule; a non-member is denied; removing the member or the
   group revokes access; a user from another workspace is denied; and a
   workspace admin without the rule is denied unless another rule grants them.

## Consequences

- The design's group-based project access is expressible without the deferred
  organisation model; ADR-0044's team primitive stays deferred.
- SET-02 and PROJ-03 share one group table and one access-rule shape; the client
  portal grant (DEC-05) is a fourth rule column.
- Removing a group is an access change, so it emits a change event and is
  audited like any other permission change.

## Alternatives considered

- **Organisation teams (ADR-0044).** Deferred; not needed for workspace-scoped
  project access and would couple this decision to an inactive model.
- **Per-user grants only.** Rejected: the design's Access screen is built around
  groups, and per-user grants do not scale to project access matrices.
