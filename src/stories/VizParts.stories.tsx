import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ChartRenderer } from '#/components/viz/chart-renderer-impl'
import { FigureControls } from '#/components/viz/figure-controls'
import { SnapshotSourceBanner } from '#/components/viz/snapshot-source-banner'
import { SourceComparison } from '#/components/viz/source-comparison'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { CHART_PALETTE, CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartSpec, MaterialisedChart } from '#/lib/chart-spec'
import type { DatasetVersionSummary } from '#/lib/dataset-explorer-data'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Four visualization modules that had no story of their own
 * (`src/components/viz/`): the chart renderer's implementation (the public
 * `ChartRenderer` wraps it in a lazy boundary, so this story imports the
 * implementation directly and renders without waiting for the chart bundle),
 * the publication figure controls, the snapshot banner and the two-source
 * comparison.
 */
const DATASET_A = '11111111-1111-1111-8111-111111111111'
const DATASET_B = '22222222-2222-2222-8222-222222222222'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const OD = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'

const meta = {
  title: 'Visualization/Parts',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/datasets/$datasetId'),
        path: '/datasets/$datasetId',
        params: { datasetId: DATASET_A },
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function inside(queryClient: QueryClient, width = 720) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const seeded = (data: ReadSeed[]) => screenQueryClient({ data })

const spec: ChartSpec = {
  specVersion: CHART_SPEC_VERSION,
  type: 'line',
  datasets: [{ datasetId: DATASET_A }],
  fields: {
    x: { fieldId: TIME },
    y: { fieldId: OD },
    series: null,
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  display: {
    axes: {
      x: { label: 'Time', scale: 'linear', unit: 'h' },
      y: { label: 'OD₆₀₀', scale: 'linear' },
    },
    series: [],
    legend: { visible: true },
  },
  overlays: { errorBars: null },
}

const points = [
  [0, 0.05],
  [2, 0.12],
  [4, 0.34],
  [6, 0.68],
  [8, 0.82],
]

const materialised: MaterialisedChart = {
  state: { kind: 'ok' },
  columns: [
    { id: TIME, label: 'Time', logicalType: 'decimal', unit: 'h' },
    { id: OD, label: 'OD₆₀₀', logicalType: 'decimal' },
  ],
  rows: points.map(([x, y]) => ({ [TIME]: x, [OD]: y })),
  series: [
    {
      identifier: 'OD₆₀₀',
      label: 'OD₆₀₀',
      color: CHART_PALETTE[0],
      points: points.map(([x, y]) => ({ x, y, yError: null, label: 'OD₆₀₀' })),
    },
  ],
  xLabel: 'Time',
  yLabel: 'OD₆₀₀',
  xUnit: 'h',
  yUnit: undefined,
  droppedPoints: 0,
}

// --- Chart renderer implementation -----------------------------------------

export const RendererLine: Story = {
  render: () => (
    <ChartRenderer
      title="Bacterial growth curve"
      spec={spec}
      materialised={materialised}
      frozen={null}
    />
  ),
  decorators: [inside(seeded([]))],
}

export const RendererError: Story = {
  render: () => (
    <ChartRenderer
      title="Bacterial growth curve"
      spec={spec}
      materialised={materialised}
      frozen={null}
      error="The dataset could not be loaded."
    />
  ),
  decorators: [inside(seeded([]))],
}

// --- Figure controls --------------------------------------------------------

function FigureHarness({ initial }: { initial: ChartSpec }) {
  const [value, setValue] = useState(initial)

  return <FigureControls spec={value} onSpecChange={setValue} />
}

export const Figure: Story = {
  render: () => <FigureHarness initial={spec} />,
  decorators: [inside(seeded([]), 320)],
}

export const FigureBadRange: Story = {
  render: () => (
    <FigureHarness
      initial={{
        ...spec,
        display: {
          ...spec.display,
          axes: {
            ...spec.display.axes,
            y: { ...spec.display.axes.y, min: 10, max: 2 },
          },
        },
      }}
    />
  ),
  decorators: [inside(seeded([]), 320)],
}

// --- Snapshot banner --------------------------------------------------------

const version: DatasetVersionSummary = {
  id: 'dv-3',
  label: 'v3',
  createdAt: '2026-10-30T09:30:00Z',
  createdByUserId: null,
  createdByCredentialId: null,
  createdByName: 'Ada Okafor',
  sourceDatasetRevision: 7,
  rowCount: 1240,
  contentHash: 'sha256:3f2a9c0d41b7',
  rowsRemovedAt: null,
  change: null,
  retention: { reason: 'kept', keptUntil: null },
  source: null,
  citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
}

export const SnapshotBanner: Story = {
  render: () => (
    <SnapshotSourceBanner
      datasetId={DATASET_A}
      datasetVersionId="dv-3"
      onUseLive={() => {}}
    />
  ),
  decorators: [
    withApiReads('pending'),
    inside(
      seeded([
        { key: ['dataset-version-summaries', DATASET_A], value: [version] },
      ]),
    ),
  ],
}

export const SnapshotBannerVersionUnknown: Story = {
  render: () => (
    <SnapshotSourceBanner
      datasetId={DATASET_A}
      datasetVersionId="dv-gone"
      onUseLive={() => {}}
    />
  ),
  decorators: [
    withApiReads('pending'),
    inside(
      seeded([{ key: ['dataset-version-summaries', DATASET_A], value: [] }]),
    ),
  ],
}

// --- Source comparison ------------------------------------------------------

const sourceOf = (id: string, name: string): CanonicalDatasetSource => ({
  datasetId: id,
  name,
  workspaceId: '00000000-0000-4000-8000-00000000ffff',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 2,
  columns: [
    { id: TIME, label: 'Time (h)', logicalType: 'decimal', unit: 'h' },
    { id: OD, label: 'OD₆₀₀', logicalType: 'decimal' },
  ],
})

const sourceA = sourceOf(DATASET_A, 'Plate reader kinetics')
const sourceB = sourceOf(DATASET_B, 'Plate reader kinetics (repeat)')
const rowsA = points.map(([x, y]) => ({ [TIME]: x, [OD]: y }))

export const Comparison: Story = {
  render: () => (
    <SourceComparison
      sourceA={sourceA}
      rowsA={rowsA}
      snapshotA={null}
      sources={[sourceA, sourceB]}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        { key: ['dataset-version-summaries', DATASET_A], value: [version] },
        {
          key: ['source-comparison-rows', DATASET_A, ''],
          value: {
            source: sourceA,
            rows: rowsA.map((r) => ({ ...r, [OD]: Number(r[OD]) * 1.1 })),
            truncated: false,
            totalCount: rowsA.length,
          },
        },
      ]),
      900,
    ),
  ],
}
