import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { userEvent, within } from 'storybook/test'

import { AddedFieldValueCell } from '#/components/models/added-field-value-cell'
import { BuiltInFieldInspector } from '#/components/models/built-in-field-inspector'
import { InheritedChangeOn } from '#/components/models/inherited-change-on'
import { requireBuiltInModel } from '#/lib/built-in-models'
import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'
import { modelField } from './model-fixtures'
import { screenRoutes } from './screen-stories'

const temperature = modelField('experiment', 'temperature_c', 'Temperature', {
  description: 'Incubator temperature at inoculation.',
  logicalType: 'decimal',
  nullable: false,
  defaultValue: 37,
  unit: { symbol: '°C' },
  section: 'Culture conditions',
})

const choice = modelField('experiment', 'cell_line', 'Cell line', {
  logicalType: 'category',
  options: [
    {
      id: 'cho',
      key: 'cho',
      label: 'CHO-K1',
      displayOrder: 0,
      lifecycle: 'active',
    },
    {
      id: 'hek',
      key: 'hek',
      label: 'HEK293',
      displayOrder: 1,
      lifecycle: 'retired',
    },
  ],
})

const model = requireBuiltInModel('experiment')
const noop = () => {}

const meta = {
  title: 'Models/Field details',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/models', ['/models/$modelId']),
        path: '/models',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const openInspector: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const trigger = within(canvasElement).queryByRole('button', {
    name: 'Details',
  })

  if (trigger) await userEvent.click(trigger)
}

export const ActiveInspector: Story = {
  play: openInspector,
  render: () => (
    <BuiltInFieldInspector
      sel={temperature}
      model={model}
      canEdit
      onEdit={noop}
      onRetire={noop}
    />
  ),
}

export const ReadOnlyChoiceInspector: Story = {
  play: openInspector,
  render: () => (
    <BuiltInFieldInspector
      sel={{ ...choice, askOnCreate: false, showInList: false }}
      model={model}
      canEdit={false}
      onEdit={noop}
      onRetire={noop}
    />
  ),
}

export const RetiredInspector: Story = {
  play: openInspector,
  render: () => (
    <BuiltInFieldInspector
      sel={{ ...temperature, lifecycle: 'retired' }}
      model={model}
      canEdit
      onEdit={noop}
      onRetire={noop}
    />
  ),
}

export const InheritedSource: Story = {
  render: () => (
    <InheritedChangeOn source={{ id: 'experiment', name: 'Experiment' }} />
  ),
}

const values: Array<{
  label: string
  field: ModelFieldDefinition
  value: ModelFieldRecordValues['customFields'][string] | undefined
}> = [
  { label: 'Numeric zero', field: temperature, value: 0 },
  { label: 'Missing value', field: temperature, value: undefined },
  {
    label: 'Empty text',
    field: modelField('experiment', 'note', 'Note'),
    value: '',
  },
  { label: 'Active choice', field: choice, value: 'cho' },
  { label: 'Historical choice', field: choice, value: 'hek' },
  {
    label: 'False boolean',
    field: modelField('experiment', 'flag', 'Flag', { logicalType: 'boolean' }),
    value: false,
  },
  {
    label: 'Date',
    field: modelField('experiment', 'date', 'Date', { logicalType: 'date' }),
    value: '2026-09-24',
  },
  {
    label: 'Timestamp',
    field: modelField('experiment', 'time', 'Time', {
      logicalType: 'timestamp',
    }),
    value: '2026-09-24T08:30:00.000Z',
  },
]

export const RecordedValues: Story = {
  render: () => (
    <dl className="grid grid-cols-2 gap-3">
      {values.map(({ label, field, value }) => (
        <div key={label}>
          <dt className="text-caption text-fg-muted">{label}</dt>
          <dd>
            <AddedFieldValueCell field={field} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  ),
}
