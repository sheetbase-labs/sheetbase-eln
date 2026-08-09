/**
 * ANALYSIS-001 — Analysis Studio route component tests.
 *
 * Covers the header states, the controls (chart-type / axis / grouping /
 * aggregation / normalisation / overlay), the saved-views panel, the export
 * panel, the preview's error states (missing field, excessive size), and the
 * accessible data-table alternative. Mocks react-query and chart-data so the
 * studio never hits the network.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useQuery } from '@tanstack/react-query'
import {
  AnalysisControls,
  AnalysisStudioHeader,
  DataTableAlternative,
  EmptyAnalysisState,
  ExportPanel,
  SavedViewsPanel,
} from './analysis'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'
import { DEFAULT_EXPORT_SETTINGS } from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import type {
  ScientificLogicalType,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
}))

vi.mock('@tanstack/react-query', () => {
  const actual = vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})
vi.mock('#/lib/chart-data', () => ({
  useLiveChartDataset: () => ({
    datasetQuery: { data: null, isLoading: false },
    calcQuery: { data: null, isLoading: false },
  }),
  materialiseLiveChart: () => ({
    state: { kind: 'missing_dataset' },
    columns: [],
    rows: [],
    series: [],
    xLabel: 'x',
    yLabel: 'y',
    xUnit: undefined,
    yUnit: undefined,
  }),
}))

afterEach(() => {
  cleanup()
  vi.mocked(useQuery).mockReset()
})

function column(
  id: string,
  fieldName: string,
  label: string,
  type: ScientificLogicalType = 'decimal',
) {
  return {
    id,
    field_name: fieldName,
    label,
    display_order: 0,
    logical_type: type,
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [],
  }
}

function table(
  overrides: Partial<ScientificTableWire> = {},
): ScientificTableWire {
  return {
    id: '11111111-1111-1111-8111-111111111111',
    resource_name: 'sheet_alpha',
    name: 'Stability',
    schema_version: 1,
    lifecycle: 'active',
    columns: [
      column(
        'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01',
        'time_h',
        'Time (h)',
        'decimal',
      ),
      column('aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02', 'ph', 'pH', 'decimal'),
      column(
        'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
        'buffer',
        'Buffer',
        'category',
      ),
      column(
        'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa04',
        'ph_sd',
        'pH SD',
        'decimal',
      ),
    ],
    ...overrides,
  }
}

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ tableId: '11111111-1111-1111-8111-111111111111' }],
    fields: {
      x: {
        columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01',
        fieldName: 'time_h',
      },
      y: { columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02', fieldName: 'ph' },
      series: {
        columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
        fieldName: 'buffer',
      },
      color: null,
      size: null,
    },
    filters: [],
    transformations: [],
    display: {
      axes: {
        x: { label: 'Time (h)', scale: 'linear' },
        y: { label: 'pH', scale: 'linear' },
      },
      series: [{ identifier: 'all', label: 'all', color: '#006EDC' }],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
    ...overrides,
  }
}

// --- AnalysisStudioHeader -------------------------------------------------

describe('AnalysisStudioHeader', () => {
  it('renders a skeleton while loading', () => {
    render(
      <AnalysisStudioHeader
        datasets={[]}
        loading
        error={null}
        selectedTableId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Analysis Studio')).toBeTruthy()
    expect(screen.queryByLabelText('Select data source')).toBeNull()
  })

  it('renders an error badge on failure', () => {
    render(
      <AnalysisStudioHeader
        datasets={[]}
        loading={false}
        error={new Error('boom')}
        selectedTableId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Could not load datasets')).toBeTruthy()
  })

  it('renders a populated data-source selector', () => {
    const t = table()
    render(
      <AnalysisStudioHeader
        datasets={[t]}
        loading={false}
        error={null}
        selectedTableId={t.id}
        onSelect={() => {}}
      />,
    )
    const select = screen.getByLabelText('Select data source')
    expect((select as unknown as HTMLSelectElement).value).toBe(t.id)
  })
})

// --- AnalysisControls -----------------------------------------------------

describe('AnalysisControls', () => {
  it('renders chart-type, axis, grouping and overlay controls', () => {
    render(
      <AnalysisControls
        table={table()}
        spec={spec()}
        onSpecChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Chart type')).toBeTruthy()
    expect(screen.getByLabelText('X axis field')).toBeTruthy()
    expect(screen.getByLabelText('Y axis field')).toBeTruthy()
    expect(screen.getByLabelText('Group by series')).toBeTruthy()
    expect(screen.getByLabelText('Aggregation function')).toBeTruthy()
    expect(screen.getByLabelText('Normalisation method')).toBeTruthy()
    expect(screen.getByLabelText('Error bar basis')).toBeTruthy()
  })

  it('changes the chart type when a type button is clicked', async () => {
    const changed: { spec: ChartSpec | null } = { spec: null }
    render(
      <AnalysisControls
        table={table()}
        spec={spec()}
        onSpecChange={(s) => {
          changed.spec = s
        }}
      />,
    )
    const barButton = screen.getByRole('radio', { name: /bar/i })
    await userEvent.click(barButton)
    expect(changed.spec?.type).toBe('bar')
  })

  it('adds an aggregation transformation', async () => {
    const changed: { spec: ChartSpec | null } = { spec: null }
    render(
      <AnalysisControls
        table={table()}
        spec={spec()}
        onSpecChange={(s) => {
          changed.spec = s
        }}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Aggregation function'),
      'mean',
    )
    expect(
      changed.spec?.transformations.some((t) => t.kind === 'aggregate'),
    ).toBe(true)
  })

  it('enables error bars with a basis', async () => {
    const changed: { spec: ChartSpec | null } = { spec: null }
    render(
      <AnalysisControls
        table={table()}
        spec={spec()}
        onSpecChange={(s) => {
          changed.spec = s
        }}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Error bar basis'),
      'sd',
    )
    expect(changed.spec?.overlays.errorBars).not.toBeNull()
    expect(changed.spec?.overlays.errorBars?.basis).toBe('sd')
  })
})

// --- SavedViewsPanel ------------------------------------------------------

function view(overrides: Partial<AnalysisViewWire> = {}): AnalysisViewWire {
  return {
    id: 'v-1',
    workspace_id: 'ws-1',
    owner_user_id: 'u-1',
    name: 'pH over time',
    version: 1,
    spec: spec(),
    source_revisions: [
      {
        tableId: '11111111-1111-1111-8111-111111111111',
        schemaVersion: 1,
        datasetSchemaId: null,
        datasetSchemaRevision: null,
      },
    ],
    export_settings: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('SavedViewsPanel', () => {
  it('renders the empty state when there are no views', () => {
    render(
      <SavedViewsPanel
        views={[]}
        selectedViewId={null}
        viewName=""
        onViewNameChange={() => {}}
        onLoad={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
        saving={false}
        canSave={false}
      />,
    )
    expect(screen.getByText('No saved views yet.')).toBeTruthy()
  })

  it('lists saved views and loads one on click', async () => {
    const v = view()
    let loaded: AnalysisViewWire | null = null
    render(
      <SavedViewsPanel
        views={[v]}
        selectedViewId={null}
        viewName=""
        onViewNameChange={() => {}}
        onLoad={(vw) => {
          loaded = vw
        }}
        onSave={() => {}}
        onDelete={() => {}}
        saving={false}
        canSave={true}
      />,
    )
    await userEvent.click(screen.getByLabelText(`Load view ${v.name}`))
    expect(loaded).not.toBeNull()
  })

  it('disables save when the name is empty', () => {
    render(
      <SavedViewsPanel
        views={[]}
        selectedViewId={null}
        viewName=""
        onViewNameChange={() => {}}
        onLoad={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
        saving={false}
        canSave={false}
      />,
    )
    expect(
      screen.getByLabelText('Save analysis view').matches('[disabled]'),
    ).toBe(true)
  })
})

// --- ExportPanel ----------------------------------------------------------

describe('ExportPanel', () => {
  it('renders format, theme, dimensions and provenance controls', () => {
    render(
      <ExportPanel
        spec={spec()}
        settings={DEFAULT_EXPORT_SETTINGS}
        onSettingsChange={() => {}}
        table={table()}
        datasets={[table()]}
        viewName="Test"
        selectedViewId={null}
        views={[]}
        user={{ id: 'u-1', name: 'Alice' }}
        materialised={{
          state: { kind: 'ok' },
          columns: [],
          rows: [],
          series: [],
          xLabel: 'x',
          yLabel: 'y',
          xUnit: undefined,
          yUnit: undefined,
        }}
      />,
    )
    expect(screen.getByLabelText('Export format')).toBeTruthy()
    expect(screen.getByLabelText('Export theme')).toBeTruthy()
    expect(screen.getByLabelText('Export width')).toBeTruthy()
    expect(screen.getByLabelText('Export height')).toBeTruthy()
  })
})

// --- DataTableAlternative -------------------------------------------------

describe('DataTableAlternative', () => {
  it('renders a loading skeleton while data loads', () => {
    const { container } = render(
      <DataTableAlternative materialised={null as never} loading />,
    )
    // Skeleton renders as a div with class containing "animate-pulse".
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders a no-data message for a non-ok state', () => {
    render(
      <DataTableAlternative
        materialised={{
          state: { kind: 'missing_field', fields: ['y'] },
          columns: [],
          rows: [],
          series: [],
          xLabel: 'x',
          yLabel: 'y',
          xUnit: undefined,
          yUnit: undefined,
        }}
        loading={false}
      />,
    )
    expect(
      screen.getByText('No plottable data table for the current state.'),
    ).toBeTruthy()
  })

  it('renders the data table with rows for an ok state', () => {
    render(
      <DataTableAlternative
        materialised={{
          state: { kind: 'ok' },
          columns: [],
          rows: [],
          series: [
            {
              identifier: 'HEPES',
              label: 'HEPES',
              color: '#006EDC',
              points: [
                { x: 0, y: 7, yError: 0.1, label: 'HEPES' },
                { x: 24, y: 6.8, yError: 0.2, label: 'HEPES' },
              ],
            },
          ],
          xLabel: 'Time (h)',
          yLabel: 'pH',
          xUnit: undefined,
          yUnit: undefined,
        }}
        loading={false}
      />,
    )
    expect(screen.getByText('Data table')).toBeTruthy()
    expect(screen.getByText('2 points')).toBeTruthy()
    expect(screen.getByLabelText('Chart data table')).toBeTruthy()
  })

  it('exposes an explicit point-inspection action when selection is enabled', async () => {
    const selected: Array<{
      series: string
      x: number | null
      y: number | null
      yError: number | null
    }> = []
    render(
      <DataTableAlternative
        materialised={{
          state: { kind: 'ok' },
          columns: [],
          rows: [],
          series: [
            {
              identifier: 'HEPES',
              label: 'HEPES',
              color: '#006EDC',
              points: [{ x: 24, y: 6.8, yError: null, label: 'HEPES' }],
            },
          ],
          xLabel: 'Time (h)',
          yLabel: 'pH',
          xUnit: undefined,
          yUnit: undefined,
        }}
        loading={false}
        onSelectPoint={(point) => selected.push(point)}
      />,
    )
    await userEvent.click(screen.getByLabelText('Inspect HEPES at 24'))
    expect(selected).toEqual([{ series: 'HEPES', x: 24, y: 6.8, yError: null }])
  })
})

// --- EmptyAnalysisState ---------------------------------------------------

describe('EmptyAnalysisState', () => {
  it('renders an error alert on failure', () => {
    render(<EmptyAnalysisState loading={false} error={new Error('boom')} />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('renders a friendly empty message when idle', () => {
    render(<EmptyAnalysisState loading={false} error={null} />)
    expect(screen.getByText(/No datasets yet/i)).toBeTruthy()
  })
})
