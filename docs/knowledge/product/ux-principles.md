---
title: Sheetbase UX Principles
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase UX Principles

## Design character

Sheetbase should feel like a mature, premium scientific workspace: dense, calm, precise and fast. The strongest early visual reference was Attio-style product design, adapted for scientific work rather than copied literally.

The product should avoid the common ELN pattern of large empty cards, oversized headings and low information density.

## Density with clarity

Prefer:

- compact controls;
- clear hierarchy;
- strong alignment and spacing;
- efficient sidebars/inspectors;
- large working surfaces for Sheets, charts and scientific content;
- progressive disclosure for advanced options.

Do not confuse minimalism with removing useful information.

## Spreadsheet-native Sheets

The Sheet interaction model should prioritise direct manipulation:

- keyboard navigation;
- type/paste/fill;
- range selection;
- copy/cut;
- predictable editing;
- typed cells and validation without blocking exploratory work unnecessarily;
- fast filter/sort/freeze operations;
- familiar formula behaviour;
- obvious provenance/write-back state when data is sourced from durable objects.

Users should not need to understand the database model to enter data effectively.

## Notebook composition

Notebooks should support free-form scientific composition with multiple section types rather than forcing one rigid experiment form.

Expected content includes:

- text/narrative;
- methods/procedure content;
- Sheets;
- figures and analyses;
- files;
- linked scientific Records;
- evidence/review state.

The product should still make structure obvious enough that users understand what will become evidence.

## Navigation and organisation

Projects/folders should provide a strong spatial/navigation model for scientific work. The sidebar should make it easy to understand where Notebooks, Sheets, Datasets and other artefacts live without implying that folder placement defines canonical identity.

## Model/schema editing

Creating and editing Models and schemas should be immersive and obvious, not a basic settings form full of disconnected inputs.

A user defining a concept such as “Lentivector” should be able to understand the entity, fields, relationships, lifecycle and reuse implications as one coherent design surface.

## Scientific visualisation

The figure should dominate the graphing workspace. Controls should be compact and immediate rather than presented as a giant wizard or a wall of dropdowns.

Basic charts should be quick; advanced grouping, facets, error bars, fits, axes and styling should appear progressively.

## Configuration vs scientific work

Steward/configuration surfaces can expose more structural detail, but scientist-facing workflows should favour task language over database/schema terminology.

Capabilities should control actions, not create multiple visually unrelated products for each role.

## Consistency

The same concepts should look and behave consistently across Notebook, Sheet, Dataset, configuration and admin surfaces.

Avoid bespoke one-off components when a canonical interaction already exists.

## Errors and provenance

Errors should explain what happened and how to recover. Scientific transforms/validations should not silently coerce invalid values.

Provenance should be inspectable when users need it, especially for sourced Sheet cells, chart points, frozen evidence and external imports, without permanently cluttering the primary workspace.

## Visual restraint

Avoid:

- generic dashboard aesthetics;
- decorative gradients and random illustration;
- huge hero-like text inside the application;
- card grids for inherently tabular/workspace tasks;
- icon overload;
- excessive whitespace that reduces working area.

Use the product design system and accepted design ADRs as the implementation source of truth.
