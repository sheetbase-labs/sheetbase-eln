import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CellConflictPanel } from '#/components/sheet/cell-conflict-panel'
import type { CellConflictRow } from '#/components/sheet/cell-conflict-panel'

/**
 * EXP-05.4 cell conflict surface. The panel resolves through the RPC, so
 * stories keep it mounted read-only in practice (nothing is submitted);
 * a settled conflict renders its decision instead of the controls. Author
 * names come from a query the stories leave pending.
 */
const ME = 'user-me'
const PRIYA = 'user-priya'

function openConflict(
  overrides: Partial<CellConflictRow> = {},
): CellConflictRow {
  return {
    id: 'conflict-1',
    sheet_instance_id: 'inst-1',
    row_key: 'row-6',
    field_id: 'field-1',
    local_value: 7.4e11,
    local_author_user_id: ME,
    local_at: '2026-10-10T10:14:00Z',
    remote_value: 7.5e11,
    remote_author_user_id: PRIYA,
    remote_at: '2026-10-10T10:09:00Z',
    state: 'open',
    resolved_value: null,
    resolved_by_user_id: null,
    resolved_at: null,
    reason: null,
    ...overrides,
  }
}

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise(() => {}) },
    },
  })
}

function Harness({ conflict }: { conflict: CellConflictRow }) {
  const [value] = useState(conflict)
  return <CellConflictPanel conflict={value} />
}

const meta = {
  title: 'Sheet/Cell conflict panel',
  component: CellConflictPanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="w-[560px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    conflict: openConflict(),
    currentUserId: ME,
    cellLabel: 'row 6, Capsid titre',
    unit: 'vg/mL',
  },
} satisfies Meta<typeof CellConflictPanel>
export default meta
type Story = StoryObj<typeof meta>

/** Both edits with their authors; the reader chooses one and states why. */
export const Open: Story = {
  render: (args) => <Harness conflict={args.conflict} />,
}

/** The optional secondary action is hidden when the caller omits it. */
export const WithAsk: Story = {
  args: { onAsk: () => {}, askLabel: 'Ask Priya' },
  render: (args) => <Harness conflict={args.conflict} />,
}

/** A remote edit by another user reads as a name, not “You”. */
export const RemoteIsViewer: Story = {
  args: { currentUserId: PRIYA },
  render: (args) => <Harness conflict={args.conflict} />,
}

/** Settled conflicts show what was decided and by whom. */
export const Resolved: Story = {
  args: {
    conflict: openConflict({
      state: 'resolved',
      resolved_value: 7.4e11,
      resolved_by_user_id: ME,
      resolved_at: '2026-10-10T10:20:00Z',
      reason: 'Kept the calibrated instrument value.',
    }),
  },
}

/** No previous value known: the panel does not invent one. */
export const WithoutPreviousValue: Story = {
  args: { previousValue: undefined },
}
