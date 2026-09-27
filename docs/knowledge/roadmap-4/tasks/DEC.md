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

## DEC-01 — Adopt UI system v3

**Status:** proposed. Accept [ADR-0047](../../decisions/0047-ui-system-v3-adoption.md).
**Unblocks:** DSYS-02 onward and every screen.

## DEC-02 — Sheet grid and formula authority

**Status:** proposed. Choose option (a) or (b) in [ADR-0048](../../decisions/0048-sheet-grid-on-sheetbase-table.md) with a compatibility run over the existing formula fixtures, then accept it.
**Unblocks:** COMP-06.

## DEC-03 — Routes outside the design

**Status:** proposed. Owner decision recorded in [SHELL-04](SHELL.md).
**Unblocks:** SHELL-01.

## DEC-04 — Regulated signing and tamper-evident audit

**Status:** proposed. Decide [ADR-0045](../../decisions/0045-regulated-intended-use-control-model.md) (GXP-01) for the intended use the design shows: password re-entry at signing, signature certification, signature meanings, lockout, hash-chained audit with nightly verification, and how re-authentication works with company SSO.
**Unblocks:** REV-03, REV-05, SET-03 lockout.

## DEC-05 — Client users

**Status:** proposed. New ADR: how CDMO clients are represented, authenticate and are isolated (see [PORTAL-01](PORTAL.md)), reconciled with [ADR-0044](../../decisions/0044-organisation-team-domain-model.md).
**Unblocks:** PORTAL-02, client rows in PROJ-03 and SET-02.

## DEC-06 — Groups

**Status:** proposed. Decide the group/team part of ADR-0044 needed for group-based project access and member groups.
**Unblocks:** SET-02, PROJ-03 group members.

## DEC-07 — Workspace-defined record models

**Status:** proposed. New ADR amending ADR-0026 (see [MDL-01](MDL.md)), including whether materials and cell banks are built-in or workspace-defined.
**Unblocks:** MDL-01, MDL-04, LAB-04.

## DEC-08 — Pipelines that pause for a person

**Status:** proposed. New ADR amending ADR-0046 for the `waiting` run state and resumption outside the original transaction (see [PIPE-02](PIPE.md)).
**Unblocks:** PIPE-02.

## DEC-09 — Durable offline edits

**Status:** proposed. New ADR amending ADR-0018 for device-persisted edits, replay with expected revisions, per-cell conflicts and retention after sign-out (see [EXP-05](EXP.md)).
**Unblocks:** EXP-05.

## DEC-10 — Labels, printers and scanning

**Status:** proposed. Owner decision: printer integration (ZPL over a print gateway or browser printing), label template and 2D code content.
**Unblocks:** LAB-05, MOB-02.

## DEC-11 — Snapshot retention periods

**Status:** proposed. Owner decision on the periods the design states (15 years for snapshots cited by signed records; row removal for uncited snapshots two years after archive) and who may keep a snapshot.
**Unblocks:** DSET-04.

## DEC-12 — Component package distribution

**Status:** proposed. Owner decision: private registry for `sheetbase-components` (GitHub Packages or a private npm scope).
**Unblocks:** COMP-05.
