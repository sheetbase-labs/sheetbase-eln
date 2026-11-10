'use client'

/**
 * EXP-05.2 — the client-side model the offline UI reads.
 *
 * The device store (`src/lib/offline/store.ts`, EXP-05.1) is the source of
 * truth for unsynced edits. This module turns one scope's stored edits into
 * what the offline surface needs: a target key per edit so a cell or block
 * can ask "am I unsynced?", a human description for the inspector list, and
 * the connection facts (online, last sync) the banner states.
 *
 * It deliberately owns no persistence and no replay (EXP-05.3): it reads the
 * store and renders. Nothing here decides whether an edit is allowed.
 */

import * as React from 'react'
import {
  blockEditTargetKey,
  cellEditTargetKey,
  offlineEditTargetKey,
  canEditBlockOffline,
  losslessPlainText,
  isConnectionDown,
} from './offline-edit-model'

import {
  useLiveCoordinator,
  useLiveStatus,
} from '#/components/live/live-event-provider'
import type { LiveStatus } from '#/lib/live-events'
import type { NotebookBlock } from '#/lib/notebook-data'
import type {
  OfflineEdit,
  OfflineEditScope,
  OfflineEditStore,
  OfflineJsonValue,
} from '#/lib/offline/store'

// ---------------------------------------------------------------------------
// Provider — one scope's unsynced edits, readable anywhere in the tree.
// ---------------------------------------------------------------------------

export interface OfflineEditsContextValue {
  /** The scope's unsynced edits, in replay order. */
  edits: OfflineEdit[]
  /** True until the device store has answered once. */
  loading: boolean
  /** How many edits are waiting to sync. */
  unsyncedCount: number
  /** Whether the given target key carries at least one unsynced edit. */
  isUnsynced: (targetKey: string) => boolean
  /** Re-read the device store (after a write, or on reconnect). */
  refresh: () => void
  /** True when this tree can keep text edits on the device for later. */
  canQueue: boolean
  /**
   * Keep a text block's latest text on the device to send later. A newer draft
   * replaces the block's earlier one, which keeps the revision it was first
   * based on. Returns false when the text cannot be kept without losing
   * formatting, so the caller can say so rather than pretend it saved.
   */
  queueBlockText: (
    block: { id: string; version: number },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw editor input is immediately decoded by losslessPlainText through canonical isRichTextPayload acceptance.
    payload: unknown,
  ) => Promise<boolean>
  /**
   * Keep a block's whole payload on the device to send later, whatever its
   * type. A newer draft replaces the block's earlier one and keeps the revision
   * the first was based on. Returns false for blocks that need the server.
   */
  queueBlockPayload: (
    block: {
      id: string
      type: string
      version: number
      payloadSchemaVersion: number
    },
    payload: NotebookBlock['payload'],
  ) => Promise<boolean>
  /** Keep sheet cell changes on the device to send later. */
  queueSheetCells: (
    sheet: { instanceId: string; revision: number },
    cells: Array<{ rowId: string; columnId: string; value: OfflineJsonValue }>,
  ) => Promise<void>
  /** Keep a row added to a sheet on the device, with the values it holds. */
  queueSheetRow: (
    sheet: { instanceId: string; revision: number },
    row: { rowKey: string; values: Record<string, OfflineJsonValue> },
  ) => Promise<void>
}

const EMPTY_OFFLINE_EDITS: OfflineEditsContextValue = {
  edits: [],
  loading: false,
  unsyncedCount: 0,
  isUnsynced: () => false,
  refresh: () => undefined,
  canQueue: false,
  queueBlockText: async () => false,
  queueBlockPayload: async () => false,
  queueSheetCells: async () => undefined,
  queueSheetRow: async () => undefined,
}

const OfflineEditsContext =
  React.createContext<OfflineEditsContextValue | null>(null)

export interface OfflineEditsProviderProps {
  /** The device store. Callers pass the IndexedDB one; tests pass in-memory. */
  store: OfflineEditStore
  /** The user and record whose edits this subtree shows. */
  scope: OfflineEditScope
  /** Change this (e.g. on reconnect) to re-read the store. */
  refreshKey?: unknown
  children: React.ReactNode
}

export function OfflineEditsProvider({
  store,
  scope,
  refreshKey,
  children,
}: OfflineEditsProviderProps) {
  const [edits, setEdits] = React.useState<OfflineEdit[]>([])
  const [loading, setLoading] = React.useState(true)
  const [nonce, setNonce] = React.useState(0)
  const refresh = React.useCallback(() => setNonce((value) => value + 1), [])

  React.useEffect(() => {
    let active = true
    setLoading(true)
    store
      .listEdits({ userId: scope.userId, recordId: scope.recordId })
      .then((next) => {
        if (!active) return
        setEdits(next)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setEdits([])
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [store, scope.userId, scope.recordId, refreshKey, nonce])

  const keys = React.useMemo(
    () => new Set(edits.map((edit) => offlineEditTargetKey(edit))),
    [edits],
  )

  const queueBlockText = React.useCallback<
    OfflineEditsContextValue['queueBlockText']
  >(
    async (block, payload) => {
      const text = losslessPlainText(payload)

      if (text === null) return false
      const scopeKey = { userId: scope.userId, recordId: scope.recordId }

      const earlier = (await store.listEdits(scopeKey)).filter(
        (edit) => edit.kind === 'block_text' && edit.blockId === block.id,
      )

      const expectedRevision = earlier.length
        ? Math.min(...earlier.map((edit) => edit.expectedRevision))
        : block.version

      if (earlier.length) {
        await store.removeEdits(
          scopeKey,
          earlier.map((edit) => edit.id),
        )
      }

      await store.putEdit(scopeKey, {
        kind: 'block_text',
        blockId: block.id,
        text,
        expectedRevision,
      })
      refresh()

      return true
    },
    [store, scope.userId, scope.recordId, refresh],
  )

  const queueBlockPayload = React.useCallback<
    OfflineEditsContextValue['queueBlockPayload']
  >(
    async (block, payload) => {
      if (!canEditBlockOffline(block.type)) return false
      const scopeKey = { userId: scope.userId, recordId: scope.recordId }

      const earlier = (await store.listEdits(scopeKey)).filter(
        (edit) =>
          (edit.kind === 'block_text' || edit.kind === 'block_payload') &&
          edit.blockId === block.id,
      )

      const expectedRevision = earlier.length
        ? Math.min(...earlier.map((edit) => edit.expectedRevision))
        : block.version

      if (earlier.length) {
        await store.removeEdits(
          scopeKey,
          earlier.map((edit) => edit.id),
        )
      }

      await store.putEdit(scopeKey, {
        kind: 'block_payload',
        blockId: block.id,
        blockType: block.type,
        payloadSchemaVersion: block.payloadSchemaVersion,
        // Legacy transport compatibility: JSON coercion is intentional; this cast does not validate the cloned contents.
        // oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Only this unchecked legacy transport cast; post-clone validation still belongs to the store.
        // react-doctor-disable-next-line no-json-parse-stringify-clone -- Preserve toJSON, omission and native serialization failures before the store validates.
        payload: JSON.parse(JSON.stringify(payload)) as Record<
          string,
          OfflineJsonValue
        >,
        // oxlint-enable anti-slop/require-safety-comment-for-type-assertion
        expectedRevision,
      })
      refresh()

      return true
    },
    [store, scope.userId, scope.recordId, refresh],
  )

  const queueSheetCells = React.useCallback<
    OfflineEditsContextValue['queueSheetCells']
  >(
    async (sheet, cells) => {
      const scopeKey = { userId: scope.userId, recordId: scope.recordId }
      const existing = await store.listEdits(scopeKey)

      for (const cell of cells) {
        // A cell typed into a row that was itself added offline joins that
        // row's draft, so replay creates the row with its values in one write.
        const row = existing.find(
          (edit) =>
            edit.kind === 'row' &&
            edit.sheetInstanceId === sheet.instanceId &&
            edit.rowKey === cell.rowId,
        )

        if (row && row.kind === 'row') {
          // react-doctor-disable-next-line async-await-in-loop -- Removal and insertion share one ordered queue; failure must stop all later writes.
          await store.removeEdits(scopeKey, [row.id])
          await store.putEdit(scopeKey, {
            kind: 'row',
            sheetInstanceId: sheet.instanceId,
            rowKey: row.rowKey,
            values: { ...row.values, [cell.columnId]: cell.value },
            expectedRevision: row.expectedRevision,
            id: row.id,
            createdAt: row.createdAt,
          })
          continue
        }

        // The same cell edited again replaces the earlier draft but keeps the
        // revision the first one was based on, so a conflict is still seen.
        const earlier = existing.find(
          (edit) =>
            edit.kind === 'cell' &&
            edit.sheetInstanceId === sheet.instanceId &&
            edit.rowId === cell.rowId &&
            edit.columnId === cell.columnId,
        )

        if (earlier) await store.removeEdits(scopeKey, [earlier.id])
        await store.putEdit(scopeKey, {
          kind: 'cell',
          sheetInstanceId: sheet.instanceId,
          rowId: cell.rowId,
          columnId: cell.columnId,
          value: cell.value,
          expectedRevision: earlier?.expectedRevision ?? sheet.revision,
        })
      }

      refresh()
    },
    [store, scope.userId, scope.recordId, refresh],
  )

  const queueSheetRow = React.useCallback<
    OfflineEditsContextValue['queueSheetRow']
  >(
    async (sheet, row) => {
      const scopeKey = { userId: scope.userId, recordId: scope.recordId }
      await store.putEdit(scopeKey, {
        kind: 'row',
        sheetInstanceId: sheet.instanceId,
        rowKey: row.rowKey,
        values: row.values,
        expectedRevision: sheet.revision,
      })
      refresh()
    },
    [store, scope.userId, scope.recordId, refresh],
  )

  const value = React.useMemo<OfflineEditsContextValue>(
    () => ({
      edits,
      loading,
      unsyncedCount: edits.length,
      isUnsynced: (targetKey: string) => keys.has(targetKey),
      refresh,
      canQueue: true,
      queueBlockText,
      queueBlockPayload,
      queueSheetCells,
      queueSheetRow,
    }),
    [
      edits,
      loading,
      keys,
      refresh,
      queueBlockText,
      queueBlockPayload,
      queueSheetCells,
      queueSheetRow,
    ],
  )

  return (
    <OfflineEditsContext.Provider value={value}>
      {children}
    </OfflineEditsContext.Provider>
  )
}

/** The scope's unsynced edits. Empty (and inert) without a provider. */
export function useOfflineEdits(): OfflineEditsContextValue {
  return React.useContext(OfflineEditsContext) ?? EMPTY_OFFLINE_EDITS
}

/** Whether the text block `blockId` has an unsynced local edit. */
export function useUnsyncedBlock(blockId: string): boolean {
  const { isUnsynced } = useOfflineEdits()

  return isUnsynced(blockEditTargetKey(blockId))
}

/**
 * A `cellState` callback for the Sheet grid that paints `unsynced` on cells
 * with a local edit. Stable per scope, so the grid's memoized cells are not
 * invalidated on every render.
 */
export function useUnsyncedCellState(
  sheetInstanceId: string,
): (rowId: string, columnId: string) => 'unsynced' | undefined {
  const { isUnsynced } = useOfflineEdits()

  return React.useCallback(
    (rowId: string, columnId: string) =>
      isUnsynced(cellEditTargetKey(sheetInstanceId, rowId, columnId))
        ? ('unsynced' as const)
        : undefined,
    [isUnsynced, sheetInstanceId],
  )
}

// ---------------------------------------------------------------------------
// Connection facts — the same live-event signal the app shell already uses.
// ---------------------------------------------------------------------------

/** True while the live-event stream is delivering (or still bootstrapping). */
export function useIsOnline(status?: LiveStatus): boolean {
  const coordinator = useLiveCoordinator()
  const live = useLiveStatus()

  if (status) return !isConnectionDown(status.status)

  // Without a mounted stream (SSR, a public route, a test render) there is no
  // evidence the connection is down, so nothing is claimed offline.
  if (!coordinator) return true

  return !isConnectionDown(live.status)
}

/**
 * When the stream last caught up: the wall-clock time the status became
 * `live` or last applied an event. Null until this tab has synced once, so
 * the banner can say "not synced yet" rather than invent a time.
 */
export function useLastSyncedAt(status: LiveStatus): string | null {
  const [lastSyncedAt, setLastSyncedAt] = React.useState<string | null>(null)
  const live = status.status === 'live'
  const seq = status.lastAppliedSeq
  React.useEffect(() => {
    if (!live && seq === 0) return
    setLastSyncedAt(new Date().toISOString())
  }, [live, seq])

  return lastSyncedAt
}
