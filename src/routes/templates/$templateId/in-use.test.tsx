/**
 * R5-CONFIG-04 — the In-use tab: the records-by-version matrix, the project
 * filter that was parsed but unused, the stale (records-behind) banner, and the
 * hidden-record (denied) state. The route reads the version/governance records
 * unchanged; these tests drive the four acceptance states over the real
 * fetch/parse path with a fixture HTTP transport.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'

import { dropSharedReads } from '#/lib/data-client'
import type { notebookTemplateVersionWireSchema } from '#/lib/notebook-template-data'

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const TPL = uuid(9)
const V1 = uuid(1)
const V2 = uuid(2)
const PRJ1 = uuid(11)
const PRJ2 = uuid(12)

type VersionWire = z.input<typeof notebookTemplateVersionWireSchema>

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

interface Fixtures {
  versions: VersionWire[]
  records: RecordWire[]
  projects: { id: string; title: string }[]
  madeCount: number
}

const fixtures: Fixtures = {
  versions: [],
  records: [],
  projects: [],
  madeCount: 0,
}

/** Keep the compiled DataClient real; fixture only the HTTP it sends. */
const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname, searchParams } = new URL(request.url)

  switch (pathname) {
    case '/api/db/notebook_template_versions':
      return Response.json(fixtures.versions)

    case '/api/db/reading_planned_rows':
      return Response.json([])

    case '/api/db/records': {
      const offset = Number(searchParams.get('offset') ?? 0)

      return Response.json(
        fixtures.records.slice(offset, offset + TEMPLATE_USERS_PAGE_SIZE),
      )
    }

    case '/api/db/projects':
      return Response.json(fixtures.projects)

    case '/api/db/notebook_template_instantiations':
      return new Response('[]', {
        headers: {
          'content-type': 'application/json',
          'content-range': `0-0/${fixtures.madeCount}`,
        },
      })

    default:
      // User names resolve through the server-function endpoint; ids stand in.
      return Response.json({})
  }
}

vi.stubGlobal('fetch', fixtureFetch)

const { TEMPLATE_USERS_PAGE_SIZE } =
  await import('#/components/templates/templates-data')

const { Route } = await import('./in-use')

function versionWire(overrides: Partial<VersionWire> = {}): VersionWire {
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

function resetFixtures() {
  fixtures.versions = [
    versionWire({ id: V2, version: 2 }),
    versionWire({ id: V1, version: 1, lifecycle: 'retired' }),
  ]
  fixtures.records = []
  fixtures.projects = [
    { id: PRJ1, title: 'Stability' },
    { id: PRJ2, title: 'Assay' },
  ]
  fixtures.madeCount = 0
}

/**
 * `madeCount` is the workspace-wide count of records made from the template's
 * versions (`notebook_template_instantiations`), which is higher than the rows
 * the viewer can list whenever some sit in projects they cannot open. It
 * defaults to the rows themselves: nothing proven hidden.
 */
function withRecords(records: RecordWire[], madeCount = records.length) {
  fixtures.records = records
  fixtures.madeCount = madeCount
}

afterEach(() => {
  cleanup()
  dropSharedReads()
})

beforeEach(() => {
  resetFixtures()
  dropSharedReads()
})

async function renderRoute(search = '') {
  const root = createRootRoute()

  const route = createRoute({
    getParentRoute: () => root,
    path: '/templates/$templateId/in-use',
    component: Route.options.component,
    validateSearch: Route.options.validateSearch,
  })

  const elsewhere = createRoute({
    getParentRoute: () => root,
    path: '$',
    component: () => null,
  })

  const router = createRouter({
    routeTree: root.addChildren([route, elsewhere]),
    history: createMemoryHistory({
      initialEntries: [`/templates/tpl-1/in-use${search}`],
    }),
  })

  await router.load()

  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
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
    await renderRoute()

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
    await renderRoute()
    expect(
      await screen.findByText('No records use this template yet'),
    ).toBeTruthy()
  })

  it('states the hidden-record behaviour in the denied state', async () => {
    withRecords([recordWire()])
    await renderRoute('?state=denied')
    const banner = await screen.findByText(/not a member of the project/)
    expect(banner.textContent).toContain('You can see 1 record')
  })

  it('names the records it cannot show when the workspace count proves them', async () => {
    // Three records were made from these versions, only one is in a project
    // this viewer can open: the row set alone cannot say that, the
    // workspace-scoped instantiation count can, and no URL flag is involved.
    withRecords([recordWire()], 3)
    await renderRoute()
    const banner = await screen.findByText(/aren’t listed here/)
    expect(banner.textContent).toContain('2 records made from this template')
    expect(banner.textContent).toContain('You can see 1 record')
  })

  it('does not claim hidden records the row set cannot prove', async () => {
    withRecords([recordWire()], 1)
    await renderRoute('?state=denied')
    const banner = await screen.findByText(/not a member of the project/)
    expect(banner.textContent).not.toMatch(
      /\d+ records? made from this template/,
    )
  })

  it('says access, not absence, when every record is in a project the viewer cannot open', async () => {
    withRecords([], 2)
    await renderRoute()
    expect(
      await screen.findByText('No records you can access yet'),
    ).toBeTruthy()
    expect(screen.queryByText('No records use this template yet')).toBeNull()
  })

  it('counts records past the first page of the query', async () => {
    const firstPage = Array.from(
      { length: TEMPLATE_USERS_PAGE_SIZE },
      (_, index) =>
        recordWire({
          id: `rec-${index}`,
          identifier: `EXP-${index}`,
          status: 'in_progress',
        }),
    )

    const lastPage = [
      recordWire({
        id: 'rec-last',
        identifier: 'EXP-last',
        status: 'in_review',
      }),
    ]

    withRecords([...firstPage, ...lastPage], TEMPLATE_USERS_PAGE_SIZE + 1)
    await renderRoute()

    const matrix = await screen.findByRole('table', {
      name: 'Records by version',
    })

    const rows = within(matrix).getAllByRole('row')
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['v2current', '200', '1', '0', '201'])
    expect(
      screen.getByText('201 records in total · 0 signed · 1 in review.'),
    ).toBeTruthy()
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
    await renderRoute()
    const banner = await screen.findByText(/older\s+versions?/)
    expect(banner.textContent).toContain('1 can move to v2 now')
  })

  it('wires the project filter to the records shown', async () => {
    withRecords([
      recordWire({ id: 'rec-1', identifier: 'EXP-1', project_id: PRJ1 }),
      recordWire({ id: 'rec-2', identifier: 'EXP-2', project_id: PRJ2 }),
    ])
    await renderRoute(`?project=${PRJ2}`)

    expect(await screen.findByLabelText('Filter by project')).toHaveProperty(
      'value',
      PRJ2,
    )
    expect(await screen.findByText('EXP-2')).toBeTruthy()
    expect(screen.queryByText('EXP-1')).toBeNull()
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  it('wires the version filter to the record groups', async () => {
    withRecords([
      recordWire({ id: 'rec-1', identifier: 'EXP-1' }),
      recordWire({
        id: 'rec-2',
        identifier: 'EXP-2',
        source_notebook_template_version_id: V1,
      }),
    ])
    await renderRoute(`?version=${V1}`)

    expect(
      await screen.findByRole('table', { name: 'Records on version 1' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('table', { name: 'Records on version 2' }),
    ).toBeNull()
  })
})
