# Storybook coverage

This file records the deliberate exceptions to the rule that every exported
React component has a story, and the story-level limits that are deliberate
rather than gaps.

The guard is `src/components/story-coverage.test.ts`; `pnpm validate` runs
`pnpm build-storybook` after `pnpm build`, so a story that stops compiling or
stops being collected fails the gate rather than the next person's review.

Stories live in `src/stories/<ComponentName>.stories.tsx` (a few live beside
their component under `src/components/**`); the Storybook config picks up both.
No story in this repository reaches a database or the network: fixture data is
static, and reads are satisfied by seeding a React Query cache with
`staleTime: Infinity` or by a promise that never settles, which renders the
component's own loading or error state.

## Domain audit (17 October 2026)

Every component in the domain directories the first pass listed had a story file
when this pass started, so the gap there was not coverage by file — but three
components had no story at all (`knowledge/`'s `RecordLineageSection` and
`RelationshipPanel`, `extensions/`'s `ExtensionSlots`), and stories were written
for them. Rendering every domain story in a browser found stories that did not
render what they claimed:

- **23 stories failed to render at all.** Sixteen dialogs and editors called
  `useMutation`/`useQuery` with no `QueryClientProvider` in their decorators
  (`AmendNotebookDialog`, `DuplicateNotebookDialog`, `RequestEditAccessDialog`,
  `SheetPromote`, `PipelineOutputBlockEditor`, `AnalysisBlockPreview`); four
  `ScientificSheetBlock` stories threw because the block was rendered outside
  `ScientificWorkbookProvider`; three `ChartRenderer` stories passed an `any`
  fixture with no `typeParams` and no `datasetId`, so the renderer threw on the
  type parameters it reads.
- **7 stories rendered “Route not found”.** `OpenLink` and `CitationList` set
  `parameters.tanstack.router.path` without a matching `route`, which moves the
  story URL but leaves the sandbox router with no such route, so every `Link`
  destination failed.
- **4 `CanonicalSheetWorkspace` stories** all rendered the instance-read failure
  path. The loaded instance read was seeded; the three stories still render
  "This Sheet could not be loaded." and make four `/api/…` requests each
  (re-measured 17 October 2026 against the built Storybook), because
  `withClient()` builds its `QueryClient` inside the decorator body, so the seed
  is discarded as soon as the decorator re-renders. One-line fix in
  `src/stories/CanonicalSheetWorkspace.stories.tsx` — hoist the client out of
  the decorator — and it belongs to the notebook lane, not this one.
- **1 unreachable story** was removed: the lifecycle panel is mounted only for a
  writable instance, so an archived instance never renders it.

The deliberate silences below were re-checked in the same pass and are correct:
portalled dialogs (`E-Sign`, `Duplicate`, `Amend`, `RequestEditAccess`,
`SheetPromote`), skeleton loaders, icon-only triggers, and components that
return `null` by contract.

## Notebook

| Component                                                                                       | Reason                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScientificWorkbookProvider`                                                                    | Provider only. It creates the workbook context its children read (`useSheetCalculation`); it renders `children` unchanged and has no rendered surface of its own. Consumers (`ScientificSheetBlock`) are wrapped in it by their stories. |
| `useAutosave` (`use-autosave.ts`)                                                               | Hook, not a component. Exported so callers can hold the machine directly; it has no rendered surface.                                                                                                                                    |
| `PROPOSAL_ABSENT_MESSAGE`, `PROPOSAL_UNREADABLE_MESSAGE` (`pipeline-output-block-proposal.tsx`) | Constants, not components. The states they name are rendered by `PipelineProposalAbsent.stories.tsx` and `PipelineProposalUnreadable.stories.tsx`.                                                                                       |

## Sheet

| Component                                   | Reason                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ReferencePicker` (`formula-references.ts`) | Class, not a component. It is the keyboard reference-picking controller the in-cell editor instantiates; it returns no JSX. |
| `CONFLICT_REASON_MAX`, `REFERENCE_COLORS`   | Constants, not components.                                                                                                  |

`ScientificSheetBlock.stories.tsx` renders the extracted column form, schema
column, formula bar, footer and validation messages directly as well as through
the loaded parent block. The direct stories include blocked schema actions and
a failed-save footer. Storybook records mutation callbacks without running
server writes.

| Module                                       | Why no story                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/sheet/cell-conflict-data.ts` | Conflict transport functions, wire types and the `CONFLICT_REASON_MAX` constant. Nothing renders; the conflict panel has its own story.              |
| `src/components/sheet/formula-references.ts` | A1/range helpers and the imperative `ReferencePicker` controller, not React components. The formula editor stories exercise their rendered consumer. |

## Model fields

`ModelFieldEditors.stories.tsx` renders the definition, category, defaults and
quantity editors with current definition output. It includes numeric, category
and reference fields, locked published keys, saving and retired states.
`ModelFieldDetails.stories.tsx` renders built-in inspectors, inherited-source
links and recorded values, including zero, false, missing and historical choices.

| Module                                                 | Why no story                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/models/built-in-field-presentation.ts` | Type-label constants and pure helpers for field presentation, choice parsing and validation. No React component or rendered UI; the built-in field inspector stories exercise its type and placement labels. |
| `src/components/models/model-create-validation.ts`     | Model metadata length constants, input types and pure validation/error-description helpers. No React component or rendered UI; the existing model-create dialog stories render validation messages.          |

## Review

| Component                                 | Reason                             |
| ----------------------------------------- | ---------------------------------- |
| `AREA_LABELS`, `KIND_META`-derived labels | Constants, not components.         |
| `exactText`, `focusChange`                | Utility functions, not components. |

The review's `signature-binding.ts` formats known frozen revision versions;
`evidence-drift.ts` describes the canonical drift read; `revision-change-data.ts`
formats frozen change values and area labels without reconstructing metadata;
and `review-focus.ts` focuses and scrolls an existing document location using
runtime DOM capabilities. These modules export no rendering owners. Existing
signature, evidence and revision-review stories still exercise their consumers;
no rendering module is excluded.

## Notebook, sheet, sequence, live and scan modules without a story

The notebook's `block-reorder-targets.ts`, `part-presentation.ts`,
`inspector-cell-facts.ts` and `image-annotation-rendering.ts` export only
non-component helpers and types. The guard already classifies them correctly,
so they need no skip entries. Their consumers retain the reorder, parts-strip,
inspector and image-annotation stories; those renderers are not excluded.

`src/components/notebook/read-only-entries.ts` is also nonrendering. It has no
React imports or JSX and assigns content-plus-duplicate-occurrence render keys
for read-only value snapshots, not scientific IDs or editable draft identities.
Validation messages, canonical and legacy table previews, checklist previews,
code output, slide text and proposal comparisons retain their existing component
and story render owners. The guard needs no skip entry for this helper.

| Module                                             | Why no story                                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/notebook/callout-styles.ts`        | Constants and a pure helper (`CALLOUT_STYLES`, `calloutVariantOf`), not components. The callout they style is rendered by the notebook block stories.                                                                                               |
| `src/components/notebook/current-step-card.tsx`    | Card that reads the notebook's step timers and instruments from the server, links to the schedule and calls the notebook's step functions, so it has no state to show without a connected app.                                                      |
| `src/components/notebook/gate-description.ts`      | Gate wording, picker-target resolution and the `FIELD_LABELS` lookup. No JSX, hooks, writes or runtime component imports; the existing gate stories render its consumers.                                                                           |
| `src/components/notebook/index.ts`                 | Barrel that re-exports `NotebookBlock`, the block previews and editors and `NotebookDocument`, each of which has its own story.                                                                                                                     |
| `src/components/notebook/notebook-ai-context.tsx`  | Context provider alias (`NotebookAiProvider`) and its hook; it renders `children` unchanged. `AiComposer.stories.tsx` shows the composer that reads it.                                                                                             |
| `src/components/notebook/slash-command-options.ts` | Pure AI/plugin menu metadata, text filtering and keyboard-selection counts shared by `SlashCommandMenu` and `RichTextEditor`. No JSX, hooks or components; the menu story renders its consumer and slash/editor tests exercise matching and counts. |
| `src/components/sheet/index.ts`                    | Barrel that re-exports `SheetbaseTableGrid` and its types; the grid has its own stories.                                                                                                                                                            |
| `src/components/sheet/reference-colors.ts`         | Constant (`REFERENCE_COLORS`), not a component.                                                                                                                                                                                                     |
| `src/components/sequence/index.ts`                 | Barrel that re-exports the sequence viewer, maps and panel, which `SequenceViewer.stories.tsx` renders.                                                                                                                                             |
| `src/components/live/index.ts`                     | Barrel for the live-event provider and `ConnectionStatus`; `ConnectionStatus` has its own story.                                                                                                                                                    |
| `src/components/live/live-event-provider.tsx`      | Provider that opens an `EventSource` to `/api/events` and renders `children` unchanged, so it has no surface of its own and would reach the network. Its status is shown by `ConnectionStatus.stories.tsx`.                                         |
| `src/components/scan/code-decoder.ts`              | Decoder interfaces, format constants and loaders, not components.                                                                                                                                                                                   |
| `src/components/scan/jsqr-code-decoder.ts`         | Decoder loader and constants, not a component.                                                                                                                                                                                                      |

## Collaboration

Components whose populated states need a connected co-editing room
(`PresenceStack`, `RemoteSelectionChips`, `BlockCoEditBadge`,
`CollaborationRoom`) do have stories, but a storybook build has no
collaboration server and no signed-in session, so those stories cover the
reachable contract: nothing renders before the room is ready, and nothing
throws outside a room boundary. The populated states are exercised by the
component tests with real collaboration providers and awareness state, and by
the two-browser journey spec.

| Module                                       | Why no story                                                                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/collaboration/room-ready.ts` | Room-readiness context and its useContext hook only, with no JSX or visible component. CollaborationRoom and the presence components retain their stories; real-provider tests exercise the ready and peer-populated states. |

## Viz

| Component                                       | Reason                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CHART_PALETTE` (`chart-renderer.tsx`)          | Constant re-export, not a component.                                                                                 |
| `describeExecutionError` (`analysis-panel.tsx`) | Utility function, not a component.                                                                                   |
| `LARGE_PLATE_CELL_THRESHOLD` (`plate-map.tsx`)  | Constant, not a component. The compact and 96-well states it switches between are covered by `PlateMap.stories.tsx`. |

## Audit

| Component                                                                                 | Reason                                                                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `mapTimelineEvents`, `describeAuditEvent`, `auditLinkFor`                                 | Utility functions, not components.                                                              |
| `AUDIT_OPERATION_ICONS`, `AUDIT_ENTITY_ICONS`, `AUDIT_DECISION_ICONS`, `AUDIT_TYPE_ICONS` | Icon maps, not components. The rows that use them are covered by `HistoryTimeline.stories.tsx`. |

## Scientific

None. Every exported component has a story.

## Comments

| Component                       | Reason                             |
| ------------------------------- | ---------------------------------- |
| `threadState` (`comments-data`) | Utility function, not a component. |

## Scan

| Component                                                          | Reason                                         |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| `loadCodeDecoder`, `setFallbackDecoderLoader`, `createJsQrDecoder` | Decoder loaders and factories, not components. |

## Import

Both exported flows have stories. The upload flow's later steps need a stored
file; the map and check steps are covered from static fixtures of the stored-file
read. `ImportUploadFlow.stories.tsx` also directly renders the real
`PluginPullPanel` connector form. No rendering owner is skipped here.

`import-search.ts`, `import-flow-data.ts` and `import-receipt-data.ts` own URL
parsing, pure flow decisions and frozen receipt presentation respectively. They
contain no JSX or visible components. The flow and receipt stories render their
results through the production components; these are not component exemptions.

## Related work

None. Both the pure list and the live panel have stories.

## Chemistry registration

| Module                                                   | Why no story                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/ui/brand-mark-spokes.ts`                 | SVG path data for the mark, not a component. `BrandMark.stories.tsx` renders the assembled mark and `Spinner` renders the spokes individually.           |
| `src/components/audit/audit-icons.ts`                    | The icon vocabulary an audit row looks its icon up in; it renders no markup. `AuditTrail` stories exercise every event kind it resolves.                 |
| `src/components/icons/icon-map.ts`                       | The name-to-icon map the `Icon` component reads; it renders no markup. The icon stories render each name through `Icon`.                                 |
| `src/components/comments/comment-composer.tsx`           | The composer lives inside the thread it posts to; `CommentPanel.stories.tsx` renders it in place, with the same draft and submit contract.               |
| `src/components/protocols/protocol-versions-dialogs.tsx` | The approve/reject dialogs open from the versions table; `ProtocolVersionsPanel.stories.tsx` renders the panel that mounts them.                         |
| `src/components/sheets/column-promotions.ts`             | Promotion vocabulary and a pure next-step helper, not components. The promotion rows that read them are rendered by `ColumnPromotionsPanel.stories.tsx`. |

## Story-level limits

These are reachable states that a static fixture cannot show as a visual
difference. They are recorded here so they are not mistaken for coverage.

| Component                                                                            | Limit                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScientificRecordLinker` (`scientific-record-linker.tsx`)                            | The rule-restricted tabs and the no-allowed-kind state only differ inside the open picker, and the picker's search reads need a backend. The at-rest stories keep their claims; `scientific-record-linker.test.tsx` covers the restricted tab set and the fallback tab. |
| `CanonicalSheetEditor` (`canonical-sheet-workspace.tsx`)                             | `readOnly`, `NoProject` and `Archived` change whether cells accept an edit, not the rendered chrome, so their stories render the same toolbar and grid. The cell-level refusal is expressed through the grid's `readOnly` column settings.                              |
| `CanonicalSheetLifecyclePanel` (`canonical-sheet-lifecycle-panel.tsx`)               | The panel is mounted by its host only when the instance is writable, so an archived variant is not a reachable state and has no story. Its per-instance differences need the definition reads, which the stories leave pending.                                         |
| `NotebookTemplateUpgradeBanner`, `PromoteRejected`, `TagPills`, `ContributorAvatars` | The silent states are the contract: each returns `null` rather than rendering an empty container. Their stories name the silence so a reader can see the contract exercised.                                                                                            |

## Covered elsewhere (not a gap, not a skip)

These exported components have a story, but under a file name that does not
match the component: the story was written before this area's per-component
naming and is kept where it is.

| Component                                                         | Story file                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Diff`, `Source` (`scientific/diff.tsx`, `scientific/source.tsx`) | `src/stories/SourceDiffTagChip.stories.tsx`                                                                                   |
| `CommentThread` (`comments/comment-thread.tsx`)                   | `src/stories/CommentThread.stories.tsx` (moved out of `CommentPanel.stories.tsx`, which now covers the panel it is named for) |

## Pure helper modules beside components (10 November 2026)

These modules hold no component: their exports are data and functions the
components call, so there is nothing for a story to render.

| Module                                            | Why no story                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/components/materials/reagent-order-model.ts` | The order status tone, its label and the open-order lookup; `ReagentOrders` stories render them through the grid. |

## Re-export aliases

| Export                                                                 | Reason                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `RecordHeaderAvatar`, `RecordHeaderBadge` (`record/record-header.tsx`) | Re-exports of `Avatar` and `Badge`; covered by `Avatar.stories.tsx` and `Badge.stories.tsx`.                                    |
| `ComposedSheetWorkspace` (`sheet/composed-sheet-workspace.tsx`)        | Re-export of the workspace in `canonical-sheet-workspace.tsx`; one component, one story (`ComposedSheetWorkspace.stories.tsx`). |

## The guard

The structural guard in `src/components/story-coverage.test.ts` covers every
component module under `src/components/`. It reads every `| Module | Why no story |`
table in this file, in any section, so an area records its skips in its own
section with that header. A module a story imports is covered; a module
listed in one of those tables is a recorded skip; a module that is neither fails
the guard, and the failure names the file, the two places it could go, and the
title conventions below.

The table is keyed by the module's path rather than by an export name, because
coverage is resolved per module — one module, one story. Recording a module that
does have a story, or one that no longer exists, also fails the guard, so the
table cannot rot into a blanket exemption.

Not everything in those directories is a component, and this table is only for
components: non-component modules are named in the prose below instead, since
the guard never asks about them.

**Titles.** Kit stories (`src/components/ui/`) are titled `UI/<Name>`, and a
registry copy whose name a kit story already holds takes `UI/Registry <Name>`
(after `UI/RegistryKbd`). A story file that merely shares its name with a
component is not coverage of it.

| Module                                                   | Why no story                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/follow/follow-toggle.tsx`                | Reads and writes the signed-in person's follow through the data client; covered by the follow tests.                                       |
| `src/components/open-data/ontology-and-repositories.tsx` | Reads and saves ontology and repository settings through the data client and a server function; covered by the open-tables database tests. |
| `src/components/open-data/ontology-terms.tsx`            | Searches the ontology route and links terms through the data client; covered by the ontology tests.                                        |
| `src/components/open-data/open-tables.tsx`               | Reads and saves open-table settings and logins through the data client; covered by the open-tables database tests.                         |
| `src/components/open-data/publish-control.tsx`           | Reads targets and publications through the data client and polls while a draft is made; covered by the publishing database tests.          |
| `src/components/settings/audit-timestamps.tsx`           | Reads and saves the time-stamping settings through the data client; covered by the trusted timestamp tests.                                |
| `src/components/settings/change-email-dialog.tsx`        | Calls the email change server functions; covered by the email change tests.                                                                |
| `src/components/settings/lab-logo-settings.tsx`          | Uploads to the logo route and reads the root route context; covered by the logo route tests.                                               |
| `src/components/settings/leave-workspace.tsx`            | Calls the leave workspace function and sign-out; covered by the profile tests.                                                             |
| `src/components/ui/lab-logo.tsx`                         | Reads the lab logo version from the root route context.                                                                                    |

### Non-component modules in this scope

| Module                                   | What it is                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/components/reui/use-file-upload.ts` | Hook, not a component. It wraps the file input's state and has no rendered surface of its own. |
| `src/components/story-coverage.test.ts`  | This guard, not a component.                                                                   |

## Assistant, workspace, offline and shell

Modules in these areas that render nothing of their own, or that cannot be
mounted without the whole application behind them. Everything else in
`assist/`, `workspace/`, `offline/`, `shell/`, `shortcuts/`, `pwa/`,
`favourites/`, `data-access/`, `overview/`, `dev-toolbar/` and `shell/` has
a story.

| Module                                                  | Why no story                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/offline/offline-edit-model.ts`          | Pure offline-edit summaries, text conversion, queued-block construction and overlay helpers; it renders nothing. Offline component stories exercise the rendered edit and conflict states.                                                                                                     |
| `src/components/shell/index.ts`                         | Re-export of `ShellProvider`, which renders its children unchanged.                                                                                                                                                                                                                            |
| `src/components/shell/shell-context.tsx`                | `ShellProvider` renders its children unchanged; there is no chrome to show.                                                                                                                                                                                                                    |
| `src/components/shortcuts/sheet-keyboard-shortcuts.tsx` | Registers cell shortcuts for a grid and returns `null`. The registry it feeds is shown by `ShortcutsDialog.stories.tsx`.                                                                                                                                                                       |
| `src/components/lib/theme.ts`                           | Theme cookie and storage constants and the store behind `ThemeProvider`; no rendered surface.                                                                                                                                                                                                  |
| `src/components/workspace/use-record-links.ts`          | Hook, plus the drag MIME constant. It wires drag and click handling onto a pane's links and renders nothing.                                                                                                                                                                                   |
| `src/components/workspace/workspace-navigation.tsx`     | Context, hooks and click helpers for panes; no rendered surface.                                                                                                                                                                                                                               |
| `src/components/workspace/pane-page.tsx`                | Mounts a second copy of the application's own page router (`getPaneRouter`) for an address, inside the live auth context. A story would need the whole app and its database behind it; `PaneHeader`, `WorkspaceBar`, `PeekCard`, `Shelf` and `WorkspaceStatus` show the pane chrome around it. |
| `src/components/workspace/workspace-host.tsx`           | The host that owns the open panes, layouts, shelf and link groups and mounts a `PanePage` for each. It reads the root route's auth context and session storage and renders the application's pages, so it cannot stand alone; every piece of its chrome has its own story.                     |
| `src/components/workspace/workspace-host-chrome.tsx`    | The workspace host's bar, pane chips and status footer, wired to a live session: switching tabs, saving layouts and picking a pane all change the open workspace. `WorkspaceBar` and `WorkspaceStatus` have stories with static props; this is the session-bound composition of them.          |
| `src/components/workspace/workspace-host-stage.tsx`     | The stage of open panes. Every pane mounts a `PanePage` — a second copy of the application's page router inside the live auth context — so the section cannot render without the whole app; `pane-page.tsx` is recorded for the same reason, and `PaneHeader` has its own story.               |
| `src/components/workspace/workspace-host-overlays.tsx`  | The hover hint, peek card and drop target the host floats over its panes; each reads the live link state the host's pointer listeners maintain, so a story would show a static imitation. `PeekCard` has its own story.                                                                        |

## Screens

The screen components under `src/components/{datasets, integrations, models,
pipelines, projects, protocols, samples, schedule, search, settings, shell,
templates}/**` had no stories when this section was written. They do now.

Two things make a screen-level story possible, and both live in the harness at
`src/stories/screen-stories.tsx`:

- **A sandbox route tree with every destination the screen links to.** The
  Storybook TanStack framework builds its router from the story's own `route`
  parameter, so a `path` alone moves the story URL and leaves every `Link` in
  the screen unresolvable ("Route not found"). `screenRoutes` builds that tree
  from the path the story renders on and then the paths it links to; the mount
  must be that path, flat, and first — the framework injects the story into the
  tree's first route, so a tree starting elsewhere, or one whose mount is a
  section with the story's path nested under it, renders nothing at all. Nesting
  a _link_ changes nothing, which the Models lane measured.
- **A query client whose reads are static.** `screenQueryClient` seeds the reads
  a screen performs and leaves the ones it does not seed pending, refused or
  failed, which renders the screen's own loading, denied and error states. No
  story in this repository reaches the network or the database.

Stories are named for the surface rather than one per file: several modules that
are facets of one screen share a file, which the table records. States are shown
per module rather than once on the happy path.

| Story file                                          | Modules covered                                                                                                  | States shown                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stories/DatasetDetailTabs.stories.tsx`         | `datasets/dataset-imports-tab`, `dataset-used-by-tab`, `dataset-history-tab`                                     | Committed, failed and connector-authority receipts; the empty list with its Import-a-file action; loading, denied and failed reads; two dependents with the snapshot row dropped; history with, without, loading, denied and failed                                                                      |
| `src/stories/DatasetValueActions.stories.tsx`       | `datasets/value-actions`                                                                                         | Unflagged; no source sample; a manual flag; a rule flag with two provenance shapes; read-only; the mark and clear dialogs, including a busy one; every flag kind; no value                                                                                                                               |
| `src/stories/AgentSurface.stories.tsx`              | `pipelines/agents/agent-surface`                                                                                 | Pending, approved, rejected and failed proposals with and without the approve capability; a waiting, paused and succeeded workflow; nothing proposed or running; policies with a credential, without one, without the capability, and the empty state whose action starts the form                       |
| `src/stories/PipelineCodeAndDeliveries.stories.tsx` | `pipelines/pipeline-code`, `pipelines/run-deliveries`                                                            | Stored steps and none; the temporary-store note; delivered, retrying and dead-letter deliveries; the three honest empty reasons by run status; deliveries unreadable and loading                                                                                                                         |
| `src/stories/RunPromptPanel.stories.tsx`            | `pipelines/run-prompt`                                                                                           | Waiting, no longer waiting, submitting, a refused answer, an answered prompt with its values and reason, and a schema with no fields                                                                                                                                                                     |
| `src/stories/ProjectsPage.stories.tsx`              | `projects/projects-page`                                                                                         | Three projects with counts per tab; loading; no projects; no project access (a different screen from none); a role that cannot create; a failed read                                                                                                                                                     |
| `src/stories/ProjectLists.stories.tsx`              | `projects/project-list`, `projects/mobile-list`                                                                  | A populated list in both forms; the empty list with the action its reason implies; a page past the end; a refused read and a failed one; phone rows with status, selected and bare                                                                                                                       |
| `src/stories/MilestoneTimeline.stories.tsx`         | `projects/milestone-timeline`                                                                                    | Month and week scales, a selected milestone, and an undated plan (which draws nothing)                                                                                                                                                                                                                   |
| `src/stories/RecordModelScreens.stories.tsx`        | `models/record-model-records`, `record-model-new`, `record-model-record`                                         | The list with the model's fields as columns; an empty model; the generated create form with a project, with none and with a rule blocking it; the record page with an "added later" field, a failed timeline and a refused usage read; the model and the record that are not visible; reads held loading |
| `src/stories/RecordModelVersions.stories.tsx`       | `models/record-model-versions`                                                                                   | Published and draft versions, pending approval, read-only, empty, loading, unavailable, a model that is not visible, and refused approval and usage reads (through `stubDataClient`)                                                                                                                     |
| `src/stories/ModelApprovalPanel.stories.tsx`        | `models/model-approval-panel`                                                                                    | The approval request, its decisions, the disabled-publication state a refused read shows, and the panel with nothing to approve                                                                                                                                                                          |
| `src/stories/RecordModelVersionEditor.stories.tsx`  | `models/record-model-version-editor`                                                                             | The draft field editor: an editable draft, a published version, and no fields                                                                                                                                                                                                                            |
| `src/stories/ModelCreateDialog.stories.tsx`         | `models/model-create-dialog`                                                                                     | The create dialog, its validation refusal, its create error and its closed state                                                                                                                                                                                                                         |
| `src/stories/DraftConflictBanner.stories.tsx`       | `models/draft-conflict-banner`                                                                                   | A conflicting draft, a stale one, and the banner with nothing to say                                                                                                                                                                                                                                     |
| `src/stories/SampleInspector.stories.tsx`           | `samples/sample-hold-meter`, `sample-label-card`, `sample-state-banner`, `sample-recent-history`, `sample-usage` | Hold windows live, expired and absent; a full label, one with no code and one with an identifier only; every state banner including the one that renders nothing; history rows, limited, empty and with an unknown actor; a usage bar balanced and with no balance                                       |
| `src/stories/SampleLabelPrint.stories.tsx`          | `samples/sample-label-print`                                                                                     | The print document (made visible with print styles in the story) and the print action at rest                                                                                                                                                                                                            |
| `src/stories/SampleWithdraw.stories.tsx`            | `samples/withdraw-dialog`                                                                                        | Withdraw and reserve at rest; an over-free refusal; a ready withdrawal; no experiments to choose from; the quantity keypad                                                                                                                                                                               |
| `src/stories/ScheduleBookDialog.stories.tsx`        | `schedule/book-dialog`                                                                                           | Open with instruments and a resolved zone; an empty registry; incomplete-form and server refusals; an unreadable workspace zone                                                                                                                                                                          |
| `src/stories/SearchPalette.stories.tsx`             | `search/search-palette`, `search/highlight`                                                                      | The prompt state; grouped results with an archived row; no matches with a did-you-mean; loading; a failed search; a project-scope miss; both highlight modes                                                                                                                                             |
| `src/stories/TemplateUpdateView.stories.tsx`        | `templates/template-update-view`                                                                                 | Loading; no preview; a full preview; the retarget column expanded; a refused apply and an applied one                                                                                                                                                                                                    |
| `src/stories/SettingsSessions.stories.tsx`          | `settings/settings-sessions`                                                                                     | This device plus two others (one a deployment identity), only this device, loading, and a failed read with its retry                                                                                                                                                                                     |
| `src/stories/IntegrationsRuns.stories.tsx`          | `integrations/run-history`, `integrations/credentials-card`                                                      | Runs with a failed and a succeeded expansion, no runs, a refused read, stored credentials, missing required names, none stored, and a non-steward (which renders nothing)                                                                                                                                |
| `src/stories/IntegrationsIngest.stories.tsx`        | `integrations/ingest-panel`, `integrations/enterprise-source-panel`                                              | An instrument output mapped to a schema with a real CSV and preview, no published schema, refused reads, object storage and database sources at rest, and no enterprise adapter (which renders nothing)                                                                                                  |
| `src/stories/RegisterConnectorDialog.stories.tsx`   | `integrations/register-connector-dialog`                                                                         | The instrument, storage and database forms, a filled-in registration (key normalised), and the closed state                                                                                                                                                                                              |
| `src/stories/SettingsGeneral.stories.tsx`           | `settings/settings-general`                                                                                      | Saved, an unsaved edit, an invalid time zone, and a refused read falling back to defaults                                                                                                                                                                                                                |
| `src/stories/SettingsNotifications.stories.tsx`     | `settings/settings-notifications`                                                                                | Saved, an unsaved edit, and defaults when both reads are refused                                                                                                                                                                                                                                         |
| `src/stories/SettingsParserSettings.stories.tsx`    | `settings/parser-settings`                                                                                       | A draft and an approved version with its QA evidence, a refused retained file, no versions, no active workspace, a refused read, and a scientist without schema authority                                                                                                                                |
| `src/stories/SettingsPageChrome.stories.tsx`        | `settings/settings-page`                                                                                         | The page with a count, actions and checked, unchecked and disabled rows, and its quiet header                                                                                                                                                                                                            |
| `src/stories/SettingsWorkspaceGroups.stories.tsx`   | `settings/workspace-groups`                                                                                      | A group with members, an empty group, no groups, and the confirm-removal warning                                                                                                                                                                                                                         |
| `src/stories/AppShell.stories.tsx`                  | `shell/app-shell`                                                                                                | The shell, the notification popover open and empty, and an unknown inbox count (which is not a zero)                                                                                                                                                                                                     |
| `src/stories/NotFound.stories.tsx`                  | `shell/not-found`                                                                                                | Not found inside a record, at an unknown record id, and under no section the product has                                                                                                                                                                                                                 |

Three modules are covered beside their components rather than in this
directory: `src/components/protocols/protocol-document.tsx` and
`protocol-version-training.tsx` by
`src/components/protocols/protocols.stories.tsx` (document, empty and
unreadable; training required, failed, pending and unavailable),
`protocols-registry-grid.tsx` by `src/stories/ProtocolsRegistryGrid.stories.tsx`,
and `src/components/settings/parser-versions.tsx` by
`src/components/settings/parser-versions.stories.tsx` (populated and empty).

`src/components/models/record-model-versions.stories.tsx` was retired in this
pass: it rendered `record-model-versions.tsx` with three states, all of them
subsets of `src/stories/RecordModelVersions.stories.tsx`, which is the survivor.
One component, one story.

### How a story answers a screen's reads

Five mechanisms, and a story picks the one its screen needs. Each is verified by
sweeping the built stories in Chromium with the network log open: no story in
this lane makes a request to `/api/…`.

| Mechanism                                                 | What it is for                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screenQueryClient({ data })`                             | Seeding a read. A seeded key is fresh for `staleTime: Infinity`, so the screen's hook subscribes to it and never runs its own query function.                                                                                                                                                   |
| `holdRead(client, key, 'pending' \| 'denied' \| 'error')` | Making a read _be_ loading, refused or failed. A screen's own `queryFn` outranks the client-level default, so an unseeded key runs it and leaves the page; pre-fetching the key puts the read in the cache in the state the story names, and the client's `retryOnMount: false` holds it there. |
| `stubDataClient({ '<rpc or resource>': fixtures })`       | A module that takes a `client` prop. Reads are answered by name and everything else refuses, so an unanswered read shows the module's own error state rather than an empty list it would render as "nothing here".                                                                              |
| `StubDataClient stub={…}`                                 | The two screens that read through the shared `notebookDataClient` imperatively — the palette's search and the schedule dialog's workspace zone. A module-scope client captured `fetch` before any story could stub it, so its two methods are replaced for the story's lifetime.                |
| `withApiReads('error')`                                   | The last resort, at the fetch boundary, for a request a screen resolves while it runs rather than through the cache.                                                                                                                                                                            |

### Story-level limits

| Limit                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A read a screen leaves _enabled_ can always load, so seeding alone cannot show it a first-load state; `holdRead` is what holds it loading. Where a refused read is the honest state, the story shows that instead: parser settings has no "loading" story for this reason.                                                                      |
| `SearchPalette` and `ScheduleBookDialog` read through the shared `notebookDataClient` imperatively rather than through React Query, so a query-cache seed cannot drive them. Their stories replace the two client methods for the story's lifetime (`StubDataClient` in the harness); the stub answers instead, and no request leaves the page. |
| `SampleLabelPrintStyles` is a style-only export rendered inside `SampleLabelPrint`; its story shows the print document with that CSS applied.                                                                                                                                                                                                   |
| `PrintLabelButton`'s click path records through a server and then calls `window.print()`, so its story shows the action at rest rather than a printed page.                                                                                                                                                                                     |
| `MilestoneTimeline` returns `null` when no milestone has a date; that story shows the silence as the contract.                                                                                                                                                                                                                                  |

### Modules in these directories with no story

| Module                                           | Why no story                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/datasets/dataset-import-row.ts`  | Frozen import-receipt presentation data and instrument-finding labels only. No React imports or JSX. DatasetDetailTabs stories render the receipt rows and their provenance through DatasetImportsTab. |
| `src/components/datasets/value-action-labels.ts` | Canonical flag labels and reason-category constants only. No React imports or JSX. DatasetValueActions stories render the flags and reason controls; dataset compare uses the same labels.             |

The guard never asks about these — they export no component-shaped value — so
they are recorded here rather than as skips: `datasets/dataset-detail-tabs.ts`,
`datasets/datasets-data.ts`, `datasets/snapshot-data.ts`,
`models/model-approval-data.ts`, `models/model-field-impact.ts`,
`models/model-version-impact.ts`, `pipelines/pipelines-data.ts`,
`pipelines/agents/agents-data.ts`, `projects/project-access.ts` (read by the
Projects screen's stories, but a hook), `projects/project-data.ts`,
`projects/project-lists.ts`, `projects/options.ts`, `projects/types.ts`,
`samples/sample-history.ts`, `samples/sample-state.ts`,
`samples/samples-data.ts`, `schedule/schedule-data.ts`,
`search/result-text.ts`, `settings/settings-nav.ts`,
`settings/settings-profile-data.ts`, `settings/settings-sessions-data.ts`,
`shell/nav.ts`, `templates/templates-data.ts`. All are hooks, query-key
factories, pure helpers, type-only modules or fixtures.

`models/models-data.ts` and `models/model-approval.ts` export value names that
begin with a capital letter, so the guard's own heuristic would read them as
component modules if its scope were widened; they are the same kind of module —
the models screen's hooks and its approval vocabulary — and they have no
rendered surface of their own.

### Widening the guard to these directories

It is one line for whoever owns `src/components/story-coverage.test.ts`: add the
twelve directories to `SCOPE`. Two things need attention first, and both are
why it is not done here:

- `src/components/protocols/protocols.stories.tsx` imports its components
  relatively (`./protocol-document`), and the guard resolves coverage from
  `#/…` specifiers only. Widening the scope without teaching it relative
  specifiers would report those two protocol components as uncovered even
  though they have stories.
- `models/models-data.ts` and `models/model-approval.ts` would need a recorded
  skip, in a table whose heading and wording are the guard's to choose.

## Checkbox: the mixed and disabled marks

`src/components/ui/checkbox.tsx` reported `aria-checked="mixed"` while
painting its tick in `text-on-accent` on an unfilled `bg-surface` box — a white
mark on a white box, so a partly selected grid's header looked empty. Measured
in Chromium before the fix: fill `oklch(1 0 89.9)`, ink `oklch(1 0 89.9)`. The
same defect had a second half: a disabled checked box kept the disabled surface
fill (`data-disabled:bg-surface-disabled` beat `data-checked:bg-primary` in
Tailwind's variant order) while the tick stayed `on-accent`.

Both are fixed by filling the box for `data-indeterminate` as for `data-checked`
and repeating that fill for `data-disabled:data-checked:` and
`data-disabled:data-indeterminate:`, which win by attribute specificity whatever
order Tailwind emits them in. Measured in Chromium after the fix: a mixed box,
enabled or disabled, and a disabled checked box, all paint fill
`oklch(0.551 0.188 256)` with ink `oklch(1 0 89.9)`. `checkbox.test.tsx` resolves
those colours out of `src/styles.css` for light and dark, modelling the cascade
by specificity, and fails if they stop differing.

## Samples, models, registry, materials, stocktake and search

The screens and dialogs for samples, materials and reagent orders, model
fields and subtypes, the registry, stocktake and search each have a story. The
files are grouped by surface rather than one per module:

| Story file                                        | Modules covered                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/stories/SamplePlacement.stories.tsx`         | `samples/position-picker`, `place-field`, `location-field`, `label-template-picker`                                          |
| `src/stories/SampleDialogs.stories.tsx`           | `samples/aliquot-dialog`, `pool-dialog`, `move-dialog`, `bulk-register-dialog`, `sample-edit-dialogs`                        |
| `src/stories/SampleRecordPanels.stories.tsx`      | `samples/sample-inspector`, `sample-workflow-panel`, `release-checks-panel`, `sample-label-sheet`                            |
| `src/stories/MaterialSafetyAndOrders.stories.tsx` | `materials/ghs-pictogram`, `material-safety`, `reagent-orders`, `make-solution-dialog`                                       |
| `src/stories/RegistryGrid.stories.tsx`            | `inventory/registry-grid`                                                                                                    |
| `src/stories/ModelFieldTables.stories.tsx`        | `models/field-changes`, `inherited-fields-table`, `record-model-fields-tab`, `record-model-edit`, `record-model-edit-dialog` |
| `src/stories/ModelSubtypes.stories.tsx`           | `models/model-subtype-ui`, `dataset-subtype-ui`                                                                              |
| `src/stories/BuiltInModelPages.stories.tsx`       | `models/built-in-model-layout`, `built-in-model-fields`, `added-fields`                                                      |
| `src/stories/RegistryScreens.stories.tsx`         | `registry/registry-list`, `registry-lineage`, `registry-form`, `registry-settings`                                           |
| `src/stories/StocktakeScreens.stories.tsx`        | `stocktake/stocktake-list`, `stocktake-count`, `stocktake-summary`                                                           |
| `src/stories/SearchSavedAndPickers.stories.tsx`   | `search/saved-searches`, `search/result-icon`, `record-picker/experiment-picker`, `record-picker/record-picker`              |

Fixtures the sample stories share are in `src/stories/sample-fixtures.ts`, and
those for the model stories in `src/stories/model-fixtures.ts`.

### Story-level limits

| Component                                      | Limit                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecordPicker` (`record-picker.tsx`)           | The picker's workspace search runs through a client the module builds when it loads, so a story cannot answer it. With no server it shows the failed-search state; the results list is covered by `record-picker` unit tests and the live app. |
| `PrintLabelsDialog` (`sample-label-sheet.tsx`) | The print document is portalled and hidden on screen; the `LabelSheet` story shows only that it renders without error.                                                                                                                         |

### Skipped modules

| Module                                                 | Why no story                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/samples/label-sheet-data.ts`           | Pure label-kind selection and canonical print-record orchestration, without a visible component; label-sheet and print stories render the callers. |
| `src/components/samples/quantity-actions.ts`           | Context creation and useContext only; no JSX or visible component. Actual quantity dialogs retain their stories.                                   |
| `src/components/samples/quantity-actions-provider.tsx` | Passes children unchanged through SampleActionsContext.Provider; it adds no visible UI. Actual dialogs and the sample frame consume its actions.   |
| `src/components/stocktake/stocktake-shared.ts`         | Tone maps and label helpers, not a component. The list, count and summary stories render every one of its states.                                  |

`samples/quantity-plans.ts` contains pure aliquot/pool arithmetic and validation,
without JSX. The plan-preview stories import it directly, so it needs no skip.

## Datasets, instruments, experiments, protocols, reports, templates and viz

The screen parts under `src/components/{datasets, instruments, experiments,
protocols, recurring, reports, scan, schedule, templates}/`,
`src/components/projects/project-sheets.tsx`, `src/components/viz/` and
`src/components/audit/saved-trails.tsx` are covered by these files, one per
screen, each showing the states that change what the part says:

| Story file                                       | Modules covered                                                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stories/DatasetActions.stories.tsx`         | `datasets/{dataset-inspector, column-inspector, dataset-archive, dataset-model-upgrade, dataset-run-pipeline, cite-snapshot-dialog}`                       |
| `src/stories/InstrumentParts.stories.tsx`        | `instruments/{agent-download, intake-delivery-notice, intake-setup-dialog, live-readings, out-of-service, parser-follow-up, request-qualification-button}` |
| `src/stories/ExperimentParts.stories.tsx`        | `experiments/{book-instrument-button, save-as-template-dialog, results-workspace}`, `audit/saved-trails`                                                   |
| `src/stories/ProtocolParts.stories.tsx`          | `protocols/{new-protocol-dialog, protocol-hazards, protocol-inspector, protocol-training-roster, protocol-versions-panel}`                                 |
| `src/components/protocols/protocols.stories.tsx` | `protocols/{protocol-document, protocol-version-training}` (now imported by `#/` path so the guard sees them)                                              |
| `src/stories/ReportParts.stories.tsx`            | `reports/{add-section-dialogs, generated-reports, new-report-dialog, report-document, reports-registry-grid, section-card}`                                |
| `src/stories/BenchActions.stories.tsx`           | `scan/scan-sample-actions`, `schedule/edit-booking-dialog`, `recurring/repeat-fields`                                                                      |
| `src/stories/TemplateAndSheetParts.stories.tsx`  | `templates/{bulk-upgrade-panel, template-sections-board, use-template-dialog}`, `projects/project-sheets`                                                  |
| `src/stories/VizParts.stories.tsx`               | `viz/{chart-renderer-impl, figure-controls, snapshot-source-banner, source-comparison}`                                                                    |

Stories answer reads by seeding a query client (`screenQueryClient`) and wrap
the story in `withApiReads('error' | 'pending')` where a part also polls or
resolves a request while it runs, so no story makes a request that leaves the
page. Two limits are deliberate: the instrument live-readings chart polls every
few seconds, so its story holds the poll pending and leaves the seeded readings
on screen; and the bulk-upgrade story runs the upgrade against a refused
server, so every notebook comes back in the "not updated" list.

| Module                                           | Why no story                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/experiments/series-bar.tsx`      | Reads the experiment's series from the database and draws nothing without one; the series tab and notebook journeys cover it.                                           |
| `src/components/experiments/series-offer.tsx`    | A checkbox that appears only when the experiment is in a series; it needs the series query, and the Repeat and New run dialogs that hold it are covered by their tests. |
| `src/components/experiments/experiments-data.ts` | Query keys, list filters, row mapping and hooks for the experiments list. Nothing renders; the screens that use it have stories.                                        |
| `src/components/projects/project-lists.ts`       | Page-size constants, filters, fetchers and hooks behind the project lists (which have stories in `ProjectLists.stories.tsx`). Nothing renders.                          |

## Plates and group comparisons

| Module                                       | Why no story                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/plates/new-run-dialog.tsx`   | Portalled dialog that reads projects and saves through the data client, so it has no state to show without a connected app.           |
| `src/components/plates/plates-page.tsx`      | Page that lists plate runs and worklists from the server and switches between them.                                                   |
| `src/components/plates/potency-panel.tsx`    | Reads potency across saved runs from the server; the curve it draws has its own story (`DoseResponsePlot`).                           |
| `src/components/plates/run-detail.tsx`       | Detail view that loads one run, its quality and its samples from the server and saves settings and archiving through the data client. |
| `src/components/plates/worklist-dialogs.tsx` | Portalled dialogs that read plate runs and write worklists through the data client.                                                   |
| `src/components/viz/analysis-comparison.tsx` | Controls and results for the Analyse tab; they run on a dataset loaded in Analysis Studio and render nothing without one.             |

## Agent permissions, checks and lab watchers

| Module                                                      | Why no story                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/settings/agent-permissions-panel.tsx`       | Settings panel that reads and saves agent permissions through the data client; its table and selects are the shared components.       |
| `src/components/settings/ai-checks-panel.tsx`               | Settings panel that starts a run on the server and reads earlier runs through the data client.                                        |
| `src/components/settings/lab-watchers-panel.tsx`            | Settings panel that reads watchers and findings and saves through the data client.                                                    |
| `src/components/pipelines/agents/action-requests-board.tsx` | Board that reads the actions agents asked for and approves or rejects them through the data client, so it has no state to show alone. |

## Run quality control and instrument data

| Module                                            | Why no story                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/components/quality/run-qc-panel.tsx`         | Loads tracked series and points from the server and saves through the data client; the chart it draws has its own story. |
| `src/components/instruments/converted-data.tsx`   | Lists converted instrument files from the server and downloads each document through the data client.                    |
| `src/components/instruments/converter-picker.tsx` | Reads the converters the Python runtime offers over the network and adds a parser; shown inside the intake setup dialog. |

## Provenance modules without a story

| Module                                          | Why no story                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/pipelines/run-reproduction.tsx` | Reads a run's reproductions and starts one through the data client and the reproduce route; covered by the run page tests and the provenance database tests.                    |
| `src/components/settings/lineage-section.tsx`   | Reads and saves lineage endpoints through server functions that need a signed-in manager; covered by the provenance database tests and the Integrations settings click-through. |

## Plugin modules without a story

| Module                                                       | Why no story                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/calculators/plugin-calculator-panel.tsx`     | Lists the calculators plugins add and runs them through the plugin run route, so it has nothing to show without an installed plugin and a runner.                         |
| `src/components/extensions/cell-display.tsx`                 | Draws one declarative cell display; covered by the cell display unit tests and the plugin hooks click-through.                                                            |
| `src/components/extensions/field-type-hooks.tsx`             | Reads installed plugins and links a model field to a plugin type; covered by the plugin hooks database tests and click-through.                                           |
| `src/components/extensions/plugin-cell-renderer.tsx`         | Hosts a hidden sandboxed frame that draws cells and checks what it answers; needs the plugin server route, so covered by the click-through and the plugin screen tests.   |
| `src/components/extensions/plugin-field-input.tsx`           | Hosts a plugin's sandboxed input frame in a form; needs the plugin server route, so covered by the click-through.                                                         |
| `src/components/extensions/plugin-host.ts`                   | Runs what a plugin screen asks Sheetbase to do, as the person; a pure helper with no UI, covered by the host capability tests and the click-through.                      |
| `src/components/extensions/plugin-page.tsx`                  | Hosts a plugin page or settings page in a sandboxed frame under the shared headers; needs the plugin server route, so covered by the click-through.                       |
| `src/components/extensions/plugin-report-section-dialog.tsx` | Hosts a plugin's section form in a dialog and adds what it returns to a report; needs the plugin server route, so covered by the click-through.                           |
| `src/components/extensions/plugin-widgets.tsx`               | Lays out the plugin cards on Home, each a sandboxed frame; needs the plugin server route, so covered by the click-through.                                                |
| `src/components/extensions/plugin-block.tsx`                 | Reads installed plugins to find the block a notebook holds; covered by the plugin hooks click-through.                                                                    |
| `src/components/extensions/plugin-frame.tsx`                 | Hosts a sandboxed frame and answers its messages by running plugin operations; covered by the sandbox and runtime tests and the click-through.                            |
| `src/components/extensions/plugin-screen.tsx`                | Fetches a plugin screen or page and passes it to the drawing or frame component; covered by the plugin hooks click-through.                                               |
| `src/components/extensions/plugin-view.tsx`                  | Draws a validated screen with shared components that have their own stories; covered by the screen unit tests.                                                            |
| `src/components/extensions/table-hooks.tsx`                  | Reads installed plugins and runs their column and row hooks on the shared table; covered by the plugin hooks click-through.                                               |
| `src/components/extensions/tone.ts`                          | Pure helper mapping a tone name to token classes; covered by the cell display unit tests.                                                                                 |
| `src/components/plugins/plugin-file-preview.tsx`             | Reads a stored file and sends it to a plugin preview through the plugin data route, so it needs an installed plugin and a runner.                                         |
| `src/components/search/plugin-hits.tsx`                      | A table of search results built on the registry grid (which has a story), each row linking to a record; it only holds the plugin's hits.                                  |
| `src/components/viz/extension-analysis.tsx`                  | Lists analysis kinds and runs them through the plugin run route, then draws with the shared chart renderer, which has its own story; covered by the plugin runtime tests. |

## Robots, scheduler and code cells

| Module                                               | Why no story                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/components/instruments/robot-section.tsx`       | Reads robot settings and jobs through the data client and calls the job functions; covered by the robot job tests.      |
| `src/components/scheduler/schedule-panel.tsx`        | Reads parts, needs and proposals through the data client and calls the scheduler functions; covered by scheduler tests. |
| `src/components/scheduler/instrument-timeline.tsx`   | Reads an instrument's bookings and jobs through the data client; covered by the scheduler tests.                        |
| `src/components/settings/working-hours-settings.tsx` | Reads and saves the scheduler settings through the data client; covered by the scheduler tests.                         |
| `src/components/notebook/code-cell-block.tsx`        | Runs the cell through the code cell route and reads its runs through the data client; covered by the code cell tests.   |

## Data contract modules without a story

| Module                                                | Why no story                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/contracts/blocked-import-dialog.tsx`  | Portalled dialog that reads the contract from the server; the import flow opens it when a contract refuses an import.          |
| `src/components/contracts/contract-impact-notice.tsx` | Notice that reads the model's contract from the server and compares it with the version about to be published.                 |
| `src/components/contracts/contract-panel.tsx`         | The Contract tab: reads and writes contracts, runs and members through the data client, and has no state to show without them. |
| `src/components/contracts/dataset-contract-badge.tsx` | Reads a dataset's standing and its contract from the server; the badge it draws has its own story (`ContractStatusBadge`).     |
| `src/components/contracts/rule-dialog.tsx`            | Portalled form that previews a rule against stored data and saves it through the data client.                                  |

## Planner

| Module                                    | Why no story                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/planner/plan-dialog.tsx`  | Asks the assistant through a server function and creates the experiment through the data client; plan rules and the create call are covered by unit and database tests. |
| `src/components/planner/plan-review.tsx`  | Lays out a plan passed in as props; it has no states of its own and is covered by the Plan with AI click-through.                                                       |
| `src/components/planner/plan-with-ai.tsx` | Shows a button only when a real model is connected.                                                                                                                     |

## Split interiors (10 November 2026)

The screens below were split into the parts they are made of, so a story would
show the same markup the parent's story already shows in every state it has.
Each module here is rendered by its parent's story, which remains the story for
the screen: `Inspector.stories.tsx`, `RecordHeader`'s stories,
`ProtocolParts.stories.tsx`, `ReportParts.stories.tsx` and
`ProjectsPage.stories.tsx`.

| Module                                                     | Why no story                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/contracts/rule-dialog-fields.tsx`          | The condition fields and the preview block inside the rule dialog; the dialog renders both.                                                                        |
| `src/components/record/inspector-header.tsx`               | The inspector's identity strip; `Inspector.stories.tsx` renders it with a record type, a status and a close control.                                               |
| `src/components/record/inspector-tabs.tsx`                 | The tab strip and panels; `Inspector.stories.tsx` renders them, including the close control that rides the strip when the header is hidden.                        |
| `src/components/record/inspector-content.tsx`              | The inspector's four states (skeleton, nothing selected, unavailable, permission denied); every one is a story in `Inspector.stories.tsx`.                         |
| `src/components/record/record-header-identity.tsx`         | The type, identifier, status and phase line; rendered by every `RecordHeader` story.                                                                               |
| `src/components/record/record-header-meta.tsx`             | The owner, updated, contributors and tags line, and its rule; rendered by the `RecordHeader` stories that pass any of those.                                       |
| `src/components/protocols/protocol-inspector-sections.tsx` | The approvals, training and used-by lists; `ProtocolParts.stories.tsx` renders the inspector that composes them.                                                   |
| `src/components/reports/add-text-dialog.tsx`               | A portalled dialog; `ReportParts.stories.tsx` mounts it in its open state, as it does the evidence dialog beside it.                                               |
| `src/components/reports/add-evidence-dialog.tsx`           | A portalled dialog that reads submitted records and versions; `ReportParts.stories.tsx` mounts it open, and the picker is covered by its tests.                    |
| `src/components/reports/evidence-block-table.tsx`          | The block list inside the evidence dialog; `ReportParts.stories.tsx` renders it with the chosen row and the no-blocks state.                                       |
| `src/components/projects/projects-header.tsx`              | The title row and view strip; `ProjectsPage.stories.tsx` renders them wide and narrow, with and without a resolved count.                                          |
| `src/components/projects/projects-toolbar.tsx`             | The sort, filter, group, search, columns and overflow controls; `ProjectsPage.stories.tsx` renders them in its list stories.                                       |
| `src/components/projects/projects-filter-menu.tsx`         | The filter dropdown; rendered open by the `ProjectsPage` stories that set filters, and the filter state is asserted by `projects-page.test.tsx`.                   |
| `src/components/projects/projects-search-field.tsx`        | The search box and its draft; `ProjectsPage.stories.tsx` renders it and `projects-page.test.tsx` covers applying and clearing a term.                              |
| `src/components/projects/projects-filter-chips.tsx`        | The chips that state a filter is on; `ProjectsPage.stories.tsx` renders them with the archived and stage filters applied.                                          |
| `src/components/projects/projects-page-states.tsx`         | The loading, failure, empty and no-results panels; `ProjectsPage.stories.tsx` renders each state and `projects-page.test.tsx` asserts their copy.                  |
| `src/components/projects/projects-table.tsx`               | The phone list and table; `ProjectsPage.stories.tsx` renders both, grouped and ungrouped, with and without bulk selection.                                         |
| `src/components/projects/projects-table-row.tsx`           | One project row; rendered by `ProjectsPage.stories.tsx` in the table stories, whose row click and link are asserted by `projects-page.test.tsx`.                   |
| `src/components/projects/projects-footer.tsx`              | The count, hidden-archive note and selection actions; `ProjectsPage.stories.tsx` renders it with and without a selection.                                          |
| `src/components/projects/new-project-dialog.tsx`           | A portalled dialog; `ProjectsPage.stories.tsx` mounts it open, and the create flows are asserted by `projects-page.test.tsx`.                                      |
| `src/components/plates/-plates-body.tsx`                   | The tab bodies under the Plates page's header; `PlatesPage` renders every one of them, and the runs and worklists tables are asserted by the plates browser suite. |
