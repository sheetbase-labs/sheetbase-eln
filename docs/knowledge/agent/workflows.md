---
title: Agent Workflows for Sheetbase
status: canonical
last_reviewed: 2026-08-30
---

# Agent Workflows for Sheetbase

This document defines how an agent should **review**, **propose**, and **implement** work in Sheetbase.

The goal is to make repository knowledge, rather than private conversational history, sufficient for high-quality engineering judgement.

## Common preparation

Before substantial work:

1. Read [`../README.md`](../README.md).
2. Read [`../PRODUCT.md`](../PRODUCT.md), [`../DESIGN.md`](../DESIGN.md), and [`../ROADMAP.md`](../ROADMAP.md) as relevant.
3. Read [`agent-context.md`](agent-context.md) and [`development-rules.md`](development-rules.md).
4. Search the knowledge base for the concepts affected by the work. Prefer qmd when available; see [`qmd.md`](qmd.md).
5. Read the relevant roadmap task and accepted ADRs in full.
6. Inspect the current implementation and tests. Do not infer present behaviour from roadmap prose alone.

Historical documents can explain *why*, but they do not override later canonical decisions, accepted ADRs, or executable contracts.

# Reviewing a PR

A review is an independent assessment of the actual implementation against Sheetbase's product model, roadmap task, architecture and engineering quality.

## 1. Establish intended scope

Identify:

- the named roadmap task/epic, if any;
- its exit criterion;
- explicit non-goals;
- affected canonical concepts;
- any ADRs or public contracts it changes or relies upon.

Search the knowledge base for the exact task ID plus the important domain concepts.

Do **not** use the PR description as the primary source of truth.

## 2. Inspect the actual diff

Review every material changed file and trace consequential paths end-to-end:

```text
UI / SDK / external client
        ↓
server route / domain operation
        ↓
capability / RLS / validation
        ↓
persistence / revision / provenance
        ↓
read / reconstruction / evidence path
```

For scientific calculations or evidence, trace both live and frozen/historical paths where applicable.

## 3. Compare against canonical knowledge

Explicitly check:

- Does the PR use the canonical Notebook / Sheet / Dataset / Model / Record model?
- Does it create a second authority or shadow model?
- Are stable IDs used instead of labels, positions or display names?
- Does exploratory vs governed state remain intentional?
- Are binding, promotion, write-back and provenance semantics preserved?
- Are version/evidence boundaries correct?
- Is PostgreSQL/RLS/server enforcement authoritative?
- Does the API/browser/automation model remain coherent?
- Does the UI fit the current Sheetbase design language?
- Does it accidentally resurrect anything in `decisions/context/retired-approaches.md`?
- During pre-release, does it remove superseded paths rather than adding speculative compatibility?

## 4. Validate the task promise

Do not treat a checklist of endpoints/components as proof of completion.

Ask: **does the user-visible/domain promise in the task actually work end-to-end?**

Examples:

- a frozen chart must reconstruct the same scientific meaning, not merely store a version ID;
- a permission must be enforced server-side, not merely hidden in the UI;
- write-back must hit the correct canonical target, not just update a displayed cell;
- an SDK must exercise the supported public contract rather than reproduce business logic locally.

## 5. Inspect tests and validation

Assess whether tests prove the important semantics at the correct layer.

Look for the relevant combination of:

- unit/domain tests;
- DB/RLS tests;
- API tests;
- browser workflow tests;
- evidence/reconstruction tests;
- performance tests where scale is part of the task.

Confirm reported validation where possible. Do not assume CI or a PR summary proves a path you have not inspected.

## 6. Review output

Lead with findings, ordered by severity.

For each finding include:

- what is wrong;
- why it matters in Sheetbase terms;
- the concrete code/path involved;
- the required correction.

Then give:

- overall task-completion judgement;
- validation confidence;
- merge recommendation.

Do not manufacture minor findings to make a review look thorough. A clean PR can receive a clean review.

# Proposing work

A proposal should extend Sheetbase deliberately rather than start from a feature idea in isolation.

## 1. Search before designing

Search the knowledge base for:

- the user problem;
- relevant canonical concepts;
- related roadmap work;
- accepted and retired decisions;
- historical attempts or mockups;
- competitor/reference lessons where useful.

Then inspect the current product/code to determine what already exists.

## 2. Frame the problem in Sheetbase terms

State:

- user/problem;
- why it belongs in Sheetbase;
- canonical concepts affected;
- what remains unchanged;
- whether it is product depth, scientific depth, platform, governance or automation work.

Avoid defining a new top-level concept when an existing one can represent the behaviour.

## 3. Identify the architectural fit

Answer before proposing implementation:

- What is the canonical source of truth?
- What has stable identity?
- What is local vs durable/governed?
- What is mutable vs versioned/frozen?
- What capabilities protect it?
- What public/domain operation represents it?
- How would browser, SDK and automation clients interact with the same concept?
- What provenance/evidence is required?

If the proposal introduces a genuine durable fork, propose an ADR.

## 4. Define a complete task

A roadmap/task proposal should contain:

- problem and intended outcome;
- explicit scope;
- non-goals;
- dependencies;
- canonical contracts affected;
- implementation outline without over-prescribing internals;
- required tests/evidence;
- exit criterion.

Prefer one coherent named task over vague partial slices of several roadmap tasks.

# Implementing work

## 1. Work from the assigned task

Read the complete task and its dependencies. Do not opportunistically start another roadmap item because adjacent code is convenient to edit.

Small supporting changes needed for the assigned task are part of that task.

## 2. Confirm the current implementation

Before editing, trace the actual current path and identify:

- authoritative tables/RPCs/services;
- current UI/API callers;
- relevant tests;
- old paths that should be removed rather than preserved.

## 3. Extend canonical contracts

Prefer:

```text
existing canonical concept
        +
new capability / state / operation
```

over:

```text
new parallel table/model/API
        +
compatibility glue
```

During pre-release, remove superseded development-era behaviour unless a current explicit dependency requires it.

## 4. Implement end-to-end

For material product work, normally cover the full relevant path:

```text
schema/persistence
→ server/domain contract
→ permissions/RLS
→ client/API surface
→ UI/workflow
→ tests/evidence
→ documentation
```

Do not stop at a backend or UI stub if the named task promises a working workflow.

## 5. Test semantics

Tests should prove the behaviour that matters scientifically and architecturally, including failure cases and workspace/permission isolation where relevant.

## 6. Update knowledge deliberately

Update `docs/knowledge/` when the work changes:

- a durable product concept;
- a roadmap/task status or direction;
- an accepted/rejected architectural decision;
- a cross-cutting invariant;
- the interpretation of historical material.

Do not add duplicate knowledge documents for ordinary implementation detail; current subsystem/runbook docs can remain under `docs/`.

## 7. Hand-off

A PR should clearly state:

- named task/scope;
- user/domain outcome;
- important architectural decisions;
- removed superseded paths;
- known limits/non-goals;
- validation performed.

Do not claim completion until the named exit criterion is actually met.
