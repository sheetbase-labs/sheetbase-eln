# DEC — Decisions Roadmap 4 Needs

**Status (2026-09-27):** Proposed; not assigned. These are scheduled first. Every capability the design shows is built in Roadmap 4; a decision below settles _how_, never _whether_.

## Programme goal

Take each open decision that a v3 screen depends on to an accepted outcome
early, so no screen or capability waits on one.

Each task ends in an accepted ADR (or a recorded owner decision for
non-architectural choices) with its evidence, per
[`../../decisions/README.md`](../../decisions/README.md). Accepting an ADR that
was proposed in an earlier roadmap follows that ADR's own stated exit; if the
evidence it asks for does not exist yet, the task produces it.

## How to run a decision task

Decision tasks are owned by a senior engineer or the product owner, not
assigned to a junior developer. Each follows the same steps:

1. Copy the ADR template from [`../../decisions/README.md`](../../decisions/README.md)
   to `docs/knowledge/decisions/NNNN-<slug>.md` (next free number), or open the
   existing proposed ADR named in the task.
2. Gather the evidence the task lists; link code, tests and design screens.
3. Write the options with their consequences; recommend one.
4. Review with the product owner (Gareth) and at least one engineer who will
   build on it; record their decision in the ADR (`Status: accepted`, date).
5. Update the task files that depend on it (search the tasks for the DEC ID)
   with anything the decision changed.

## DEC-01 — Adopt UI system v3

**Status:** proposed. Accept [ADR-0047](../../decisions/0047-ui-system-v3-adoption.md).
**Unblocks:** DSYS-02 onward and every screen.

**How:** Review ADR-0047 against the renders (`pnpm design:render`) and `DESIGN_ADOPTION.md`; confirm the token mapping, the removal of density modes and the exact-parity rule; accept.

## DEC-02 — Sheet grid and formula authority

**Status:** accepted 2026-09-27 ([ADR-0048](../../decisions/0048-sheet-grid-on-sheetbase-table.md), option (b)). The server adopts the `sheetbase-table` engine; HyperFormula and Handsontable are removed. COMP-06 owns the engine parity work.
**Unblocks:** COMP-06.

**How:** Run the existing formula fixtures (`src/lib/formula-ir.test.ts`, `src/lib/calculation.server.test.ts`, `pnpm test:phase4`) through the `sheetbase-table` engine in a spike branch; list unsupported functions and differing results; choose option (a) or (b) in ADR-0048 with that table as evidence.

## DEC-03 — Routes outside the design

**Status:** proposed. Owner decision recorded in [SHELL-04](SHELL.md).
**Unblocks:** SHELL-01.

**How:** For each route listed in SHELL-04, record usage (who needs it, which roadmap task created it), then choose keep (and commission v3 screens for it), fold or retire; write the decisions into SHELL-04.

## DEC-04 — Regulated signing and tamper-evident audit

**Status:** proposed. Decide [ADR-0045](../../decisions/0045-regulated-intended-use-control-model.md) (GXP-01) for the intended use the design shows: password re-entry at signing, signature certification, signature meanings, lockout, hash-chained audit with nightly verification, and how re-authentication works with company SSO.
**Unblocks:** REV-03, REV-05, SET-03 lockout.

**How:** Read ADR-0045 and `roadmap-3/tasks/GXP.md`; define the intended use the design implies (signing records in a CDMO under client audit); decide re-authentication with SSO (password re-entry vs. provider step-up), signature meanings by role, lockout policy and the audit hash-chain design; accept ADR-0045 or supersede it.

## DEC-05 — Client users

**Status:** proposed. New ADR: how CDMO clients are represented, authenticate and are isolated (see [PORTAL-01](PORTAL.md)), reconciled with [ADR-0044](../../decisions/0044-organisation-team-domain-model.md).
**Unblocks:** PORTAL-02, client rows in PROJ-03 and SET-02.

**How:** Read ADR-0044 and PORTAL-01; decide same-workspace client role vs separate client organisation, authentication (invite + email sign-in or SSO), sharing model and the RLS test plan; write a new ADR.

## DEC-06 — Groups

**Status:** proposed. Decide the group/team part of ADR-0044 needed for group-based project access and member groups.
**Unblocks:** SET-02, PROJ-03 group members.

**How:** Decide whether groups are workspace-scoped lists of members referenced by project access rules, reconciled with ADR-0044 teams; record in ADR-0044 or a new ADR.

## DEC-07 — Workspace-defined record models

**Status:** proposed. New ADR amending ADR-0026 (see [MDL-01](MDL.md)), including whether materials and cell banks are built-in or workspace-defined.
**Unblocks:** MDL-01, MDL-04, LAB-04.

**How:** Read ADR-0026 and `src/db/schema.ts` (`model_kinds`, `record_field_definitions`); prototype how a workspace-defined kind would be stored (generic record host vs table per model) and how RLS, search, lineage and the public API (`docs/api/`) treat it; decide materials/cell banks; write the ADR.

## DEC-08 — Pipelines that pause for a person

**Status:** proposed. New ADR amending ADR-0046 for the `waiting` run state and resumption outside the original transaction (see [PIPE-02](PIPE.md)).
**Unblocks:** PIPE-02.

**How:** Read ADR-0042/0046 and `src/lib/pipeline-execute.server.ts`; design the `waiting` state, what is kept while waiting, how resumption re-establishes the run actor and pinned inputs, and timeouts; write the ADR.

## DEC-09 — Durable offline edits

**Status:** proposed. New ADR amending ADR-0018 for device-persisted edits, replay with expected revisions, per-cell conflicts and retention after sign-out (see [EXP-05](EXP.md)).
**Unblocks:** EXP-05.

**How:** Read ADR-0018 and `src/components/notebook/use-autosave.ts`; design IndexedDB storage, replay with expected revisions, conflict granularity (cell, block) and sign-out retention; write the ADR.

## DEC-10 — Labels, printers and scanning

**Status:** proposed. Owner decision: printer integration (ZPL over a print gateway or browser printing), label template and 2D code content.
**Unblocks:** LAB-05, MOB-02.

**How:** Confirm the lab's printers (models, network access) and label stock; choose print path (print gateway sending ZPL, or browser printing) and the 2D code payload (a URL containing the record ID); record the decision in LAB-05.

## DEC-11 — Snapshot retention periods

**Status:** proposed. Owner decision on the periods the design states (15 years for snapshots cited by signed records; row removal for uncited snapshots two years after archive) and who may keep a snapshot.
**Unblocks:** DSET-04.

**How:** Confirm retention periods with QA; record who may keep an uncited snapshot and for how long; record the decision in DSET-04.

## DEC-12 — Component package distribution

**Status:** proposed. Owner decision: private registry for `sheetbase-components` (GitHub Packages or a private npm scope).
**Unblocks:** COMP-05.

**How:** Choose GitHub Packages (scoped to `sheetbase-labs`) or a private npm scope; confirm CI access tokens for both repositories; record in COMP-05.
