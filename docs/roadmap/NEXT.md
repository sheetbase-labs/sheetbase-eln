# Sheetbase Roadmap — Current Work

> **Implementation and planning agents start here for post-Core work.**

## Programme

**Product & Platform Consolidation**

## Active task

**PC-01 — Canonical Sheet Experience**

Task: [`tasks/PC.md`](./tasks/PC.md) (section PC-01)  
Agent prompt: [`prompts/PC.md`](./prompts/PC.md)

PC-00 is complete. Audit: [`audits/PC-00.md`](./audits/PC-00.md).

CORE-01–06 and Core Hardening remain closed. Do not reopen settled Core architecture without concrete implementation evidence.

## Goal of PC-01

One spreadsheet-native Sheet experience spanning ad-hoc and composed states, exposing existing CORE-03/H2 RPCs (paste, types, calculations, bind/adopt, Record link/create, extract/upgrade/materialise) instead of inventing a second Sheet system.

## Required reading

1. [`README.md`](./README.md)
2. [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md)
3. [`PROGRAMME_MAP.md`](./PROGRAMME_MAP.md)
4. [`audits/PC-00.md`](./audits/PC-00.md)
5. [`tasks/PC.md`](./tasks/PC.md)
6. [`prompts/PC.md`](./prompts/PC.md)
7. [`../core/CORE_HARDENING.md`](../core/CORE_HARDENING.md)
8. relevant accepted ADRs (especially 0020, 0037, 0038)

## Do now

Implement PC-01 from evidence in the PC-00 audit. Prefer existing RPCs. A thin PC-03 slice (blank experiment create + submit) may proceed in parallel because workflows A and F are otherwise unreachable.

## Do not

- do not start AUTO;
- do not build a visual Pipeline designer;
- do not create an AI-specific data or permission model;
- do not reopen FieldDefinition, Dataset, Definition/Instance, Template version or frozen-evidence architecture without a real defect;
- do not create another Dataset, Sheet, Template or capability system;
- do not treat the browser as the only future client;
- do not restore SCI-010 / scientific-table / legacy notebook-template surfaces;
- do not broaden specialist workspaces merely because old code exists.

## Expected hand-off

PC-01 should leave a scientist able to work in one Sheet experience from a Notebook, with Core reuse actions reachable, and `NEXT.md` pointing at the next approved task (likely continuing PC-01 slices, the PC-03 submit/create slice, or parallel API-01 — see the audit parallelisation plan).
