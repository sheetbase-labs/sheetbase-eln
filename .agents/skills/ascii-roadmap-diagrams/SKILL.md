---
name: ascii-roadmap-diagrams
description: Create compact, aligned ASCII/Unicode roadmap, capability-map, progress, and programme-status diagrams in Markdown code blocks. Use for project roadmaps, workstream status, completed-vs-remaining summaries, phases, and capability maps.
---

# ASCII Roadmap Diagrams

Use this skill to turn project plans, roadmaps, workstreams, capabilities, and task status into compact monospaced text diagrams.

The goal is not decorative ASCII art. The goal is a high-information visual summary that can be pasted into Markdown, GitHub, terminals, issues, PRs, planning docs, and agent hand-offs.

## When to use

Prefer these diagrams when the user asks for:

- a roadmap;
- a visual of what is complete vs remaining;
- a programme map;
- capability families;
- workstream status;
- progress across epics/tasks;
- a "where are we?" overview;
- project phases or sequencing;
- a compact status dashboard.

## Core rules

1. Always use a Markdown code block. Alignment depends on monospace rendering.
2. Optimise for scanability. A reader should understand the structure in seconds.
3. Show structure before prose. Put the diagram first.
4. Keep columns and bar widths consistent.
5. Prefer Unicode box drawing: `│ ─ ├ └ ┬ ┴ ┼ ┌ ┐ ▼ ↑ →`.
6. Use status symbols consistently:
   - complete: `█`
   - remaining: `░`
   - active / next: `▶`
   - partial: combine `█` and `░`
7. Do not fabricate precision. Use percentages only when grounded.
8. Preserve hierarchy: programme → stream → epic → task.
9. Recalculate statuses from current source material. Never reuse stale percentages blindly.
10. Prefer dense information over decorative framing.

# Diagram Type 1 — Capability Map

Use this for the overall shape of a project.

```text
                           PROJECT
                               │
       ┌───────────────────────┼────────────────────────┐
       │                       │                        │
    PILLAR A                PILLAR B                 PILLAR C
       │                       │                        │
       ▼                       ▼                        ▼

 AREA  ██████████ 100%     AREA   ████████░░  80%   AREA   ██░░░░░░░░  20%
 AREA  ███████░░░  70%     AREA   ██████████ 100%   AREA   ░░░░░░░░░░   0%
 AREA  ██████████ 100%     AREA   █████░░░░░  50%
```

Rules:

- usually use 2–4 pillars;
- keep pillar names short;
- use 10-cell bars;
- align percentages;
- leave whitespace when one pillar has fewer rows.

Example:

```text
                           SHEETBASE
                               │
       ┌───────────────────────┼────────────────────────┐
       │                       │                        │
   FOUNDATION               PRODUCT                 PLATFORM
       │                       │                        │
       ▼                       ▼                        ▼

 CORE  ██████████ 100%     PC     ██████████ 100%   PLAT   ██░░░░░░░░
 DATA  ██████████ 100%     SCI    ████████░░  75%   AUTO   ░░░░░░░░░░
 API   ███████░░░ ~60%     COLLAB ██████████ 100%
 INT   ██████████ 100%     GOV    ████████░░  75%
```

# Diagram Type 2 — Current → Future Capability Map

Use this for roadmap generations or "what happens after this roadmap?".

```text
                           PROJECT
                               │
       ┌───────────────────────┼────────────────────────┐
       │                       │                        │
   CURRENT A                CURRENT B                CURRENT C
       │                       │                        │
       ▼                       ▼                        ▼

 CORE  ██████████ 100%     PROD   ██████████ 100%   PLAT   ██████████ 100%
 DATA  ██████████ 100%     SCI    ██████████ 100%   AUTO   ██████████ 100%

                               │
                               ▼

       ┌───────────────────────┼────────────────────────┐
       │                       │                        │
    FUTURE A                FUTURE B                 FUTURE C
       │                       │                        │
       ▼                       ▼                        ▼

 SDK   ░░░░░░░░░░   0%     AI     ░░░░░░░░░░   0%   ORG    ░░░░░░░░░░   0%
 EXT   ░░░░░░░░░░   0%     KNOW   ░░░░░░░░░░   0%   GXP    ░░░░░░░░░░   0%
 APP   ░░░░░░░░░░   0%     DISC   ░░░░░░░░░░   0%   OPS    ░░░░░░░░░░   0%
```

Use the vertical transition to make the conceptual shift explicit.

# Diagram Type 3 — Detailed Task Roadmap

Use when showing all tasks and statuses.

```text
WORKSTREAM NAME
────────────────────────────────────────────────────────────
TASK-01  ████████████████████  DONE
TASK-02  ████████████████████  Completed capability
TASK-03  ▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶  NEXT — Current work
TASK-04  ░░░░░░░░░░░░░░░░░░░░  Later capability
```

Use 20-cell bars.

Status patterns:

```text
TASK-01  ████████████████████  DONE
TASK-02  ░░░░░░░░░░░░░░░░░░░░  Planned work
TASK-03  ▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶  NEXT — Description
TASK-04  ████████░░░░░░░░░░░░  40% — Description
TASK-05  ░░░░░░░░░░░░░░░░░░░░  BLOCKED — requires ADR
TASK-06  ░░░░░░░░░░░░░░░░░░░░  LATER — usage driven
```

Separate workstreams like this:

```text
DATA
────────────────────────────────────────────────────────────
DATA-01  ████████████████████  Import
DATA-02  ████████████████████  Export / portability
DATA-03  ████████████████████  Files / attachments
DATA-04  ████████████████████  Global search
```

Use two blank lines between major sections.

For important completion milestones, a centred callout is acceptable:

```text
                         INTEGRATIONS COMPLETE
```

Do not overuse these.

# Diagram Type 4 — Phase / Journey Map

Use when sequence matters more than percentages.

```text
                        ┌──────────────────────┐
                        │ 1. CORE DATA MODEL   │
                        │      COMPLETE        │
                        └──────────┬───────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │ 2. PRODUCT CONSOLIDATION│
                    │       COMPLETE           │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                 ┌──────────────────────────────┐
                 │ 3. OPERABILITY / MATURITY   │
                 │       CURRENT PHASE          │
                 └──────────────┬───────────────┘
                                │
                                ▼
                  ┌─────────────────────────────┐
                  │ 4. AUTOMATION / AGENTS     │
                  │          LATER              │
                  └─────────────────────────────┘
```

Use sparingly because box diagrams take more vertical space.

# Diagram Type 5 — Simple Ordered Roadmap

Use when the next-order sequence is the point.

```text
NOW
 │
 ├─ PLAT-01  Deployment / recovery
 ├─ PLAT-02  Observability
 ├─ PLAT-03  Security
 │
 ├─ AUTO-01  Pipeline foundation
 ├─ AUTO-02  Execution / triggers
 ├─ AUTO-03  Pipeline authoring
 │
 ├─ PLAT-05  Scale from measured workloads
 │
 ├─ AUTO-04  Agent-authored operations
 └─ AUTO-05  Agentic workflows
```

# Choosing the right diagram

```text
Need overall project shape?
→ Capability Map

Need present + future generations?
→ Current → Future Capability Map

Need every epic/task?
→ Detailed Task Roadmap

Need sequential phases?
→ Phase / Journey Map

Need concise next-order list?
→ Simple Ordered Roadmap
```

Often the best response contains two diagrams:

1. capability map;
2. detailed roadmap or sequence.

Do not automatically generate all five.

# Progress bar conventions

Compact, 10 cells:

```text
██████████ 100%
████████░░  80%
██████░░░░  60%
████░░░░░░  40%
██░░░░░░░░  20%
░░░░░░░░░░   0%
```

Detailed, 20 cells:

```text
████████████████████ 100%
████████████████░░░░  80%
████████████░░░░░░░░  60%
████████░░░░░░░░░░░░  40%
████░░░░░░░░░░░░░░░░  20%
░░░░░░░░░░░░░░░░░░░░   0%
```

Prefer bars based on task completion rather than subjective confidence.

If a workstream has 4 tasks and 3 are complete, 75% is reasonable.

If task sizes differ radically, avoid mathematical precision unless weights are defined.

# Alignment rules

Alignment is part of correctness.

Bad:

```text
API ██████████ 100%     COLLAB ████████░░ 80% PLAT ██░░░░░░░░
```

Good:

```text
 API   ██████████ 100%     COLLAB ████████░░  80%   PLAT   ██░░░░░░░░  20%
```

Keep:

- identifiers aligned;
- bars equal width;
- percentage columns aligned;
- descriptions starting in the same column.

When descriptions wrap, indent the continuation to the description column:

```text
Follow-up ░░░░░░░░░░░░░░░░░░░░  Stable Sheet row IDs +
                                  cell/range comments
```

# Tone

These diagrams should feel like:

- programme-management tooling;
- engineering planning;
- terminal dashboards;
- architecture summaries.

They should not feel like:

- novelty ASCII art;
- marketing graphics;
- decorative boxes around every sentence.

# Reasoning checklist

Before drawing:

1. Identify the hierarchy.
2. Determine the unit of completion.
3. Separate done, active, planned, deferred, and blocked.
4. Group by conceptual workstream, not merely chronology.
5. Decide whether future work represents a new capability generation.
6. Avoid mixing task status and capability maturity unless clearly labelled.
7. If source material is incomplete, say so outside the diagram instead of guessing.

# Full example

```text
FOUNDATION / CORE
────────────────────────────────────────────────────────────
CORE-01  ████████████████████  DONE
CORE-02  ████████████████████  DONE
CORE-03  ████████████████████  DONE
CORE-04  ████████████████████  DONE
CORE-05  ████████████████████  DONE
CORE-06  ████████████████████  DONE
Hardening████████████████████  DONE


PRODUCT CONSOLIDATION
────────────────────────────────────────────────────────────
PC-01    ████████████████████  Canonical Sheet
PC-02    ████████████████████  Dataset / Record workflows
PC-03    ████████████████████  Notebook product
PC-04    ████████████████████  Templates / Definitions
PC-05    ████████████████████  Steward configuration
PC-06    ████████████████████  Golden workflows


SCIENTIFIC
────────────────────────────────────────────────────────────
SCI-01   ████████████████████  Charting
SCI-02   ████████████████████  Analysis framework
SCI-03   ████████████████████  Notebook analysis
SCI-04   ░░░░░░░░░░░░░░░░░░░░  LATER — usage driven


PLATFORM
────────────────────────────────────────────────────────────
PLAT-01  ▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶  NEXT — Deployment / recovery
PLAT-02  ▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶  NEXT — Observability
PLAT-03  ██░░░░░░░░░░░░░░░░░░  Security
PLAT-04  ░░░░░░░░░░░░░░░░░░░░  Platform administration
PLAT-05  ░░░░░░░░░░░░░░░░░░░░  Performance / scale


AUTOMATION
────────────────────────────────────────────────────────────
AUTO-01  ░░░░░░░░░░░░░░░░░░░░  Pipeline foundation
AUTO-02  ░░░░░░░░░░░░░░░░░░░░  Execution / triggers
AUTO-03  ░░░░░░░░░░░░░░░░░░░░  Pipeline authoring
AUTO-04  ░░░░░░░░░░░░░░░░░░░░  Agent-authored operations
AUTO-05  ░░░░░░░░░░░░░░░░░░░░  Agentic workflows
```

# Output expectations

When asked for a roadmap visual:

1. Prefer the diagram over a table.
2. Put it in a `text` fenced code block.
3. Follow it with only a short interpretation unless more detail is requested.
4. If both strategic and detailed views help, provide one capability map and one detailed roadmap.
5. Recalculate statuses from the source material each time.

The intended reaction is:

> "I can see the whole project immediately."
