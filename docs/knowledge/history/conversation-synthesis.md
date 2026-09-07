---
title: Sheetbase Conversation Synthesis
status: historical
last_reviewed: 2026-08-30
---

# Sheetbase Conversation Synthesis

This file captures recurring themes, corrections and rationale from Sheetbase product and roadmap discussions. It is intentionally synthesised rather than a raw transcript.

## Repeated product themes

### “Make it feel obvious, not database-y”

The product should expose sophisticated structure without forcing scientists into schema-administration language during routine work. This drove Notebook-first and Sheet-first workflows, progressive governance and immersive configuration surfaces.

### “A table should just be a Sheet”

This correction simplified the product vocabulary and became a durable architectural decision: one Sheet product rather than separate table/sheet abstractions.

### “Full-featured graphing matters”

Scientific graphing was a requirement from the earliest ELN design discussions. When SCI-04 later drifted into a deferred bucket, that was inconsistent with the original product intent and was corrected.

### “Local exploratory work must be legitimate”

The product should not force every experiment into a predefined data model. Free-form Notebook composition and local Sheet fields are intentional, with explicit promotion into durable governed structures.

### “Reuse must not create spooky action at a distance”

Definitions/Templates should enable reuse without silently mutating old experiments. This underpins pinned versions and explicit upgrades.

### “One canonical model”

Roadmap reviews repeatedly rejected parallel implementations: separate scientific tables, duplicate scope vocabularies, duplicated chart freeze logic, feature-local permission semantics and compatibility layers that preserved dead paths.

### “Server authority, not UI theatre”

Permission reviews repeatedly focused on proving server/RLS enforcement rather than trusting hidden navigation or client checks. This shaped capability, admin and external-client work.

### “Evidence must preserve scientific meaning”

The important distinction is not simply mutable vs immutable rows. Frozen/submitted evidence must retain the exact data/configuration semantics required to reconstruct a scientific result while live work continues.

## Roadmap-priority corrections

### Core product before external platform breadth

At several points SDK/webhook/automation work was available but intentionally pushed behind scientist-facing workflows and product consolidation.

The rationale was simple: a beautiful SDK around an immature product model would lock in the wrong abstractions.

### Scientific visualisation before final SDK/agent work

After platform hardening, SCI-04 was moved ahead of SDKs because graphing is direct user value and part of the product thesis.

### Sheetbase-first future roadmap

Post-Roadmap-2 planning initially risked being framed around interoperability/ecosystem needs. The correction was to focus on maturing Sheetbase UI/platform/scientific depth in its own right.

## Development-process themes

### Whole named roadmap tasks

Agents should complete a named task/exit criterion rather than being told to do an ambiguous fraction of another roadmap item. Tiny supporting changes are implementation details of the assigned task.

### Inspect real code and tests

PR reviews should inspect the actual diff/server path/tests rather than trusting PR summaries. Several important issues were found only by tracing real execution paths, including request-scoped capability checks and live/frozen visualisation parity.

### Avoid speculative compatibility

Once it was made explicit that Sheetbase had no users, production data or production credentials, compatibility-only shims became actively undesirable. The preferred approach is to remove superseded development-era paths.

### Correctness before checklist completion

A roadmap item is not complete because every bullet has a component. Reviews should test the core promise: e.g. a frozen visualisation must actually preserve the same scientific meaning as the live one, not merely contain a Dataset Version ID.

## UX corrections that matter

Repeated design feedback favours:

- dense, professional layouts;
- large working areas for Sheets/figures;
- separate screens/assets rather than overloaded composite mockups;
- obvious interactions rather than basic form grids;
- consistent styling across the product;
- avoiding huge text and excessive whitespace;
- preserving the established design language when adding new surfaces.

## How to use this history

Use these themes to understand _why_ canonical rules exist. Do not treat historical phrasing as stronger than current ADRs or canonical product documents.
