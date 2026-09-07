# GXP — Configurable Regulated Controls & Evidence

**Status (2026-09-07):** GXP-01 has proposed ADR-0045 from merged #162, not an accepted concrete intended-use/control decision. GXP-02..04 are explicitly deferred. Existing review/signing functionality is not regulated-use validation. See the [reconciled status index](README.md) and [`../../NEXT.md`](../../NEXT.md); no gate is removed by this reconciliation.

## Programme goal

Allow organisations to enable stronger regulated controls without turning all Sheetbase use into compliance theatre or weakening canonical evidence semantics.

## GXP-01 — Intended-Use & Control Model

### Goal

Define configurable regulated-use modes and control boundaries.

### Scope

- intended-use categories and risk-based control mapping;
- which workflows/objects require additional controls;
- roles/responsibilities and configuration authority;
- relationship to existing review, signing, evidence and audit semantics;
- ADRs for consequential security/evidence changes.

### Exit

A documented control model maps concrete regulated intended uses to specific Sheetbase controls without blanket claims of compliance.

## GXP-02 — Controlled Change & Configuration Evidence

### Goal

Provide traceable configuration/change evidence where regulated use requires it.

### Scope

- controlled publication/change of governed Models, Schemas, Definitions/Templates and relevant configuration;
- approvals/effective versions where justified;
- dependency/impact evidence;
- immutable history and audit linkage;
- exportable review evidence.

### Exit

A configured regulated workflow can demonstrate who changed governed configuration, what was approved/effective, and what downstream evidence used it.

## GXP-03 — Review, E-Signature & Record Controls

### Goal

Mature regulated review/signature behaviour around existing human-session evidence contracts.

### Scope

- configurable review/signature policies;
- signer meaning/reason and authentication expectations;
- amendment/correction flows;
- retention/lock behaviour where required;
- no machine/agent attestation.

### Exit

Representative regulated records can be reviewed, signed, amended and reconstructed with explicit policy and human attribution.

## GXP-04 — Validation & Audit Evidence Pack

### Goal

Make the system easier to validate and audit for configured intended uses.

### Scope

- intended-use/configuration reports;
- release/version evidence and automated test evidence;
- audit/export packages for selected controls;
- operational SOP/runbook hooks where appropriate;
- documented residual risks and supplier/open-source assumptions.

### Exit

An organisation can assemble a coherent evidence pack for a defined intended use from supported Sheetbase records rather than ad-hoc screenshots/manual archaeology.

## Boundaries

- Do not claim blanket GxP/Part 11 compliance.
- Audit events are not a substitute for immutable scientific evidence.
- Stronger controls are configurable and evidence-driven, not forced into exploratory workflows without need.
