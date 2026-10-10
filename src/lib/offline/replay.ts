/**
 * EXP-05.3 — offline replay (ADR-0018 amendment "durable offline edits").
 *
 * When the connection returns, the drafts the device store holds are sent back
 * in the order they were made. Each one goes through the same canonical write
 * path it would have used online — the block payload RPC, the sheet write path,
 * the comment RPC — carrying the expected revision the editor last saw:
 *
 *   - an edit whose expected revision still holds commits and is removed from
 *     the store, so a crash or a second replay cannot send it twice;
 *   - a stale sheet-cell edit is not overwritten: both sides are recorded as an
 *     open `api.sheet_cell_conflicts` row, the draft stays queued, and the
 *     calculations that depend on that cell are held with a stated reason;
 *   - a write the server refuses for any other reason stays queued and is never
 *     reported as committed.
 *
 * The engine is deliberately blind to *how* a commit happens: it drives an
 * `OfflineReplayPort`. The canonical port (`createCanonicalOfflineReplayWriter`)
 * calls the real RPCs; tests drive a fake port, so replay order, removal and
 * conflict bookkeeping are proven without a server.
 *
 * The engine owns no persistence and no connection state; `replayOfflineEdits`
 * is a pure function of the store's current contents plus the port.
 */

import type { DataClient } from '#/lib/data-client'
import { DataClientError, createDataClient } from '#/lib/data-client'
import { EMPTY_RICH_TEXT_PAYLOAD } from '#/lib/blocks'
import type { RichTextPayload } from '#/lib/blocks'
import { replyToComment } from '#/lib/comments-data'
import { updateBlockPayload } from '#/lib/notebook-mutations'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import { fetchSheetInstance } from '#/lib/sheet-instance-data'
import { mutateSheetLocalState } from '#/lib/sheet-local-data'
import {
  resolveSheetWriteTarget,
  writeSheetCells,
} from '#/lib/sheet-write-back'
import type { SheetWriteTarget } from '#/lib/sheet-write-back'
import type { OfflineEdit, OfflineEditScope, OfflineEditStore } from './store'

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** What happened to one queued edit during a replay. */
export type OfflineReplayStatus = 'committed' | 'conflict' | 'held' | 'failed'

/**
 * Why an edit did not commit. `overlap` is the only conflict reason: the
 * expected revision moved, so this edit and the server's change overlap.
 */
export type OfflineReplayReason =
  | 'overlap'
  | 'conflict_raise_failed'
  | 'sheet_conflict_unresolved'
  | 'refused'
  | 'commit_failed'

export interface OfflineReplayOutcome {
  editId: string
  sequence: number
  kind: OfflineEdit['kind']
  status: OfflineReplayStatus
  /** Null only for a committed edit. */
  reason: OfflineReplayReason | null
  /** One sentence for the surface that reports the result. */
  message: string
  /** The recorded conflict id, when the edit became a conflict row. */
  conflictId: string | null
  /** The sheet an outcome belongs to, or null for a text block. */
  sheetInstanceId: string | null
}

/**
 * A calculation held back by an unresolved conflict: the conflicted cell is an
 * input, so the columns computed from it cannot be trusted until a person
 * resolves the conflict. A stale non-cell edit (a queued row or comment)
 * blocks the same sheet without naming one cell, so the cell coordinates are
 * nullable.
 */
export interface HeldCalculation {
  sheetInstanceId: string
  rowId: string | null
  columnId: string | null
  conflictId: string | null
  /** Why it is held, in words a person can act on. */
  message: string
}

export interface OfflineReplayReport {
  /** Every queued edit, in the order it was considered. */
  outcomes: OfflineReplayOutcome[]
  committedEditIds: string[]
  conflicts: OfflineReplayOutcome[]
  held: OfflineReplayOutcome[]
  failed: OfflineReplayOutcome[]
  heldCalculations: HeldCalculation[]
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * An edit whose expected revision no longer matches: a port raises this (or a
 * `DataClientError` carrying `stale_version`/`conflict`) so the engine can turn
 * a cell overlap into a conflict rather than a generic failure.
 */
export class OfflineReplayOverlapError extends Error {
  constructor(
    message = 'The server moved past the revision this edit was based on.',
  ) {
    super(message)
    this.name = 'OfflineReplayOverlapError'
  }
}

/**
 * A write the server refused on its merits (validation, permission, a missing
 * target). Distinct from a transport failure so the report can say the server
 * refused rather than that the connection failed.
 */
export class OfflineReplayRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfflineReplayRefusedError'
  }
}

/** Whether a commit failure means this edit and the server now overlap. */
export function isOfflineReplayOverlap(error: unknown): boolean {
  if (error instanceof OfflineReplayOverlapError) return true
  if (error instanceof DataClientError) {
    if (error.code === 'stale_version' || error.code === 'conflict') return true
  }
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : ''
  if (code === 'SB001' || code === 'SB073') return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /SB001|SB073|stale|revision conflict/i.test(message)
}

function isRefused(error: unknown): boolean {
  if (error instanceof OfflineReplayRefusedError) return true
  if (error instanceof DataClientError)
    return error.status >= 400 && error.status < 500
  if (error instanceof Error) {
    if (error.name === 'ZodError') return true
    // The canonical sheet write path refuses a bad batch before writing.
    if (
      error.name === 'SheetBatchValidationError' ||
      error.name === 'SheetMixedAuthorityWriteError'
    )
      return true
    if (
      /unresolved_target|ambiguous_target|calculated_read_only/.test(
        error.message,
      )
    )
      return true
  }
  return false
}

function failureReason(error: unknown): OfflineReplayReason {
  return isRefused(error) ? 'refused' : 'commit_failed'
}

function failureMessage(error: unknown, reason: OfflineReplayReason): string {
  const detail = error instanceof Error ? error.message : String(error ?? '')
  return reason === 'refused'
    ? `The server refused this edit; it stays queued. ${detail}`.trim()
    : `This edit could not be sent; it stays queued. ${detail}`.trim()
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/** The one cell shape a conflict can be raised for. */
export type OfflineCellEdit = Extract<OfflineEdit, { kind: 'cell' }>

/**
 * Where a replay commits. The canonical implementation is
 * `createCanonicalOfflineReplayWriter`; a test doubles it to prove the
 * engine's order, removal and conflict bookkeeping without a server.
 */
export interface OfflineReplayPort {
  /** Send one edit through its canonical write path. */
  commit: (edit: OfflineEdit) => Promise<void>
  /**
   * Record both sides of an overlapping cell edit as an open conflict. Must be
   * idempotent: replaying the same edit returns the same open conflict rather
   * than creating a second one.
   */
  raiseCellConflict: (edit: OfflineCellEdit) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function sheetIdOf(edit: OfflineEdit): string | null {
  return edit.kind === 'block_text' ? null : edit.sheetInstanceId
}

/** Edits that move the sheet's revision, and so depend on its conflicts. */
function mutatesSheet(edit: OfflineEdit): boolean {
  return edit.kind === 'cell' || edit.kind === 'row'
}

function holdMessage(
  sheetInstanceId: string,
  blocked: HeldCalculation,
): string {
  const cell =
    blocked.rowId && blocked.columnId
      ? ` on row ${blocked.rowId} · ${blocked.columnId}`
      : ''
  return (
    `Held: ${sheetInstanceId} has an unresolved conflict${cell}, ` +
    'and this edit depends on it.'
  )
}

function conflictMessage(edit: OfflineEdit): string {
  return edit.kind === 'cell'
    ? 'This cell changed on the server since this device edited it; both values are kept as a conflict.'
    : 'The server moved past the revision this edit was based on; it is kept for review.'
}

/**
 * Replay every queued edit for one scope, in `sequence` order.
 *
 * Committed edits are removed from the store as they land, so a replay that
 * runs twice cannot send them again. Conflicted, held and failed edits stay
 * queued. A sheet that gains an unresolved conflict blocks later edits to the
 * same sheet (their calculations depend on the conflicted cell) and is reported
 * in `heldCalculations`.
 */
export async function replayOfflineEdits(input: {
  scope: OfflineEditScope
  store: OfflineEditStore
  port: OfflineReplayPort
}): Promise<OfflineReplayReport> {
  const edits = await input.store.listEdits(input.scope)
  const outcomes: OfflineReplayOutcome[] = []
  const committedEditIds: string[] = []
  const conflicts: OfflineReplayOutcome[] = []
  const held: OfflineReplayOutcome[] = []
  const failed: OfflineReplayOutcome[] = []
  const heldCalculations: HeldCalculation[] = []
  const blocked = new Map<string, HeldCalculation>()

  for (const edit of edits) {
    const sheetInstanceId = sheetIdOf(edit)
    const base = {
      editId: edit.id,
      sequence: edit.sequence,
      kind: edit.kind,
      sheetInstanceId,
    }

    const blocker =
      sheetInstanceId && mutatesSheet(edit)
        ? blocked.get(sheetInstanceId)
        : undefined
    if (blocker) {
      const outcome: OfflineReplayOutcome = {
        ...base,
        status: 'held',
        reason: 'sheet_conflict_unresolved',
        message: holdMessage(sheetInstanceId!, blocker),
        conflictId: blocker.conflictId,
      }
      held.push(outcome)
      outcomes.push(outcome)
      continue
    }

    try {
      await input.port.commit(edit)
    } catch (error) {
      if (isOfflineReplayOverlap(error)) {
        if (edit.kind === 'cell') {
          try {
            const conflictId = await input.port.raiseCellConflict(edit)
            const blockedCell: HeldCalculation = {
              sheetInstanceId: edit.sheetInstanceId,
              rowId: edit.rowId,
              columnId: edit.columnId,
              conflictId,
              message:
                `Calculations that depend on row ${edit.rowId} · ${edit.columnId} ` +
                'are held until this conflict is resolved.',
            }
            blocked.set(edit.sheetInstanceId, blockedCell)
            heldCalculations.push(blockedCell)
            const outcome: OfflineReplayOutcome = {
              ...base,
              status: 'conflict',
              reason: 'overlap',
              message: conflictMessage(edit),
              conflictId,
            }
            conflicts.push(outcome)
            outcomes.push(outcome)
          } catch (raiseError) {
            // The conflict could not be recorded, so the edit must not be
            // reported as one: it stays queued as a failure and the sheet is
            // not treated as blocked (there is no row to resolve).
            const outcome: OfflineReplayOutcome = {
              ...base,
              status: 'failed',
              reason: 'conflict_raise_failed',
              message:
                'This edit overlaps a server change, but the conflict could not be recorded; it stays queued. ' +
                (raiseError instanceof Error ? raiseError.message : ''),
              conflictId: null,
            }
            failed.push(outcome)
            outcomes.push(outcome)
          }
        } else {
          // A stale block/row/comment edit: keep it, and hold the sheet's
          // dependent work. There is no conflict row for these kinds.
          if (sheetInstanceId) {
            const blockedCell: HeldCalculation = {
              sheetInstanceId,
              rowId: null,
              columnId: null,
              conflictId: null,
              message: `A queued edit to ${sheetInstanceId} is stale and is held until it is reviewed.`,
            }
            blocked.set(sheetInstanceId, blockedCell)
            heldCalculations.push(blockedCell)
          }
          const outcome: OfflineReplayOutcome = {
            ...base,
            status: 'conflict',
            reason: 'overlap',
            message: conflictMessage(edit),
            conflictId: null,
          }
          conflicts.push(outcome)
          outcomes.push(outcome)
        }
      } else {
        const reason = failureReason(error)
        const outcome: OfflineReplayOutcome = {
          ...base,
          status: 'failed',
          reason,
          message: failureMessage(error, reason),
          conflictId: null,
        }
        failed.push(outcome)
        outcomes.push(outcome)
      }
      continue
    }

    // Committed: remove it before moving on so a crash cannot replay it.
    await input.store.removeEdits(input.scope, [edit.id])
    committedEditIds.push(edit.id)
    outcomes.push({
      ...base,
      status: 'committed',
      reason: null,
      message: 'Committed.',
      conflictId: null,
    })
  }

  return {
    outcomes,
    committedEditIds,
    conflicts,
    held,
    failed,
    heldCalculations,
  }
}

// ---------------------------------------------------------------------------
// Reconnect decision
// ---------------------------------------------------------------------------

/**
 * Whether a connection-status change is the moment to replay. The stream says
 * `live` once it is delivering; the transition *to* live (from reconnecting,
 * offline or the initial connect) is when queued drafts become sendable.
 * A tab that is already live does not replay on every unrelated status update.
 */
export function shouldReplayOfflineEdits(
  previousStatus: string,
  nextStatus: string,
): boolean {
  return nextStatus === 'live' && previousStatus !== 'live'
}

// ---------------------------------------------------------------------------
// Canonical port
// ---------------------------------------------------------------------------

/** One paragraph per line, so a plain-text draft becomes a valid payload. */
export function richTextPayloadFromText(text: string): RichTextPayload {
  const lines = text.split(/\r?\n/)
  if (text.length === 0) return EMPTY_RICH_TEXT_PAYLOAD
  return {
    doc: {
      type: 'doc',
      content: lines.map((line) =>
        line.length === 0
          ? { type: 'paragraph' as const }
          : {
              type: 'paragraph' as const,
              content: [{ type: 'text' as const, text: line }],
            },
      ),
    },
  }
}

/**
 * Stable pseudo-uuid for an edit's retry token. The sheet write RPCs dedupe by
 * retry token, so a replay that runs again after a crash must send the *same*
 * token for the same edit — never a fresh one, which would double-write.
 */
export function retryTokenForEdit(editId: string): string {
  const hash = (seed: number): string => {
    let value = seed >>> 0
    for (let index = 0; index < editId.length; index += 1) {
      value ^= editId.charCodeAt(index)
      value = Math.imul(value, 0x01000193) >>> 0
    }
    // A second round over the reversed string decorrelates the halves.
    for (let index = editId.length - 1; index >= 0; index -= 1) {
      value ^= editId.charCodeAt(index)
      value = Math.imul(value, 0x85ebca6b) >>> 0
    }
    return value.toString(16).padStart(8, '0')
  }
  const hex = (
    hash(0x811c9dc5) +
    hash(0x9e3779b9) +
    hash(0x85ebca6b) +
    hash(0xc2b2ae35)
  ).slice(0, 32)
  const versioned = `${hex.slice(0, 12)}4${hex.slice(13, 16)}`
  const variant = `${((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17)}`
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${variant.slice(0, 4)}-${variant.slice(4, 16)}`
}

/** The server's current value for one cell, or null when it cannot be read. */
async function readServerCellValue(
  instanceId: string,
  rowId: string,
  columnId: string,
  composition: ComposedSheetSnapshot | null,
  client: DataClient,
): Promise<unknown> {
  try {
    const projected = composition?.boundProjection?.rows.find(
      (row) => row.rowKey === rowId,
    )
    const bound = projected?.values[columnId]
    if (bound) return bound.kind === 'present' ? bound.value : null
    if (composition?.localFieldIds.includes(columnId)) {
      const instance = await fetchSheetInstance(instanceId, client)
      const row = instance?.state.localValues[rowId]
      return row && columnId in row ? row[columnId] : null
    }
  } catch {
    // A remote value we cannot read is recorded as absent rather than
    // invented; the conflict still carries the local side and the row/column.
  }
  return null
}

export interface CanonicalOfflineReplayWriterOptions {
  client?: DataClient
  /** The signed-in user, recorded as the local author of a raised conflict. */
  userId: string
}

/**
 * The canonical replay port: every draft goes through the write RPC its online
 * path uses, and an overlap becomes an `api.record_cell_conflict` row.
 *
 * Sheet revisions are tracked per instance because all of a device's queued
 * edits were made against the same revision the editor last saw; each local
 * write advances the instance revision by one, so the next draft expects the
 * advanced value while a concurrent server change still reads as an overlap.
 */
export function createCanonicalOfflineReplayWriter(
  options: CanonicalOfflineReplayWriterOptions,
): OfflineReplayPort {
  const client = options.client ?? createDataClient()
  const sheetRevisions = new Map<string, number>()
  const compositions = new Map<string, ComposedSheetSnapshot>()

  async function compositionFor(
    instanceId: string,
    fresh = false,
  ): Promise<ComposedSheetSnapshot> {
    if (fresh) compositions.delete(instanceId)
    const cached = compositions.get(instanceId)
    if (cached) return cached
    const next = await fetchComposedSheetRows(instanceId, {}, client)
    compositions.set(instanceId, next)
    return next
  }

  return {
    async commit(edit) {
      switch (edit.kind) {
        case 'block_text':
          await updateBlockPayload(client, {
            blockId: edit.blockId,
            payload: richTextPayloadFromText(edit.text),
            expectedVersion: edit.expectedRevision,
          })
          return

        case 'cell': {
          const composition = await compositionFor(edit.sheetInstanceId)
          const expected =
            sheetRevisions.get(edit.sheetInstanceId) ?? edit.expectedRevision
          if (composition.revision !== expected) {
            throw new OfflineReplayOverlapError(
              `Sheet revision ${composition.revision} is past the ${expected} this edit was based on.`,
            )
          }
          let target: SheetWriteTarget
          try {
            target = resolveSheetWriteTarget({
              composition,
              rowKey: edit.rowId,
              columnId: edit.columnId,
            })
          } catch (error) {
            // The cell no longer resolves in the current composition (a hidden
            // row, a retired column, a calculated column): a deterministic
            // refusal, not a transport failure.
            throw new OfflineReplayRefusedError(
              error instanceof Error ? error.message : 'unresolved cell target',
            )
          }
          await writeSheetCells(
            {
              composition,
              cells: [
                {
                  rowKey: edit.rowId,
                  columnId: edit.columnId,
                  value: edit.value,
                },
              ],
              retryToken: retryTokenForEdit(edit.id),
            },
            client,
          )
          // A local write bumps the instance revision; a bound write does not
          // (it moves the Dataset row or Record), so the pin only advances for
          // a local cell, and the next draft still reads a concurrent change
          // as an overlap.
          sheetRevisions.set(
            edit.sheetInstanceId,
            expected + (target.kind === 'local' ? 1 : 0),
          )
          compositions.delete(edit.sheetInstanceId)
          return
        }

        case 'row': {
          const expected =
            sheetRevisions.get(edit.sheetInstanceId) ?? edit.expectedRevision
          const rowKey = globalThis.crypto.randomUUID()
          const next = await mutateSheetLocalState(
            {
              instanceId: edit.sheetInstanceId,
              expectedRevision: expected,
              retryToken: retryTokenForEdit(edit.id),
              rows: [{ kind: 'local', rowKey }],
              cells: Object.entries(edit.values).map(([columnId, value]) => ({
                rowKey,
                fieldId: columnId,
                value,
              })),
            },
            client,
          )
          sheetRevisions.set(edit.sheetInstanceId, next.revision)
          compositions.delete(edit.sheetInstanceId)
          return
        }

        case 'comment': {
          if (!edit.parentId) {
            // The device store keeps a draft comment's body but not the cell or
            // row it was anchored to, and a sheet comment cannot exist without
            // an anchor. Refuse rather than invent one.
            throw new OfflineReplayRefusedError(
              'a draft comment has no cell or row anchor, so it cannot be created',
            )
          }
          await replyToComment(client, edit.parentId, edit.body, edit.mentions)
          return
        }
      }
    },

    async raiseCellConflict(edit) {
      let composition: ComposedSheetSnapshot | null = null
      try {
        composition = await compositionFor(edit.sheetInstanceId, true)
      } catch {
        // The conflict is still worth raising without a remote value: the
        // local side, row and column are enough for a person to decide.
      }
      const remoteValue = await readServerCellValue(
        edit.sheetInstanceId,
        edit.rowId,
        edit.columnId,
        composition,
        client,
      )
      const conflict = await client.rpc<{ id?: string } | null>(
        'record_cell_conflict',
        {
          p_instance_id: edit.sheetInstanceId,
          p_row_key: edit.rowId,
          p_field_id: edit.columnId,
          p_local_value: edit.value,
          p_local_author_user_id: options.userId,
          p_local_at: edit.createdAt,
          p_remote_value: remoteValue,
          p_remote_author_user_id: null,
          p_remote_at: null,
        },
      )
      return conflict?.id ?? null
    },
  }
}
