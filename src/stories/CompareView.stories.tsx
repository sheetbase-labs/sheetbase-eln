import { useState } from 'react'
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CompareView } from '#/components/viz/compare-view'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import {
  COMPARATIVE_VIEW_CONFIG_VERSION,
  validateComparativeViewConfig,
} from '#/lib/comparative-view'
import type { ComparativeViewConfig } from '#/lib/comparative-view'
import type { ChartColumn } from '#/lib/chart-spec'

/**
 * VIEW-03 compare surface. `CompareView` is controlled — the config lives
 * with its caller — so each story wraps it in the smallest stateful caller
 * that lets the faceting controls change something.
 */
const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const PH = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const BUFFER = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const columns: ChartColumn[] = [
  { id: TIME, label: 'Time (h)', logicalType: 'decimal' },
  { id: PH, label: 'pH', logicalType: 'decimal' },
  { id: BUFFER, label: 'Buffer', logicalType: 'category' },
]

const source: CanonicalDatasetSource = {
  datasetId: DATASET_ID,
  name: 'Stability',
  workspaceId: '00000000-0000-4000-8000-00000000ffff',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 1,
  columns,
}

const rows: Record<string, unknown>[] = [
  { [TIME]: 0, [PH]: 7.0, [BUFFER]: 'A' },
  { [TIME]: 1, [PH]: 7.2, [BUFFER]: 'A' },
  { [TIME]: 2, [PH]: 7.1, [BUFFER]: 'A' },
  { [TIME]: 0, [PH]: 6.8, [BUFFER]: 'B' },
  { [TIME]: 1, [PH]: 6.7, [BUFFER]: 'B' },
  { [TIME]: 2, [PH]: 6.5, [BUFFER]: 'B' },
]

const baseConfig: ComparativeViewConfig = {
  configVersion: COMPARATIVE_VIEW_CONFIG_VERSION,
  datasetId: DATASET_ID,
  versionId: null,
  viewType: 'time_series',
  timeField: TIME,
  valueField: PH,
  groupBy: [BUFFER],
  facetBy: null,
}

function Caller({
  initialConfig,
  ...props
}: { initialConfig: ComparativeViewConfig } & Omit<
  ComponentProps<typeof CompareView>,
  'config' | 'onConfigChange'
>) {
  const [config, setConfig] = useState(initialConfig)
  const errors = validateComparativeViewConfig(config)
  return (
    <div className="w-[860px] max-w-full space-y-2">
      <CompareView {...props} config={config} onConfigChange={setConfig} />
      <p className="text-xs text-fg-muted" data-config-state>
        {errors.length > 0
          ? `Config refused: ${errors.join(', ')}`
          : 'Config accepted by validateComparativeViewConfig'}
      </p>
    </div>
  )
}

const meta = {
  title: 'Visualization/Compare view',
  component: CompareView,
  tags: ['autodocs'],
  args: {
    source,
    columns,
    rows,
    config: baseConfig,
    onConfigChange: () => {},
    onPromote: () => {},
  },
} satisfies Meta<typeof CompareView>
export default meta
type Story = StoryObj<typeof meta>

/** Time series grouped by buffer, previewed through the chart renderer. */
export const TimeSeries: Story = {
  render: (args) => <Caller {...args} initialConfig={baseConfig} />,
}

/** Replicate distribution: the same grouping, a different question. */
export const Distribution: Story = {
  render: (args) => (
    <Caller
      {...args}
      initialConfig={{
        ...baseConfig,
        viewType: 'distribution',
        timeField: null,
        groupBy: [TIME],
      }}
    />
  ),
}

export const Loading: Story = {
  args: { loading: true },
  render: (args) => <Caller {...args} initialConfig={baseConfig} />,
}

export const Error: Story = {
  args: { error: 'The dataset revision could not be read.' },
  render: (args) => <Caller {...args} initialConfig={baseConfig} />,
}

/** No rows materialised: the preview states the empty dataset. */
export const EmptyDataset: Story = {
  args: { rows: [] },
  render: (args) => <Caller {...args} initialConfig={baseConfig} />,
}

/** Small multiples: one panel per facet value. */
export const Faceted: Story = {
  render: (args) => (
    <Caller
      {...args}
      initialConfig={{ ...baseConfig, groupBy: [TIME], facetBy: BUFFER }}
    />
  ),
}
