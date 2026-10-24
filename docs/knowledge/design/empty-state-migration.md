---
title: Empty-state migration — the remaining sites
status: sweep list — one row per EmptyState site
last_reviewed: 2026-10-16
---

# Empty-state migration

`DESIGN.md` (Application states) requires an empty state to "explain what is
absent and offer one relevant next action". The owner decided on 16 October 2026
to bring empty states back onto the table — "Happy to put empty back on the
table. I just want a really consistent experience for users using high quality
components" — which reverses the exclusion recorded in
`docs/knowledge/design/notebook-editor-and-reui.html` §11.2 and decision 8 of §11.7. This file is
the list the sweep works from; the component itself and the record of what was
compared against the registry item live in
[`component-comparison-record.md`](component-comparison-record.md) (row 2).

**One component renders an empty state:**
`src/components/v3/ui/empty-state.tsx` — see
[`../../development/component-compare.md`](../../development/component-compare.md)
for the comparison harness. The legacy kit's `ui/empty.tsx` and its barrel
export were deleted with the change that added `description` and `action`; the
37-line forward component it replaced is gone too. Its API:

| Prop             | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `title`          | What is absent. Required.                                                                                 |
| `description`    | What would fill the space, and — for a not-allowed state — who to ask.                                    |
| `action`         | The one relevant next step (a `Button`, or a fragment of buttons).                                        |
| `icon` / `media` | The standard 20px icon, or a custom leading visual.                                                       |
| `children`       | Anything after the action row.                                                                            |
| `body`           | **Deprecated alias of `description`**, kept only while this list is swept. Delete it when the sweep ends. |

## How this list was made

Every `<EmptyState` site in `src/**/*.tsx` was read from the tree on 16 October
2026 with a parser that records the props passed and whether the element is
self-closing; the 92 rows below are all of them (stories are excluded, and the
harness pair's vendored copy is not a product site). "Renders today" is what the
site passes now. "Next action" and "Satisfies `DESIGN.md:383`" are the sweep's
judgement from the screen's own affordances, not a measurement: where a screen's
action depends on something this pass did not confirm, the row says so.

Vocabulary used below: **not-allowed** states need no control — the design
system's rule is that they say who to ask. **Informational** states (history,
lineage, "nothing needs you today") have no next action to offer and satisfy the
rule by explaining the absence. Everything else has an action available.

## Sweep result

The sweep is complete. 99 `EmptyState` sites render the component across 68
files in `src/**` (tests, stories and the comparison harness excluded), every
one of them passing `description`, and `action` where the row asked for one;
none passes the deleted `body` alias. What each site got, or why it needs
nothing, is the table below, read with these three judgements:

- **Not-allowed and not-applicable states** take no control; their copy says who
  to ask. That covers the no-project-access states, the dataset-schema screens
  (`models/$modelId/{relations,rules,usage}`), and the frozen-version views.
- **Informational states** — sample and material history, lineage,
  measurements, usage, instrument runs, the releases table, "nothing due today"
  — satisfy the rule by explaining the absence.
- **States whose next step is permanently on screen** take no action of their
  own, because the control is already in the header or the form beside them: the
  result citations and result datasets (the Notebook tab), a pipeline's Run now,
  the inline add-a-rule and add-a-relation forms, the editor-hosted start a
  version, and the project tabs, whose `ProjectList` header carries the create or
  registry link. `ProjectList` accepts an `action` for the day one of those tabs
  needs its own.

Two sites gained an action the row did not ask for, both because a failed read is
not the empty state the row described: the two dataset tabs offer **Try again**.

## The 92 sites

| Site                                                       | Renders today                                                                      | Next action                                                       | Satisfies `DESIGN.md:383`                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/components/component-compare/surface.tsx:23`          | “No rows” · icon · description                                                     | None — harness chrome, not a product site                         | Yes (it is not a product empty state)                              |
| `src/components/import/import-flow.tsx:779`                | “This import doesn’t exist” · icon · description · children                        | carried in `children` today                                       | Partly — an action exists but in `children`                        |
| `src/components/import/import-flow.tsx:929`                | “This import has no target” · icon · description · children                        | carried in `children` today                                       | Partly — an action exists but in `children`                        |
| `src/components/v3/datasets/dataset-imports-tab.tsx:116`   | “conditional — see the file” · icon · description                                  | None — say who to ask (design: "not allowed")                     | Yes — not-allowed kind                                             |
| `src/components/v3/datasets/dataset-imports-tab.tsx:181`   | “No imports yet” · icon · description                                              | Import a file (the tab’s own action)                              | No — needs the action slot                                         |
| `src/components/v3/datasets/dataset-used-by-tab.tsx:76`    | “conditional — see the file” · icon · description                                  | None — say who to ask                                             | Yes — not-allowed kind                                             |
| `src/components/v3/datasets/dataset-used-by-tab.tsx:138`   | “Nothing references this dataset yet” · icon · description                         | None — informational                                              | No — informational                                                 |
| `src/components/v3/models/record-model-new.tsx:118`        | “Model not found” · icon · description · children                                  | carried in `children` today                                       | Partly — an action exists but in `children`                        |
| `src/components/v3/models/record-model-record.tsx:53`      | “Record not found” · icon · description · children                                 | carried in `children` today                                       | Partly — an action exists but in `children`                        |
| `src/components/v3/models/record-model-records.tsx:206`    | “Model not found” · icon · description · children                                  | carried in `children` today                                       | Partly — an action exists but in `children`                        |
| `src/components/v3/pipelines/agents/agent-surface.tsx:182` | “No operation proposals” · icon · description                                      | None — proposals are produced by agents, not the reader           | No — informational                                                 |
| `src/components/v3/pipelines/agents/agent-surface.tsx:435` | “No agent workflows” · icon · description                                          | Create or enable a workflow — confirm the screen’s own affordance | No — needs the action slot                                         |
| `src/components/v3/pipelines/agents/agent-surface.tsx:914` | “No execution policies” · icon · description                                       | Create an execution policy — confirm                              | No — needs the action slot                                         |
| `src/components/v3/projects/project-list.tsx:98`           | “empty.title” · icon · description                                                 | Depends on the empty reason (title and body are passed in)        | No — needs the action slot                                         |
| `src/components/v3/settings/settings-sessions.tsx:90`      | “No other sessions” · icon · description                                           | None — informational; this is the healthy case                    | No — informational                                                 |
| `src/components/v3/shell/not-found.tsx:60`                 | “conditional — see the file” · icon · description                                  | **Back to the section / Search**                                  | **Yes — this change**                                              |
| `src/routes/analysis/$analysisId.tsx:117`                  | “This analysis does not exist” · icon · description · children                     | Search or return to the analyses list                             | No — needs the action slot (children carry it today)               |
| `src/routes/analysis/index.tsx:169`                        | “You don’t have access to analyses” · icon · description                           | None — say who to ask                                             | Yes — not-allowed kind                                             |
| `src/routes/analysis/index.tsx:281`                        | “emptyCopy.title” · icon · description · children                                  | Depends on the empty reason (title and body are passed in)        | No — needs the action slot                                         |
| `src/routes/client-portal.tsx:225`                         | “No approved records yet” · icon · description                                     | None — a client sees what the CDMO shares; no self-service        | No — informational                                                 |
| `src/routes/client-portal.tsx:284`                         | “No shared reports yet” · icon · description                                       | None — informational                                              | No — informational                                                 |
| `src/routes/client-portal.tsx:334`                         | “No messages yet” · icon · description                                             | None — informational                                              | No — informational                                                 |
| `src/routes/client-portal.tsx:536`                         | “No shared projects yet” · icon · description                                      | None — informational                                              | No — informational                                                 |
| `src/routes/datasets/$datasetId/rows.tsx:217`              | “No snapshot to read rows from” · icon · description                               | Back to the dataset / create a snapshot — confirm                 | No — needs the action slot                                         |
| `src/routes/datasets/$datasetId/rows.tsx:335`              | “conditional — see the file” · icon · description                                  | Clear search / Clear filters                                      | No — needs the action slot                                         |
| `src/routes/datasets.tsx:286`                              | “conditional — see the file” · icon · description                                  | None — say who to ask (project access)                            | Yes — not-allowed kind                                             |
| `src/routes/evidence/$revisionId.tsx:142`                  | “No revision has this id” · icon · description · children                          | Search or go back to the record                                   | No — needs the action slot                                         |
| `src/routes/experiments/$expId/-links-tab.tsx:76`          | “emptyTitle” · no icon · description                                               | Depends on the empty reason (title and body are passed in)        | No — needs the action slot                                         |
| `src/routes/experiments/$expId/results.tsx:138`            | “No cited analyses” · no icon · description                                        | Cite an analysis — confirm the screen’s own affordance            | No — needs the action slot                                         |
| `src/routes/experiments/$expId/results.tsx:188`            | “No datasets” · no icon · description                                              | Attach a dataset — confirm                                        | No — needs the action slot                                         |
| `src/routes/help/index.tsx:177`                            | “No help articles match” · icon · description                                      | Clear search                                                      | No — needs the action slot                                         |
| `src/routes/index.tsx:854`                                 | “Nothing awaiting your review” · no icon · description                             | None — the section header already links to the Inbox              | No — informational (adjacent control)                              |
| `src/routes/index.tsx:922`                                 | “Nothing worked on recently” · no icon · description                               | None — the section header already links to All recent             | No — informational (adjacent control)                              |
| `src/routes/instruments/$instrumentId.tsx:548`             | “No runs yet” · icon · description                                                 | None — runs arrive from the instrument; the tab is read-only      | No — informational                                                 |
| `src/routes/instruments.tsx:275`                           | “You don’t have access to the instrument registry” · icon · description            | **Book an instrument instead**                                    | **Yes — this change**                                              |
| `src/routes/instruments.tsx:552`                           | “No instruments registered yet” · icon · description                               | **Register an instrument**                                        | **Yes — this change**                                              |
| `src/routes/instruments.tsx:567`                           | “searching: No instruments match “${search.q}”” · icon · description               | **Clear search and filters / Show all instruments**               | **Yes — this change**                                              |
| `src/routes/materials.tsx:424`                             | “searching: No material lots match “${search.q}”” · icon · description             | **Clear search / Back to in stock**                               | **Yes — this change**                                              |
| `src/routes/models/$modelId/datasets.tsx:39`               | “No datasets use this model” · icon · description                                  | None — informational                                              | No — informational                                                 |
| `src/routes/models/$modelId/edit.tsx:532`                  | “No draft to edit” · icon · description                                            | Retry / return to the model                                       | No — needs the action slot                                         |
| `src/routes/models/$modelId/fields.tsx:93`                 | “No version yet” · icon · description                                              | Save a version — confirm                                          | No — needs the action slot                                         |
| `src/routes/models/$modelId/fields.tsx:135`                | “No fields on this version” · icon · description                                   | Add a field — confirm                                             | No — needs the action slot                                         |
| `src/routes/models/$modelId/relations.tsx:60`              | “Relations apply to record models” · icon · description                            | None — the tab does not apply to this model kind                  | No — not-applicable kind                                           |
| `src/routes/models/$modelId/relations.tsx:228`             | “No relations yet” · icon · description                                            | Add a relation — confirm                                          | No — needs the action slot                                         |
| `src/routes/models/$modelId/rules.tsx:90`                  | “Rules apply to record models” · icon · description                                | None — the tab does not apply to this model kind                  | No — not-applicable kind                                           |
| `src/routes/models/$modelId/rules.tsx:244`                 | “No rules yet” · icon · description                                                | Add a rule — confirm                                              | No — needs the action slot                                         |
| `src/routes/models/$modelId/usage.tsx:39`                  | “Usage applies to record models” · icon · description                              | None — the tab does not apply to this model kind                  | No — not-applicable kind                                           |
| `src/routes/models/$modelId/versions.tsx:165`              | “No versions yet” · icon · description                                             | Save the first version                                            | No — needs the action slot                                         |
| `src/routes/models/$modelId.tsx:79`                        | “The model definition could not be read” · icon · description · children           | Retry / return to the model list                                  | No — needs the action slot (children carry it today)               |
| `src/routes/models/$modelId.tsx:281`                       | “searching: ${kind.label} is a built-in model” · icon · description · children     | None — built-in models are read-only; offer what still works      | No — informational                                                 |
| `src/routes/models/$modelId.tsx:306`                       | “searching: Model “${modelKey}” could not be read” · icon · description · children | Retry / return                                                    | No — needs the action slot                                         |
| `src/routes/models/$modelId.tsx:329`                       | “searching: No model “${modelKey}”” · icon · description · children                | Search or return to the model list                                | No — needs the action slot                                         |
| `src/routes/models.tsx:325`                                | “searching: No models match “${search.q}”” · icon · description                    | Clear search                                                      | No — needs the action slot                                         |
| `src/routes/pipelines/$pipelineId/index.tsx:63`            | “No version yet” · icon · description                                              | Save a version                                                    | No — needs the action slot                                         |
| `src/routes/pipelines/$pipelineId/runs/index.tsx:85`       | “No runs yet” · icon · description                                                 | Start a run                                                       | No — needs the action slot                                         |
| `src/routes/pipelines/$pipelineId/triggers.tsx:289`        | “No triggers” · icon · description                                                 | Add a trigger                                                     | No — needs the action slot                                         |
| `src/routes/pipelines.tsx:335`                             | “searching: No pipelines match “${search.q}”” · icon · description                 | Clear search                                                      | No — needs the action slot                                         |
| `src/routes/projects/$projectId/folders.tsx:276`           | “searching: Nothing in ${currentFolder?.name ??” · icon · description              | Create a folder / upload a file                                   | No — needs the action slot                                         |
| `src/routes/projects/$projectId/index.tsx:163`             | “No milestones yet” · no icon · description                                        | Add a milestone                                                   | No — needs the action slot                                         |
| `src/routes/projects/$projectId/index.tsx:212`             | “No experiments yet” · icon · description                                          | Create an experiment                                              | No — needs the action slot                                         |
| `src/routes/projects/$projectId/milestones.tsx:527`        | “No milestones yet” · icon · description · children                                | Add a milestone — the children carry a control today              | No — needs the action slot (children carry it today)               |
| `src/routes/protocols/$protocolId.tsx:312`                 | “No frozen versions yet” · icon · description                                      | Freeze a version                                                  | No — needs the action slot                                         |
| `src/routes/protocols/$protocolId.tsx:392`                 | “No frozen versions yet” · icon · description                                      | Freeze a version                                                  | No — needs the action slot                                         |
| `src/routes/protocols.tsx:300`                             | “searching: No protocols match “${search.q}”” · icon · description                 | **Clear search (only while searching)**                           | **Yes — this change**                                              |
| `src/routes/r/$identifier.tsx:52`                          | “Could not look up this code” · no icon · description                              | **Try again**                                                     | **Yes — this change**                                              |
| `src/routes/r/$identifier.tsx:69`                          | “Nothing matches this code” · no icon · description                                | **Search for the record**                                         | **Yes — this change**                                              |
| `src/routes/samples/$sampleId/history.tsx:100`             | “No history yet” · icon · description                                              | None — informational                                              | No — informational                                                 |
| `src/routes/samples/$sampleId/lineage.tsx:163`             | “No lineage links yet” · icon · description                                        | None — informational                                              | No — informational                                                 |
| `src/routes/samples/$sampleId/measurements.tsx:90`         | “No measurements yet” · no icon · description                                      | Record a measurement — confirm the screen’s own affordance        | No — needs the action slot                                         |
| `src/routes/samples/$sampleId/usage.tsx:208`               | “Not used yet” · icon · description                                                | None — informational                                              | No — informational                                                 |
| `src/routes/samples.tsx:288`                               | “conditional — see the file” · icon · description                                  | **Clear search / Back to in stock**                               | **Yes — this change**                                              |
| `src/routes/schedule.tsx:268`                              | “No instruments configured” · icon · description                                   | **Open the instrument registry**                                  | **Yes — this change**                                              |
| `src/routes/search.tsx:344`                                | “Search names, IDs, cell values, comments and files” · icon · description          | None — this is the prompt state, not an empty result              | No — informational                                                 |
| `src/routes/settings/access.tsx:296`                       | “No accessible projects” · icon · description                                      | None — say who to ask                                             | Yes — not-allowed kind                                             |
| `src/routes/settings/diagnostics.tsx:118`                  | “Only workspace admins can see diagnostics” · icon · description                   | None — say who to ask                                             | Yes — not-allowed kind                                             |
| `src/routes/settings/diagnostics.tsx:152`                  | “Diagnostics could not be loaded” · icon · description                             | Retry                                                             | No — needs the action slot                                         |
| `src/routes/settings/diagnostics.tsx:329`                  | “No recent failures” · icon · description                                          | None — nothing has failed; that is the healthy case               | No — informational                                                 |
| `src/routes/settings/index.tsx:35`                         | “Only workspace admins can see workspace settings” · icon · description · children | None — say who to ask (children carry a control today)            | No — the description says who to ask, the children carry a control |
| `src/routes/settings/integrations.tsx:135`                 | “No connectors yet” · icon · description                                           | Add a connector — confirm the screen’s own affordance             | No — needs the action slot                                         |
| `src/routes/settings/members.tsx:99`                       | “Only workspace members can see the roster” · icon · description                   | **Open the client portal**                                        | **Yes — this change**                                              |
| `src/routes/settings/members.tsx:485`                      | “No members” · icon · description                                                  | Invite people — the header holds the same control today           | No — needs the action slot                                         |
| `src/routes/settings/usage.tsx:129`                        | “Only workspace admins can see usage” · icon · description                         | None — say who to ask                                             | Yes — not-allowed kind                                             |
| `src/routes/settings/usage.tsx:165`                        | “Usage could not be loaded” · icon · description                                   | Retry                                                             | No — needs the action slot                                         |
| `src/routes/sheets/new.tsx:129`                            | “This sheet is empty” · icon · description                                         | None — a new sheet is empty by definition                         | No — informational                                                 |
| `src/routes/templates/$templateId/in-use.tsx:203`          | “No records you can access yet” · icon · description                               | None — say who to ask                                             | Yes — not-allowed kind                                             |
| `src/routes/templates/$templateId/in-use.tsx:209`          | “No records use this template yet” · icon · description                            | None — informational; the template is simply unused               | No — informational                                                 |
| `src/routes/templates/$templateId/in-use.tsx:303`          | “No records match these filters” · icon · description · children                   | Clear filters                                                     | No — needs the action slot                                         |
| `src/routes/templates/$templateId/index.tsx:149`           | “No version yet” · icon · description                                              | Save the first version                                            | No — needs the action slot                                         |
| `src/routes/templates/$templateId/update.tsx:113`          | “Nothing to take yet” · icon · description                                         | None — informational; the version has not been taken yet          | No — informational                                                 |
| `src/routes/templates/$templateId/update.tsx:177`          | “No notebook needs this version” · icon · description                              | None — informational                                              | No — informational                                                 |
| `src/routes/templates/$templateId/versions.tsx:233`        | “No versions yet” · icon · description                                             | Save a version                                                    | No — needs the action slot                                         |
| `src/routes/templates.tsx:270`                             | “searching: No templates match “${search.q}”” · icon · description                 | **Clear search / New template**                                   | **Yes — this change**                                              |

## Sites this change migrated (tranche 1)

Twelve sites in files no other thread owns, chosen for traffic and for an action
that already existed on the screen:

| Site                                       | What changed                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/v3/shell/not-found.tsx:60` | The two buttons moved from `children` to `action`; every bad URL and unknown id now gets the section link and Search as its next step.    |
| `src/routes/materials.tsx:424`             | "Clear search" / "Back to in stock" moved to `action`; `description` replaces `body`.                                                     |
| `src/routes/samples.tsx:288`               | The same, including the no-project-access copy.                                                                                           |
| `src/routes/schedule.tsx:268`              | "Open the instrument registry" moved to `action`.                                                                                         |
| `src/routes/settings/members.tsx:99`       | "Open the client portal" moved to `action` for the client-account state.                                                                  |
| `src/routes/protocols.tsx:300`             | Gained "Clear search" while a search is active; no action when the tab is simply empty.                                                   |
| `src/routes/templates.tsx:270`             | Gained "Clear search" while searching, and the screen's own New-template dialog when the list is genuinely empty.                         |
| `src/routes/instruments.tsx:275,552,567`   | "Book an instrument instead", the register dialog, and "Clear search and filters" moved to `action`; the description explains each state. |
| `src/routes/r/$identifier.tsx:52,69`       | Gained "Try again" on the lookup failure, and "Search for the record" when a scanned code matches nothing.                                |

## Files owned by other threads — do not touch these without the owner

Six surfaces are being rewritten concurrently; their empty states belong to the
follow-on tranche, even where the row above says an action is available:

| Surface         | File                                                             | Empty-state sites                                                                                               |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Import flow     | `src/components/import/import-flow.tsx`                          | :779, :929 — both already carry an action in `children`                                                         |
| Inventory list  | `src/components/v3/inventory/list.tsx`                           | none (`ListHeader`/`ListToolbar`/`ListFooter` are shared chrome)                                                |
| Notebook        | `src/components/notebook/**`, `notebook-document.tsx`            | none through `EmptyState`; the document rolls its own "Start this Notebook" panel (see below)                   |
| Audit timelines | `src/components/audit/**`                                        | none through `EmptyState`                                                                                       |
| Upload surface  | `src/components/v3/integrations/ingest-panel.tsx`                | none through `EmptyState`                                                                                       |
| Data grid       | `src/components/scientific/data-table.tsx`, `data-grid-types.ts` | none through `EmptyState`; `src/routes/datasets/$datasetId/rows.tsx` carries two sites and is the grid's screen |

## Ad-hoc empty markup

The plan's §11.2 counts "≈88 further sites that roll their own". This pass did
not enumerate them exhaustively; a text search for the phrases an empty state
uses ("No …", "Nothing …", "None …") over `src/**/*.tsx` found these families,
and each is a candidate for the same component:

| Where                                                                                                                                                          | What it renders today                                                            | Note                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/components/notebook/notebook-document.tsx` (`data-empty-notebook`)                                                                                        | "Start this Notebook" panel with its own Start-writing control                   | The document's full-height empty state; owned by the notebook thread   |
| `src/routes/inbox.tsx:543`                                                                                                                                     | "Nothing here" with its own copy branches                                        | Owned by the Inbox/QA work; replace when that screen is next touched   |
| `src/routes/datasets/$datasetId/compare.tsx:370`                                                                                                               | `<Muted>No differences between these snapshots.</Muted>`                         | Informational; the wider "inline `Muted`" family below                 |
| `src/routes/schedule.tsx:779,814`                                                                                                                              | `<Muted>Nothing due.</Muted>`, `<Muted>No samples are booked for today.</Muted>` | Panel-level notices, not table empties                                 |
| `src/components/review/signatures-table.tsx:96`, `src/components/review/revision-diff-review.tsx:574`, `src/components/notebook/notebook-history-panel.tsx:51` | One-line `<Muted>` or a small heading where a table would be                     | Same family as the `Muted` inline notices                              |
| `src/components/sheet/sheet-record-picker.tsx:94`                                                                                                              | `<CommandEmpty>No … Records match your search.</CommandEmpty>`                   | The picker's own empty; the command kit owns it                        |
| `src/components/notebook/notebook-inspector.tsx:380,384,414`                                                                                                   | `<EmptyHint>` / "No value recorded"                                              | Inspector-level, deliberately quieter than a panel empty state         |
| `src/routes/projects/$projectId/milestones.tsx:803,816,826,887`                                                                                                | Four `<Muted>` one-liners inside milestone cards                                 | Card-level; decide whether a card empty is the component or a sentence |

The `Muted` one-liner family is the largest of these and is deliberately not a
table empty: a sentence inside a card is not the same job as the notice that
replaces a table's rows. The sweep should convert the panel- and table-level
instances and leave the inline sentences alone, and any change here records the
same comparison row when the component changes.

## What "satisfying `DESIGN.md:383`" means for a sweep

1. **Nothing yet** — name the object that is absent and offer the create action
   (`templates.tsx` does both now).
2. **Nothing matching** — quote the query in the title and offer Clear search or
   Clear filters.
3. **Not allowed** — say who to ask and offer what still works; no control is
   required.
4. **Not found / could not load** — offer the return path or a retry.
5. **Informational** (history, lineage, "nothing needs you") — explain why it is
   empty; offering an action here is worse, not better.

When a site is converted, it replaces `body` with `description`, moves any
`children` action to `action`, and deletes the `body` alias only when no site
uses it — the alias exists for exactly the rows left in the table above.
