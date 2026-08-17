# Sheetbase Roadmap — Current Work

> **Implementation and planning agents start here for post-Core work.**

## Programme

**Product & Platform Consolidation**

## Active task

**PC-00 — Product & Platform Consolidation Audit**

Task: [`tasks/PC-00.md`](./tasks/PC-00.md)

CORE-01–06 and Core Hardening are complete. Do not reopen settled Core architecture without concrete implementation evidence.

AUTO-01 remains deferred. Do not start Pipeline or agentic automation work from this hand-off.

## Goal of PC-00

Establish what Sheetbase can actually do today across product and platform surfaces, identify missing or duplicate paths, and turn the master roadmap into an evidence-based first implementation sequence.

The audit must cover more than UI. It should inspect:

- Sheet, Dataset, Record, Notebook, Template and configuration workflows;
- public/external API surface and credentials;
- import/export and files;
- search;
- governance and administration;
- collaboration;
- charts and analysis;
- integrations;
- deployment, observability and security posture;
- developer experience;
- existing but hidden Core capabilities;
- legacy or duplicate product surfaces;
- representative end-to-end workflows.

## Required reading

1. [`README.md`](./README.md)
2. [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md)
3. [`PROGRAMME_MAP.md`](./PROGRAMME_MAP.md)
4. [`tasks/PC-00.md`](./tasks/PC-00.md)
5. [`../core/CORE_01_06_IMPLEMENTATION_REVIEW.md`](../core/CORE_01_06_IMPLEMENTATION_REVIEW.md)
6. [`../core/CORE_HARDENING.md`](../core/CORE_HARDENING.md)
7. relevant accepted ADRs

## Do now

Complete PC-00 as an audit/planning checkpoint. Refine priorities and task boundaries from evidence before beginning PC-01 or parallel API/DATA work.

## Do not

- do not start AUTO-01;
- do not build a visual Pipeline designer;
- do not create an AI-specific data or permission model;
- do not reopen the FieldDefinition, Dataset, Definition/Instance, Template version or frozen-evidence architecture without evidence of a real defect;
- do not create another Dataset, Sheet, Template or capability system;
- do not treat the browser as the only future client;
- do not make compatibility/legacy surfaces primary again;
- do not broaden specialist workspaces merely because old code exists;
- do not turn PC-00 into implementation.

## Expected hand-off

PC-00 should leave:

1. an inventory of current product/platform surfaces;
2. canonical / duplicate / missing classifications;
3. end-to-end workflow findings;
4. security/API/data-interoperability gaps;
5. a prioritised P0–P3 gap list;
6. refined scopes for the first PC/API/DATA/GOV/PLAT epics;
7. a recommended parallelisation plan;
8. this file updated to the first approved implementation task.
