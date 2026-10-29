import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetPromote } from '#/components/sheet/sheet-promote'
import type { SheetPromoteLocalField } from '#/components/sheet/sheet-promote'

/**
 * The “promote a local column” dialog for a composed Sheet. It is a controlled
 * dialog: with `open` supplied the caller owns it, and `trigger={false}` is
 * how the workspace opens it from the column menu. The request itself is only
 * sent on submit. The target list is one read, so the stories seed it rather
 * than leaving the select empty.
 */
function client() {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  instance.setQueryData(
    ['dataset-schema-definitions', 'promote-target'],
    [
      {
        id: '0198d970-e266-4000-8000-0000000d0001',
        key: 'observations',
        name: 'Observations',
        description: 'Per-well readings from the plate reader',
        lifecycle: 'published',
        display_id: 'DS-0004',
        created_at: '2026-05-02T09:00:00Z',
        updated_at: '2026-08-14T10:20:00Z',
        created_by_user_id: 'user-1',
      },
      {
        id: '0198d970-e266-4000-8000-0000000d0002',
        key: 'formulation',
        name: 'Formulation',
        description: null,
        lifecycle: 'published',
        display_id: 'DS-0007',
        created_at: '2026-06-11T13:40:00Z',
        updated_at: '2026-09-01T08:05:00Z',
        created_by_user_id: 'user-2',
      },
    ],
  )
  return instance
}
const field: SheetPromoteLocalField = {
  fieldId: '0198d970-e266-4000-8000-00000000f001',
  key: 'observation',
  label: 'Observation',
  logicalType: 'text',
  quantity: null,
}

const meta = {
  title: 'Sheet/Sheet promote',
  component: SheetPromote,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    instanceId: '0198d970-e266-4000-8000-000000000030',
    field,
    onSubmitted: () => {},
  },
} satisfies Meta<typeof SheetPromote>
export default meta
type Story = StoryObj<typeof meta>

/** Closed: the trigger the column menu renders. */
export const Trigger: Story = {}

/** Open, with the target choice and the reason the reviewer will read. */
export const Open: Story = {
  args: { open: true, trigger: false },
}

/** A quantity field carries its unit into the promotion. */
export const QuantityField: Story = {
  args: {
    open: true,
    trigger: false,
    field: {
      ...field,
      key: 'titre',
      label: 'Titre',
      logicalType: 'decimal',
      quantity: { storageUnit: 'vg/mL', preferredDisplayUnit: 'vg/mL' },
    },
  },
}

/** A caller-named trigger for surfaces that say what is being promoted. */
export const CustomTriggerLabel: Story = {
  args: { triggerLabel: 'Add to dataset' },
}
