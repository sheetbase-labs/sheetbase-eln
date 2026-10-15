/**
 * NAV-02 regression: a Sheet deep link opens the instance's own project and is
 * editable. The route used to read the project from the `projectId` search
 * param only, so a link without one (the common case — Share copies the URL)
 * handed the workspace no project *and* forced `readOnly`, which meant the
 * Sheet opened read-only with no way to write it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '#/components/v3/ui/sonner'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'

import { ComposedSheetRoute } from './$sheetId'

let mockSearchState: Record<string, unknown> = {}

const mocks = vi.hoisted(() => ({
  workspaceProps: null as null | Record<string, unknown>,
  instance: null as null | Record<string, unknown>,
  projectTitle: 'AAV9 transfer',
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ sheetId: 'sheet-1' }),
    useSearch: () => mockSearchState,
    useRouteContext: () => ({
      context: { user: { id: 'gareth' }, workspace: { id: 'ws' } },
    }),
  }),
  redirect: (options: unknown) => options,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#link">{children}</a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data:
      queryKey[0] === 'sheet-instance'
        ? mocks.instance
        : queryKey[0] === 'record' || queryKey[0] === 'project'
          ? { id: 'project-9', title: mocks.projectTitle }
          : null,
  }),
}))

vi.mock('#/components/sheet/canonical-sheet-workspace', () => ({
  CanonicalSheetWorkspace: (props: Record<string, unknown>) => {
    mocks.workspaceProps = props
    return <div data-testid="sheet-workspace" />
  },
}))

vi.mock('#/components/collaboration/collaboration-room', () => ({
  CollaborationRoom: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  safeBuildRoomId: () => null,
}))

vi.mock('#/lib/collaboration/liveblocks.config', () => ({
  useCollaborationEnabled: () => false,
}))

vi.mock('#/lib/recents', () => ({ useRecentViewTracking: () => undefined }))

vi.mock('#/components/v3/ui/layout', () => ({
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

vi.mock('#/components/favourites/favourite-toggle', () => ({
  FavouriteToggle: () => null,
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {},
  notebookQueryKeys: {
    project: (id: string) => ['project', id],
    record: (id: string) => ['record', id],
  },
  fetchProject: async () => ({ id: 'project-9', title: 'AAV9 transfer' }),
  fetchRecord: async () => ({ id: 'record-1', title: 'Run 1' }),
}))

vi.mock('#/lib/sheet-instance-data', () => ({
  sheetInstanceDataClient: {},
  fetchSheetInstance: async () => mocks.instance,
}))

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
