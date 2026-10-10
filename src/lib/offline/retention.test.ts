/**
 * EXP-05.5 — sign-out retention.
 *
 * The device store is EXP-05.1's; these tests use an in-memory fake that
 * keeps per-user drafts exactly as the real store does, and records the
 * discard path so we can prove sign-out never reaches it.
 */
import { describe, expect, it } from 'vitest'

import {
  countRetainedDrafts,
  createInMemorySignOutRetentionStorage,
  restoreDraftsForUser,
  retainDraftsOnSignOut,
  webSignOutRetentionStorage,
} from './retention'
import type { RetainedDraftStore, SignOutRetentionStorage } from './retention'
import { createInMemoryStorage, createOfflineEditStore } from './store'
import type { OfflineEdit } from './store'

interface Draft {
  id: string
  text: string
}

const ALICE = 'user-alice'
const BOB = 'user-bob'
const RECORD_ONE = 'record-1'
const RECORD_TWO = 'record-2'

const ALICE_DRAFTS: Draft[] = [
  { id: 'edit-1', text: 'Alice: 4.2 mM' },
  { id: 'edit-2', text: 'Alice: incubation 30 min' },
]
const BOB_DRAFTS: Draft[] = [{ id: 'edit-3', text: 'Bob: pH 7.1' }]

const scopeKey = (userId: string, recordId: string) =>
  `${userId}\u0000${recordId}`

function createDeviceStore() {
  const entries = new Map<string, Draft[]>([
    [scopeKey(ALICE, RECORD_ONE), [...ALICE_DRAFTS]],
    [scopeKey(BOB, RECORD_TWO), [...BOB_DRAFTS]],
  ])
  const discarded: string[] = []
  const port: RetainedDraftStore<Draft> = {
    listScopes: async (userId) =>
      [...entries.keys()]
        .filter((key) => key.startsWith(`${userId}\u0000`))
        .map((key) => key.slice(userId.length + 1))
        .sort(),
    listDrafts: async ({ userId, recordId }) => [
      ...(entries.get(scopeKey(userId, recordId)) ?? []),
    ],
  }
  return {
    port,
    /** Every byte the device currently holds, for a before/after comparison. */
    device: () => JSON.stringify([...entries.entries()].sort()),
    /** The store's explicit discard path — signing out must never call it. */
    discard: (userId: string, recordId: string) => {
      discarded.push(scopeKey(userId, recordId))
      entries.delete(scopeKey(userId, recordId))
    },
    discarded,
  }
}

function createRetentionStorage(): SignOutRetentionStorage {
  return createInMemorySignOutRetentionStorage()
}

describe('EXP-05.5 sign-out retention', () => {
  it('leaves the device store untouched when a user signs out', async () => {
    const device = createDeviceStore()
    const before = device.device()
    const retention = createRetentionStorage()

    const marker = await retainDraftsOnSignOut(
      device.port,
      retention,
      ALICE,
      () => new Date('2026-10-10T09:00:00Z'),
    )

    expect(marker).toEqual({
      userId: ALICE,
      retained: 2,
      signedOutAt: '2026-10-10T09:00:00.000Z',
    })
    // Sign-out never discards: the store is byte-for-byte unchanged.
    expect(device.device()).toBe(before)
    expect(device.discarded).toEqual([])
    expect(retention.read()).toEqual(marker)
  })

  it('counts only the signing-out user’s drafts', async () => {
    const device = createDeviceStore()
    expect(await countRetainedDrafts(device.port, ALICE)).toBe(2)
    expect(await countRetainedDrafts(device.port, BOB)).toBe(1)
    expect(await countRetainedDrafts(device.port, 'user-nobody')).toBe(0)
  })

  it('gives the same user their edits back after signing in again', async () => {
    const device = createDeviceStore()
    await retainDraftsOnSignOut(device.port, createRetentionStorage(), ALICE)

    expect(await restoreDraftsForUser(device.port, ALICE)).toEqual([
      { recordId: RECORD_ONE, drafts: ALICE_DRAFTS },
    ])
  })

  it('never gives another user the signed-out user’s edits', async () => {
    const device = createDeviceStore()
    await retainDraftsOnSignOut(device.port, createRetentionStorage(), ALICE)

    const restored = await restoreDraftsForUser(device.port, BOB)

    expect(restored).toEqual([{ recordId: RECORD_TWO, drafts: BOB_DRAFTS }])
    expect(JSON.stringify(restored)).not.toContain('Alice')
  })

  it('round-trips the retention marker through web storage', async () => {
    const storage = webSignOutRetentionStorage(window.localStorage)
    storage.clear()
    const device = createDeviceStore()

    await retainDraftsOnSignOut(device.port, storage, BOB)

    expect(storage.read()).toMatchObject({ userId: BOB, retained: 1 })
  })

  it('wires the port straight onto the real device store', async () => {
    // The one-line-per-method wiring EXP-05.1 leaves us, exercised end to end.
    const store = createOfflineEditStore(createInMemoryStorage())
    const port: RetainedDraftStore<OfflineEdit> = {
      listScopes: (userId) => store.listScopes(userId),
      listDrafts: (scope) => store.listEdits(scope),
    }
    await store.putEdit(
      { userId: ALICE, recordId: RECORD_ONE },
      {
        kind: 'block_text',
        blockId: 'block-1',
        text: '4.2 mM',
        expectedRevision: 1,
      },
    )

    await retainDraftsOnSignOut(port, createRetentionStorage(), ALICE)

    // Still on the device, and only its owner can read it back.
    expect(await restoreDraftsForUser(port, ALICE)).toHaveLength(1)
    expect(await restoreDraftsForUser(port, BOB)).toEqual([])
  })
})
