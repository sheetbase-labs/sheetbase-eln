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

import { t } from '#/copy'
import * as React from 'react'

import {
  useLiveCoordinator,
  useLiveStatus,
} from '#/components/live/live-event-provider'
import type { LiveStatus } from '#/lib/live-events'
import type {
  OfflineEdit,
  OfflineEditScope,
  OfflineEditStore,
} from '#/lib/offline/store'

// ---------------------------------------------------------------------------
// Targets — where an unsynced edit belongs, as a comparable key.
// ---------------------------------------------------------------------------

/** Target key for an unsynced text-block edit. */
export function blockEditTargetKey(blockId: string): string {
  return `block:${blockId}`
}

/** Target key for an unsynced sheet-cell edit. */
export function cellEditTargetKey(
  sheetInstanceId: string,
  rowId: string,
  columnId: string,
): string {
  return `cell:${sheetInstanceId}:${rowId}:${columnId}`
}

/**
 * Target key for an unsynced added sheet row. A row draft carries no row id
 * yet (the server mints it on replay), so it marks the Sheet the row belongs
 * to.
 */
export function rowEditTargetKey(sheetInstanceId: string): string {
  return `row:${sheetInstanceId}`
}

/** Target key for an unsynced draft comment. */
export function commentEditTargetKey(sheetInstanceId: string): string {
  return `comment:${sheetInstanceId}`
}

/** The target key an edit marks, whatever its kind. */
export function offlineEditTargetKey(edit: OfflineEdit): string {
  switch (edit.kind) {
    case 'block_text':
      return blockEditTargetKey(edit.blockId)
    case 'cell':
      return cellEditTargetKey(edit.sheetInstanceId, edit.rowId, edit.columnId)
    case 'row':
      return rowEditTargetKey(edit.sheetInstanceId)
    case 'comment':
      return commentEditTargetKey(edit.sheetInstanceId)
  }
}

// ---------------------------------------------------------------------------
// Descriptions — one honest line per unsynced edit for the inspector list.
// ---------------------------------------------------------------------------

/** Clock time, e.g. "10:02", for the last-sync note and the edit list. */
export function formatClockTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function shortText(value: string, limit = 60): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1)}…`
    : collapsed
}

function previewValue(value: unknown): string {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'string') return shortText(value, 40)
  if (typeof value === 'object') return shortText(JSON.stringify(value), 40)
  return String(value)
}

/** A readable, id-grounded description of one unsynced edit. */
export interface OfflineEditDescription {
  /** ISO timestamp the edit was made. */
  at: string
  /** What changed, e.g. "Edited a Sheet cell". */
  title: string
  /** The detail line, e.g. "Load (L/m²) · row 6 · 4.1". */
  detail: string
}

export function describeOfflineEdit(edit: OfflineEdit): OfflineEditDescription {
  switch (edit.kind) {
    case 'block_text':
      return {
        at: edit.createdAt,
        title: t('notebook.offlineEdits.title'),
        detail: shortText(edit.text) || t('notebook.offlineEdits.detail'),
      }
    case 'cell':
      return {
        at: edit.createdAt,
        title: t('notebook.offlineEdits.editedASheetCellTitle'),
        detail: t('notebook.offlineEdits.detail2', {
          columnId: edit.columnId,
          rowId: edit.rowId,
          previewValue: previewValue(edit.value),
        }),
      }
    case 'row':
      return {
        at: edit.createdAt,
        title: t('notebook.offlineEdits.addedASheetRowTitle'),
        detail: t('notebook.offlineEdits.values', {
          count: Object.keys(edit.values).length,
        }),
      }
    case 'comment':
      return {
        at: edit.createdAt,
        title: t('notebook.offlineEdits.addedACommentTitle'),
        detail: shortText(edit.body) || t('notebook.offlineEdits.detail3'),
      }
  }
}

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
}

const EMPTY_OFFLINE_EDITS: OfflineEditsContextValue = {
  edits: [],
  loading: false,
  unsyncedCount: 0,
  isUnsynced: () => false,
  refresh: () => undefined,
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

  const value = React.useMemo<OfflineEditsContextValue>(
    () => ({
      edits,
      loading,
      unsyncedCount: edits.length,
      isUnsynced: (targetKey: string) => keys.has(targetKey),
      refresh,
    }),
    [edits, loading, keys, refresh],
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

/**
 * Whether the live-event stream is down, from its status. `connecting` is a
 * bootstrap state (the outcome is not yet known) and `live` is healthy;
 * `reconnecting` and `offline` both mean the stream is not delivering, which
 * is what the offline surface and connection-requiring actions key on.
 */
export function isConnectionDown(status: LiveStatus['status']): boolean {
  return status === 'reconnecting' || status === 'offline'
}

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
