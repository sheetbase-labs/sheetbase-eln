/**
 * SCI-004 chart block preview tests. Verifies the ChartBlockPreview
 * resolves a live dataset through the shared scientific-sheet-data client,
 * surfaces missing-field, empty-dataset, log-scale-invalid and stale
 * states, renders a frozen snapshot without live re-read, and shows
 * loading/permission/empty states, using real query providers and controlled HTTP.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BlockPreview } from './block-preview'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { ResolvedDataset, CanonicalDatasetSource } from '#/lib/chart-data'
import { chartQueryKeys } from '#/lib/chart-data'
import { dropSharedReads } from '#/lib/data-client'
import { CHART_PALETTE } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

let dataset: ResolvedDataset | null = null

beforeEach(() => {
  dropSharedReads()
  dataset = makeResolved()
  transport.mockReset()
  transport.mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  })

  if (dataset)
    client.setQueryData([chartQueryKeys.dataset(TABLE_ID), 0, null], dataset)
  client.setQueryData(
    [
      ...chartQueryKeys.versionRows('22222222-2222-4222-8222-222222222222'),
      1,
      undefined,
    ],
    { rows: [{ c1: 0, c2: 7.2 }], totalCount: 1, matchesProvenance: true },
  )

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  )
}

const TABLE_ID = '00000000-0000-4000-8000-000000000170'

function makeResolved(
  rowsOverrides?: ResolvedDataset['rows'],
  state?: 'ok' | 'empty',
): ResolvedDataset {
  const source: CanonicalDatasetSource = {
    datasetId: TABLE_ID,
    name: 'Stability readings (qPCR)',
    workspaceId: 'ws-1',
    schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
    schemaVersionNumber: 1,
    revision: 1,
    columns: [
      {
        id: 'c1',
        label: 'Time (days)',
        logicalType: 'decimal',
        unit: { symbol: 'd' },
      },
      {
        id: 'c2',
        label: 'Log titer',
        logicalType: 'decimal',
        unit: { symbol: 'log₁₀' },
      },
      { id: 'c3', label: 'Condition', logicalType: 'text' },
    ],
  }

  const rows =
    state === 'empty'
      ? []
      : (rowsOverrides ?? [
          { c1: 0, c2: 7.2, c3: '4 °C' },
          { c1: 28, c2: 5.9, c3: '4 °C' },
          { c1: 0, c2: 7.1, c3: '−20 °C' },
          { c1: 28, c2: 6.4, c3: '−20 °C' },
        ])

  return { source, rows, truncated: false, totalCount: rows.length }
}

function lineSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: 1,
    type: 'line',
    datasets: [{ datasetId: TABLE_ID }],
    fields: {
      x: { fieldId: 'c1' },
      y: { fieldId: 'c2' },
      series: { fieldId: 'c3' },
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
        y: { label: 'Log titer', scale: 'linear', unit: 'log₁₀' },
      },
      series: [
        { identifier: '4 °C', label: '4 °C', color: CHART_PALETTE[0] },
        { identifier: '−20 °C', label: '−20 °C', color: CHART_PALETTE[1] },
      ],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
    ...overrides,
  }
}

function makeBlock(payload: NotebookBlock['payload']): NotebookBlock {
  return {
    id: 'block-chart',
    recordId: 'experiment-1',
    type: 'chart',
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

function mockOkDataset() {
  dataset = makeResolved()
}

describe('ChartBlockPreview — live resolution', () => {
  it('renders a live chart from the resolved dataset', async () => {
    mockOkDataset()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Stability curve',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      // VIEW-01: the RepresentationFrame owns the visible chrome; the inner
      // ChartFrame hides its figcaption (badges included) and keeps only an
      // sr-only title, so the title renders twice but each badge once.
      expect(screen.getAllByText('Stability curve')).toHaveLength(2)
      expect(screen.getByText('Live')).toBeTruthy()
    })
    await waitFor(() => {
      expect(document.querySelector('[role="img"]')).toBeTruthy()
    })
  })

  it('renders a loading state while the dataset resolves', () => {
    dataset = null
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Loading chart',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('renders a permission/error state when the dataset cannot be loaded', async () => {
    dataset = null
    transport.mockRejectedValue(new Error('permission denied'))
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'No access',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByText(/couldn’t be loaded/i)).toBeTruthy()
    })
  })

  it('surfaces a missing-dataset state when no spec is present', () => {
    renderWithQuery(<BlockPreview block={makeBlock({ title: 'Empty' })} />)
    expect(screen.getByText(/No chart configured/i)).toBeTruthy()
  })

  it('surfaces a missing-field state when a bound column is absent', async () => {
    dataset = makeResolved()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Missing field',
          spec: lineSpec({
            fields: {
              x: { fieldId: 'c1' },
              y: { fieldId: 'missing-col' },
              series: null,
              color: null,
              size: null,
              facet: null,
            },
          }),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText(/missing field/i).length).toBeGreaterThan(0)
    })
  })

  it('surfaces an empty-dataset state when filters match no rows', async () => {
    dataset = makeResolved([], 'empty')
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Empty dataset',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText(/no rows to plot/i).length).toBeGreaterThan(0)
    })
  })

  it('surfaces a log-scale-invalid state for non-positive values on a log axis', async () => {
    dataset = makeResolved([{ c1: 0, c2: -1, c3: '4 °C' }])
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Log invalid',
          spec: lineSpec({
            display: {
              ...lineSpec().display,
              axes: {
                x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
                y: { label: 'Log titer', scale: 'log', unit: 'log₁₀' },
              },
            },
          }),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText(/log scale/i).length).toBeGreaterThan(0)
    })
  })

  it('renders the too-large state when the dataset exceeds the client ceiling', async () => {
    dataset = { ...makeResolved(), truncated: true, totalCount: 100001 }
    renderWithQuery(<BlockPreview block={makeBlock({ spec: lineSpec() })} />)
    expect(screen.getByRole('status').textContent).toContain(
      'This dataset has 100,001 rows, above the 100,000-row analysis limit.',
    )
  })
})

describe('ChartBlockPreview — frozen snapshot', () => {
  it('renders a frozen snapshot without live re-read', () => {
    mockOkDataset()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Frozen snapshot',
          spec: lineSpec(),
          frozen: {
            revisionId: null,
            frozenAt: '2025-07-14T10:00:00Z',
            frozenByUserId: 'u1',
            datasetProvenance: [
              {
                datasetId: TABLE_ID,
                schemaVersionNumber: 1,
                rowCount: 2,
                checksum: 'abc12345',
              },
            ],
            data: {
              columns: [
                {
                  fieldId: 'c1',
                  label: 'Time (days)',
                  logicalType: 'decimal',
                  unit: { symbol: 'd' },
                },
                {
                  fieldId: 'c2',
                  label: 'Log titer',
                  logicalType: 'decimal',
                  unit: { symbol: 'log₁₀' },
                },
              ],
              rows: [{ c1: 0, c2: 7.2 }],
              series: [
                {
                  identifier: '4 °C',
                  label: '4 °C',
                  color: CHART_PALETTE[0],
                  points: [{ x: 0, y: 7.2, yError: null, label: '4 °C' }],
                },
              ],
            },
          },
        })}
      />,
    )
    // VIEW-01: the frame owns the visible Snapshot badge; the inner
    // figcaption is hidden when framed, so exactly one badge renders.
    expect(screen.getByText('Snapshot')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    // Frozen path must not call the live dataset resolver.
    expect(transport).not.toHaveBeenCalled()
    expect(document.querySelector('[role="img"]')).toBeTruthy()
  })
})

describe('ChartBlockPreview — NOTE-03 canonical dataset affordances', () => {
  it('offers an Open dataset link built from the spec dataset UUID on a live chart', async () => {
    mockOkDataset()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Live stability',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('Live')).toBeTruthy()
    })
    const open = screen.getByRole('link', { name: 'Open dataset' })
    expect(open.getAttribute('href')).toBe(
      `/datasets/${encodeURIComponent(TABLE_ID)}`,
    )
  })

  it('surfaces the pinned Dataset version and open affordance on a frozen chart', async () => {
    const versionId = '22222222-2222-4222-8222-222222222222'
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Frozen pinned',
          spec: lineSpec(),
          frozen: {
            revisionId: null,
            frozenAt: '2025-07-14T10:00:00Z',
            frozenByUserId: 'u1',
            datasetProvenance: [
              {
                datasetId: TABLE_ID,
                datasetVersionId: versionId,
                schemaVersionNumber: 1,
                rowCount: 1,
                checksum: 'abc12345',
              },
            ],
            data: {
              columns: [],
              rows: [],
              series: [],
            },
          },
        })}
      />,
    )
    // The pinned version is visible at a glance, not only in the sr-only
    // description, and the open affordance targets the canonical Dataset.
    expect(await screen.findByText(/Dataset version 22222222/)).toBeTruthy()
    const open = screen.getByRole('link', { name: 'Open dataset' })
    expect(open.getAttribute('href')).toBe(
      `/datasets/${TABLE_ID}/rows?snapshot=${versionId}`,
    )
    // VIEW-01: the frame owns the visible Snapshot badge; the inner
    // figcaption is hidden when framed, so exactly one badge renders.
    expect(screen.getByText('Snapshot')).toBeTruthy()
  })
})
