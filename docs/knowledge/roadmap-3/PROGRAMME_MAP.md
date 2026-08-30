# Roadmap 3 — Programme Map

## Entry condition

Roadmap 3 becomes the active execution programme only after Roadmap 2's active remainder is complete or explicitly closed. `../NEXT.md` remains the single current hand-off.

## Programme shape

```text
                         ROADMAP 2 COMPLETE
                                |
                                v
                     +---------------------+
                     |   PRODUCT DEPTH     |
                     | NAV GRID NOTE FIND  |
                     +----------+----------+
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
          +-------------------+    +-------------------+
          | SCIENTIFIC DEPTH  |    |   OPEN PLATFORM   |
          | KNOW VIEW MODEL   |    | SDK EVENT EXT     |
          | REUSE             |    | ADMIN             |
          +---------+---------+    +---------+---------+
                    |                        |
                    +-----------+------------+
                                |
                                v
                    +-----------------------+
                    | INTELLIGENT WORKSPACE |
                    | AI ASSIST AUTO+       |
                    +-----------+-----------+
                                |
                                v
                    +-----------------------+
                    |   INSTITUTIONALISE    |
                    | ENT-ORG GXP OPS       |
                    +-----------------------+
```

This is a dependency shape, not a requirement for purely serial delivery. Independent tasks may proceed in parallel once their explicit dependencies and assignment are satisfied.

## Programmes and tasks

| Programme | Task | Outcome | Depends on |
| --- | --- | --- | --- |
| Product Depth | NAV-01 | coherent workspace navigation and command access | Roadmap 2 complete |
| Product Depth | GRID-01 | spreadsheet-grade Sheet interaction depth | Roadmap 2 complete |
| Product Depth | NOTE-01 | mature Notebook composition/authoring | Roadmap 2 complete |
| Product Depth | FIND-01 | recent/favourite/contextual resurfacing | NAV-01 recommended |
| Scientific Depth | KNOW-01 | relationship/context navigation across scientific objects | NAV-01; canonical identities |
| Scientific Depth | VIEW-01 | richer scientific representations over canonical data | SCI-04; GRID-01 recommended |
| Scientific Depth | MODEL-01 | deeper configurable scientific modelling | Roadmap 1 schema/model contracts |
| Scientific Depth | REUSE-01 | reusable scientific structures/workflows with explicit upgrades | MODEL-01; NOTE-01 |
| Open Platform | SDK-01 | mature ergonomic Python/TypeScript SDK product | Roadmap 2 API-04/05 |
| Open Platform | EVENT-01 | mature event/webhook platform | Roadmap 2 API-06 |
| Open Platform | EXT-01 | extension model over canonical contracts | SDK-01; EVENT-01 |
| Open Platform | ADMIN-01 | mature platform administration | existing GOV/PLAT foundations |
| Intelligent Workspace | AI-01 | safe contextual intelligence substrate | KNOW-01; SDK/EVENT foundations |
| Intelligent Workspace | ASSIST-01 | embedded assistance inside canonical workflows | AI-01; GRID-01; NOTE-01 |
| Intelligent Workspace | AUTO-PLUS-01 | mature agentic operation/workflow capability | Roadmap 2 AUTO-04/05; AI-01 |
| Institutionalise | ENT-ORG-01 | organisation/team model when justified | accepted ADR; ADMIN-01 |
| Institutionalise | GXP-01 | configurable regulated controls/evidence | ADMIN-01; evidence contracts |
| Institutionalise | OPS-01 | larger-scale operational maturity | ADMIN-01; adoption evidence |

## Recommended waves

### Wave A — Scientist experience

`NAV-01`, `GRID-01`, `NOTE-01` can start in parallel after Roadmap 2 closes. `FIND-01` follows or overlaps once navigation semantics are settled.

### Wave B — Scientific meaning and platform maturity

`KNOW-01`, `VIEW-01`, `MODEL-01`, `SDK-01`, `EVENT-01`, `ADMIN-01` may progress in parallel according to product need. `REUSE-01` follows MODEL/NOTE maturity. `EXT-01` follows SDK/EVENT maturity.

### Wave C — Intelligence

`AI-01` establishes context/permission/provenance foundations. `ASSIST-01` and `AUTO-PLUS-01` build on it and on mature human workflows.

### Wave D — Institutionalisation

`ENT-ORG-01`, `GXP-01`, and `OPS-01` are evidence-driven. Do not start them merely because earlier waves are complete.

## Cross-cutting invariants

Every Roadmap 3 task must preserve:

- one canonical Notebook / Sheet / Dataset / Model / Record model;
- PostgreSQL/RLS/server authority;
- stable semantic identity;
- explicit local vs governed state;
- explicit write targets and provenance;
- Dataset Version / Definition Version / submitted-evidence boundaries;
- one capability system;
- one connector framework;
- one Pipeline model;
- one ChartSpec model;
- one public domain contract for browser/SDK/integration/automation clients.

## Planning rule

A task becomes Ready only when:

1. its dependencies are satisfied;
2. its task section has a complete exit criterion;
3. any required ADR is accepted;
4. the root `../NEXT.md` or an explicit assignment identifies it as current work.

Roadmap order alone does not assign work.
