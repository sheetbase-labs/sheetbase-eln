---
title: Sheetbase Core Concepts
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase Core Concepts

## Top-level product concepts

The durable top-level concepts are **Notebooks, Sheets and Datasets**. Models/Records provide scientific entity identity beneath and alongside them.

### Notebook

A Notebook is the scientific context and evidence container.

It can contain narrative, methods, observations, files, Sheets, linked Records, analyses, figures, review state and submitted/frozen evidence.

A Notebook is not just a page layout. It is the unit in which scientific work is assembled into a coherent record.

### Sheet

A Sheet is the primary structured-data interaction surface.

It should feel spreadsheet-native: type, paste, fill, copy/cut, keyboard navigation, rows/columns, typed editors, validation, filters, sorts, frozen columns, formulas, Record references, Dataset sources, local fields, write-back and charts.

A Sheet is **not** automatically a durable Dataset. It may combine governed and exploratory data.

There is one Sheet product. “Ad-hoc”, “composed”, “bound” or similar terms describe states/configuration, not separate products.

### Dataset

A Dataset is durable rectangular structured data independent of Sheet presentation.

It owns stable identity, rows, fields, schema-version binding, revision state and immutable Dataset Versions.

Datasets are appropriate when tabular data has durable meaning beyond one transient Sheet arrangement.

### Model

A Model defines a type of scientific entity and its fields, for example Sample, Reagent or Lentivector. Models are user-extensible subject to capability/governance rules.

A Model is not a Dataset schema and should not be used as a generic replacement for every table.

### Record

A Record is an instance of a Model/scientific entity with stable identity.

Record identity is not its display name, row coordinate or human-readable identifier. UUID identity, human identifier and name/title are distinct concepts.

## Definitions and instances

Reusable configuration is separated from working state.

### Sheet Definition vs Sheet Instance

- **Sheet Definition**: reusable configuration/structure.
- **Sheet Instance**: state used in actual work/experiments.

Instances do not silently inherit future changes to a Definition. Upgrades are explicit where supported.

### Notebook Template vs Notebook

- **Notebook Template**: reusable configuration and placements.
- **Notebook**: working scientific state instantiated from a Template or created directly.

Reuse does not imply shared mutable state.

## Dataset Schema and Dataset Version

Dataset Schemas are versioned. A Dataset pins a Schema Version.

A live Dataset is mutable through canonical operations and revisions. A **Dataset Version** is an immutable meaningful snapshot used for historical interpretation, reuse and evidence.

A later schema change must not silently reinterpret an existing Dataset Version.

## Local and governed data

A Sheet may mix:

- Dataset-backed governed fields;
- Record references;
- local exploratory fields;
- calculated fields.

This is intentional.

Creating a local field does not automatically create a Dataset Schema field or Model field. Promotion is explicit.

## Binding vs promotion

**Binding** connects existing durable data/structure to a Sheet.

**Promotion** turns useful exploratory/local structure into a governed reusable concept.

They are different user actions and different semantic transitions.

## Write-back

A composed Sheet can expose data from durable sources and allow controlled write-back where the mapping is unambiguous.

There is one write-back target per write operation. Record write-back uses stable UUID identity. Sheet UI coordinates are not semantic identity.

## Projects and folders

Projects are organisational/scientific context, not a competing data identity layer. The UI may present projects and folders to help scientists organise work, but canonical entity identity remains independent of navigation placement.

## Scientific files

Files are first-class referenced artefacts through the canonical file subsystem. Notebook file blocks, imports, evidence and integrations should reuse that subsystem rather than inventing local attachment stores.

## Submitted/frozen evidence

Submitting scientific work creates an evidence boundary. Live workspace objects can continue evolving, while evidence references immutable state needed to preserve historical scientific meaning.

This is why a generic “version everything” strategy is avoided. Version only where meaning requires it.
