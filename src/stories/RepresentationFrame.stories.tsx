import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RepresentationFrame } from '#/components/viz/representation-frame'
import { Button } from '#/components/v3/ui/button'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'
import {
  SHEET_REPRESENTATION_CONFIG_VERSION,
  createRepresentationHandle,
} from '#/lib/representations'

/**
 * VIEW-01 frame chrome. Handles are built with the real
 * `createRepresentationHandle`, so the Live/Snapshot badge and the source
 * line are the ones the product derives from the envelope.
 */
const DATASET_ID = '0198d970-e266-4000-8000-000000000001'
const VERSION_ID = '0198d970-e266-4000-8000-000000000010'

const chartSpec: ChartSpec = {
  specVersion: CHART_SPEC_VERSION,
  type: 'line',
  datasets: [{ datasetId: DATASET_ID }],
  fields: {
    x: { fieldId: '0198d970-e266-4000-8000-000000000002' },
    y: { fieldId: '0198d970-e266-4000-8000-000000000003' },
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

const liveHandle = createRepresentationHandle({
  source: { datasetId: DATASET_ID, versionId: null },
  config: {
    kind: 'chart',
    configVersion: CHART_SPEC_VERSION,
    config: chartSpec,
  },
  title: 'Recovery by condition',
})

const frozenHandle = createRepresentationHandle({
  source: { datasetId: DATASET_ID, versionId: VERSION_ID },
  config: {
    kind: 'chart',
    configVersion: CHART_SPEC_VERSION,
    config: chartSpec,
  },
  title: 'Recovery by condition',
})

const sheetHandle = createRepresentationHandle({
  source: { datasetId: null, versionId: null },
  config: {
    kind: 'sheet',
    configVersion: SHEET_REPRESENTATION_CONFIG_VERSION,
    config: { instanceId: '0198d970-e266-4000-8000-000000000030' },
  },
  title: 'Observation worksheet',
})

const meta = {
  title: 'Visualization/Representation frame',
  component: RepresentationFrame,
  tags: ['autodocs'],
  args: {
    title: 'Recovery by condition',
    handle: liveHandle,
    children: (
      <p className="text-sm text-fg-muted">
        Kind renderer output (in the app this is the chart, plate map or sheet).
      </p>
    ),
  },
} satisfies Meta<typeof RepresentationFrame>
export default meta
type Story = StoryObj<typeof meta>

export const Live: Story = {}

/** A pinned Dataset Version renders the Snapshot badge and the version line. */
export const Snapshot: Story = { args: { handle: frozenHandle } }

/** The sheet kind is the one representation that stays editable. */
export const EditableSheet: Story = {
  args: { title: 'Observation worksheet', handle: sheetHandle },
}

export const Loading: Story = { args: { loading: true } }

export const Error: Story = {
  args: { error: 'The pinned Dataset Version could not be read.' },
}

export const WithActions: Story = {
  args: {
    handle: frozenHandle,
    actions: (
      <>
        <Button size="sm" variant="secondary">
          Export
        </Button>
        <Button size="sm" variant="quiet">
          Copy citation
        </Button>
      </>
    ),
  },
}

/** Narrow column: the header truncates rather than wrapping the badges. */
export const Narrow: Story = {
  render: (args) => (
    <div className="w-[320px]">
      <RepresentationFrame {...args} handle={frozenHandle} />
    </div>
  ),
}
