import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LabelTemplatePicker } from '#/components/samples/label-template-picker'
import { LocationInput } from '#/components/samples/location-field'
import { PlaceField } from '#/components/samples/place-field'
import { PositionPicker } from '#/components/samples/position-picker'
import type { LabelTemplate } from '#/lib/labels'
import { positionKeys } from '#/lib/storage-positions'
import type { PlaceChoice } from '#/lib/storage-positions'
import { screenQueryClient, screenRoutes } from './screen-stories'
import { BOX_ID, boxFixtures, positionCells } from './sample-fixtures'

/**
 * Where a sample goes: the box picker, the compact field that opens it, the
 * typed-location input and the label-template choice
 * (`src/components/samples/`). They are one file because they are one
 * decision on the move, aliquot and receive forms. The box list and each box's
 * positions are seeded into the query cache, so nothing is fetched.
 */
function seededClient(withBoxes: boolean) {
  return screenQueryClient({
    data: withBoxes
      ? [
          { key: positionKeys.boxes, value: boxFixtures },
          ...boxFixtures.map((box) => ({
            key: positionKeys.box(box.id),
            value: positionCells(box.id),
          })),
          { key: ['storage-locations', 'suggestions'], value: [] },
        ]
      : [
          { key: positionKeys.boxes, value: [] },
          {
            key: ['storage-locations', 'suggestions'],
            value: ['Bench 4', 'Cold room shelf 2'],
          },
        ],
  })
}

const meta = {
  title: 'Samples/Placement',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/samples', ['/settings/lab/storage']),
        path: '/samples',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function Picker({
  initial = null,
  canManageStorage,
  textLocations,
}: {
  initial?: PlaceChoice | null
  canManageStorage?: boolean
  textLocations?: readonly string[]
}) {
  const [value, setValue] = useState<PlaceChoice | null>(initial)

  return (
    <PositionPicker
      value={value}
      onChange={setValue}
      canManageStorage={canManageStorage}
      textLocations={textLocations}
    />
  )
}

const boxesClient = seededClient(true)
const emptyClient = seededClient(false)

/** The picker on the first box with room: free positions can be clicked. */
export const PickerWithBoxes: Story = {
  render: () => (
    <QueryClientProvider client={boxesClient}>
      <Picker />
    </QueryClientProvider>
  ),
}

/** A position already chosen: the picker opens on its box with the cell selected. */
export const PickerWithChoice: Story = {
  render: () => {
    const box = boxFixtures[0]
    const position = positionCells(BOX_ID)[3]

    return (
      <QueryClientProvider client={boxesClient}>
        <Picker initial={{ kind: 'position', box, position }} />
      </QueryClientProvider>
    )
  },
}

/** No storage set up and an admin looking: typing a place, with a link to Settings. */
export const PickerNoBoxesAdmin: Story = {
  render: () => (
    <QueryClientProvider client={emptyClient}>
      <Picker canManageStorage textLocations={['Bench 4']} />
    </QueryClientProvider>
  ),
}

/** No storage set up for someone who cannot manage it: typing is the only way. */
export const PickerNoBoxes: Story = {
  render: () => (
    <QueryClientProvider client={emptyClient}>
      <Picker textLocations={['Bench 4']} />
    </QueryClientProvider>
  ),
}

/** The compact field with nothing chosen. */
export const PlaceFieldEmpty: Story = {
  render: () => (
    <QueryClientProvider client={boxesClient}>
      <PlaceField
        value={null}
        onChange={() => {}}
        title="Where should SMP-2231 go?"
      />
    </QueryClientProvider>
  ),
}

/** The compact field showing a chosen position, with Change and Clear. */
export const PlaceFieldChosen: Story = {
  render: () => (
    <QueryClientProvider client={boxesClient}>
      <PlaceField
        value={{
          kind: 'position',
          box: boxFixtures[0],
          position: positionCells(BOX_ID)[3],
        }}
        onChange={() => {}}
        title="Where should SMP-2231 go?"
      />
    </QueryClientProvider>
  ),
}

/** A typed place, for a bench or shared instrument that is not in a box. */
export const PlaceFieldTyped: Story = {
  render: () => (
    <QueryClientProvider client={boxesClient}>
      <PlaceField
        value={{ kind: 'text', text: 'Bench 4' }}
        onChange={() => {}}
        title="Where should SMP-2231 go?"
      />
    </QueryClientProvider>
  ),
}

function TypedLocation() {
  const [value, setValue] = useState('Cold')

  return (
    <LocationInput
      value={value}
      onChange={setValue}
      aria-label="Storage location"
      locations={['Cold room shelf 2', 'Cold room shelf 3', 'Bench 4']}
    />
  )
}

/** The location input offers the places the page already holds as suggestions. */
export const LocationInputSuggestions: Story = {
  render: () => (
    <QueryClientProvider client={emptyClient}>
      <TypedLocation />
    </QueryClientProvider>
  ),
}

const template = (
  id: string,
  name: string,
  widthMm: number,
  heightMm: number,
): LabelTemplate => ({
  id,
  workspaceId: '0198d970-e266-4000-8000-000000000001',
  name,
  recordKind: 'sample',
  showCondition: true,
  showUseBy: true,
  showLot: true,
  showSampleType: false,
  widthMm,
  heightMm,
  barcodeType: 'qr',
  layout: 'standard',
  isDefault: false,
  archivedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
})

const TEMPLATES = [
  template('0198d970-e266-4000-8000-0000000000a1', 'Cryovial', 50, 25),
  template('0198d970-e266-4000-8000-0000000000a2', 'Bottle', 70, 40),
]

function ChosenTemplate() {
  const [chosen, setChosen] = useState(TEMPLATES[0].id)

  return (
    <LabelTemplatePicker
      templates={TEMPLATES}
      chosen={TEMPLATES.find((item) => item.id === chosen)}
      onChoose={setChosen}
    />
  )
}

/** Two or more templates: a select, with the chosen one's size in each option. */
export const TemplatePicker: Story = {
  render: () => <ChosenTemplate />,
}

/** One template or none: the picker renders nothing, so the label keeps its look. */
export const TemplatePickerSilent: Story = {
  render: () => (
    <div className="text-label text-fg-muted">
      <LabelTemplatePicker
        templates={[TEMPLATES[0]]}
        chosen={TEMPLATES[0]}
        onChoose={() => {}}
      />
      With a single template the picker renders nothing.
    </div>
  ),
}
