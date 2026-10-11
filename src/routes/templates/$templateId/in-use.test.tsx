/**
 * R5-CONFIG-04 — the In-use tab: the records-by-version matrix, the project
 * filter that was parsed but unused, the stale (records-behind) banner, and the
 * hidden-record (denied) state. The route reads the version/governance records
 * unchanged; these tests drive the four acceptance states over the real
 * fetch/parse path with a mocked /api/db client.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './in-use'
import type * as NotebookTemplateData from '#/lib/notebook-template-data'

const router = vi.hoisted(() => {
  const search: Record<string, unknown> = {}
  return { search, navigate: vi.fn() }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ templateId: 'tpl-1' }),
    useSearch: () => router.search,
    useNavigate: () => router.navigate,
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => router.navigate,
}))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id, names: {} }),
}))

const client = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))
vi.mock('#/lib/notebook-template-data', async (importOriginal) => ({
  ...(await importOriginal<typeof NotebookTemplateData>()),
  notebookTemplateDataClient: client,
}))

type VersionWire = Record<string, unknown>

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const TPL = uuid(9)
const V1 = uuid(1)
const V2 = uuid(2)
const PRJ1 = uuid(11)
const PRJ2 = uuid(12)

function versionWire(overrides: VersionWire = {}): VersionWire {
  return {
    id: V1,
    template_id: TPL,
    version: 1,
    lifecycle: 'published',
    configuration_format_version: 1,
    configuration: {
      formatVersion: 1,
      parameters: [],
      placements: [
        {
          id: uuid(21),
          kind: 'section_placeholder',
          order: 1,
          key: 'a',
          label: 'A',
        },
      ],
    },
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    published_at: '2026-01-02T00:00:00.000Z',
    published_by_user_id: null,
    reason: null,
    signed_by_user_id: null,
    signed_meaning: null,
    signed_at: null,
    retired_at: null,
    retired_by_user_id: null,
    ...overrides,
  }
}

interface RecordWire {
  id: string
  identifier: string
  title: string
  source_notebook_template_version_id: string | null
  status: string
  locked_at: string | null
  project_id: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

function recordWire(overrides: Partial<RecordWire> = {}): RecordWire {
  return {
    id: uuid(31),
    identifier: 'EXP-1',
    title: 'Run one',
    source_notebook_template_version_id: V2,
    status: 'in_progress',
    locked_at: null,
    project_id: PRJ1,
    created_by_user_id: 'user-1',
    created_at: '2026-01-03T00:00:00.000Z',
    updated_at: '2026-01-03T00:00:00.000Z',
    ...overrides,
  }
}

const VERSIONS = [
  versionWire({ id: V2, version: 2 }),
  versionWire({ id: V1, version: 1, lifecycle: 'retired' }),
]

const PROJECTS = [
  { id: PRJ1, title: 'Stability' },
  { id: PRJ2, title: 'Assay' },
]

function renderRoute() {
  const Component = Route.options.component as React.ComponentType
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  router.search = {}
  client.list.mockReset()
  client.rpc.mockReset()
})

function withRecords(records: RecordWire[]) {
  client.list.mockImplementation((resource: string) => {
    if (resource === 'notebook_template_versions')
      return Promise.resolve(VERSIONS)
    if (resource === 'records') return Promise.resolve(records)
    if (resource === 'projects') return Promise.resolve(PROJECTS)
    return Promise.resolve([])
  })
}

describe('Template in-use', () => {
  it('shows the records-by-version matrix for the populated state', async () => {
    withRecords([
      recordWire({ id: 'rec-1', identifier: 'EXP-1' }),
      recordWire({
        id: 'rec-2',
        identifier: 'EXP-2',
        source_notebook_template_version_id: V1,
        status: 'in_review',
      }),
    ])
    renderRoute()

    const matrix = await screen.findByRole('table', {
      name: 'Records by version',
    })
    const rows = within(matrix).getAllByRole('row')
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['v2current', '1', '0', '0', '1'])
    expect(
      within(rows[2])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['v1', '0', '1', '0', '1'])
    expect(await screen.findByText('EXP-1')).toBeTruthy()
    expect(screen.getByText('EXP-2')).toBeTruthy()
    // Project names resolve for the rows, not the raw ids.
    expect(screen.getAllByText('Stability').length).toBeGreaterThan(0)
  })

  it('shows the empty state when no record uses the template', async () => {
    withRecords([])
    renderRoute()
    expect(
      await screen.findByText('No records use this template yet'),
    ).toBeTruthy()
  })

  it('states the hidden-record behaviour in the denied state', async () => {
    router.search = { state: 'denied' }
    withRecords([recordWire()])
    renderRoute()
    const banner = await screen.findByText(/not a member of the project/)
    expect(banner.textContent).toContain('You can see 1 record')
  })

  it('banners the in-use set that is behind the current version', async () => {
    withRecords([
      recordWire({
        id: 'rec-1',
        identifier: 'EXP-1',
        source_notebook_template_version_id: V1,
      }),
      recordWire({ id: 'rec-2', identifier: 'EXP-2' }),
    ])
    renderRoute()
    const banner = await screen.findByText(/on older\s+versions/)
    expect(banner.textContent).toContain('1 can move to v2 now')
  })

  it('wires the project filter to the records shown', async () => {
    router.search = { project: PRJ2 }
    withRecords([
      recordWire({ id: 'rec-1', identifier: 'EXP-1', project_id: PRJ1 }),
      recordWire({ id: 'rec-2', identifier: 'EXP-2', project_id: PRJ2 }),
    ])
    renderRoute()

    expect(await screen.findByLabelText('Filter by project')).toHaveProperty(
      'value',
      PRJ2,
    )
    expect(await screen.findByText('EXP-2')).toBeTruthy()
    expect(screen.queryByText('EXP-1')).toBeNull()
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  it('wires the version filter to the record groups', async () => {
    router.search = { version: V1 }
    withRecords([
      recordWire({ id: 'rec-1', identifier: 'EXP-1' }),
      recordWire({
        id: 'rec-2',
        identifier: 'EXP-2',
        source_notebook_template_version_id: V1,
      }),
    ])
    renderRoute()

    expect(
      await screen.findByRole('table', { name: 'Records on version 1' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('table', { name: 'Records on version 2' }),
    ).toBeNull()
  })
})
