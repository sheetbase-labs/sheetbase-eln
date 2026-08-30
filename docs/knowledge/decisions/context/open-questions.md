---
title: Open Sheetbase Questions
status: draft
last_reviewed: 2026-08-30
---

# Open Sheetbase Questions

These are deliberately unresolved or usage-driven. They should not be treated as implicit permission to invent a solution inside unrelated work.

## Organisation model (GOV-02)

Questions include:

- whether Sheetbase needs a first-class organisation above workspaces;
- teams/groups and their ownership semantics;
- membership inheritance;
- how organisation boundaries affect RLS, credentials, administration and audit.

**Rule:** requires a dedicated ADR before implementation.

## Stable Sheet row identity for collaboration

Collaboration supports canonical Dataset/Record/Notebook anchors, but rich Sheet cell/range collaboration remains constrained by stable Sheet row identity.

This should be solved in the Sheet model rather than by inventing ephemeral collaboration-only scientific identity.

## Post-10k scientific analysis strategy

SCI-04 provides a measured bounded client analysis envelope. Future needs may require server-side aggregation/materialisation or a different transport strategy.

Do not silently sample statistical input. Any scale increase must preserve the distinction between analysis population and display sampling.

## Deeper statistical methods

The current analysis model intentionally focuses on broadly useful scientific visualisation/statistics. Additional hypothesis tests, non-linear models, dose-response methods or domain-specific analyses should be driven by real workflows and extend the canonical analysis architecture.

## Unit conversion

Fields carry quantity/unit metadata, but a broad conversion engine remains deferred. If added, it should become a canonical product capability rather than chart-specific conversion logic.

## Named service-account principals

The API credential foundation exists. A richer named service-principal identity model remains a future design question and should receive an ADR before affecting audit/RLS identity semantics.

## Agent-authored operations

AUTO-04/05 still need detailed product boundaries around:

- approval/confirmation;
- attribution;
- allowed mutation classes;
- evidence/provenance;
- reversibility;
- use of canonical APIs/SDKs.

The answer must not be a privileged agent bypass.

## Roadmap 3 product depth sequencing

The broad direction is captured in `roadmap/roadmap-3-thinking.md`, but detailed tasks and ordering should be based on actual product friction after Roadmap 2 rather than prematurely freezing a long checklist.

## Extensibility model

A future extension/plugin model may be useful, but should not expose unstable database internals or encourage shadow domain models. SDK/events should mature first.
