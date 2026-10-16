import { useState } from 'react'
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ChartConfigurator } from '#/components/viz/chart-configurator'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'

/**
 * Controlled chart authoring: the spec lives with the caller, so each story
 * supplies a small stateful caller. The seed spec is deliberately partial
 * (x and y bound only) — that is the state the configurator is designed to
 * complete.
 */
const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const OD = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const CONDITION = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const source: CanonicalDatasetSource = {
  datasetId: DATASET_ID,
  name: 'Plate reader kinetics',
  workspaceId: '00000000-0000-4000-8000-00000000ffff',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 2,
  columns: [
    { id: TIME, label: 'Time (h)', logicalType: 'decimal', unit: 'h' },
    { id: OD, label: 'OD₆₀₀', logicalType: 'decimal' },
    { id: CONDITION, label: 'Condition', logicalType: 'category' },
  ],
}

const baseSpec: ChartSpec = {
  specVersion: CHART_SPEC_VERSION,
  type: 'line',
  datasets: [{ datasetId: DATASET_ID }],
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
    axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
    series: [],
  },
  overlays: { errorBars: null },
}

function Caller({
  initialSpec,
  ...props
}: { initialSpec: ChartSpec } & Omit<
  ComponentProps<typeof ChartConfigurator>,
  'spec' | 'onSpecChange'
>) {
  const [spec, setSpec] = useState(initialSpec)
  return (
    <div className="w-[900px] max-w-full">
      <ChartConfigurator {...props} spec={spec} onSpecChange={setSpec} />
    </div>
  )
}

const meta = {
  title: 'Visualization/Chart configurator',
  component: ChartConfigurator,
  tags: ['autodocs'],
  args: { source, spec: baseSpec, onSpecChange: () => {} },
} satisfies Meta<typeof ChartConfigurator>
export default meta
type Story = StoryObj<typeof meta>

export const Wrap: Story = {
  render: (args) => <Caller {...args} initialSpec={baseSpec} />,
}

/** Rail is the narrow stacked column used beside a chart preview. */
export const Rail: Story = {
  args: { layout: 'rail' },
  render: (args) => (
    <div className="w-[280px]">
      <Caller {...args} initialSpec={baseSpec} />
    </div>
  ),
}

/** A series binding turns the chart into one line per condition. */
export const WithSeries: Story = {
  render: (args) => (
    <Caller
      {...args}
      initialSpec={{
        ...baseSpec,
        fields: { ...baseSpec.fields, series: { fieldId: CONDITION } },
      }}
    />
  ),
}

/** Bar charts expose the stacking parameter that only they use. */
export const StackedBar: Story = {
  render: (args) => (
    <Caller
      {...args}
      initialSpec={{
        ...baseSpec,
        type: 'bar',
        typeParams: { bar: { stacking: 'stacked' } },
        fields: { ...baseSpec.fields, series: { fieldId: CONDITION } },
      }}
    />
  ),
}
