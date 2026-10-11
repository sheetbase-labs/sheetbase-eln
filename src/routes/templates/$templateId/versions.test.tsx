/**
 * R5-CONFIG-04 — the Versions tab: the per-version change set read from the
 * stored definitions, the signature list, the records-on-this-version split,
 * and the stale-publish refusal. `?state=denied` stays view-only. The four
 * acceptance states (populated, empty, denied, stale) are driven over the real
 * fetch/parse path with a mocked /api/db client.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './versions'
import { DataClientError } from '#/lib/data-client'
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

vi.mock('#/components/v3/ui/sonner', () => ({ toast: vi.fn() }))

const client = vi.hoisted(() => ({ list: vi.fn(), rpc: vi.fn() }))
const publish = vi.hoisted(() => vi.fn())
vi.mock('#/lib/notebook-template-data', async (importOriginal) => ({
  ...(await importOriginal<typeof NotebookTemplateData>()),
  notebookTemplateDataClient: client,
  publishNotebookTemplateVersion: publish,
}))

interface PlaceholderPlacement {
  id: string
  kind: 'section_placeholder'
  order: number
  key: string
  label: string
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const TPL = uuid(9)
const V1 = uuid(1)
const V2 = uuid(2)
const V3 = uuid(3)

function placeholder(
  id: string,
  order: number,
  label: string,
): PlaceholderPlacement {
  return { id, kind: 'section_placeholder', order, key: `k${order}`, label }
}

function configuration(placements: PlaceholderPlacement[]) {
  return { formatVersion: 1, parameters: [], placements }
}

function versionWire(overrides: Record<string, unknown> = {}) {
  return {
    id: V1,
    template_id: TPL,
    version: 1,
    lifecycle: 'published',
    configuration_format_version: 1,
    configuration: configuration([placeholder(uuid(21), 1, 'A')]),
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    published_at: '2026-01-02T00:00:00.000Z',
    published_by_user_id: 'user-9',
    reason: 'Initial',
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
    project_id: uuid(41),
    created_by_user_id: 'user-1',
    created_at: '2026-01-03T00:00:00.000Z',
    updated_at: '2026-01-03T00:00:00.000Z',
    ...overrides,
  }
}

const VERSION_1 = versionWire({ id: V1, version: 1 })
const VERSION_2 = versionWire({
  id: V2,
  version: 2,
  configuration: configuration([
    placeholder(uuid(21), 1, 'A'),
    placeholder(uuid(22), 2, 'B'),
  ]),
})
const VERSION_3_DRAFT = versionWire({
  id: V3,
  version: 3,
  lifecycle: 'draft',
  revision: 1,
  published_at: null,
  published_by_user_id: null,
  reason: null,
})

function withData(
  versions: Record<string, unknown>[],
  records: RecordWire[] = [],
) {
  client.list.mockImplementation((resource: string) => {
    if (resource === 'notebook_template_versions')
      return Promise.resolve(versions)
    if (resource === 'records') return Promise.resolve(records)
    if (resource === 'projects') return Promise.resolve([])
    return Promise.resolve([])
  })
}

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
  publish.mockReset()
})

describe('Template versions', () => {
  it('shows the change set, signatures and record split for the populated state', async () => {
    withData([VERSION_2, VERSION_1], [recordWire()])
    renderRoute()

    // Change set of the selected (current) version against the one before it.
    expect(await screen.findByText('Changes since v1')).toBeTruthy()
    const changes = screen.getByRole('table', { name: 'Changes in version 2' })
    const added = within(changes)
      .getAllByRole('row')
      .find((row) => row.textContent.includes('Section · B'))
    expect(added?.textContent).toContain('Added')

    // Signatures list names the publisher of the selected version.
    const signatures = screen.getByText('Signatures').closest('section')
    if (!signatures) throw new Error('Signature section required')
    expect(within(signatures).getByText(/user-9/)).toBeTruthy()
    expect(within(signatures).getByText(/No signature recorded/)).toBeTruthy()

    // Records-on-this-version split.
    const total = screen.getByText('Total').parentElement
    if (!total) throw new Error('Record total required')
    expect(await within(total).findByText('1')).toBeTruthy()
  })

  it('shows the empty state when the template has no versions', async () => {
    withData([])
    renderRoute()
    expect(await screen.findByText('No versions yet')).toBeTruthy()
  })

  it('shows the view-only banner in the denied state', async () => {
    router.search = { state: 'denied' }
    withData([VERSION_2, VERSION_1])
    renderRoute()
    expect(
      await screen.findByText(/Only template owners and QA can publish/),
    ).toBeTruthy()
  })

  it('refuses a publish on a stale view and offers a reload', async () => {
    const user = userEvent.setup()
    router.search = { v: V3 }
    withData([VERSION_3_DRAFT, VERSION_2, VERSION_1])
    publish.mockRejectedValue(
      new DataClientError(
        'SB001',
        'stale Notebook Template Version revision',
        409,
      ),
    )
    renderRoute()

    await user.click(await screen.findByRole('button', { name: 'Publish v3…' }))
    await user.type(
      screen.getByPlaceholderText('e.g. Adds the stability timepoints'),
      'Adds a step',
    )
    await user.click(screen.getByRole('button', { name: 'Publish v3' }))

    expect(await screen.findByText(/publish was refused/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(
      screen.getByText('Reload the draft before you publish.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Publish v3…' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(publish).toHaveBeenCalledWith(V3, 1, 'Adds a step')
  })
})
