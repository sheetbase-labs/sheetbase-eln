/**
 * EXP-05.3 — the reconnect runner.
 *
 * The runner must not send anything while the connection is down, must replay
 * once the stream is live again, and must say so when an edit conflicts or is
 * held behind an unresolved conflict rather than looking synced.
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { LiveStatus } from '#/lib/live-events'
import type { OfflineCellEdit, OfflineReplayPort } from '#/lib/offline/replay'
import { OfflineReplayOverlapError } from '#/lib/offline/replay'
import {
  createInMemoryStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import type { OfflineEdit, OfflineEditScope } from '#/lib/offline/store'
import { OfflineEditsProvider } from './offline-edits'
import { OfflineReplayRunner } from './offline-replay'

afterEach(cleanup)

const SCOPE: OfflineEditScope = { userId: 'user-alice', recordId: 'record-1' }

function statusSnapshot(value: LiveStatus['status']): LiveStatus {
  return {
    status: value,
    lastAppliedSeq: 0,
    workspaceId: null,
    lastResetReason: null,
  }
}

function cell(overrides: Partial<OfflineCellEdit> = {}) {
  return {
    kind: 'cell' as const,
    sheetInstanceId: 'sheet-1',
    rowId: 'row-1',
    columnId: 'field-1',
    value: 4.1,
    expectedRevision: 5,
    ...overrides,
  }
}

function fakePort(
  behaviour: (edit: OfflineEdit) => 'commit' | 'overlap',
): OfflineReplayPort & { commits: string[] } {
  const commits: string[] = []
  return {
    commits,
    async commit(edit) {
      commits.push(edit.id)
      if (behaviour(edit) === 'overlap') throw new OfflineReplayOverlapError()
    },
    async raiseCellConflict() {
      return 'conflict-1'
    },
  }
}

describe('OfflineReplayRunner', () => {
  it('sends nothing while the connection is down', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await store.putEdit(SCOPE, cell())
    const port = fakePort(() => 'commit')

    render(
      <OfflineEditsProvider store={store} scope={SCOPE}>
        <OfflineReplayRunner
          store={store}
          scope={SCOPE}
          port={port}
          status={statusSnapshot('offline')}
        />
      </OfflineEditsProvider>,
    )

    expect(port.commits).toEqual([])
  })

  it('replays on reconnect, commits clean edits and reports a conflict', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await store.putEdit(SCOPE, {
      kind: 'block_text',
      blockId: 'block-1',
      text: 'note',
      expectedRevision: 1,
    })
    await store.putEdit(SCOPE, cell())
    const port = fakePort((edit) =>
      edit.kind === 'cell' ? 'overlap' : 'commit',
    )

    const { rerender, findByText } = render(
      <OfflineEditsProvider store={store} scope={SCOPE}>
        <OfflineReplayRunner
          store={store}
          scope={SCOPE}
          port={port}
          status={statusSnapshot('offline')}
        />
      </OfflineEditsProvider>,
    )

    rerender(
      <OfflineEditsProvider store={store} scope={SCOPE}>
        <OfflineReplayRunner
          store={store}
          scope={SCOPE}
          port={port}
          status={statusSnapshot('live')}
        />
      </OfflineEditsProvider>,
    )

    await waitFor(() => expect(port.commits).toHaveLength(2))
    // The clean edit left the store; the conflicting one stays until resolved.
    await waitFor(async () => {
      const remaining = await store.listEdits(SCOPE)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.kind).toBe('cell')
    })
    expect(
      await findByText(/conflicts with a change on the server/),
    ).toBeTruthy()
  })
})
