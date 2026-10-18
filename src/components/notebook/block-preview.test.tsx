import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockPreview } from './block-preview'
import type * as sheetInstanceData from '#/lib/sheet-instance-data'
import { fetchSheetInstance } from '#/lib/sheet-instance-data'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/sheet-instance-data', async (importOriginal) => {
  const actual = await importOriginal<typeof sheetInstanceData>()
  return { ...actual, fetchSheetInstance: vi.fn() }
})

const mockFetchSheetInstance = vi.mocked(fetchSheetInstance)

afterEach(() => cleanup())

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const block = (type: string, payload: unknown) => ({
  id: 'b1',
  recordId: 'r1',
  type,
  payload: payload as Record<string, unknown>,
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

describe('BlockPreview table (canonical string-array payload)', () => {
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
    expect(screen.getByText(/no Sheet Instance/i)).toBeTruthy()
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
      `/datasets?dataset=${encodeURIComponent(datasetId)}`,
    )
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
    mockFetchSheetInstance.mockResolvedValue({
      id: instanceId,
      name: 'Titration working sheet',
      lifecycle: 'active',
      sourceDefinitionVersionId: null,
    } as never)
    renderWithQuery(
      <BlockPreview
        block={block('sheet', {
          instanceId,
        })}
      />,
    )
    const open = await screen.findByRole('link', { name: 'Open full sheet' })
    expect(open.getAttribute('href')).toBe(`/sheets/${instanceId}`)
  })
})

// ---------------------------------------------------------------------------
// NOTE-03 chart block Dataset affordances. spec.datasets and
// frozen.datasetProvenance are arrays — every source gets its own stable-ID
// link, and frozen charts surface every pinned Dataset Version.
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
      `/datasets?dataset=${encodeURIComponent(CHART_DATASET_A)}`,
    )
    expect(second.getAttribute('href')).toBe(
      `/datasets?dataset=${encodeURIComponent(CHART_DATASET_B)}`,
    )
    // Multi-source labels are ordinal, never a display label.
    expect(screen.queryByRole('link', { name: 'Open dataset' })).toBeNull()
  })

  it('frozen multi-Dataset chart renders every pinned Dataset Version', () => {
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
    // Each link targets the stable Dataset UUID, not the Version.
    expect(first.getAttribute('href')).toBe(
      `/datasets?dataset=${encodeURIComponent(CHART_DATASET_A)}`,
    )
    expect(second.getAttribute('href')).toBe(
      `/datasets?dataset=${encodeURIComponent(CHART_DATASET_B)}`,
    )
    // No misleading single-version subtitle when two Versions are pinned.
    expect(screen.queryByText(/^Dataset Version /)).toBeNull()
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
      `/datasets?dataset=${encodeURIComponent(CHART_DATASET_A)}`,
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
    expect(screen.getByText('Dataset Version 11111111')).toBeTruthy()
    const open = screen.getByRole('link', { name: 'Open dataset' })
    expect(open.getAttribute('href')).toBe(
      `/datasets?dataset=${encodeURIComponent(CHART_DATASET_A)}`,
    )
    expect(screen.queryByText('Dataset 1')).toBeNull()
  })
})
