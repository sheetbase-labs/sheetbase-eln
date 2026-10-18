/**
 * J-DAT-07 / J-DAT-08 — Record reading explains why it cannot save and where
 * to go next, instead of showing a dead form.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './new'
import type * as router from '@tanstack/react-router'

const mocks = vi.hoisted(() => ({
  samples: [] as unknown[],
  datasets: [] as unknown[],
  planned: [] as unknown[],
  fields: [] as unknown[],
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({
      options,
      useSearch: () => ({}),
    }),
    useNavigate: () => vi.fn(),
    Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
      <a href={to}>{children}</a>
    ),
  }
})

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

vi.mock('#/lib/readings-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listReadingSamples: async () => mocks.samples,
  listReadingDatasets: async () => mocks.datasets,
  listReadingPlannedRows: async () => mocks.planned,
  listReadingFields: async () => mocks.fields,
}))

function renderForm() {
  const Form = Route.options.component as React.ComponentType
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Form />
    </QueryClientProvider>,
  )
}

const sample = {
  id: 's1',
  identifier: 'S-1',
  title: 'Lysate',
  project_id: null,
}

afterEach(() => {
  cleanup()
  mocks.samples = []
  mocks.datasets = []
  mocks.planned = []
  mocks.fields = []
})

describe('Record reading — blocked states', () => {
  it('links the empty planned-row state to datasets and explains Save', async () => {
    mocks.samples = [sample]
    renderForm()

    expect(await screen.findByText('No planned rows to fill')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open datasets' }).getAttribute('href'),
    ).toBe('/datasets')
    expect(
      screen.getByText(/until a dataset has a planned row to fill/),
    ).toBeTruthy()
  })

  it('links Register a sample when there are no samples', async () => {
    renderForm()

    const link = await screen.findByRole('link', { name: 'Register a sample' })
    expect(link.getAttribute('href')).toBe('/samples')
    expect(screen.getByText('Choose a sample to record against.')).toBeTruthy()
  })

  it('names who adds fields when the dataset has no numeric field', async () => {
    mocks.samples = [sample]
    mocks.datasets = [
      {
        id: 'd1',
        display_id: 'DS-1',
        name: 'Titre run',
        schema_version_id: 'v1',
        revision: 1,
      },
    ]
    mocks.planned = [
      { id: 'p1', dataset_id: 'd1', planned_key: 'A1', scheduled_at: null },
    ]
    renderForm()

    expect(await screen.findByText('No numeric fields')).toBeTruthy()
    expect(screen.getByText(/A model owner or admin adds fields/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open dataset' }).getAttribute('href'),
    ).toBe('/datasets/$datasetId')
  })
})
