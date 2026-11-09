import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { BlockConflictDiff } from '#/components/offline/block-conflict-diff'
import { richTextPayloadFromText } from '#/lib/offline/replay'
import type {
  OfflineBlockPayloadEdit,
  OfflineReplayPort,
} from '#/lib/offline/replay'

/**
 * What differs between the version someone else saved and the one made
 * offline, as one flowing text. Words only in the saved version are struck
 * through; words only in the offline version are highlighted.
 */
const edit: OfflineBlockPayloadEdit = {
  id: 'e1',
  sequence: 1,
  kind: 'block_payload',
  blockId: 'b1',
  blockType: 'rich_text',
  payloadSchemaVersion: 1,
  expectedRevision: 3,
  createdAt: '2026-11-05T10:00:00.000Z',
  payload: richTextPayloadFromText(
    'Filtrate was sampled at 50, 100 and 150 L/m². Re-checked at the bench: turbidity stable.',
  ) as unknown as OfflineBlockPayloadEdit['payload'],
}

const port = (saved: string | null): OfflineReplayPort => ({
  commit: async () => {},
  raiseCellConflict: async () => null,
  readServerBlockPayload: async () =>
    saved === null ? null : richTextPayloadFromText(saved),
})

const meta = {
  title: 'Offline/Block conflict diff',
  component: BlockConflictDiff,
  tags: ['autodocs'],
  args: { edit },
  decorators: [
    (Story) => (
      <div className="w-[560px] text-label">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BlockConflictDiff>

export default meta

type Story = StoryObj<typeof meta>

/** Both sides changed the paragraph: removed and added words read in place. */
export const Changed: Story = {
  args: {
    port: port(
      'Filtrate was sampled at 50, 100 and 150 L/m². Mei L. rechecked the titre.',
    ),
  },
}

/** The saved version could not be read, so the diff says so. */
export const SavedVersionUnavailable: Story = {
  args: { port: port(null) },
}
