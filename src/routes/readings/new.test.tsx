/**
 * J-DAT-07 / J-DAT-08 — Record reading explains why it cannot save and where
 * to go next, instead of showing a dead form.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type {
  ReadingDatasetWire,
  ReadingFieldWire,
  ReadingPlannedRowWire,
  ReadingSampleWire,
} from '#/lib/readings-data'

interface Fixtures {
  samples: ReadingSampleWire[]
  datasets: ReadingDatasetWire[]
  planned: ReadingPlannedRowWire[]
  fields: ReadingFieldWire[]
  commits: z.infer<typeof commitRowSchema>[]
}

const fixtures: Fixtures = {
  samples: [],
  datasets: [],
  planned: [],
  fields: [],
  commits: [],
}

/** The reading form's planned row, committed through the canonical batch RPC. */
const commitRowSchema = z.looseObject({
  p_dataset_id: z.string(),
  p_expected_dataset_revision: z.number(),
  p_rows: z.array(
    z.looseObject({
      operation: z.string(),
      plannedKey: z.string(),
      values: z.record(z.string(), z.union([z.string(), z.number()])),
    }),
  ),
  p_idempotency_key: z.string(),
})

const fixtureFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    new URL(input instanceof Request ? input.url : input, 'http://localhost'),
    init,
  )

  const { pathname, searchParams } = new URL(request.url)

  switch (pathname) {
    case '/api/db/records': {
      const id = searchParams.get('id')?.replace(/^eq\./, '')

      return Response.json(
        id ? fixtures.samples.filter((row) => row.id === id) : fixtures.samples,
      )
    }

    case '/api/db/datasets':
      return Response.json(fixtures.datasets)

    case '/api/db/reading_planned_rows':
      return Response.json(fixtures.planned)

    case '/api/db/dataset_schema_version_fields':
      return Response.json(fixtures.fields)

    case '/api/db/rpc/commit_dataset_row_batch': {
      const body = commitRowSchema.parse(await request.json())

      fixtures.commits.push(body)

      return Response.json({
        ok: true,
        datasetId: body.p_dataset_id,
        datasetRevision: body.p_expected_dataset_revision + 1,
      })
    }
  }

  throw new Error(`Unexpected request: ${request.method} ${request.url}`)
}

// Keep the Router, Query and the singleton DataClient real; fixture only HTTP.
vi.stubGlobal('fetch', fixtureFetch)

const { Route } = await import('./new')
const { dropSharedReads } = await import('#/lib/data-client')

const sample: ReadingSampleWire = {
  id: 's1',
  identifier: 'S-1',
  title: 'Lysate',
  project_id: null,
}

beforeEach(() => {
  fixtures.samples = []
  fixtures.datasets = []
  fixtures.planned = []
  fixtures.fields = []
  fixtures.commits = []
})

afterEach(() => {
  cleanup()
  dropSharedReads()
})

afterEach(() => vi.unstubAllGlobals())

/** The reading page under a real router, so its search and navigation are real. */
async function renderForm(entry = '/readings/new') {
  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        auth: {
          workspace: { id: 'ws' },
          user: { id: 'u1', name: 'Scientist' },
        },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/readings/new',
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
    history: createMemoryHistory({ initialEntries: [entry] }),
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  await router.load()

  return {
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  }
}

describe('Record reading — blocked states', () => {
  it('fills the handed-over plan with its derived sample, returns to the value, and refuses an already-filled link', async () => {
    const user = userEvent.setup()
    const returnTo = '/datasets/d1/rows?row=source&field=titre&live=true'
    fixtures.samples = [sample, { ...sample, id: 'derived', identifier: 'S-2' }]
    fixtures.datasets = [
      {
        id: 'd1',
        display_id: 'DS-1',
        name: 'Titre run',
        schema_version_id: 'v1',
        revision: 7,
      },
    ]
    fixtures.planned = [
      {
        id: 'other',
        dataset_id: 'd1',
        planned_key: 'A1',
        scheduled_at: null,
        sample_id: 's1',
        measurement_field_id: null,
      },
      {
        id: 'repeat',
        dataset_id: 'd1',
        planned_key: 'repeat:derived:1',
        scheduled_at: null,
        sample_id: 'derived',
        measurement_field_id: 'titre',
      },
    ]
    fixtures.fields = [
      {
        field_id: 'titre',
        key: 'titre',
        label: 'Titre',
        logical_type: 'decimal',
        nullable: true,
        display_order: 1,
        quantity: null,
        validation: null,
        relationship: null,
      },
      {
        field_id: 'sample',
        key: 'sample',
        label: 'Sample',
        logical_type: 'reference',
        nullable: true,
        display_order: 2,
        quantity: null,
        validation: null,
        relationship: { target: { modelKey: 'sample' } },
      },
    ]

    const { router, unmount } = await renderForm(
      `/readings/new?sample=derived&dataset=d1&plannedKey=repeat:derived:1&returnTo=${encodeURIComponent(returnTo)}`,
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/^Sample/).textContent).toContain('S-2'),
    )
    expect(screen.getByLabelText<HTMLButtonElement>(/^Sample/).disabled).toBe(
      true,
    )
    await user.type(screen.getByLabelText(/^Value/), '3.75')
    await user.click(screen.getByRole('button', { name: 'Save reading' }))
    await waitFor(() => expect(fixtures.commits).toHaveLength(1))
    expect(fixtures.commits[0]).toMatchObject({
      p_dataset_id: 'd1',
      p_expected_dataset_revision: 7,
      p_rows: [
        {
          operation: 'create',
          plannedKey: 'repeat:derived:1',
          values: { titre: 3.75, sample: 'derived' },
        },
      ],
    })
    await waitFor(() => expect(router.state.location.href).toBe(returnTo))

    unmount()
    dropSharedReads()
    fixtures.planned = [fixtures.planned[0]]
    await renderForm('/readings/new?dataset=d1&plannedKey=repeat:derived:1')
    await screen.findByText(/This planned row is no longer available/)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Save reading',
      }).disabled,
    ).toBe(true)
  })

  it('links the empty planned-row state to datasets and explains Save', async () => {
    fixtures.samples = [sample]
    await renderForm()

    expect(await screen.findByText('No planned rows to fill')).toBeTruthy()
    expect(
      screen.getByText('Open datasets').closest('a')?.getAttribute('href'),
    ).toBe('/datasets?tab=issues')
    expect(
      screen.getByText(/until a dataset has a planned row to fill/),
    ).toBeTruthy()
  })

  it('links Register a sample when there are no samples', async () => {
    await renderForm()

    const link = await screen.findByRole('link', { name: 'Register a sample' })
    expect(link.getAttribute('href')).toBe('/samples')
    expect(screen.getByText('Choose a sample to record against')).toBeTruthy()
  })

  it('names who adds fields when the dataset has no numeric field', async () => {
    fixtures.samples = [sample]
    fixtures.datasets = [
      {
        id: 'd1',
        display_id: 'DS-1',
        name: 'Titre run',
        schema_version_id: 'v1',
        revision: 1,
      },
    ]
    fixtures.planned = [
      {
        id: 'p1',
        dataset_id: 'd1',
        planned_key: 'A1',
        scheduled_at: null,
        sample_id: null,
        measurement_field_id: null,
      },
    ]
    await renderForm()

    expect(await screen.findByText('No numeric fields')).toBeTruthy()
    expect(
      screen.getByText(/A model owner or admin can add fields/),
    ).toBeTruthy()
    expect(
      screen.getByText('Open dataset').closest('a')?.getAttribute('href'),
    ).toBe('/datasets/d1')
  })

  it('reads the sample, dataset and return path handed over by the linking page', () => {
    // The route declares a plain validator; TanStack's option type also admits
    // a parse/stringify object, so the shape is checked here rather than assumed.
    const validateSearch = z
      .function({
        input: [z.record(z.string(), z.unknown())],
        output: z.json(),
      })
      .parse(Route.options.validateSearch)

    expect(
      validateSearch({
        sample: 's1',
        dataset: 'd1',
        returnTo: '/experiments/e1/data/results',
        project: 'ignored',
      }),
    ).toEqual({
      sample: 's1',
      dataset: 'd1',
      returnTo: '/experiments/e1/data/results',
    })

    // A return path must stay inside the app.
    expect(validateSearch({ returnTo: 'https://example.com' })).toEqual({})
  })
})
