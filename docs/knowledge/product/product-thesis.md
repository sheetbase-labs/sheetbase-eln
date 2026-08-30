---
title: Sheetbase Product Thesis
status: canonical
last_reviewed: 2026-08-30
related:
  - docs/roadmap/PRODUCT_DIRECTION.md
---

# Sheetbase Product Thesis

## The core idea

Sheetbase should give scientists the **immediacy and flexibility of a spreadsheet** while quietly providing the identity, structure, provenance, reuse, governance, versioning and evidence expected from a serious scientific data platform.

The product should feel simple at the point of use even when the underlying model is rigorous.

A scientist should be able to start with:

```text
open Notebook
  ↓
add Sheet
  ↓
type / paste / import data
  ↓
link Records or Datasets when useful
  ↓
calculate / analyse / visualise
  ↓
promote useful structure deliberately
  ↓
submit / freeze when work becomes evidence
```

The architecture exists to make this workflow safe and reusable without making scientists behave like database administrators.

## What Sheetbase is

Sheetbase is a scientist-facing workspace that combines:

- notebooks for narrative, methods, observations and evidence;
- spreadsheet-native structured-data interaction;
- durable Datasets with typed schemas and immutable meaningful versions;
- user-extensible Models and Records for scientific entities;
- reusable Definitions and Templates without hidden shared mutable state;
- first-class visualisation and analysis;
- files, import/export and search;
- collaboration and review;
- governance, auditability and electronic-record semantics;
- public APIs and future SDKs;
- deterministic automation and, later, agentic assistance.

It should be useful as a product in its own right. Interoperability is a property of the platform, not the reason the product exists.

## Product promise

Scientists should be able to work loosely when exploring and rigorously when meaning becomes durable.

That means Sheetbase deliberately supports both:

```text
exploratory / local / provisional
            +
structured / reusable / governed
```

The transition between them is explicit. Typing a column does not automatically create organisational schema. Reusing a successful structure does not make old experiments share mutable state. Freezing evidence does not freeze every live workspace object.

## The differentiator

The differentiator is not “an ELN with tables” or “a spreadsheet in a browser”. It is the combination of:

1. **Spreadsheet immediacy** — direct manipulation, paste, fill, keyboard navigation, calculations and charts.
2. **Scientific identity** — Records, Datasets, fields and relationships have durable IDs rather than being inferred from labels and coordinates.
3. **Progressive structure** — exploration can become reusable schema and templates without being forced into governance up front.
4. **Provenance and evidence** — users can answer where data, figures and conclusions came from, and submitted evidence remains stable.
5. **One platform model** — UI, APIs, integrations, pipelines and agents ultimately operate on the same canonical concepts.

## Product posture

Sheetbase should be:

- dense rather than sparse;
- powerful without being opaque;
- generic enough for scientific work beyond biotech while remaining excellent for biotech workflows;
- keyboard-friendly and spreadsheet-native;
- explicit about provenance, validation and frozen/live state;
- extensible without exposing implementation internals;
- opinionated about canonical identity and evidence boundaries;
- permissive about exploratory work.

## Human workflows first

Human scientist and steward workflows establish the semantics. Automation follows those semantics rather than creating a separate execution universe.

A future agent should not have a privileged shadow model of Sheetbase. It should use the same domain operations, permissions, provenance and evidence rules as human or SDK clients.

## Long-term direction

The mature product should support a continuum:

```text
Notebook + Sheet
      ↓
structured scientific knowledge
      ↓
reusable models / schemas / templates
      ↓
analysis / visualisation / evidence
      ↓
open platform / SDK / events
      ↓
contextual assistance and automation
```

The centre of gravity remains the scientist's workspace, not integrations, infrastructure or automation for their own sake.
