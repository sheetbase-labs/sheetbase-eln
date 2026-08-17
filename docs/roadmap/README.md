# Sheetbase Post-Core Roadmap

> **Status:** active planning authority after CORE-01–06 and Core Hardening  
> **Current phase:** Product & Platform Consolidation

## Purpose

This folder is the canonical planning home for Sheetbase after the completed Core Data Workspace programme.

`docs/core/` remains the architectural and implementation record for CORE-01–06. This folder describes what Sheetbase builds next: the scientist-facing product, public platform, interoperability, governance, collaboration, scientific analysis, integrations, operational maturity and automation.

## Start here

1. [`NEXT.md`](./NEXT.md) — current hand-off and what should be planned or implemented next.
2. [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) — product thesis, principles and target experience.
3. [`PROGRAMME_MAP.md`](./PROGRAMME_MAP.md) — programme-level sequencing and dependencies.
4. [`tasks/README.md`](./tasks/README.md) — epic index and status.
5. The relevant task file under [`tasks/`](./tasks/) before implementing an epic.
6. [`prompts/README.md`](./prompts/README.md) — reusable agent starting prompts for each programme.

## Programmes

| Prefix | Programme | Relative timing | Agent prompt |
| --- | --- | --- | --- |
| `PC` | Product Consolidation | Now | [`prompts/PC.md`](./prompts/PC.md) |
| `API` | API & Developer Platform | Early / parallel with PC | [`prompts/API.md`](./prompts/API.md) |
| `DATA` | Data Interoperability | Early / parallel with PC | [`prompts/DATA.md`](./prompts/DATA.md) |
| `GOV` | Identity, Administration & Governance | Early–mid | [`prompts/GOV.md`](./prompts/GOV.md) |
| `COLLAB` | Collaboration | Mid | [`prompts/COLLAB.md`](./prompts/COLLAB.md) |
| `SCI` | Scientific Analysis & Visualisation | Mid, after core Sheet UX stabilises | [`prompts/SCI.md`](./prompts/SCI.md) |
| `INT` | Integrations | Mid–late | [`prompts/INT.md`](./prompts/INT.md) |
| `PLAT` | Platform, Operations & Security | Continuous | [`prompts/PLAT.md`](./prompts/PLAT.md) |
| `AUTO` | Automation | Later | [`prompts/AUTO.md`](./prompts/AUTO.md) |

PC-00 has its own audit prompt: [`prompts/PC-00.md`](./prompts/PC-00.md).

## Planning model

The roadmap is deliberately not a single long queue. Several capability tracks can progress in parallel once their dependencies are satisfied.

```text
                       CORE COMPLETE
                            |
              +-------------+-------------+
              |             |             |
              v             v             v
             PC            API           DATA
              |             |             |
              +------+------+-+-----------+
                     |        |
                     v        v
                    GOV      PLAT
                     |        |
              +------+------+------+
              |             |       |
              v             v       v
           COLLAB           SCI     INT
                            |
                            v
                           AUTO
```

This is a dependency shape, not a mandate that every programme must finish before another starts. AUTO is a normal later workstream, just as INT and SCI are sequenced according to the capabilities they build upon.

## Current planning rule

Do not start large post-Core implementation from an old summary. Begin with `NEXT.md`, then follow the relevant task file and matching prompt.

The immediate task is **PC-00 — Product & Platform Consolidation Audit**. Its job is to establish the actual post-Core product/platform state and refine the first implementation epics from evidence.

## Relationship to root `ROADMAP.md`

The root `ROADMAP.md` remains the concise repository-level orientation and completed Core summary. Detailed post-Core planning lives here.

## Relationship to ADRs

Task files define delivery scope. Accepted ADRs define durable architectural decisions. If implementation exposes a genuinely new durable fork, add an ADR rather than silently changing the architecture inside a task file.
