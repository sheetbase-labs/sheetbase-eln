import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { GhsPictogram } from '#/components/materials/ghs-pictogram'
import { MakeSolutionDialog } from '#/components/materials/make-solution-dialog'
import {
  HazardPictograms,
  MaterialSafetySection,
  SignalWordBadge,
} from '#/components/materials/material-safety'
import {
  ReagentOrdersPanel,
  RequestReorderDialog,
} from '#/components/materials/reagent-orders'
import { workspaceMemberQueryKeys } from '#/components/projects/project-data'
import { sampleListQueryKeys } from '#/components/samples/samples-data'
import { GHS_PICTOGRAMS, materialSafetyKeys } from '#/lib/material-safety'
import type { MaterialSafety } from '#/lib/material-safety'
import { reagentOrderQueryKeys } from '#/lib/reagent-orders'
import type { ReagentOrder } from '#/lib/reagent-orders'
import { solutionQueryKeys } from '#/lib/solution-prep'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Chemical safety, reagent orders and solution prep
 * (`src/components/materials/`): the GHS pictograms, the safety section on
 * a lot, the Orders list with its dialogs, and the make-a-solution dialog.
 * Every read is seeded into a query cache hoisted outside the decorator.
 */
const LOT_ID = '0198d970-e266-4000-8000-000000000d01'

const SAFETY: MaterialSafety = {
  recordId: LOT_ID,
  pictograms: ['GHS02', 'GHS05', 'GHS07'],
  signalWord: 'danger',
  hazardStatements: ['H225', 'H314'],
  sheet: {
    fileObjectId: 'fo-1',
    fileRecordId: 'fr-1',
    name: 'Acetonitrile SDS.pdf',
  },
  updatedAt: '2026-09-20T08:00:00.000Z',
}

const order = (
  overrides: Partial<ReagentOrder> & Pick<ReagentOrder, 'id' | 'reference'>,
): ReagentOrder => ({
  materialRecordId: LOT_ID,
  materialTitle: 'Acetonitrile, HPLC grade',
  supplier: 'Fisher Scientific',
  supplierRecordId: null,
  catalogNo: 'A998-4',
  quantity: 4,
  unit: 'L',
  status: 'requested',
  note: null,
  orderReference: null,
  expectedOn: null,
  cancelReason: null,
  receivedRecordId: null,
  receivedLot: null,
  requestedBy: 'u-1',
  requestedAt: '2026-09-22T09:00:00.000Z',
  orderedAt: null,
  receivedAt: null,
  cancelledAt: null,
  ...overrides,
})

const ORDERS: ReagentOrder[] = [
  order({ id: 'o-1', reference: 'RO-0004' }),
  order({
    id: 'o-2',
    reference: 'RO-0003',
    materialTitle: 'Tris base',
    supplier: 'Sigma-Aldrich',
    catalogNo: 'T1503',
    quantity: 500,
    unit: 'g',
    status: 'ordered',
    orderReference: 'PO-8812',
    expectedOn: '2026-10-02',
    orderedAt: '2026-09-23T10:00:00.000Z',
  }),
  order({
    id: 'o-3',
    reference: 'RO-0002',
    materialTitle: 'DMEM, high glucose',
    status: 'received',
    quantity: 10,
    unit: 'bottles',
    receivedLot: 'LOT-5521',
    receivedRecordId: 'lot-new',
    receivedAt: '2026-09-18T11:00:00.000Z',
  }),
]

const ordersClient = screenQueryClient({
  data: [
    { key: reagentOrderQueryKeys.all, value: ORDERS },
    {
      key: workspaceMemberQueryKeys.identities,
      value: new Map([['u-1', 'Dana Whitfield']]),
    },
    {
      key: sampleListQueryKeys.projects,
      value: new Map([['p-1', 'Process development']]),
    },
    { key: materialSafetyKeys.one(LOT_ID), value: SAFETY },
    { key: materialSafetyKeys.one('lot-empty'), value: null },
    { key: solutionQueryKeys.candidates(''), value: [] },
  ],
})
const emptyOrdersClient = screenQueryClient({
  data: [
    { key: reagentOrderQueryKeys.all, value: [] },
    { key: workspaceMemberQueryKeys.identities, value: new Map() },
  ],
})

const meta = {
  title: 'Materials/Safety and orders',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/materials', ['/materials/$lotId']),
        path: '/materials',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** All nine GHS pictograms, drawn as the standard red-bordered diamond. */
export const Pictograms: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {GHS_PICTOGRAMS.map((code) => (
        <GhsPictogram key={code} code={code} size={64} />
      ))}
    </div>
  ),
}

/** The compact pictogram row and the signal-word badges used in lists. */
export const HazardRowAndSignalWords: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <HazardPictograms pictograms={['GHS02', 'GHS06']} />
      <SignalWordBadge word="danger" />
      <SignalWordBadge word="warning" />
    </div>
  ),
}

/** A hazardous lot with its safety data sheet; an editor sees the Edit action. */
export const SafetySection: Story = {
  render: () => (
    <QueryClientProvider client={ordersClient}>
      <MaterialSafetySection
        recordId={LOT_ID}
        name="Acetonitrile, HPLC grade"
        projectId="p-1"
        canEdit
      />
    </QueryClientProvider>
  ),
}

/** A lot with no recorded hazards says so, and an editor can add them. */
export const SafetySectionEmpty: Story = {
  render: () => (
    <QueryClientProvider client={ordersClient}>
      <MaterialSafetySection
        recordId="lot-empty"
        name="Tris base"
        projectId="p-1"
        canEdit
      />
    </QueryClientProvider>
  ),
}

/** The Orders tab: open orders with the actions a buyer and a requester see. */
export const OrdersPanel: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <QueryClientProvider client={ordersClient}>
      <div className="flex h-[480px] flex-col">
        <ReagentOrdersPanel canPlace canWrite />
      </div>
    </QueryClientProvider>
  ),
}

/** A viewer without ordering rights sees the list with no actions. */
export const OrdersPanelReadOnly: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <QueryClientProvider client={ordersClient}>
      <div className="flex h-[480px] flex-col">
        <ReagentOrdersPanel canPlace={false} canWrite={false} />
      </div>
    </QueryClientProvider>
  ),
}

/** No orders yet. */
export const OrdersPanelEmpty: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <QueryClientProvider client={emptyOrdersClient}>
      <div className="flex h-[360px] flex-col">
        <ReagentOrdersPanel canPlace canWrite />
      </div>
    </QueryClientProvider>
  ),
}

/** Requesting a reorder from a material page. */
export const ReorderDialog: Story = {
  render: () => (
    <QueryClientProvider client={ordersClient}>
      <RequestReorderDialog
        open
        onOpenChange={() => {}}
        material={{
          uuid: LOT_ID,
          id: 'MAT-0231',
          name: 'Acetonitrile, HPLC grade',
          unit: 'L',
        }}
      />
    </QueryClientProvider>
  ),
}

/** Making a solution from lots: the empty ingredient list. */
export const MakeSolution: Story = {
  render: () => (
    <QueryClientProvider client={ordersClient}>
      <MakeSolutionDialog open onOpenChange={() => {}} />
    </QueryClientProvider>
  ),
}
