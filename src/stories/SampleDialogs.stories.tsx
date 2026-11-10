import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useState } from 'react'

import { AliquotDialog } from '#/components/samples/aliquot-dialog'
import {
  AliquotCreated as AliquotCreatedContent,
  PoolCreated,
} from '#/components/samples/quantity-created'
import { AliquotPlanPreview } from '#/components/samples/quantity-plan-preview'
import { PoolSources } from '#/components/samples/quantity-pool-sources'
import { planAliquots } from '#/components/samples/quantity-plans'
import { Dialog, DialogContent } from '#/components/ui/dialog'
import { BulkRegisterDialog } from '#/components/samples/bulk-register-dialog'
import { MoveSampleDialog } from '#/components/samples/move-dialog'
import { PoolDialog } from '#/components/samples/pool-dialog'
import {
  EditDetailsDialog,
  EditHoldDialog,
  ReceiveStockDialog,
} from '#/components/samples/sample-edit-dialogs'
import type { ExperimentOption } from '#/components/samples/quantity-hooks'
import type { SampleQuantityBalances } from '#/lib/samples'
import { positionKeys } from '#/lib/storage-positions'
import {
  screenQueryClient,
  screenRoutes,
  stubDataClient,
} from './screen-stories'
import {
  PROJECT_ID,
  SAMPLE_ID,
  boxFixtures,
  positionCells,
  sampleFixture,
} from './sample-fixtures'

/**
 * The sample write dialogs (`src/components/samples/`): split into tubes,
 * pool, move, bulk register, and the three editors. Each takes its data as
 * props or a seeded cache, so every story is a still frame; the submit
 * callbacks are no-ops.
 */
const queryClient = screenQueryClient({
  data: [
    { key: positionKeys.boxes, value: boxFixtures },
    ...boxFixtures.map((box) => ({
      key: positionKeys.box(box.id),
      value: positionCells(box.id),
    })),
    { key: ['storage-positions', 'sample', SAMPLE_ID], value: null },
    { key: ['storage-locations', 'suggestions'], value: [] },
    { key: ['label-templates', 'picker'], value: [] },
  ],
})

const meta = {
  title: 'Samples/Dialogs',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/samples', [
          '/samples/$sampleId',
          '/settings/lab/storage',
        ]),
        path: '/samples',
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const noop = () => {}
const sample = sampleFixture()

const experiments: ExperimentOption[] = [
  { id: 'exp-1', identifier: 'EXP-0142', title: 'Depth filtration' },
  { id: 'exp-2', identifier: 'EXP-0147', title: 'Virus inactivation' },
]

const balances: SampleQuantityBalances = {
  sampleRecordId: SAMPLE_ID,
  unit: 'mL',
  current: 4600,
  used: 10400,
  reserved: 600,
  free: 4000,
}

const sourceSample = {
  id: sample.id,
  identifier: sample.identifier,
  title: sample.title,
  quantity: sample.quantity,
  quantityUnit: sample.quantityUnit,
  storageLocation: sample.storageLocation,
}

// --- Aliquot ----------------------------------------------------------------

/** The split form: tube count, amount each, purpose and where the tubes go. */
export const Aliquot: Story = {
  render: () => (
    <AliquotDialog
      open
      onOpenChange={noop}
      sample={sourceSample}
      busy={false}
      onSubmit={noop}
      client={stubDataClient()}
      experiments={experiments}
      balances={balances}
    />
  ),
}

/** The server refused the split: the error is named in the dialog. */
export const AliquotRefused: Story = {
  render: () => (
    <AliquotDialog
      open
      onOpenChange={noop}
      sample={sourceSample}
      busy={false}
      error="The sample is on hold and cannot be split."
      onSubmit={noop}
      client={stubDataClient()}
      experiments={experiments}
      balances={balances}
    />
  ),
}

/** After the split: the new tubes are listed and linked. */
export const AliquotCreated: Story = {
  render: () => (
    <AliquotDialog
      open
      onOpenChange={noop}
      sample={sourceSample}
      busy={false}
      onSubmit={noop}
      client={stubDataClient()}
      experiments={experiments}
      balances={balances}
      created={[1, 2, 3].map((n) =>
        sampleFixture({
          id: `tube-${n}`,
          identifier: `SMP-224${n}`,
          title: `Harvest lot HL-0934 · ${n}`,
          quantity: 500,
        }),
      )}
    />
  ),
}

// --- Pool -------------------------------------------------------------------

/** Pooling with two other samples already chosen. */
export const Pool: Story = {
  render: () => (
    <PoolDialog
      open
      onOpenChange={noop}
      sample={{ ...sourceSample, metadataVersion: 3 }}
      busy={false}
      onSubmit={noop}
      client={stubDataClient()}
      experiments={experiments}
      balances={balances}
      initialRows={[
        {
          id: 's-2',
          identifier: 'SMP-2232',
          title: 'Harvest lot HL-0935',
          free: 1200,
          unit: 'mL',
          metadataVersion: 1,
          take: '',
        },
        {
          id: 's-3',
          identifier: 'SMP-2233',
          title: 'Harvest lot HL-0936',
          free: 900,
          unit: 'mL',
          metadataVersion: 2,
          take: '',
        },
      ]}
    />
  ),
}

/** The pool before any other sample is added. */
export const PoolEmpty: Story = {
  render: () => (
    <PoolDialog
      open
      onOpenChange={noop}
      sample={{ ...sourceSample, metadataVersion: 3 }}
      busy={false}
      onSubmit={noop}
      client={stubDataClient()}
      experiments={experiments}
      balances={balances}
    />
  ),
}

// --- Move -------------------------------------------------------------------

/** Moving a sample that sits at a typed location: the picker lists boxes. */
export const Move: Story = {
  render: () => (
    <MoveSampleDialog
      open
      onOpenChange={noop}
      sample={sample}
      busy={false}
      onSubmit={noop}
    />
  ),
}

/** A sample that is not in storage yet is put in rather than moved. */
export const PutInStorage: Story = {
  render: () => (
    <MoveSampleDialog
      open
      onOpenChange={noop}
      sample={{ ...sample, storageLocation: null }}
      busy={false}
      onSubmit={noop}
    />
  ),
}

// --- Bulk register ----------------------------------------------------------

/** The empty paste step: project, default location and the list or file. */
export const BulkRegister: Story = {
  render: () => (
    <BulkRegisterDialog
      open
      onOpenChange={noop}
      projects={[
        { id: PROJECT_ID, title: 'Process development' },
        { id: 'p-2', title: 'Cell line characterisation' },
      ]}
      defaultProjectId={PROJECT_ID}
      client={stubDataClient()}
    />
  ),
}

// --- Editors ----------------------------------------------------------------

/** Editing title, notes and tags, with the reason the audit trail needs. */
export const EditDetails: Story = {
  render: () => (
    <EditDetailsDialog
      sample={sample}
      busy={false}
      onClose={noop}
      onSubmit={noop}
    />
  ),
}

/** Editing the hold limit; the allowed-experiment exception is empty. */
export const EditHold: Story = {
  render: () => (
    <EditHoldDialog
      sample={sample}
      busy={false}
      onClose={noop}
      onSubmit={noop}
    />
  ),
}

/** Receiving stock: how much arrived and where the new stock goes. */
export const ReceiveStock: Story = {
  render: () => (
    <ReceiveStockDialog
      sample={sample}
      busy={false}
      canManageStorage
      onClose={noop}
      onSubmit={noop}
    />
  ),
}

export const CreatedAliquotTubes: Story = {
  render: () => (
    <Dialog open onOpenChange={noop}>
      <DialogContent>
        <AliquotCreatedContent
          created={[1, 2].map((n) =>
            sampleFixture({
              id: `tube-${n}`,
              identifier: `SMP-224${n}`,
              title: `Harvest tube ${n}`,
              quantity: 500,
            }),
          )}
          identifier={sample.identifier}
          onPrint={noop}
        />
      </DialogContent>
    </Dialog>
  ),
}

export const CreatedPool: Story = {
  render: () => (
    <Dialog open onOpenChange={noop}>
      <DialogContent>
        <PoolCreated
          created={{
            pool: sampleFixture({
              id: 'pool-1',
              identifier: 'SMP-2250',
              title: 'Pooled harvest',
              quantity: 700,
            }),
            sources: [
              sample,
              sampleFixture({ id: 'source-2', identifier: 'SMP-2232' }),
            ],
          }}
          onPrint={noop}
        />
      </DialogContent>
    </Dialog>
  ),
}

export const AliquotPlanReady: Story = {
  render: () => (
    <AliquotPlanPreview
      plan={planAliquots('3', '250', 4000, 'mL')}
      unit="mL"
      identifier={sample.identifier}
    />
  ),
}

export const AliquotPlanRefused: Story = {
  render: () => (
    <AliquotPlanPreview
      plan={planAliquots('3', '1600', 4000, 'mL')}
      unit="mL"
      identifier={sample.identifier}
    />
  ),
}

function PopulatedPoolSources() {
  const [rows, setRows] = useState([
    {
      id: 'source-1',
      identifier: 'SMP-2231',
      title: 'Harvest lot HL-0934',
      free: 1600,
      unit: 'mL',
      metadataVersion: 3,
      take: '400',
    },
    {
      id: 'source-2',
      identifier: 'SMP-2232',
      title: 'Harvest lot HL-0935',
      free: 900,
      unit: 'mL',
      metadataVersion: 5,
      take: '300',
    },
  ])

  return (
    <PoolSources
      rows={rows}
      onTake={(id, take) =>
        setRows((current) =>
          current.map((row) => (row.id === id ? { ...row, take } : row)),
        )
      }
      onRemove={(id) =>
        setRows((current) => current.filter((row) => row.id !== id))
      }
      onAdd={noop}
    />
  )
}

export const PoolSourceAmounts: Story = {
  render: () => <PopulatedPoolSources />,
}
