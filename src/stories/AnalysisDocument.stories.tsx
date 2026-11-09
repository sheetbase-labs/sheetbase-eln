import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  AnalysisTabs,
  ChartSettings,
  ChartStack,
  FieldsPane,
} from '#/components/analysis/analysis-document'
import { DuplicateAnalysisDialog } from '#/components/analysis/duplicate-analysis-dialog'
import { Button } from '#/components/ui/button'
import { CHART_PALETTE } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'
import type { ResolvedDataset } from '#/lib/chart-data'

import {
  screenQueryClient,
  screenRoutes,
  stubDataClient,
} from './screen-stories'

/**
 * The parts of an analysis document: the source's fields, the stack of charts,
 * the settings of the chosen chart, the Data/Diagnostics/Versions tabs, and the
 * dialog that runs the analysis on other data. They take an already-resolved
 * dataset, so the fixture below is the rows the analysis would carry; no read
 * is issued.
 */
const columns = [
  { id: 'time', label: 'Time', logicalType: 'decimal', unit: 'h' },
  { id: 'od', label: 'OD600', logicalType: 'decimal' },
  { id: 'condition', label: 'Condition', logicalType: 'text' },
]

const dataset: ResolvedDataset = {
  source: {
    datasetId: 'dataset-1',
    name: 'Growth curves',
    workspaceId: 'workspace',
    schemaVersionId: 'schema-1',
    schemaVersionNumber: 3,
    revision: 1,
    columns,
  },
  rows: [
    { time: 0, od: 0.05, condition: '37 °C' },
    { time: 2, od: 0.12, condition: '37 °C' },
    { time: 4, od: 0.34, condition: '37 °C' },
    { time: 6, od: 0.68, condition: '37 °C' },
    { time: 8, od: 0.82, condition: '37 °C' },
  ],
  truncated: false,
  totalCount: 5,
}

const spec = {
  specVersion: 1,
  type: 'line',
  datasets: [{ datasetId: 'dataset-1' }],
  fields: {
    x: { fieldId: 'time' },
    y: { fieldId: 'od' },
    series: { fieldId: 'condition' },
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
      y: { label: 'OD600', scale: 'linear' },
    },
    series: [{ identifier: '37 °C', label: '37 °C', color: CHART_PALETTE[0] }],
    legend: { visible: true },
  },
  overlays: { errorBars: null },
} satisfies ChartSpec

const view = {
  id: 'view-1',
  workspace_id: 'workspace',
  owner_user_id: 'user-1',
  name: 'Growth curve',
  display_id: 'AV-0001',
  version: 2,
  charts: [spec],
  source_revisions: [],
  export_settings: null,
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-02T09:00:00Z',
}

const duplicateClient = screenQueryClient({
  data: [
    {
      key: ['ui-port', 'analysis-duplicate', 'datasets'],
      value: [
        { id: 'dataset-1', name: 'Growth curves' },
        { id: 'dataset-2', name: 'Growth curves, repeat' },
        { id: 'dataset-3', name: 'Stress response' },
      ],
    },
    {
      key: ['ui-port', 'analysis-duplicate', 'source', 'dataset-1'],
      value: dataset.source,
    },
  ],
})

const meta = {
  title: 'Analysis/Analysis document',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    tanstack: {
      router: {
        route: screenRoutes('/analysis/$viewId', []),
        path: '/analysis/view-1',
        params: { viewId: 'view-1' },
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={duplicateClient}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/** The source's columns with the part each plays in the charts. */
export const Fields: Story = {
  render: () => (
    <div className="flex">
      <FieldsPane dataset={dataset} charts={[spec]} />
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'desktop' } },
}

/** No dataset resolved yet. */
export const FieldsNoDataset: Story = {
  render: () => (
    <div className="flex">
      <FieldsPane dataset={null} charts={[]} />
    </div>
  ),
}

/** Two charts of one analysis, one under another, with the first selected. */
export const Charts: Story = {
  render: () => {
    const [selected, setSelected] = useState(0)

    return (
      <div className="w-[680px] max-w-full">
        <ChartStack
          charts={[spec, { ...spec, type: 'scatter' }]}
          selected={selected}
          onSelect={setSelected}
          dataset={dataset}
          loading={false}
          title="Growth curve"
          onAdd={() => {}}
        />
      </div>
    )
  },
}

/** The settings of the selected chart. */
export const Settings: Story = {
  render: () => (
    <div className="w-[320px]">
      <ChartSettings
        charts={[spec, { ...spec, type: 'scatter' }]}
        selected={0}
        columns={columns}
        editable
        onYChange={() => {}}
        onRemove={() => {}}
      />
    </div>
  ),
}

/** The same settings for someone who cannot edit. */
export const SettingsReadOnly: Story = {
  render: () => (
    <div className="w-[320px]">
      <ChartSettings
        charts={[spec]}
        selected={0}
        columns={columns}
        editable={false}
        onYChange={() => {}}
        onRemove={null}
      />
    </div>
  ),
}

/** Data, Diagnostics and Versions under the charts. */
export const Tabs: Story = {
  render: () => (
    <div className="w-[720px] max-w-full">
      <AnalysisTabs
        charts={[spec]}
        dataset={dataset}
        diagnostics={<p className="text-label">No issues found.</p>}
        version={2}
        updatedAt="2026-10-02T09:00:00Z"
        earlier={[
          {
            version: 1,
            charts: [{ ...spec, type: 'scatter' }],
            saved_at: '2026-10-01T09:00:00Z',
          },
        ]}
      />
    </div>
  ),
}

/** Run the analysis on other data. */
export const Duplicate: Story = {
  render: () => {
    const [open, setOpen] = useState(true)

    return (
      <>
        <Button onClick={() => setOpen(true)}>Run on other data</Button>
        <DuplicateAnalysisDialog
          view={view}
          workspaceId="workspace"
          userId="user-1"
          open={open}
          onOpenChange={setOpen}
          client={stubDataClient()}
        />
      </>
    )
  },
}
