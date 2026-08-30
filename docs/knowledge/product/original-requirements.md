---
title: Original Sheetbase Product Requirements
status: canonical
last_reviewed: 2026-08-30
---

# Original Sheetbase Product Requirements

These requirements capture the durable product intent that seeded the later Core and Roadmap 2 architecture.

## Spreadsheet-native structured data

Sheets backed by PostgreSQL are a primary way scientists enter and manipulate data. They should feel familiar to Excel users while remaining grounded in typed, durable scientific data semantics.

The product should support direct entry, paste, fill, keyboard navigation, filtering, formulas and graphing without exposing database administration.

## Compositional Sheets

A Sheet must be able to combine more than one source. It may compose:

- multiple Datasets;
- Model/Record-backed fields;
- Record relationships;
- local exploratory columns;
- calculated/derived columns.

This composition must preserve field/source provenance rather than flattening everything into an ambiguous copied table.

## Semantic row identity

Visible row position is not scientific identity. Rows and linked Records need stable semantic identity so sorting, filtering and joins do not change meaning.

Where a Sheet represents joined/composed data, the product must be explicit about which source object/row a writable value belongs to.

## Record creation from Sheets

Scientists must be able to create canonical Records from the Sheet workflow itself rather than leaving the grid for a separate administration process.

Both inline and bulk creation are legitimate product workflows. Creation must still use canonical validation, permissions, Model semantics and provenance.

## Explicit write-back

A composed Sheet can expose editable and read-only data together.

For writable cells, the authoritative target must be explicit and unambiguous. Joined/derived/read-only values must not silently write into an arbitrary source. Failures should be attributable to the specific row/field operation.

## User-extensible data models

Users with the appropriate capabilities should be able to create and evolve Models/schema rather than relying entirely on developer-defined scientific entities.

Configuration should be powerful enough for different scientific organisations/workflows without turning every scientist into a database administrator.

## Role-specific configuration

Different roles need different configuration and operational authority. Scientist authoring, Steward data-language configuration and workspace/platform administration are intentionally distinct concerns even though they use one capability system.

## Information density, accuracy and scale

The product should favour high information density and scientific accuracy while remaining clear and performant at realistic scale.

Do not trade working area and scientific context for decorative minimalism.

## Pipelines and agents later

The long-term product should support both manually configured/coded transformations and agentic manipulations.

Those capabilities should come after the human/domain model is solid and should operate through the same canonical data, permission, provenance and evidence contracts.

## Biotech-first context, generic architecture

Early use cases and design discussions were biotech-heavy, but the product architecture should not depend on one assay type, instrument vendor or scientific discipline.

Scientific concepts should be configurable where practical rather than hard-coded into the platform core.
