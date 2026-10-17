# Storybook coverage

This file records the deliberate exceptions to the rule that every exported
React component has a story, and the story-level limits that are deliberate
rather than gaps. It is written to be the input for a structural guard; no such
guard exists on this branch yet.

Stories live in `src/stories/<ComponentName>.stories.tsx` (a few live beside
their component under `src/components/**`); the Storybook config picks up both.
No story in this repository reaches a database or the network: fixture data is
static, and reads are satisfied by seeding a React Query cache with
`staleTime: Infinity` or by a promise that never settles, which renders the
component's own loading or error state.

## Domain audit (17 October 2026)

Every component in the domain directories had a story file when this pass
started, so the gap was not coverage by file. Rendering every domain story in a
browser found stories that did not render what they claimed:

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
  path. The loaded instance read is now seeded, so the writable, read-only and
  composed-wrapper states render their real grid.
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

| Component                                          | Reason                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ReferencePicker` (`formula-reference-editor.tsx`) | Class, not a component. It is the keyboard reference-picking controller the in-cell editor instantiates; it returns no JSX. |
| `CONFLICT_REASON_MAX`, `REFERENCE_COLORS`          | Constants, not components.                                                                                                  |

## Review

| Component                                 | Reason                             |
| ----------------------------------------- | ---------------------------------- |
| `AREA_LABELS`, `KIND_META`-derived labels | Constants, not components.         |
| `exactText`, `focusChange`                | Utility functions, not components. |

## Collaboration

| Component               | Reason                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CollaborationProvider` | Provider. It renders `children` unchanged when collaboration is disabled and otherwise mounts the Liveblocks provider; the disabled branch is covered by its story, the enabled branch needs a Liveblocks secret. |

Components whose populated states need a connected Liveblocks room
(`PresenceStack`, `RemoteSelectionChips`, `BlockCoEditBadge`, `ThreadPanel`,
`CollaborationRoom`) do have stories, but a storybook build has no websocket
and no token endpoint, so those stories cover the reachable contract: nothing
renders before the room is ready, and nothing throws outside a room boundary.
The populated states are exercised by the component tests with the room hooks
mocked at the module boundary.

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

None. Both exported flows have stories. The upload flow's later steps need a
stored file; the map and check steps are covered from static fixtures of the
stored-file read.

## Related work

None. Both the pure list and the live panel have stories.

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

## Re-export aliases

| Export                                                                 | Reason                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `RecordHeaderAvatar`, `RecordHeaderBadge` (`record/record-header.tsx`) | Re-exports of `Avatar` and `Badge`; covered by `Avatar.stories.tsx` and `Badge.stories.tsx`.                                    |
| `ComposedSheetWorkspace` (`sheet/composed-sheet-workspace.tsx`)        | Re-export of the workspace in `canonical-sheet-workspace.tsx`; one component, one story (`ComposedSheetWorkspace.stories.tsx`). |
