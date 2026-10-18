import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ChartEncodingEditor } from '#/components/viz/chart-encodings'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'

/**
 * R5-STUDIO-02 encoding authoring. Assignments are controlled, so the story
 * keeps the spec in state and lets a drop or a menu choice actually land.
 */
const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const OD = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const CONDITION = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'
const REPLICATE = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa04'

const columns: ChartColumn[] = [
  { id: TIME, label: 'Time (h)', logicalType: 'decimal', unit: 'h' },
  { id: OD, label: 'OD₆₀₀', logicalType: 'decimal' },
  { id: CONDITION, label: 'Condition', logicalType: 'category' },
  { id: REPLICATE, label: 'Replicate', logicalType: 'integer' },
]

const emptySpec: ChartSpec = {
  specVersion: CHART_SPEC_VERSION,
  type: 'line',
  datasets: [{ datasetId: DATASET_ID }],
  fields: {
    x: null,
    y: null as never,
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

const boundSpec: ChartSpec = {
  ...emptySpec,
  fields: {
    ...emptySpec.fields,
    x: { fieldId: TIME },
    y: { fieldId: OD },
    series: { fieldId: CONDITION },
  },
}

/** Last two characters of a binding's field id, or an em dash when unbound. */
function short(binding: { fieldId: string } | null): string {
  return binding ? binding.fieldId.slice(-2) : '—'
}

function Caller({ initialSpec }: { initialSpec: ChartSpec }) {
  const [spec, setSpec] = useState(initialSpec)
  return (
    <div className="w-[900px] max-w-full space-y-2">
      <ChartEncodingEditor
        idPrefix="encoding"
        columns={columns}
        spec={spec}
        onAssign={(role, fieldId) =>
          setSpec((prev) => ({
            ...prev,
            fields: { ...prev.fields, [role]: fieldId ? { fieldId } : null },
          }))
        }
      />
      <p className="text-xs text-fg-muted">
        Bound: x {short(spec.fields.x)} · y {short(spec.fields.y)} · series{' '}
        {short(spec.fields.series)}
      </p>
    </div>
  )
}

const meta = {
  title: 'Visualization/Chart encoding editor',
  component: ChartEncodingEditor,
  tags: ['autodocs'],
  args: { idPrefix: 'encoding', columns, spec: boundSpec, onAssign: () => {} },
} satisfies Meta<typeof ChartEncodingEditor>
export default meta
type Story = StoryObj<typeof meta>

export const Bound: Story = {
  render: () => <Caller initialSpec={boundSpec} />,
}

/** Nothing bound yet: every role slot is empty and refuses nothing. */
export const Unbound: Story = {
  render: () => <Caller initialSpec={emptySpec} />,
}

/** Narrow column — the field list and slots stack. */
export const Narrow: Story = {
  render: () => (
    <div className="w-[320px]">
      <Caller initialSpec={boundSpec} />
    </div>
  ),
}
