import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PeekCard } from '#/components/workspace/peek-card'
import type { PeekSummary } from '#/lib/peek-summary'
import { screenQueryClient, holdRead } from './screen-stories'

/**
 * A card for the record under the cursor: what it is, where it was named, and
 * the three things to do with it. Opening is a separate step, so a peek never
 * changes what is on screen. The summary is read through the query cache, so
 * the stories seed it (or hold it) rather than reaching a database.
 */
const HREF = '/experiments/exp-1'

const SUMMARY: PeekSummary = {
  identifier: 'EXP-2026-0042',
  title: 'Virus stability at 25 °C',
  kindLabel: 'Experiment',
  status: 'in_progress',
  description: 'Track infectious titre over four weeks at 25 °C.',
  facts: [
    { label: 'Owner', value: 'Dana Whitfield' },
    { label: 'Project', value: 'TB-02 stability' },
    { label: 'Updated', value: '3 Nov 2026' },
  ],
}

function withSummary(summary: PeekSummary | null) {
  const client = screenQueryClient()

  if (summary) client.setQueryData(['workspace', 'peek', HREF], summary)
  else holdRead(client, ['workspace', 'peek', HREF])

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Workspace/Peek card',
  component: PeekCard,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    target: {
      href: HREF,
      title: 'Virus stability at 25 °C',
      identifier: 'EXP-2026-0042',
      from: 'DS-0107',
      rect: { left: 40, top: 40, bottom: 64 },
    },
    pinned: false,
    onOpenBeside: () => {},
    onOpenHere: () => {},
    onPin: () => {},
    onClose: () => {},
  },
  decorators: [withSummary(SUMMARY)],
} satisfies Meta<typeof PeekCard>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Already kept on the shelf. */
export const Pinned: Story = { args: { pinned: true } }

/** The summary has not arrived: the card says it is reading. */
export const Reading: Story = { decorators: [withSummary(null)] }
