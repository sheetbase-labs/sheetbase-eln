# SciNote — ELN Pattern Reference

**Research snapshot:** 13 August 2026  
**Primary relevance to Sheetbase:** approachable workflow structure, reusable protocols/templates/forms, inventory links and API interoperability.

## Product pattern

SciNote organises work around Projects, Experiments, Workflows and Tasks, with reusable Protocol Templates and structured result/inventory features.

It is a useful counterpoint to platform-heavy competitors because its mental model is comparatively approachable.

## Protocols and templates

Protocols can contain tables, well plates, checklists, rich text, files and forms. Protocol templates can be versioned/published and reused within Tasks. Template access distinguishes stronger owner/publication authority from ordinary use/view access.

SciNote also promotes Experiment/Workflow, Inventory and Result templates.

### Sheetbase lesson

Users understand Templates as a way to make repeatable science easy. Sheetbase's underlying architecture can be sophisticated while the scientist-facing mental model remains simple.

## Structured forms and results

SciNote Forms are positioned as reusable structured entry surfaces with typed fields, validation, audit trails and versioning. Result templates standardise output capture.

### Sheetbase lesson

Not every structured input needs to look like a spreadsheet. The common schema kernel should eventually support Sheet, compact form or protocol-step views over compatible semantics.

## Tables

SciNote supports data tables inside protocol steps and documents mathematical operations/formulas in tables. The table experience is less central to the overall product identity than the proposed Sheetbase direction.

### Sheetbase opportunity

Make Sheets dramatically more capable as the primary structured work plane while retaining Forms/Templates as alternative interaction views.

## Inventory and models

SciNote supports custom inventory columns and links inventory items into experimental work. This reflects a common ELN pattern where configuration is feature/module-specific rather than one universal Model system.

### Sheetbase opportunity

Use one explicit Model system across Sample, Reagent and future scientific objects rather than separate customisation concepts for every module.

## Workflow and integration

SciNote offers reusable Workflows/Tasks and status automation plus a REST API for bidirectional integrations and operations over tasks, protocols and samples.

## What Sheetbase should copy conceptually

- approachable workflow hierarchy;
- protocol/result templates;
- reusable Forms;
- explicit Template publication/versioning;
- inventory-to-experiment traceability;
- REST interoperability.

## What Sheetbase can improve on

Unify lower-level semantics so Forms, Sheets, inventory fields and Pipeline inputs can share reusable field/schema definitions.

## Official sources

- Templates: https://www.scinote.net/product/scinote-templates/
- Create a Task Protocol or Protocol Template: https://knowledgebase.scinote.net/en/knowledge/how-to-create-a-protocol
- Getting Started / structure and data tables: https://knowledgebase.scinote.net/en/knowledge/getting-started
- Integrations and API: https://www.scinote.net/product/integrations-and-api/
- Results Templates: https://knowledgebase.scinote.net/en/knowledge/how-can-i-add-templates-for-results-to-a-task

## Caveat

Availability of some Template/Form capabilities varies by plan. This note is based on public product and knowledge-base documentation rather than a configured tenant.
