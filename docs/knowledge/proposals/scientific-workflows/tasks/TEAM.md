# Scientific collaboration and delivery

Planned at `e5801327`, 2 October 2026. Read [GUIDE.md](../GUIDE.md), existing collaboration permission/anchor contracts, ADR-0049, relevant review/evidence contracts and LAB-07. Working comments, historical training and submitted evidence have different lifecycles; do not collapse them into one mutable record.

## R5-TEAM-01: discuss stable Sheet cells

**Outcome:** scientists discuss the particular calculated, local or sourced value they are working on without comments moving when the grid is reordered. Priority P2, effort L, medium risk. Depends on BASE-02 and confirmation of the current Sheet identity contract.

**Current state and scope:** `src/lib/collaboration/types.ts:81` has Dataset-cell anchors but no Sheet anchors. `src/lib/sheet-instance.ts:38` defines composed row keys and `src/components/sheet/canonical-sheet-workspace.tsx` maps selection to stable rows. Scope: existing collaboration types, anchor serialization/resolution, permission checks and the Sheet discussion interaction. Current absence is high-confidence; range semantics are deliberately excluded initially.

**Steps:** specify single-cell identity using workspace, Sheet instance, stable row key and field/column identity with its necessary definition context; extend the existing resolver and access checks; add a selected-cell discussion entry point, linked Inbox navigation and unavailable-target states; preserve working-versus-revision comment distinctions. Treat source rebinding and changed row identity as explicit resolution events.

**Verification/exit:** extend `src/lib/collaboration/{anchors,access.server,permissions}.test.ts` and add a real Sheet discussion browser case. Run focused suites and `pnpm validate`. Sorting, filtering, renaming and reload preserve the target; deleted/rebound targets do not silently reattach; denied users cannot resolve the cell or thread. Comments never modify frozen evidence. Liveblocks does not become scientific data storage; range discussions and simultaneous value editing are deferred.

## R5-TEAM-02: identify the exact protocol version a person can use

**Outcome:** a scientist and reviewer can tell which procedure version governed an experiment and whether its operator was qualified for that version. Priority P1, effort L, high risk. Depends on BASE-02 and LAB-07's effective-version/readiness decision. LAB-07 retains implementation ownership of its promised behavior.

**Current state and scope:** `src/db/schema.ts:3479` stores training per protocol/user without version identity; `src/routes/protocols/$protocolId.tsx:482` records status against the protocol record. The original LAB-07 brief calls for version acknowledgements and effective-version starts. Scope: existing protocol/revision identity, training acknowledgement history, new-experiment binding, readiness policy and existing work items. Missing version identity is high-confidence; enforcement policy needs an explicit decision.

**Steps:** select the canonical immutable protocol version identity and preserve historical acknowledgements; bind experiments to the version used; define warning versus blocking policy per intended workflow, with attributed exceptions and reasons; create retraining work when a new effective version requires it. Never backfill old training as certification of an unknown version.

**Verification/exit:** extend `tests/db/protocol-training.test.ts`, experiment-start DB/API tests and the protocol browser area. Run those and `pnpm validate`. Training on v1 does not automatically qualify v2; existing v1 work remains readable; configured blocked starts fail server-side; justified exceptions retain actor/time/reason/version. No compliance badge or formal validation-pack claim. Stop if implementation requires inventing a second protocol document/version system.

## R5-TEAM-03: deliver an approved evidence package to a client

**Outcome:** a client opens an explicitly shared result, understands its revision/status and downloads the evidence they are permitted to receive. Priority P2, effort L, high risk. Depends on BASE-02 and PORTAL/REV sharing semantics; retain their ownership of already promised portal viewing.

**Current state and scope:** `src/routes/client-portal.tsx:202` has Reports/Records lists, with titles rendered as text at `:234`. `src/lib/export/evidence-package.ts` and `/api/export/revision/$id/package` already build revision packages. ADR-0049 constrains clients to explicit shares. Scope: portal-scoped evidence reader/download, exact revision selection, attachment policy, share/revoke/supersede behavior and internal handover confirmation. Do not grant ordinary workspace membership to make export work.

**Steps:** define whether the share pins a revision and make that identity visible; reuse canonical evidence serialization with an explicitly client-authorized read path; permit only shared revision contents and individually authorized file bytes; add open/download and clear superseded/revoked states; optionally record a download receipt without labelling it human approval or proof of reading.

**Verification/exit:** extend `tests/db/client-portal.test.ts`, export API tests and add `tests/browser/client-evidence-delivery.spec.ts`. Run those and `pnpm validate`. Client A cannot enumerate/download client B's material; a revoked share denies future requests; source edits do not change the shared revision; exported digests match the internal approved package's permitted content. Inventory which referenced attachments are actually included before promising a self-contained download. No claim that revocation recalls files already downloaded.
