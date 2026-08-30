---
title: Evolution of Sheetbase
status: historical
last_reviewed: 2026-08-30
---

# Evolution of Sheetbase

This document records how the product model evolved. It is historical context, not authority over canonical decisions.

## 1. ELN starting point

Sheetbase began from the idea of a polished electronic lab notebook with:

- project/folder navigation;
- flexible experiment pages;
- multiple sections;
- text, tables and graphs;
- simple experiment data models;
- full-featured graphing;
- biotech suitability without hard-coding the product to one scientific domain.

A major early UX goal was to avoid the rigid-form feel common to ELNs and instead use an Attio-inspired, dense, modern workspace.

## 2. From “tables in a notebook” to Sheets

Early discussion converged on top-level concepts of **Notebooks, Sheets and Datasets**. A key correction was that a table should simply be a Sheet rather than creating a separate table product.

This changed the architecture from “document with embedded widgets” toward a real structured-data workspace.

## 3. Spreadsheet-native interaction became central

The Sheet was defined as the place scientists should be able to type/paste data immediately, work with formulas, mix sources and explore without first designing a database schema.

This led to the important local/governed distinction: exploratory columns are legitimate and can later be promoted deliberately.

## 4. Dataset separated durability from presentation

Datasets emerged as durable rectangular scientific data independent of Sheet layout. This enabled stable rows/fields, typed storage, schema versions and meaningful immutable Dataset Versions.

The Sheet could therefore remain flexible and compositional without becoming the only persistence/evidence model.

## 5. Models and Records established scientific identity

User-extensible Models/Records provided durable identity for scientific entities and relationships. UUID identity, human-readable identifiers and names/titles were kept distinct.

This made it possible for Sheets to reference scientific entities without reducing every scientific object to a row label.

## 6. Definition/Instance split clarified reuse

Reusable Sheet configuration became Sheet Definition; working state became Sheet Instance. Notebook Templates were separated from Notebooks.

The crucial consequence was that reuse must not mean shared mutable state. Existing instances should not silently change when definitions/templates evolve.

## 7. Evidence semantics became explicit

The architecture distinguished:

- audit/history;
- live mutable work;
- immutable Dataset Versions;
- published reusable definitions;
- submitted/frozen evidence.

A generic Sheet Version was rejected. Dataset Version became the structured-data primitive for historical/evidence interpretation.

## 8. Core consolidation closed foundational ambiguity

CORE/PC work settled canonical FieldDefinition/data identity, typed Dataset storage, stable write-back, capability semantics, formula trust boundaries, RLS/server authority and golden workflows.

This phase also established a strong rule: do not create a parallel concept simply because an old development path exists.

## 9. Scientific-table architecture was retired

Earlier scientific-table/SCI-010 paths and generated `sheet_*` resources were no longer treated as product architecture. The canonical future became Dataset/Sheet Instance-based.

This was an important pre-release cleanup: compatibility with development history was not a product requirement.

## 10. Roadmap 2 completed the surrounding product/platform

Roadmap 2 expanded the core into import/export/files/search, collaboration, integrations, governance, administration, observability/security/scale, deterministic Pipelines and a first-class public API.

## 11. Scientific visualisation priority was corrected

After SCI-01–03, SCI-04 was temporarily framed as deferrable/usage-driven. That was challenged because serious graphing is central to a scientific workspace.

SCI-04 was restored as core Roadmap 2 work and completed the canonical ChartSpec/Analysis Studio/live-frozen/evidence/export workflow.

## 12. Future direction was re-centred on Sheetbase itself

When thinking about the post-Roadmap-2 phase, ecosystem/integration framing was rejected. The future roadmap should mature Sheetbase's own UX, scientific depth and platform first; interoperability should follow from good generic contracts.

The current draft Roadmap 3 direction therefore starts with Product Depth and Scientific Depth before broad intelligent/enterprise expansion.
