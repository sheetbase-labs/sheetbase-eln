import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { OfflineEditsProvider } from '#/components/offline/offline-edits'
import { OfflineReplayRunner } from '#/components/offline/offline-replay'
import {
  OfflineReplayOverlapError,
  OfflineReplayRefusedError,
} from '#/lib/offline/replay'
import type { OfflineReplayPort } from '#/lib/offline/replay'
import { EDITS, SCOPE, seededStore } from './offline-fixtures'

/**
 * The reconnect trigger for offline replay. When the connection is `live` it
 * sends the device store's drafts through a port and reports what it could not
 * send: a conflict, an edit held behind one, or one the server refused. It
 * renders nothing when every edit committed.
 *
 * The stories drive it with a fake port and a status override, so no write ever
 * leaves the page.
 */
const live = {
  status: 'live',
  lastAppliedSeq: 1,
  workspaceId: null,
  lastResetReason: null,
} as const

const commitAll: OfflineReplayPort = {
  commit: async () => {},
  raiseCellConflict: async () => 'conflict-1',
}

const meta = {
  title: 'Offline/Replay runner',
  component: OfflineReplayRunner,
  tags: ['autodocs'],
  args: { scope: SCOPE, status: live, store: seededStore(), port: commitAll },
  decorators: [
    (Story, context) => (
      <OfflineEditsProvider store={context.args.store} scope={SCOPE}>
        <div className="w-[560px]">
          <Story />
        </div>
      </OfflineEditsProvider>
    ),
  ],
} satisfies Meta<typeof OfflineReplayRunner>

export default meta

type Story = StoryObj<typeof meta>

/** Every edit committed: the runner has nothing to say and renders nothing. */
export const AllCommitted: Story = {}

/** A stale cell edit becomes a conflict, and the sheet edits behind it are held. */
export const ConflictAndHeld: Story = {
  args: {
    store: seededStore(),
    port: {
      commit: async (edit) => {
        if (edit.kind === 'cell') throw new OfflineReplayOverlapError()
      },
      raiseCellConflict: async () => 'conflict-1',
    },
  },
}

/** The server refused a write on its merits: the edit stays queued, with its reason. */
export const Refused: Story = {
  args: {
    store: seededStore(EDITS.filter((edit) => edit.kind !== 'cell')),
    port: {
      commit: async (edit) => {
        if (edit.kind === 'comment') {
          throw new OfflineReplayRefusedError(
            'You no longer have permission to comment on this sheet.',
          )
        }
      },
      raiseCellConflict: async () => null,
    },
  },
}
