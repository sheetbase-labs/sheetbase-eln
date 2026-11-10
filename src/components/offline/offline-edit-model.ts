import { t } from '#/copy'
import { formatTime } from '#/lib/format-date'
import { isRichTextPayload, richTextToPlainText } from '#/lib/blocks'
import { richTextPayloadFromText } from '#/lib/offline/replay'
import type { LiveStatus } from '#/lib/live-events'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { OfflineEdit, OfflineJsonValue } from '#/lib/offline/store'

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

/** An added row has no server row id until replay. */
export function rowEditTargetKey(sheetInstanceId: string): string {
  return `row:${sheetInstanceId}`
}

export function commentEditTargetKey(sheetInstanceId: string): string {
  return `comment:${sheetInstanceId}`
}

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

/** Clock time for the last-sync note and edit list; invalid input stays visible. */
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

function previewValue(value: OfflineJsonValue | undefined): string {
  if (value === null || value === undefined) return 'empty'

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Dispatch stored JSON values without changing their native preview conversion.
  if (typeof value === 'string') return shortText(value, 40)

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Keep native JSON.stringify output and refusal rather than re-decoding the stored value.
  if (typeof value === 'object') return shortText(JSON.stringify(value), 40)

  return String(value)
}

function blockTypeLabel(type: string): string {
  return type.replace(/_/g, ' ')
}

/** The first readable strings of a payload, for the one-line description. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw block payloads first use the canonical rich-text parser; fallback traverses original native objects, not a schema-validated copy.
export function blockPayloadSummary(payload: unknown): string {
  if (isRichTextPayload(payload)) return richTextToPlainText(payload)
  const found: string[] = []

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native recursive enumeration preserves accessors, key order and thrown errors; it is not schema validation.
  const walk = (value: unknown, depth: number) => {
    if (found.length >= 4 || depth > 4) return

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Read text in place without coercing native nonstring values into fabricated summary facts.
    if (typeof value === 'string') {
      if (value.trim() && !/^[0-9a-f-]{20,}$/i.test(value)) found.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Preserve Object.entries on the original native object, including accessor order and failures.
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

export interface OfflineEditDescription {
  at: string
  title: string
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

/** Blocks edited in place, rather than created by a connection-requiring action. */
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
  'structure',
  'reaction',
])

export function canEditBlockOffline(type: string): boolean {
  return OFFLINE_EDITABLE_BLOCK_TYPES.has(type)
}

/** Refuse a plain-text replay when the canonical round trip loses formatting. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This raw boundary immediately delegates acceptance to the canonical isRichTextPayload parser.
export function losslessPlainText(payload: unknown): string | null {
  if (!isRichTextPayload(payload)) return null
  const text = richTextToPlainText(payload)
  const rebuilt = richTextPayloadFromText(text)

  return JSON.stringify(rebuilt) === JSON.stringify(payload) ? text : null
}

/** Overlay queued payloads without replacing untouched block objects. */
export function overlayQueuedBlocks<
  T extends Pick<NotebookBlock, 'id' | 'payload'>,
>(blocks: T[], edits: readonly OfflineEdit[]): T[] {
  const queued = new Map<
    string,
    | Extract<OfflineEdit, { kind: 'block_payload' }>['payload']
    | ReturnType<typeof richTextPayloadFromText>
  >()

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

/** Connecting is bootstrap, not evidence of connection failure. */
export function isConnectionDown(status: LiveStatus['status']): boolean {
  return status === 'reconnecting' || status === 'offline'
}
