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
import { formatTime } from '#/lib/format-date'
import * as React from 'react'

import { isRichTextPayload, richTextToPlainText } from '#/lib/blocks'
import { richTextPayloadFromText } from '#/lib/offline/replay'

import {
  useLiveCoordinator,
  useLiveStatus,
} from '#/components/live/live-event-provider'
import type { LiveStatus } from '#/lib/live-events'
import type {
  OfflineEdit,
  OfflineEditScope,
  OfflineEditStore,
  OfflineJsonValue,
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
    case 'block_payload':
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
  return formatTime(date)
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

function blockTypeLabel(type: string): string {
  return type.replace(/_/g, ' ')
}

/** The first readable strings of a payload, for the one-line description. */
export function blockPayloadSummary(payload: unknown): string {
  if (isRichTextPayload(payload)) return richTextToPlainText(payload)
  const found: string[] = []
  const walk = (value: unknown, depth: number) => {
    if (found.length >= 4 || depth > 4) return
    if (typeof value === 'string') {
      if (value.trim() && !/^[0-9a-f-]{20,}$/i.test(value)) found.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        // Ids, kinds and keys are plumbing, not what the person wrote.
        if (/^(id|type|kind|key)$|Id$|_id$/.test(key)) continue
        walk(item, depth + 1)
      }
    }
  }
  walk(payload, 0)
  return found.join(' · ')
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
    case 'block_payload':
      return {
        at: edit.createdAt,
        title: t('notebook.offlineEdits.editedBlockTitle', {
          blockType: blockTypeLabel(edit.blockType),
        }),
        detail:
          shortText(blockPayloadSummary(edit.payload)) ||
          t('notebook.offlineEdits.detail'),
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
    payload: Record<string, unknown>,
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

/**
 * Block types whose payload is edited in place and can be sent back later.
 * The rest (files, dataset imports, pipeline output, signatures, linked
 * records) are made by a server action, so they say they need a connection.
 */
export const OFFLINE_EDITABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'rich_text',
  'checklist',
  'callout',
  'conclusion',
  'metric',
  'procedure_step',
  'materials',
  'plate_map',
  'corrective_actions',
  // The drawing needs the editor, which loads on demand; the rest is typed.
  'structure',
  'reaction',
])

export function canEditBlockOffline(type: string): boolean {
  return OFFLINE_EDITABLE_BLOCK_TYPES.has(type)
}

/**
 * The plain text of a rich-text payload, or null when plain text would lose
 * something (formatting, headings, lists, links). Only a lossless round trip
 * is kept offline, because replay rebuilds the block from text alone.
 */
export function losslessPlainText(payload: unknown): string | null {
  if (!isRichTextPayload(payload)) return null
  const text = richTextToPlainText(payload)
  const rebuilt = richTextPayloadFromText(text)
  return JSON.stringify(rebuilt) === JSON.stringify(payload) ? text : null
}

/**
 * The blocks as the person left them: each block with a queued edit shows the
 * queued payload, so a re-render or reload does not put the server's older
 * text back in front of them while the edit waits to sync. Blocks without a
 * queued edit are returned untouched.
 */
export function overlayQueuedBlocks<
  T extends { id: string; payload: Record<string, unknown> },
>(blocks: T[], edits: readonly OfflineEdit[]): T[] {
  const queued = new Map<string, Record<string, unknown>>()
  for (const edit of edits) {
    if (edit.kind === 'block_payload') queued.set(edit.blockId, edit.payload)
    else if (edit.kind === 'block_text') {
      queued.set(edit.blockId, richTextPayloadFromText(edit.text))
    }
  }
  if (queued.size === 0) return blocks
  return blocks.map((block) => {
    const payload = queued.get(block.id)
    return payload ? { ...block, payload } : block
  })
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
        payload: JSON.parse(JSON.stringify(payload)) as Record<
          string,
          OfflineJsonValue
        >,
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
