import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RelatedWorkPanel } from '#/components/related-work/related-work-panel'
import { relatedWorkQueryKeys } from '#/lib/related-work'
import type { RelatedWorkItem } from '#/lib/related-work'

/**
 * FIND-03 panel. The panel's own reads are network-bound, so these stories
 * seed the query cache with `staleTime: Infinity` and show the two states a
 * static fixture can produce honestly: resolved items, and the panel's
 * documented silence when there is nothing to show.
 *
 * The silence covers more than the empty case: the panel renders null for an
 * empty result, for a read still in flight and for a failed read alike, so
 * mounts never need an empty-state branch. Only the populated state is a
 * visible surface, and it is the one covered here.
 */
const KIND = 'record'
const ID = 'rec-1'

const items: RelatedWorkItem[] = [
  {
    kind: 'record',
    id: 'rec-2',
    recordKind: 'experiment',
    label: 'Virus stability at 25 °C',
    identifier: 'EXP-2026-0043',
    reason: 'Linked to EXP-2026-0042',
    destination: '/records/rec-2',
  },
  {
    kind: 'sheet',
    id: 'sheet-1',
    recordKind: null,
    label: 'Observation worksheet',
    identifier: null,
    reason: 'Cited in the same revision',
    destination: '/sheets/sheet-1',
  },
]

function client(seed: RelatedWorkItem[]) {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  instance.setQueryData(relatedWorkQueryKeys.related(KIND, ID), seed)
  return instance
}

function withClient(seed: RelatedWorkItem[]) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client(seed)}>
      <div className="w-80">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Related work/Panel',
  component: RelatedWorkPanel,
  tags: ['autodocs'],
  decorators: [withClient(items)],
  args: { kind: KIND, id: ID },
} satisfies Meta<typeof RelatedWorkPanel>
export default meta
type Story = StoryObj<typeof meta>

/** Resolved items, each with its transparent reason and destination. */
export const Default: Story = {}

/** An empty result renders nothing at all — mounts need no empty branch. */
export const SilentWhenEmpty: Story = { decorators: [withClient([])] }

/** The same silence covers a read that has not returned yet: the panel adds
 * nothing to the page until it has something true to say. */
export const SilentWhileUnresolved: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity } },
          })
        }
      >
        <div className="w-80">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}
