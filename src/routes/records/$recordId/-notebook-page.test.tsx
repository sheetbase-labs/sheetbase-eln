/**
 * EXP-04.4 — the notebook route's inspector wiring.
 *
 * The selected Sheet cell lives inside the Sheet workspace, so the route lifts
 * it through `onCellSelectionChange` and describes it with
 * `useNotebookCellFacts`. These tests drive the real chain — the notebook
 * canvas, the Sheet block, the Sheet editor's selection handler — with only
 * the grid's presentation layer (and the Sheet's authoritative reads) stubbed,
 * and prove the Properties tab describes the selected cell while Comments and
 * History keep rendering the existing panels.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createContext, useContext } from 'react'
import type { redirect as redirectRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { SheetbaseGridProps } from '#/components/sheet/sheetbase-grid'
import type { DataClient } from '#/lib/data-client'
import type { FieldDefinition } from '#/lib/field-definition'
import * as commentsData from '#/lib/comments-data'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import * as notebookExperience from '#/lib/notebook-experience'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { parseSheetInstanceState } from '#/lib/sheet-instance'

import {
  NotebookCanvas,
  NotebookInspector,
  StickyRecordHeader,
  useNotebookCellFacts,
} from './-notebook-page'

/**
 * The grid is replaced with a props recorder: the test selects a cell by
 * invoking the captured `SheetbaseGridSelection` callback exactly as the grid
 * would, keeping the selection contract (not the renderer) under test.
 */
const gridRender = vi.hoisted(() => vi.fn())

/** The search keys these tests drive the notebook page through. */
interface TestSearch {
  reopen?: string
  returnTo?: string
  revision?: string
  tab?: string
}

const TestRouterContext = createContext<{
  location: { search: TestSearch; hash: string }
  navigate: ReturnType<typeof vi.fn>
}>({ location: { search: {}, hash: '' }, navigate: vi.fn() })

// oxlint-disable-next-line anti-slop/no-module-mocking -- the notebook page imports the sheet grid directly, and the suite drives the grid's selection callback through a props recorder instead of rendering a Handsontable grid.
vi.mock('#/components/sheet/sheetbase-grid', () => ({
  SheetbaseTableGrid: (props: SheetbaseGridProps) => {
    gridRender(props)

    return (
      <div
        data-testid="sheet-grid"
        data-columns={props.columns.map((column) => column.id).join(',')}
      />
    )
  },
}))

// The Sheet's calculation results are an authoritative read; stub the fetch so
// the test stays offline (the editor itself is real).
// oxlint-disable-next-line anti-slop/no-module-mocking -- the page reads calculation results through this module's shared client at import time; only that one read is replaced so the editor stays real and the suite stays offline.
vi.mock('#/lib/sheet-local-data', async (importOriginal) => ({
  ...(await importOriginal()),
  readSheetInstanceCalculationResults: vi
    .fn()
    .mockResolvedValue({ results: [] }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- the page takes its route context, params, search and navigation from the router at import time, so the router's factories are the only seam a unit test has; every other export stays real.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  getRouteApi: () => ({
    useRouteContext: () => ({ context: {} }),
    useParams: () => ({ recordId: 'r1', projectId: 'p1' }),
    useSearch: () => ({}),
  }),
  redirect: (options: Parameters<typeof redirectRoute>[0]) => options,
  useBlocker: () => ({ status: 'idle' }),
  useNavigate: () => useContext(TestRouterContext).navigate,
  useParams: () => ({ recordId: 'r1', projectId: 'p1' }),
  useRouterState: <Selected,>(options?: {
    select?: (state: React.ContextType<typeof TestRouterContext>) => Selected
  }) => {
    const state = useContext(TestRouterContext)

    return options?.select ? options.select(state) : state
  },
  // The Sheet workspace reads the root auth context; this Notebook renders
  // without Sheet comments, so no actor is needed.
  useRouteContext: () => ({ auth: null }),
  Link: ({
    to,
    params,
    search: _search,
    children,
    ...rest
  }: {
    to?: string
    params?: Record<string, string>
    search?: unknown
    children?: ReactNode
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    let href = to ?? '#'

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, encodeURIComponent(value))
      }
    }

    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- the dialog itself is exercised elsewhere; this suite only needs the header's trigger to mount without opening the real submit flow.
vi.mock('#/components/notebook/submit-notebook-dialog', () => ({
  SubmitNotebookDialog: ({ recordId }: { recordId: string }) => (
    <div role="dialog" aria-label={`Submit ${recordId}`} />
  ),
}))

const signatureToGive = vi.hoisted(() => ({ value: true }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- the signing dialog and its signature read are exercised elsewhere; this suite only needs the header's trigger and its availability.
vi.mock('#/components/notebook/sign-notebook-dialog', () => ({
  useHasSignatureToGive: () => signatureToGive.value,
  SignNotebookDialog: ({ revisionId }: { revisionId: string }) => (
    <div role="dialog" aria-label={`Sign ${revisionId}`} />
  ),
}))

/** jsdom has no layout, so every range measures as empty. */
const emptyRectList: DOMRectList = Object.assign([], { item: () => null })

beforeAll(() => {
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => emptyRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  cleanup()
  gridRender.mockClear()
})

const FIELD_TURBIDITY = '10000000-0000-4000-8000-00000000000a'
const FIELD_LOAD = '10000000-0000-4000-8000-00000000000b'
const ROW_1 = '10000000-0000-4000-8000-000000000001'
const ROW_2 = '10000000-0000-4000-8000-000000000002'
const INSTANCE = '20000000-0000-4000-8000-000000000001'
const WORKSPACE = '20000000-0000-4000-8000-000000000002'

function decimalField(
  fieldId: string,
  key: string,
  label: string,
  unit: string,
  validation: { min: number; max: number },
): FieldDefinition {
  return {
    fieldId,
    key,
    label,
    description: null,
    logicalType: 'decimal',
    nullable: false,
    defaultValue: null,
    cardinality: 'one',
    quantity: {
      kind: 'amount',
      dimension: 'mass-per-volume',
      storageUnit: unit,
      preferredDisplayUnit: unit,
    },
    validation,
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
  }
}

/** An ad-hoc Sheet: two validated local columns over two rows. */
function sheetInstance(): SheetInstance {
  return {
    id: INSTANCE,
    workspaceId: WORKSPACE,
    projectId: null,
    notebookRecordId: 'r1',
    sourceDefinitionVersionId: null,
    name: 'Clarification runs',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state: parseSheetInstanceState({
      bindings: [],
      localFields: [
        decimalField(FIELD_TURBIDITY, 'turbidity_out', 'Turbidity out', 'NTU', {
          min: 0,
          max: 50,
        }),
        decimalField(FIELD_LOAD, 'load', 'Load', 'mg/L', { min: 1, max: 30 }),
      ],
      localValues: {
        [ROW_1]: { [FIELD_TURBIDITY]: 61.5, [FIELD_LOAD]: 15 },
        [ROW_2]: { [FIELD_TURBIDITY]: 12, [FIELD_LOAD]: 45 },
      },
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
        filters: [],
        sorts: [],
      },
      provenance: { createdFrom: 'ad_hoc' },
    }),
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: null,
  }
}

const record: NotebookRecord = {
  id: 'r1',
  projectId: null,
  kind: 'experiment',
  identifier: 'EXP-2025-0001',
  title: 'Virus Stability at 4C',
  status: 'in-progress',
  tags: ['stability'],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T13:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

const sheetBlock: NotebookBlock = {
  id: 'b1',
  recordId: record.id,
  type: 'sheet',
  payload: { instanceId: INSTANCE },
  payloadSchemaVersion: 1,
  order: 1,
  version: 1,
}

const fakeClient: DataClient = {
  list: async <T,>(): Promise<T[]> => [],
  count: async () => 0,
  rpc: async <T,>(): Promise<T> => {
    // SAFETY: this double answers no calls the assertions read; the page's own reads are driven by the query client.
    return {} as T
  },
  insert: async <T,>(): Promise<T> => {
    // SAFETY: this double answers no calls the assertions read; the page's own writes are driven by the query client.
    return {} as T
  },
  patch: async <T,>(): Promise<T[]> => [],
  remove: async () => [],
}

/**
 * The route's own composition: the canvas publishes the selected cell through
 * the route's hook, and the inspector renders the facts that hook produces.
 */
function NotebookSurfaces({ queryClient }: { queryClient: QueryClient }) {
  const { cell, onCellSelectionChange } = useNotebookCellFacts()

  return (
    <>
      <NotebookCanvas
        record={record}
        blocks={[sheetBlock]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        client={fakeClient}
        queryClient={queryClient}
        collaborationWorkspaceId={WORKSPACE}
        collaborationRole="member"
        onCellSelectionChange={onCellSelectionChange}
      />
      <NotebookInspector
        record={record}
        links={[]}
        linksLoading={false}
        currentUserId="u1"
        currentUserName="Ada Lovelace"
        cell={cell}
      />
    </>
  )
}

function renderSurfaces() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  queryClient.setQueryData(['sheet-instance', INSTANCE], sheetInstance())
  queryClient.setQueryData(['sheet-instance-embeddings', INSTANCE], {
    embeddings: [],
    count: 0,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <NotebookSurfaces queryClient={queryClient} />
    </QueryClientProvider>,
  )
}

describe('NotebookInspector — selected Sheet cell (EXP-04.4)', () => {
  it('describes the cell the grid selected while Comments and History keep their panels', async () => {
    const user = userEvent.setup()

    const comments = vi
      .spyOn(commentsData, 'fetchCommentsForRecord')
      .mockResolvedValue([])

    const timeline = vi
      .spyOn(notebookExperience, 'fetchRecordTimeline')
      .mockResolvedValue([])

    const revisions = vi
      .spyOn(notebookExperience, 'fetchRevisionsForRecord')
      .mockResolvedValue([])

    renderSurfaces()
    await waitFor(() => expect(gridRender).toHaveBeenCalled())
    // The Sheet mounted with both local columns, but no cell is selected yet.
    expect(screen.getByTestId('sheet-grid').getAttribute('data-columns')).toBe(
      `${FIELD_TURBIDITY},${FIELD_LOAD}`,
    )
    expect(screen.queryByText(/Clarification runs · row/)).toBeNull()

    // Select row 2, Load (45) — above its 1–30 range.
    // SAFETY: the grid double records the props it was rendered with, so the last recorded call's first argument is the grid's props.
    const props = gridRender.mock.lastCall?.[0] as SheetbaseGridProps
    act(() =>
      props.onSelectionChange?.({
        rowIndex: 1,
        rowId: ROW_2,
        columnId: FIELD_LOAD,
        rowIds: [ROW_1, ROW_2],
        columnIds: [FIELD_LOAD],
        input: '45',
      }),
    )

    // Properties (the default tab) describes the selected cell: its context,
    // value, unit and validation state.
    expect(
      await screen.findByText('Clarification runs · row 2 · Load'),
    ).toBeTruthy()
    expect(screen.getByText('45')).toBeTruthy()
    expect(screen.getAllByText('mg/L').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Above the allowed range 1–30 mg/L · flagged').length,
    ).toBeGreaterThan(0)
    // The record's own Properties are untouched — this is an addition.
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()

    // Comments and History still render their existing panels.
    await user.click(screen.getByRole('tab', { name: 'Comments' }))
    expect(
      await screen.findByText('No comments yet on this record'),
    ).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(await screen.findByText('No submitted revisions yet')).toBeTruthy()

    comments.mockRestore()
    timeline.mockRestore()
    revisions.mockRestore()
  })

  it('leaves Properties to the record when no cell is selected', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector record={record} links={[]} linksLoading={false} />
      </QueryClientProvider>,
    )
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    expect(screen.queryByText('Selected cell')).toBeNull()
    expect(screen.queryByText('Validation')).toBeNull()
  })
})

describe('StickyRecordHeader — notebook title', () => {
  it.each([undefined, 'sign'] as const)(
    'keeps a background notebook’s reopen=%s and return params separate from the active browser URL',
    async (backgroundTask) => {
      const address = window.location.href
      window.history.replaceState(null, '', '?reopen=submit&returnTo=%2Factive')
      const activeNavigate = vi.fn()
      const backgroundNavigate = vi.fn()

      const activeSearch = {
        reopen: 'submit',
        returnTo: '/active',
        tab: 'notebook',
      }

      const backgroundSearch = {
        reopen: backgroundTask,
        returnTo: '/background',
        revision: 'revision-b',
      }

      const mount = (
        search: TestSearch,
        navigate: ReturnType<typeof vi.fn>,
        background: boolean,
      ) =>
        render(
          <QueryClientProvider client={new QueryClient()}>
            <TestRouterContext.Provider
              value={{ location: { search, hash: '' }, navigate }}
            >
              <StickyRecordHeader
                record={
                  background
                    ? {
                        ...record,
                        id: 'rB',
                        lockedAt: backgroundTask ? '2026-10-22' : null,
                        lockedByRevisionId: backgroundTask
                          ? 'revision-b'
                          : null,
                      }
                    : { ...record, id: 'rA' }
                }
                projectName="Project"
                projectId="p1"
                currentUserId="u1"
                currentUserName="Ada Lovelace"
                workspaceId={WORKSPACE}
              />
            </TestRouterContext.Provider>
          </QueryClientProvider>,
        )

      try {
        const active = mount(activeSearch, activeNavigate, false)
        const background = mount(backgroundSearch, backgroundNavigate, true)
        expect(
          await within(active.container).findByRole('dialog', {
            name: 'Submit rA',
          }),
        ).toBeTruthy()

        if (backgroundTask) {
          expect(
            await within(background.container).findByRole('dialog', {
              name: 'Sign revision-b',
            }),
          ).toBeTruthy()
          expect(backgroundNavigate).toHaveBeenCalledTimes(1)
          expect(
            backgroundNavigate.mock.calls[0][0].search(backgroundSearch),
          ).toEqual({ ...backgroundSearch, reopen: undefined })
        } else {
          expect(within(background.container).queryByRole('dialog')).toBeNull()
          expect(backgroundNavigate).not.toHaveBeenCalled()
        }

        expect(activeNavigate).toHaveBeenCalledTimes(1)
        expect(activeNavigate.mock.calls[0][0].search(activeSearch)).toEqual({
          ...activeSearch,
          reopen: undefined,
        })
        expect(window.location.search).toBe('?reopen=submit&returnTo=%2Factive')
      } finally {
        window.history.replaceState(null, '', address)
      }
    },
  )

  it('offers Sign on a locked notebook only while a signature is left to give', () => {
    const lockedRecord = {
      ...record,
      lockedAt: '2026-10-22',
      lockedByRevisionId: 'revision-b',
    }

    const mount = () =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <TestRouterContext.Provider
            value={{
              location: { search: {}, hash: '' },
              navigate: vi.fn(),
            }}
          >
            <StickyRecordHeader
              record={lockedRecord}
              projectName="Project"
              projectId="p1"
              currentUserId="u1"
              currentUserName="Ada Lovelace"
              workspaceId={WORKSPACE}
            />
          </TestRouterContext.Provider>
        </QueryClientProvider>,
      )

    try {
      signatureToGive.value = true
      const first = mount()
      expect(
        within(first.container).getByRole('button', { name: 'Sign' }),
      ).toBeTruthy()
      first.unmount()
      signatureToGive.value = false
      const second = mount()
      expect(
        within(second.container).queryByRole('button', { name: 'Sign' }),
      ).toBeNull()
    } finally {
      signatureToGive.value = true
    }
  })

  it('puts the title back when the rename is refused', async () => {
    const update = vi
      .spyOn(notebookExperience, 'updateExperimentMetadata')
      .mockRejectedValue(new Error('The record is locked.'))

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <StickyRecordHeader
          record={record}
          projectName="Virus Stability"
          projectId="p1"
          currentUserId="u1"
          currentUserName="Ada Lovelace"
          workspaceId={WORKSPACE}
        />
      </QueryClientProvider>,
    )

    const user = userEvent.setup()

    const title = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Notebook title',
    })

    await user.clear(title)
    await user.type(title, 'Renamed record')
    await user.tab()

    await waitFor(() => expect(update).toHaveBeenCalled())
    await waitFor(() => expect(title.value).toBe('Virus Stability at 4C'))

    update.mockRestore()
  })
})
