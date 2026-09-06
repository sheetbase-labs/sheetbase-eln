# 0044. Organisation and team domain model

- **Status:** proposed
- **Date:** 2026-09-06
- **Ticket:** ENT-ORG-01

## Context

Sheetbase has exactly one authority boundary today: the workspace. Membership,
capabilities, RLS, credentials, administration and audit are all
workspace-scoped (`docs/knowledge/decisions/context/open-questions.md` records
GOV-02 as deferred pending a dedicated ADR). There are no production users and
no production data, so there is no adoption evidence for multi-workspace
organisation needs yet. This ADR proposes the model so a concrete deployment
need can accept it without redesigning workspace authority under pressure. It
must be **accepted** before any ENT-ORG-02 implementation; until then it is a
proposal, not permission.

## Decision (proposed)

1. An organisation groups workspaces; it never owns scientific state.
   Notebooks, Sheets, Datasets, Models, Records, Pipelines, credentials and
   audit rows stay workspace-owned with unchanged IDs and unchanged RLS.
2. Membership is explicit per workspace. An organisation role grants nothing
   by itself: access flows only through per-workspace grants. Organisation
   administration may _offer_ membership batches, but each workspace grant is
   still an explicit row — organisation hierarchy must never silently broaden
   workspace access.
3. Service credentials and API scopes stay workspace-bound. No
   organisation-wide credential exists in this model.
4. RLS keeps every existing workspace check. Organisation membership may add a
   fast path for administration reads, but it must never replace a workspace
   predicate on scientific, credential or audit tables.
5. Migration is additive: new `organisations` / `organisation_memberships`
   tables plus an optional workspace→organisation link. No scientific,
   credential or audit table changes. Existing single-workspace deployments
   behave identically with zero organisations present.
6. Teams/groups are deferred to ENT-ORG-03 and only if the accepted
   adoption need names them. This ADR does not invent a team primitive.

## Adoption gate

ENT-ORG-02 implementation begins only when all three hold:

1. this ADR is accepted;
2. a concrete deployment needs multiple workspaces under one administration;
3. the migration impact on RLS/credentials/administration/audit is re-verified
   against the then-current schema.

Earlier Roadmap 3 waves completing does not satisfy this gate.

## Consequences

- Steward scientific configuration and platform administration stay distinct;
  organisation administration is a third, strictly coarser plane.
- Cross-workspace discovery, if ever needed, is a read surface over explicit
  grants — never a merged authority.
- If the first real deployment needs only one workspace, this ADR can remain
  proposed indefinitely with zero code cost.

## Non-goals

- No organisation-level scientific configuration authority.
- No automatic inheritance of workspace access from organisation membership.
- No shared datasets, templates or credentials across workspaces by virtue of
  organisation alone (sharing stays explicit per object, as today).
