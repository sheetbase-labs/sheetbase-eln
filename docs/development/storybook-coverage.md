# Storybook coverage

This file records the deliberate exceptions to the rule that every exported
React component has a story. It is the input the structural guard reads: a
component that has neither a story nor an entry here is a coverage gap.

The guard for the forward kit, the registry copies and the icons is
`src/components/story-coverage.test.ts`; `pnpm validate` runs
`pnpm build-storybook` after `pnpm build`, so a story that stops compiling or
stops being collected fails the gate rather than the next person's review.

Stories live in `src/stories/<ComponentName>.stories.tsx` (a few live beside
their component under `src/components/**`); the Storybook config picks up both.
No story in this repository reaches a database or the network: fixture data is
static, and reads are satisfied by seeding a React Query cache with
`staleTime: Infinity` or by a promise that never settles, which renders the
component's own loading or error state.

## Notebook

| Component                         | Reason                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScientificWorkbookProvider`      | Provider only. It creates the workbook context its children read (`useSheetCalculation`); it renders `children` unchanged and has no rendered surface of its own. |
| `useAutosave` (`use-autosave.ts`) | Hook, not a component. Exported so callers can hold the machine directly; it has no rendered surface.                                                             |

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

| Component                                       | Reason                               |
| ----------------------------------------------- | ------------------------------------ |
| `CHART_PALETTE` (`chart-renderer.tsx`)          | Constant re-export, not a component. |
| `describeExecutionError` (`analysis-panel.tsx`) | Utility function, not a component.   |

## Audit

| Component                                                 | Reason                             |
| --------------------------------------------------------- | ---------------------------------- |
| `mapTimelineEvents`, `describeAuditEvent`, `auditLinkFor` | Utility functions, not components. |

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

## Forward kit, registry and icons

The structural guard in `src/components/story-coverage.test.ts` reads the table
below. Its scope is every component module under `src/components/v3/ui/`, under
`src/components/reui/`, and the two icon surfaces (`src/components/v3/icons.tsx`
and `src/components/icons/`). A module a story imports is covered; a module
listed here is a recorded skip; a module that is neither fails the guard, and
the failure names the file, the two places it could go, and the title
conventions below.

The table is keyed by the module's path rather than by an export name, because
coverage is resolved per module — one module, one story. Recording a module that
does have a story, or one that no longer exists, also fails the guard, so the
table cannot rot into a blanket exemption.

Not everything in those directories is a component, and this table is only for
components: non-component modules are named in the prose below instead, since
the guard never asks about them.

**Titles.** The forward kit and the legacy kit being removed have components of
the same name — both have a Sheet, a Table, a Dialog, a Kbd and a Checkbox. The
legacy stories are titled `UI/<Name>`; a same-named forward-kit story therefore
takes `v3 kit/<Name>`, and a registry copy whose name a legacy story already
holds takes `UI/Registry <Name>` (after `UI/RegistryKbd`). A story file that
merely shares its name with a component is not coverage of it.

| Module | Why no story |
| ------ | ------------ |

### Non-component modules in this scope

| Module                                            | What it is                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/components/reui/use-file-upload.ts`          | Hook, not a component. It wraps the file input's state and has no rendered surface of its own. |
| `src/components/v3/ui/component-adoption.test.ts` | The adoption guard, not a component.                                                           |
| `src/components/story-coverage.test.ts`           | This guard, not a component.                                                                   |

## Outside the forward-kit guard

The guard above covers the forward kit, the registry copies and the icons. It
does not cover these, and their absence from it is a recorded boundary rather
than an oversight:

| Area                                                                                                                                                                            | Position                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/v3/**` outside `v3/ui` — the v3 screens (datasets, integrations, models, pipelines, projects, protocols, samples, schedule, search, settings, shell, templates) | A separate lane of the coverage programme. These are screen-level components: several need router and query context, so their stories are written where that harness is, not here.                                                                                 |
| `src/components/ui/**` — the legacy kit                                                                                                                                         | Being deleted file by file; `src/components/v3/ui/component-adoption.test.ts` tracks the removal and the legacy story catalogue migrates with it. Telling someone to write a new story for a file with zero call sites would add work to a queue that is draining. |
| Other top-level areas (`assist`, `component-compare`, `offline`, `extensions`, `favourites`, `knowledge`, `live`, `overview`, `shortcuts`, `export`)                            | Not this lane. `/component-compare` is a development-only harness whose whole surface is the comparison record, not product UI.                                                                                                                                    |

Widening the guard to any of these means writing that area's stories first:
the guard fails on every uncovered module by design, and recording a rendered
screen as a "skip" would make the table a false record.
