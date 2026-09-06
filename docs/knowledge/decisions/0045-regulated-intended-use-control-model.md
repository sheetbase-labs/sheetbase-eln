# 0045. Regulated intended-use and control model

- **Status:** proposed
- **Date:** 2026-09-06
- **Ticket:** GXP-01

## Context

Sheetbase has no production users, no production data and no concrete
regulated intended use. Regulation attaches to an intended use, not to
software in the abstract — so GXP-02..04 (controlled change, e-signatures,
validation packs) cannot be built against real requirements yet. This ADR
proposes the control-model framework: which categories exist, which existing
Sheetbase controls each category maps to, and what evidence would activate
stronger controls. It makes no compliance claim of any kind.

## Decision (proposed)

1. Intended-use categories, least to most controlled:
   - **Exploratory research** (default): working Notebooks/Sheets/Datasets
     with ordinary versioning, provenance and audit. No additional controls.
   - **Controlled development**: published Definitions/Templates/Schemas plus
     review-before-submit flows. Adds: change control on governed
     configuration (publish/retire lifecycle already in the product),
     submission review with human sign-off (existing review contracts).
   - **Regulated record** (activated only with a concrete filing or inspection
     need): the above plus immutable frozen evidence (Dataset Versions,
     revision envelopes), amendment-only correction flows, retention/lock
     behaviour, and exportable evidence packs.
2. Control mapping is to controls that already exist: Definition/Template
   publish-retire lifecycle, review/submit/decide evidence contracts, frozen
   Dataset Versions and revision envelopes, RLS/server enforcement, and the
   append-only audit trail. No parallel compliance subsystem is proposed.
3. Roles follow existing planes: Stewards own scientific configuration,
   owners administer platform controls, and signers are named humans in
   human sessions. Agents and integrations never attest — the AUTO-04/05
   human-only attestation boundary is part of the control model.
4. Audit events remain operational telemetry. Regulated evidence is frozen
   state (versions, envelopes, signatures), never log excerpts.
5. Residual posture is explicit: no 21 CFR Part 11 / Annex 11 blanket claim;
   validation packs (GXP-04) are assembled per intended use from supported
   records when a real use activates the category.

## Activation gate

GXP-02..04 implementation begins only when a concrete regulated intended use
names its category, workflows, objects, roles and retention needs. Completing
other Roadmap 3 waves does not satisfy this gate.

## Consequences

- Exploratory work stays unburdened: stronger controls are configured per
   workflow, never forced globally.
- When a regulated use arrives, its implementation is mapping and activation,
  not architecture.
- Until then, this ADR costs nothing and constrains nothing.
