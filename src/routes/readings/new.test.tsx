/**
 * J-DAT-07 / J-DAT-08 — Record reading explains why it cannot save and where
 * to go next, instead of showing a dead form.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './new'
import type * as router from '@tanstack/react-router'

const mocks = vi.hoisted(() => ({
  samples: [] as unknown[],
  datasets: [] as unknown[],
  planned: [] as unknown[],
  fields: [] as unknown[],
  search: {},
  submit: vi.fn(async () => ({ ok: true })),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({
      options,
      useSearch: () => mocks.search,
    }),
    useNavigate: () => mocks.navigate,
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
  submitBenchReading: mocks.submit,
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
  mocks.search = {}
  vi.clearAllMocks()
})

describe('Record reading — blocked states', () => {
  it('fills the handed-over plan with its derived sample, returns to the value, and refuses an already-filled link', async () => {
    const user = userEvent.setup()
    mocks.samples = [sample, { ...sample, id: 'derived', identifier: 'S-2' }]
    mocks.datasets = [
      {
        id: 'd1',
        display_id: 'DS-1',
        name: 'Titre run',
        schema_version_id: 'v1',
        revision: 7,
      },
    ]
    mocks.planned = [
      { id: 'other', dataset_id: 'd1', planned_key: 'A1', sample_id: 's1' },
      {
        id: 'repeat',
        dataset_id: 'd1',
        planned_key: 'repeat:derived:1',
        sample_id: 'derived',
        measurement_field_id: 'titre',
      },
    ]
    mocks.fields = [
      {
        field_id: 'titre',
        key: 'titre',
        label: 'Titre',
        logical_type: 'decimal',
        nullable: true,
      },
    ]
    mocks.search = {
      sample: 'derived',
      dataset: 'd1',
      plannedKey: 'repeat:derived:1',
      returnTo: '/datasets/d1/rows?row=source&field=titre&live=true',
    }
    renderForm()
    await waitFor(() =>
      expect(screen.getByLabelText(/^Sample/).textContent).toContain('S-2'),
    )
    expect(screen.getByLabelText<HTMLButtonElement>(/^Sample/).disabled).toBe(
      true,
    )
    await user.type(screen.getByLabelText(/^Value/), '3.75')
    await user.click(screen.getByRole('button', { name: 'Save reading' }))
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          datasetId: 'd1',
          plannedKey: 'repeat:derived:1',
          expectedRevision: 7,
          measurementValue: 3.75,
          sample: { id: 'derived', identifier: 'S-2' },
        }),
      ),
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/datasets/d1/rows?row=source&field=titre&live=true',
    })
    cleanup()
    mocks.planned = [mocks.planned[0]]
    renderForm()
    await screen.findByText(/This planned row is no longer available/)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Save reading',
      }).disabled,
    ).toBe(true)
  })

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
    expect(screen.getByText('Choose a sample to record against')).toBeTruthy()
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
    expect(screen.getByText(/A model owner or admin can add fields/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open dataset' }).getAttribute('href'),
    ).toBe('/datasets/$datasetId')
  })

  it('reads the sample, dataset and return path handed over by the linking page', () => {
    const validate = (
      Route.options as unknown as {
        validateSearch: (search: Record<string, unknown>) => unknown
      }
    ).validateSearch
    expect(
      validate({
        sample: 's1',
        dataset: 'd1',
        returnTo: '/experiments/e1/results',
        project: 'ignored',
      }),
    ).toEqual({
      sample: 's1',
      dataset: 'd1',
      returnTo: '/experiments/e1/results',
    })
    // A return path must stay inside the app.
    expect(validate({ returnTo: 'https://example.com' })).toEqual({})
  })
})
