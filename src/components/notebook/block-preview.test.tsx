import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockPreview } from './block-preview'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'

afterEach(() => cleanup())

function renderWithQuery(
  ui: ReactNode,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  }),
) {
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

const block = (type: string, payload: NotebookBlock['payload']) => ({
  id: 'b1',
  recordId: 'r1',
  type,
  payload,
  payloadSchemaVersion: 1,
  order: 1,
  version: 1,
})

describe('BlockPreview callout (SCI-009 contract fix)', () => {
  it('renders the validated text/variant payload, not body/tone', () => {
    render(
      <BlockPreview
        block={block('callout', {
          text: 'Include a no-template control (NTC) in every qPCR run.',
          variant: 'warning',
        })}
      />,
    )
    expect(
      screen.getByText(
        'Include a no-template control (NTC) in every qPCR run.',
      ),
    ).toBeTruthy()
  })

  it('applies the warning variant styling', () => {
    const { container } = render(
      <BlockPreview
        block={block('callout', { text: 'Heads up', variant: 'warning' })}
      />,
    )

    // Warning callouts use a semantic warning background tint.
    const callout = container.querySelector('[class*="bg-warning"]')
    expect(callout).toBeTruthy()
  })

  it('renders the info variant with primary styling', () => {
    const { container } = render(
      <BlockPreview
        block={block('callout', { text: 'FYI', variant: 'info' })}
      />,
    )

    // Info callouts use a semantic info background tint.
    const callout = container.querySelector('[class*="bg-info"]')
    expect(callout).toBeTruthy()
  })

  it('renders nothing for the legacy body/tone payload shape', () => {
    const { container } = render(
      <BlockPreview block={block('callout', { body: 'old', tone: 'info' })} />,
    )

    // The renderer now reads text/variant; a payload without `text` renders
    // an empty callout body, confirming the old shape is no longer honoured.
    expect(container.textContent).not.toContain('old')
  })
})

describe('BlockPreview frozen evidence boundary', () => {
  it.each(['chart', 'analysis'])(
    'does not read live data for a malformed frozen %s',
    (type) => {
      // No QueryClient is installed. Falling through to a live query would throw,
      // rather than silently replacing historical evidence with today's rows.
      render(
        <BlockPreview
          block={block(type, {
            definitionId: 'saved-definition',
            spec: { specVersion: 1 },
            frozen: { frozenAt: '2026-08-23T10:00:00Z' },
          })}
        />,
      )
      expect(screen.getByRole('alert').textContent).toContain(
        'Frozen dataset version couldn’t be reconstructed.',
      )
    },
  )
})

describe('BlockPreview table (canonical string-array payload)', () => {
  it('preserves distinct row identity when an earlier row disappears without collapsing repeated rows or columns', () => {
    const columns = ['Recovery', 'Recovery']

    const view = render(
      <BlockPreview
        block={block('table', {
          columns,
          rows: [
            [9, 8],
            [5.75, false],
            [5.75, false],
          ],
        })}
      />,
    )

    const before = screen.getAllByRole('row')
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(screen.getAllByText('5.75')).toHaveLength(2)
    view.rerender(
      <BlockPreview
        block={block('table', {
          columns,
          rows: [
            [5.75, false],
            [5.75, false],
          ],
        })}
      />,
    )
    const after = screen.getAllByRole('row')
    expect(after).toHaveLength(3)
    expect(after[1]).toBe(before[2])
    expect(after[2]).toBe(before[3])
    expect(screen.getAllByText('5.75')).toHaveLength(2)
  })

  it('renders column labels and row values from the canonical format', () => {
    render(
      <BlockPreview
        block={block('table', {
          columns: ['Timepoint', 'Replicate', 'Volume'],
          rows: [
            [0, 1, 100],
            [28, 1, 100],
          ],
        })}
      />,
    )
    expect(screen.getByText('Timepoint')).toBeTruthy()
    expect(screen.getByText('Replicate')).toBeTruthy()
    expect(screen.getByText('Volume')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByText('28')).toBeTruthy()
  })

  it('renders an empty body for null cells', () => {
    const { container } = render(
      <BlockPreview
        block={block('table', {
          columns: ['A', 'B'],
          rows: [[null, 'x']],
        })}
      />,
    )

    const cells = container.querySelectorAll('tbody td')
    expect(cells).toHaveLength(2)
    expect(cells[0].textContent).toBe('')
    expect(cells[1].textContent).toBe('x')
  })

  it('puts the table in a box that scrolls sideways on narrow screens', () => {
    renderWithQuery(
      <BlockPreview
        block={block('table', {
          columns: ['Condition', 'Peak cell density', 'Titre', 'Viability'],
          rows: [['High glucose feed', 38.7, 5.7, 91.1]],
        })}
      />,
    )
    const box = screen.getByTestId('notebook-table-block')
    expect(box.className).toContain('overflow-x-auto')
    expect(box.className).not.toContain('overflow-hidden')
    expect(box.querySelector('table')).toBeTruthy()
  })
})

describe('BlockPreview sheet (read-only preview)', () => {
  it('does not preview scientific-table payloads', () => {
    renderWithQuery(
      <BlockPreview
        block={block('sheet', {
          datasetId: '00000000-0000-4000-8000-000000000170',
        })}
      />,
    )
    expect(screen.getByText(/no sheet/i)).toBeTruthy()
    expect(screen.queryByText(/scientific sheet/i)).toBeNull()
  })
})

describe('BlockPreview metric (number formatting)', () => {
  it('formats large integers with thousands separators', () => {
    render(
      <BlockPreview
        block={block('metric', {
          label: 'Viral titer',
          value: 23100000,
          unit: 'copies/mL',
        })}
      />,
    )
    expect(screen.getByText('23,100,000')).toBeTruthy()
  })

  it('renders the label in muted small text and the value prominently', () => {
    const { container } = render(
      <BlockPreview
        block={block('metric', { label: 'Volume', value: 100, unit: 'µL' })}
      />,
    )

    expect(screen.getByText('Volume')).toBeTruthy()
    const value = screen.getByText('100')
    // The value sits in a font-display dd, the label in a muted dt.
    expect(value.closest('dd')?.className).toContain('font-display')
    expect(container.querySelector('dt')?.className).toContain('text-fg-muted')
  })

  it('shows the workings under a value and keeps its precision', () => {
    render(
      <BlockPreview
        block={block('metric', {
          label: 'Mass to weigh out',
          value: 12.114,
          unit: 'mg',
          provenance: '50 mM × 2 mL × 121.14 g/mol (molarity calculator)',
        })}
      />,
    )
    expect(screen.getByText('12.11')).toBeTruthy()
    expect(
      screen.getByText('50 mM × 2 mL × 121.14 g/mol (molarity calculator)'),
    ).toBeTruthy()
  })

  it('leaves non-numeric string values untouched', () => {
    render(
      <BlockPreview
        block={block('metric', { label: 'Pass/fail', value: 'Pass' })}
      />,
    )
    expect(screen.getByText('Pass')).toBeTruthy()
  })
})

describe('BlockPreview linked_record (NOTE-03 canonical open affordance)', () => {
  it('links to the canonical Dataset UUID when targetId is present', () => {
    const datasetId = '00000000-0000-4000-8000-000000000170'
    renderWithQuery(
      <BlockPreview
        block={block('linked_record', {
          targetKind: 'dataset',
          targetIdentifier: 'Stability readings',
          targetId: datasetId,
          linkType: 'dataset',
          label: '',
        })}
      />,
    )
    const open = screen.getByRole('link', { name: 'Open' })
    expect(open.getAttribute('href')).toBe(
      `/datasets/${encodeURIComponent(datasetId)}`,
    )
  })

  it('opens a snapshot citation at its exact Dataset version', () => {
    const datasetId = '00000000-0000-4000-8000-000000000170'
    const versionId = '00000000-0000-4000-8000-000000000171'
    renderWithQuery(
      <BlockPreview
        block={block('linked_record', {
          targetKind: 'dataset',
          targetId: datasetId,
          targetIdentifier: 'DS-1',
          datasetVersionId: versionId,
          linkType: 'dataset',
        })}
      />,
    )
    expect(
      screen
        .getByRole('link', { name: 'Open cited snapshot' })
        .getAttribute('href'),
    ).toBe(`/datasets/${datasetId}/rows?snapshot=${versionId}`)
  })

  it('links non-dataset targets through recordDestination by UUID', () => {
    const sampleId = '10000000-0000-4000-8000-000000000042'
    renderWithQuery(
      <BlockPreview
        block={block('linked_record', {
          targetKind: 'sample',
          targetIdentifier: 'SMP-2025-0001',
          targetId: sampleId,
          linkType: 'sample',
          label: '',
        })}
      />,
    )
    const open = screen.getByRole('link', { name: 'Open' })
    expect(open.getAttribute('href')).toBe(
      `/samples/${encodeURIComponent(sampleId)}`,
    )
  })

  it('never renders a link for legacy payloads that only carry a label', () => {
    renderWithQuery(
      <BlockPreview
        block={block('linked_record', {
          targetKind: 'experiment',
          targetIdentifier: 'EXP-2025-0001',
          linkType: 'general',
          label: '',
        })}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
  })
})

describe('BlockPreview sheet (NOTE-03 read-preview open affordance)', () => {
  it('offers the canonical Open full sheet link built from the instance UUID', async () => {
    const instanceId = '00000000-0000-4000-8000-00000000abc1'

    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })

    client.setQueryData(['sheet-instance', instanceId], {
      id: instanceId,
      name: 'Titration working sheet',
      lifecycle: 'active',
      sourceDefinitionVersionId: null,
      workspaceId: '00000000-0000-4000-8000-000000000001',
      projectId: null,
      notebookRecordId: null,
      description: null,
      revision: 1,
      duplicatedFromInstanceId: null,
      createdAt: '2026-11-09T12:00:00Z',
      updatedAt: '2026-11-09T12:00:00Z',
      createdByUserId: 'u1',
      updatedByUserId: null,
      state: {
        bindings: [],
        localFields: [],
        localValues: {},
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
      },
    } satisfies SheetInstance)
    renderWithQuery(
      <BlockPreview
        block={block('sheet', {
          instanceId,
        })}
      />,
      client,
    )
    const open = await screen.findByRole('link', { name: 'Open full sheet' })
    expect(open.getAttribute('href')).toBe(`/sheets/${instanceId}`)
  })
})

// ---------------------------------------------------------------------------
// NOTE-03 chart block Dataset affordances. spec.datasets and
// frozen.datasetProvenance are arrays — every source gets its own stable-ID
// link, and frozen charts surface every pinned Dataset version.
// ---------------------------------------------------------------------------

const CHART_DATASET_A = '00000000-0000-4000-8000-0000000000a1'
const CHART_DATASET_B = '00000000-0000-4000-8000-0000000000b2'
const CHART_VERSION_A = '11111111-0000-4000-8000-0000000000a1'
const CHART_VERSION_B = '22222222-0000-4000-8000-0000000000b2'

const chartSpec = (datasetIds: string[]) => ({
  specVersion: 1,
  type: 'scatter',
  datasets: datasetIds.map((datasetId) => ({ datasetId })),
  fields: {
    x: null,
    y: { fieldId: 'f1' },
    series: null,
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  display: {
    axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
    series: [],
  },
  overlays: { errorBars: null },
})

const frozenChart = (
  entries: Array<{ datasetId: string; datasetVersionId: string }>,
) => ({
  revisionId: null,
  frozenAt: '2026-01-01T00:00:00Z',
  frozenByUserId: 'u1',
  datasetProvenance: entries.map((entry, i) => ({
    ...entry,
    schemaVersionNumber: 1,
    rowCount: i + 2,
    checksum: `checksum-${i}`,
  })),
  data: { columns: [], rows: [], series: [] },
})

describe('BlockPreview chart (NOTE-03 Dataset source affordances)', () => {
  it('live multi-Dataset chart renders one link per spec.datasets entry', async () => {
    renderWithQuery(
      <BlockPreview
        block={block('chart', {
          title: 'Multi-source chart',
          spec: chartSpec([CHART_DATASET_A, CHART_DATASET_B]),
        })}
      />,
    )
    const first = await screen.findByRole('link', { name: 'Dataset 1' })
    const second = screen.getByRole('link', { name: 'Dataset 2' })
    expect(first.getAttribute('href')).toBe(
      `/datasets/${encodeURIComponent(CHART_DATASET_A)}`,
    )
    expect(second.getAttribute('href')).toBe(
      `/datasets/${encodeURIComponent(CHART_DATASET_B)}`,
    )
    // Multi-source labels are ordinal, never a display label.
    expect(screen.queryByRole('link', { name: 'Open dataset' })).toBeNull()
  })

  it('frozen multi-Dataset chart renders every pinned Dataset version', () => {
    renderWithQuery(
      <BlockPreview
        block={block('chart', {
          title: 'Frozen multi-source chart',
          spec: chartSpec([CHART_DATASET_A, CHART_DATASET_B]),
          frozen: frozenChart([
            { datasetId: CHART_DATASET_A, datasetVersionId: CHART_VERSION_A },
            { datasetId: CHART_DATASET_B, datasetVersionId: CHART_VERSION_B },
          ]),
        })}
      />,
    )

    // Both sources are visible immediately (the frame renders its actions
    // while reconstruction is pending).
    const first = screen.getByRole('link', {
      name: `Dataset 1 · version ${CHART_VERSION_A.slice(0, 8)}`,
    })

    const second = screen.getByRole('link', {
      name: `Dataset 2 · version ${CHART_VERSION_B.slice(0, 8)}`,
    })

    // Each link opens the exact pinned Version, never the live Dataset.
    expect(first.getAttribute('href')).toBe(
      `/datasets/${CHART_DATASET_A}/rows?snapshot=${CHART_VERSION_A}`,
    )
    expect(second.getAttribute('href')).toBe(
      `/datasets/${CHART_DATASET_B}/rows?snapshot=${CHART_VERSION_B}`,
    )
    // No misleading single-version subtitle when two Versions are pinned.
    expect(screen.queryByText(/^Dataset version /)).toBeNull()
  })

  it('single-source live chart keeps the plain "Open dataset" affordance', () => {
    renderWithQuery(
      <BlockPreview
        block={block('chart', {
          title: 'Single-source chart',
          spec: chartSpec([CHART_DATASET_A]),
        })}
      />,
    )
    const open = screen.getByRole('link', { name: 'Open dataset' })
    expect(open.getAttribute('href')).toBe(
      `/datasets/${encodeURIComponent(CHART_DATASET_A)}`,
    )
    // No numbering for a single source.
    expect(screen.queryByText('Dataset 1')).toBeNull()
  })

  it('single-source frozen chart keeps subtitle + single Open dataset link', () => {
    renderWithQuery(
      <BlockPreview
        block={block('chart', {
          title: 'Single frozen chart',
          spec: chartSpec([CHART_DATASET_A]),
          frozen: frozenChart([
            { datasetId: CHART_DATASET_A, datasetVersionId: CHART_VERSION_A },
          ]),
        })}
      />,
    )
    expect(screen.getByText('Dataset version 11111111')).toBeTruthy()
    const open = screen.getByRole('link', { name: 'Open dataset' })
    expect(open.getAttribute('href')).toBe(
      `/datasets/${CHART_DATASET_A}/rows?snapshot=${CHART_VERSION_A}`,
    )
    expect(screen.queryByText('Dataset 1')).toBeNull()
  })
})

describe('BlockPreview conclusion', () => {
  it('shows the finding with its verdict and what it is based on', () => {
    render(
      <BlockPreview
        block={block('conclusion', {
          text: 'The vector is stable to day 21.',
          verdict: 'supported',
          basis: 'Potency assay, three lots',
        })}
      />,
    )
    expect(screen.getByText('The vector is stable to day 21.')).toBeTruthy()
    expect(screen.getByText('Supported')).toBeTruthy()
    expect(screen.getByText('Potency assay, three lots')).toBeTruthy()
  })

  it('says so when no conclusion has been written', () => {
    render(<BlockPreview block={block('conclusion', {})} />)
    expect(screen.getByText('No conclusion written')).toBeTruthy()
    expect(screen.getByText('Inconclusive')).toBeTruthy()
  })
})
