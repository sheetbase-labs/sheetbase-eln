/**
 * NAV-02 regression: a Sheet deep link opens the instance's own project and is
 * editable. The route used to read the project from the `projectId` search
 * param only, so a link without one (the common case — Share copies the URL)
 * handed the workspace no project *and* forced `readOnly`, which meant the
 * Sheet opened read-only with no way to write it.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as query from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import type { CanonicalSheetWorkspace } from '#/components/sheet/canonical-sheet-workspace'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'

import { ComposedSheetRoute } from './-sheet-page'

/** A redirect as this route states it; the mock hands it straight back. */
interface RedirectOptions {
  to: string
}

/** The search the mocked route hands the page. */
interface SheetPageSearch {
  projectId?: string
}

/** The props the page hands the sheet workspace, as this render receives them. */
type WorkspaceProps = React.ComponentProps<typeof CanonicalSheetWorkspace>

let mockSearchState: SheetPageSearch = {}

// SAFETY: both slots start empty and every test fills them before it renders;
// the page reads them only after that render.
const mocks = vi.hoisted(() => ({
  workspaceProps: null as WorkspaceProps | null,
  instance: null as SheetInstance | null,
  projectTitle: 'AAV9 transfer',
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route factory binds to the generated route tree at import time; this suite renders the sheet page on its own with the params, search and workspace the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ sheetId: 'sheet-1' }),
    useSearch: () => mockSearchState,
    useRouteContext: () => ({
      context: { user: { id: 'gareth' }, workspace: { id: 'ws' } },
    }),
  }),
  redirect: (options: RedirectOptions) => options,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#link">{children}</a>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The page reads its instance, project and record through the shared query hooks; this render has no server, so the double answers each key the page asks for with the row under test.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof query>()),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data:
      queryKey[0] === 'sheet-instance'
        ? mocks.instance
        : queryKey[0] === 'record' || queryKey[0] === 'project'
          ? { id: 'project-9', title: mocks.projectTitle }
          : null,
  }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The promotions panel runs its own reads and has its own suite; the sheet deep link is this suite's subject.
vi.mock('#/components/sheets/column-promotions-panel', () => ({
  ColumnPromotionsPanel: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The real workspace mounts the grid, its workbook context and its own reads; this suite asserts the props the page hands it, which the double records.
vi.mock('#/components/sheet/canonical-sheet-workspace', () => ({
  CanonicalSheetWorkspace: (props: WorkspaceProps) => {
    mocks.workspaceProps = props

    return <div data-testid="sheet-workspace" />
  },
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The collaboration room opens a live connection, which a jsdom render has no runtime for; the page passes its children straight through.
vi.mock('#/components/collaboration/collaboration-room', () => ({
  CollaborationRoom: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  safeBuildRoomId: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Collaboration is a workspace setting read from the server; the deep link under test behaves identically either way.
vi.mock('#/lib/collaboration/collaboration-enabled', () => ({
  useCollaborationEnabled: () => false,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The page AI hook reads the workspace's assistant settings from the server; the header renders the same without them.
vi.mock('#/lib/use-page-ai', () => ({
  usePageAi: () => ({ available: false, live: false, workspaceId: null }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Recent-view tracking posts to the server from an effect and the page does not read what it records.
vi.mock('#/lib/recents', () => ({ useRecentViewTracking: () => undefined }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- PageHeader draws the shell's chrome, which the router and theme contexts of this render do not provide; the stub renders the title, crumbs and actions the assertions read.
vi.mock('#/components/ui/layout', () => ({
  PageHeader: ({
    title,
    crumbs,
    actions,
  }: {
    title?: React.ReactNode
    crumbs?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <header>
      {crumbs}
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The favourite toggle reads and writes the person's favourites through the shared client and has its own suite; the sheet page is this suite's subject.
vi.mock('#/components/favourites/favourite-toggle', () => ({
  FavouriteToggle: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Toasts are painted by the app shell's Toaster, which this render does not mount; the spy records what the page reported.
vi.mock('#/components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The page's project and record reads run through the module-level notebook client, which builds its transport at import; the double answers the two keys the page asks for.
vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  notebookQueryKeys: {
    project: (id: string) => ['project', id],
    record: (id: string) => ['record', id],
  },
  fetchProject: async () => ({ id: 'project-9', title: 'AAV9 transfer' }),
  fetchRecord: async () => ({ id: 'record-1', title: 'Run 1' }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The instance read runs through the module-level sheet client; the double answers the instance this suite varies between cases.
vi.mock('#/lib/sheet-instance-data', () => ({
  sheetInstanceDataClient: {},
  fetchSheetInstance: async () => mocks.instance,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Identifier resolution asks the server to turn a human identifier into an id; this suite reaches the page with a UUID, as the router does.
vi.mock('#/lib/identifier-resolution', () => ({
  resolveIdentifierParam: async () => undefined,
}))

afterEach(cleanup)

beforeEach(() => {
  mocks.workspaceProps = null
  mocks.instance = {
    id: 'sheet-1',
    workspaceId: 'ws',
    projectId: 'project-9',
    notebookRecordId: null,
    sourceDefinitionVersionId: null,
    name: 'Composed assay sheet',
    description: null,
    lifecycle: 'active',
    revision: 3,
    state: validSheetInstanceState(),
    duplicatedFromInstanceId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    createdByUserId: null,
    updatedByUserId: null,
  } satisfies SheetInstance
})

describe('sheet deep link (NAV-02)', () => {
  it('hands the workspace the instance’s own project when the URL has no projectId', () => {
    mockSearchState = {}

    render(<ComposedSheetRoute />)

    expect(screen.getByTestId('sheet-workspace')).toBeTruthy()
    expect(mocks.workspaceProps?.instanceId).toBe('sheet-1')
    expect(mocks.workspaceProps?.projectId).toBe('project-9')
    // The bug: the deep link forced the workspace read-only.
    expect(mocks.workspaceProps?.readOnly).toBeUndefined()
  })

  it('still uses the URL’s project when the instance carries none', () => {
    mockSearchState = { projectId: 'project-from-url' }
    mocks.instance = { ...mocks.instance!, projectId: null }

    render(<ComposedSheetRoute />)

    expect(mocks.workspaceProps?.projectId).toBe('project-from-url')
    expect(mocks.workspaceProps?.readOnly).toBeUndefined()
  })
})

describe('sheet Share (QA2-sheets-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchState = {}
  })

  function stubClipboard(writeText: () => Promise<void>) {
    const mock = vi.fn(writeText)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mock },
    })

    return mock
  }

  it('copies the deep link and confirms only after the clipboard write succeeds', async () => {
    const writeText = stubClipboard(async () => undefined)

    render(<ComposedSheetRoute />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Link copied'))
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says the copy failed instead of claiming success when the clipboard is blocked', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError')
    })

    render(<ComposedSheetRoute />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast).not.toHaveBeenCalledWith('Link copied')
  })
})
