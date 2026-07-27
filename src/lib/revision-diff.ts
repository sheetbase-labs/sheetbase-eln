export type RevisionChangeKind = 'added' | 'removed' | 'modified' | 'moved'

export type RevisionChangeArea =
  | 'metadata'
  | 'blocks'
  | 'text'
  | 'checklists'
  | 'links'
  | 'tables'
  | 'formulas'
  | 'files'

type RevisionEntity = Record<string, unknown>

export type CanonicalRevisionEntity = RevisionEntity & { id: string }

export interface CanonicalRevisionEnvelope {
  formatVersion: number
  record: RevisionEntity
  blocks: CanonicalRevisionEntity[]
  links: CanonicalRevisionEntity[]
  scientificTables: CanonicalRevisionEntity[]
  formulas: CanonicalRevisionEntity[]
  files: CanonicalRevisionEntity[]
}

export interface RevisionChange {
  id: string
  area: RevisionChangeArea
  kind: RevisionChangeKind
  identity: string
  label: string
  path: string[]
  before?: unknown
  after?: unknown
  beforeOrder?: number
  afterOrder?: number
  beforeUnit?: string
  afterUnit?: string
  tableId?: string
  rowId?: string
  columnId?: string
}

export interface RevisionTableDiffSummary {
  tableId: string
  label: string
  addedRows: number
  removedRows: number
  modifiedCells: number
  schemaChanges: number
  changes: RevisionChange[]
}

export interface RevisionDiffResult {
  changes: RevisionChange[]
  counts: Record<RevisionChangeKind, number>
  tableSummaries: RevisionTableDiffSummary[]
  unchanged: boolean
}

const AREA_ORDER: Record<RevisionChangeArea, number> = {
  metadata: 0,
  blocks: 1,
  text: 2,
  checklists: 3,
  links: 4,
  tables: 5,
  formulas: 6,
  files: 7,
}

const KIND_ORDER: Record<RevisionChangeKind, number> = {
  added: 0,
  removed: 1,
  moved: 2,
  modified: 3,
}

const TECHNICAL_FIELDS = new Set([
  'createdAt',
  'created_at',
  'createdByUserId',
  'created_by_user_id',
  'updatedAt',
  'updated_at',
  'updatedByUserId',
  'updated_by_user_id',
  'version',
  'metadataVersion',
  'metadata_version',
  'structureVersion',
  'structure_version',
  'schemaVersion',
  'schema_version',
  'payloadSchemaVersion',
  'payload_schema_version',
])

const MISSING = Symbol('missing revision value')

function isEntity(value: unknown): value is RevisionEntity {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableIdentity(value: RevisionEntity): string | null {
  return typeof value.id === 'string' ? value.id : null
}

function exactEqual(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true
  if (Array.isArray(before) && Array.isArray(after)) {
    return (
      before.length === after.length &&
      before.every((value, index) => exactEqual(value, after[index]))
    )
  }
  if (isEntity(before) && isEntity(after)) {
    const beforeKeys = Object.keys(before).sort()
    const afterKeys = Object.keys(after).sort()
    return (
      beforeKeys.length === afterKeys.length &&
      beforeKeys.every(
        (key, index) =>
          key === afterKeys[index] && exactEqual(before[key], after[key]),
      )
    )
  }
  return false
}

function humanise(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function displayName(entity: RevisionEntity, fallback: string): string {
  for (const key of [
    'displayName',
    'display_name',
    'title',
    'name',
    'targetIdentifier',
    'target_identifier',
    'identifier',
    'formula_text',
  ]) {
    if (typeof entity[key] === 'string' && entity[key]) {
      return String(entity[key])
    }
  }
  return fallback
}

function changeId(
  area: RevisionChangeArea,
  identity: string,
  path: string[],
  kind: RevisionChangeKind,
): string {
  return [area, identity, path.join('.') || 'entity', kind]
    .map(encodeURIComponent)
    .join(':')
}

function makeChange(change: Omit<RevisionChange, 'id'>): RevisionChange {
  return {
    id: changeId(change.area, change.identity, change.path, change.kind),
    ...change,
  }
}

function compareValue({
  area,
  identity,
  label,
  path,
  before,
  after,
  changes,
  table,
}: {
  area: RevisionChangeArea
  identity: string
  label: string
  path: string[]
  before: unknown | typeof MISSING
  after: unknown | typeof MISSING
  changes: RevisionChange[]
  table?: Pick<RevisionChange, 'tableId' | 'rowId' | 'columnId'>
}) {
  if (before !== MISSING && after !== MISSING && exactEqual(before, after)) {
    return
  }
  if (isEntity(before) && isEntity(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of [...keys].sort()) {
      if (TECHNICAL_FIELDS.has(key) || key === 'id') continue
      compareValue({
        area,
        identity,
        label,
        path: [...path, key],
        before: Object.hasOwn(before, key) ? before[key] : MISSING,
        after: Object.hasOwn(after, key) ? after[key] : MISSING,
        changes,
        table,
      })
    }
    return
  }

  const kind: RevisionChangeKind =
    before === MISSING ? 'added' : after === MISSING ? 'removed' : 'modified'
  changes.push(
    makeChange({
      area,
      identity,
      label: path.length > 0 ? `${label} — ${humanise(path.at(-1)!)}` : label,
      path,
      kind,
      ...(before === MISSING ? {} : { before }),
      ...(after === MISSING ? {} : { after }),
      ...table,
    }),
  )
}

function byIdentity(items: RevisionEntity[]): Map<string, RevisionEntity> {
  return new Map(
    items.map((item) => {
      const id = stableIdentity(item)
      if (!id) {
        throw new Error(
          'Canonical revision entity is missing a stable string identity',
        )
      }
      return [id, item] as const
    }),
  )
}

function orderValue(entity: RevisionEntity, fallback: number): number {
  for (const key of ['order', 'displayOrder', 'display_order']) {
    if (typeof entity[key] === 'number') return entity[key]
  }
  return fallback
}

function orderedIds(items: RevisionEntity[]): string[] {
  return items
    .map((item, index) => ({
      id: stableIdentity(item),
      order: orderValue(item, index),
    }))
    .filter((item): item is { id: string; order: number } => item.id !== null)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((item) => item.id)
}

/** Identities outside a deterministic longest common subsequence truly moved. */
function movedIdentities(beforeIds: string[], afterIds: string[]): Set<string> {
  const common = new Set(beforeIds.filter((id) => afterIds.includes(id)))
  const before = beforeIds.filter((id) => common.has(id))
  const after = afterIds.filter((id) => common.has(id))
  const lengths = Array.from({ length: before.length + 1 }, () =>
    Array<number>(after.length + 1).fill(0),
  )

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        before[i] === after[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const unchangedOrder = new Set<string>()
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      unchangedOrder.add(before[i])
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }
  return new Set([...common].filter((id) => !unchangedOrder.has(id)))
}

function compareEntityCollection({
  area,
  before,
  after,
  label,
  changes,
}: {
  area: Exclude<RevisionChangeArea, 'metadata' | 'tables'>
  before: RevisionEntity[]
  after: RevisionEntity[]
  label: (entity: RevisionEntity, id: string) => string
  changes: RevisionChange[]
}) {
  const beforeMap = byIdentity(before)
  const afterMap = byIdentity(after)
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()])
  for (const id of [...ids].sort()) {
    const previous = beforeMap.get(id)
    const next = afterMap.get(id)
    if (!previous || !next) {
      const entity = previous ?? next!
      changes.push(
        makeChange({
          area,
          identity: id,
          label: label(entity, id),
          path: [],
          kind: previous ? 'removed' : 'added',
          ...(previous ? { before: previous } : { after: next }),
        }),
      )
      continue
    }
    compareValue({
      area,
      identity: id,
      label: label(next, id),
      path: [],
      before: previous,
      after: next,
      changes,
    })
  }
}

function blockArea(type: unknown): RevisionChangeArea {
  const value = String(type ?? '').toLowerCase()
  if (value.includes('checklist')) return 'checklists'
  if (/text|heading|note|paragraph/.test(value)) return 'text'
  return 'blocks'
}

function richTextValue(payload: RevisionEntity): string | null {
  if (!isEntity(payload.doc) || payload.doc.type !== 'doc') return null

  function nodeText(node: unknown): string {
    if (!isEntity(node)) return ''
    if (node.type === 'text')
      return typeof node.text === 'string' ? node.text : ''
    if (!Array.isArray(node.content)) return ''
    const separator =
      node.type === 'doc' ||
      node.type === 'bulletList' ||
      node.type === 'orderedList' ||
      node.type === 'listItem'
        ? '\n'
        : ''
    return node.content.map(nodeText).join(separator)
  }

  return nodeText(payload.doc).trim()
}

function checklistItems(items: RevisionEntity[]): Map<string, RevisionEntity> {
  const occurrences = new Map<string, number>()
  return new Map(
    items.map((item, index) => {
      const id = stableIdentity(item)
      if (id) return [`id:${id}`, item]
      if (typeof item.text === 'string') {
        const occurrence = occurrences.get(item.text) ?? 0
        occurrences.set(item.text, occurrence + 1)
        return [`text:${item.text}:${occurrence}`, item]
      }
      return [`index:${index}`, item]
    }),
  )
}

function compareChecklist(
  blockId: string,
  beforePayload: RevisionEntity,
  afterPayload: RevisionEntity,
  changes: RevisionChange[],
) {
  const beforeItems = Array.isArray(beforePayload.items)
    ? beforePayload.items.filter(isEntity)
    : []
  const afterItems = Array.isArray(afterPayload.items)
    ? afterPayload.items.filter(isEntity)
    : []
  const beforeMap = checklistItems(beforeItems)
  const afterMap = checklistItems(afterItems)
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()])
  for (const id of [...ids].sort()) {
    const previous = beforeMap.get(id)
    const next = afterMap.get(id)
    const identity = `${blockId}:${id}`
    const item = next ?? previous!
    const label = displayName(item, `Checklist item ${id}`)
    compareValue({
      area: 'checklists',
      identity,
      label,
      path: [],
      before: previous ?? MISSING,
      after: next ?? MISSING,
      changes,
    })
  }
}

function compareBlocks(
  before: RevisionEntity[],
  after: RevisionEntity[],
  changes: RevisionChange[],
) {
  const beforeMap = byIdentity(before)
  const afterMap = byIdentity(after)
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()])
  const moved = movedIdentities(orderedIds(before), orderedIds(after))

  for (const id of [...ids].sort()) {
    const previous = beforeMap.get(id)
    const next = afterMap.get(id)
    const entity = next ?? previous!
    const label = displayName(entity, `Block ${id}`)
    if (!previous || !next) {
      changes.push(
        makeChange({
          area: 'blocks',
          identity: id,
          label,
          path: [],
          kind: previous ? 'removed' : 'added',
          ...(previous ? { before: previous } : { after: next }),
        }),
      )
      continue
    }
    if (moved.has(id)) {
      changes.push(
        makeChange({
          area: 'blocks',
          identity: id,
          label,
          path: ['order'],
          kind: 'moved',
          beforeOrder: orderValue(previous, before.indexOf(previous)),
          afterOrder: orderValue(next, after.indexOf(next)),
        }),
      )
    }

    const beforeTop = { ...previous }
    const afterTop = { ...next }
    delete beforeTop.payload
    delete beforeTop.order
    delete afterTop.payload
    delete afterTop.order
    compareValue({
      area: 'blocks',
      identity: id,
      label,
      path: [],
      before: beforeTop,
      after: afterTop,
      changes,
    })

    const beforePayload = isEntity(previous.payload) ? previous.payload : {}
    const afterPayload = isEntity(next.payload) ? next.payload : {}
    const area = blockArea(next.type ?? previous.type)
    if (area === 'checklists') {
      compareChecklist(id, beforePayload, afterPayload, changes)
      const beforeRest = { ...beforePayload }
      const afterRest = { ...afterPayload }
      delete beforeRest.items
      delete afterRest.items
      compareValue({
        area,
        identity: id,
        label,
        path: [],
        before: beforeRest,
        after: afterRest,
        changes,
      })
    } else if (String(next.type ?? previous.type) === 'rich_text') {
      const beforeText = richTextValue(beforePayload)
      const afterText = richTextValue(afterPayload)
      if (beforeText !== afterText) {
        compareValue({
          area: 'text',
          identity: id,
          label,
          path: ['doc'],
          before: beforeText ?? MISSING,
          after: afterText ?? MISSING,
          changes,
        })
      } else if (!exactEqual(beforePayload.doc, afterPayload.doc)) {
        compareValue({
          area: 'text',
          identity: id,
          label: `${label} — Formatting`,
          path: ['doc'],
          before: beforePayload.doc ?? MISSING,
          after: afterPayload.doc ?? MISSING,
          changes,
        })
      }
      const beforeRest = { ...beforePayload }
      const afterRest = { ...afterPayload }
      delete beforeRest.doc
      delete afterRest.doc
      compareValue({
        area: 'text',
        identity: id,
        label,
        path: [],
        before: beforeRest,
        after: afterRest,
        changes,
      })
    } else {
      compareValue({
        area,
        identity: id,
        label,
        path: [],
        before: beforePayload,
        after: afterPayload,
        changes,
      })
    }
  }
}

function tableColumnName(column: RevisionEntity, id: string): string {
  return displayName(column, `Column ${id}`)
}

function tableColumnKey(column: RevisionEntity): string | null {
  for (const key of ['apiName', 'api_name', 'field_name', 'name']) {
    if (typeof column[key] === 'string') return column[key]
  }
  return null
}

function tableColumnUnit(column: RevisionEntity): string | undefined {
  return typeof column.unit === 'string' ? column.unit : undefined
}

function compareTables(
  beforeTables: RevisionEntity[],
  afterTables: RevisionEntity[],
  changes: RevisionChange[],
): RevisionTableDiffSummary[] {
  const beforeMap = byIdentity(beforeTables)
  const afterMap = byIdentity(afterTables)
  const tableIds = new Set([...beforeMap.keys(), ...afterMap.keys()])
  const summaries: RevisionTableDiffSummary[] = []

  for (const tableId of [...tableIds].sort()) {
    const previous = beforeMap.get(tableId)
    const next = afterMap.get(tableId)
    const table = next ?? previous!
    const label = displayName(table, `Table ${tableId}`)
    const tableChanges: RevisionChange[] = []
    if (!previous || !next) {
      const evidence = previous ?? next!
      const summaryValue = {
        columns: Array.isArray(evidence.columns) ? evidence.columns.length : 0,
        rows: Array.isArray(evidence.rows) ? evidence.rows.length : 0,
      }
      tableChanges.push(
        makeChange({
          area: 'tables',
          identity: tableId,
          label,
          path: [],
          kind: previous ? 'removed' : 'added',
          tableId,
          ...(previous ? { before: summaryValue } : { after: summaryValue }),
        }),
      )
    } else {
      const beforeTop = { ...previous }
      const afterTop = { ...next }
      delete beforeTop.columns
      delete beforeTop.rows
      delete afterTop.columns
      delete afterTop.rows
      compareValue({
        area: 'tables',
        identity: tableId,
        label,
        path: [],
        before: beforeTop,
        after: afterTop,
        changes: tableChanges,
        table: { tableId },
      })

      const beforeColumns = Array.isArray(previous.columns)
        ? previous.columns.filter(isEntity)
        : []
      const afterColumns = Array.isArray(next.columns)
        ? next.columns.filter(isEntity)
        : []
      const beforeColumnMap = byIdentity(beforeColumns)
      const afterColumnMap = byIdentity(afterColumns)
      const columnIds = new Set([
        ...beforeColumnMap.keys(),
        ...afterColumnMap.keys(),
      ])
      const movedColumns = movedIdentities(
        orderedIds(beforeColumns),
        orderedIds(afterColumns),
      )
      for (const columnId of [...columnIds].sort()) {
        const beforeColumn = beforeColumnMap.get(columnId)
        const afterColumn = afterColumnMap.get(columnId)
        const column = afterColumn ?? beforeColumn!
        const columnLabel = tableColumnName(column, columnId)
        const identity = `${tableId}:${columnId}`
        if (!beforeColumn || !afterColumn) {
          tableChanges.push(
            makeChange({
              area: 'tables',
              identity,
              label: `${label} — ${columnLabel}`,
              path: ['columns', columnId],
              kind: beforeColumn ? 'removed' : 'added',
              tableId,
              columnId,
              ...(beforeColumn
                ? { before: beforeColumn }
                : { after: afterColumn }),
            }),
          )
          continue
        }
        if (movedColumns.has(columnId)) {
          tableChanges.push(
            makeChange({
              area: 'tables',
              identity,
              label: `${label} — ${columnLabel}`,
              path: ['columns', columnId, 'order'],
              kind: 'moved',
              beforeOrder: orderValue(
                beforeColumn,
                beforeColumns.indexOf(beforeColumn),
              ),
              afterOrder: orderValue(
                afterColumn,
                afterColumns.indexOf(afterColumn),
              ),
              tableId,
              columnId,
            }),
          )
        }
        compareValue({
          area: 'tables',
          identity,
          label: `${label} — ${columnLabel}`,
          path: ['columns', columnId],
          before: Object.fromEntries(
            Object.entries(beforeColumn).filter(
              ([key]) =>
                !['order', 'displayOrder', 'display_order'].includes(key),
            ),
          ),
          after: Object.fromEntries(
            Object.entries(afterColumn).filter(
              ([key]) =>
                !['order', 'displayOrder', 'display_order'].includes(key),
            ),
          ),
          changes: tableChanges,
          table: { tableId, columnId },
        })
      }

      const beforeRows = Array.isArray(previous.rows)
        ? previous.rows.filter(isEntity)
        : []
      const afterRows = Array.isArray(next.rows)
        ? next.rows.filter(isEntity)
        : []
      const beforeRowMap = byIdentity(beforeRows)
      const afterRowMap = byIdentity(afterRows)
      const rowIds = new Set([...beforeRowMap.keys(), ...afterRowMap.keys()])
      for (const rowId of [...rowIds].sort()) {
        const beforeRow = beforeRowMap.get(rowId)
        const afterRow = afterRowMap.get(rowId)
        if (!beforeRow || !afterRow) {
          tableChanges.push(
            makeChange({
              area: 'tables',
              identity: `${tableId}:${rowId}`,
              label: `${label} — Row ${rowId}`,
              path: ['rows', rowId],
              kind: beforeRow ? 'removed' : 'added',
              tableId,
              rowId,
              ...(beforeRow ? { before: beforeRow } : { after: afterRow }),
            }),
          )
          continue
        }
        for (const columnId of [...columnIds].sort()) {
          const beforeColumn = beforeColumnMap.get(columnId)
          const afterColumn = afterColumnMap.get(columnId)
          if (!beforeColumn || !afterColumn) continue
          const beforeKey = tableColumnKey(beforeColumn)
          const afterKey = tableColumnKey(afterColumn)
          if (!beforeKey || !afterKey) continue
          const beforeValue = Object.hasOwn(beforeRow, beforeKey)
            ? beforeRow[beforeKey]
            : MISSING
          const afterValue = Object.hasOwn(afterRow, afterKey)
            ? afterRow[afterKey]
            : MISSING
          if (
            beforeValue !== MISSING &&
            afterValue !== MISSING &&
            exactEqual(beforeValue, afterValue)
          ) {
            continue
          }
          const kind: RevisionChangeKind =
            beforeValue === MISSING
              ? 'added'
              : afterValue === MISSING
                ? 'removed'
                : 'modified'
          const columnLabel = tableColumnName(afterColumn, columnId)
          tableChanges.push(
            makeChange({
              area: 'tables',
              identity: `${tableId}:${rowId}:${columnId}`,
              label: `${label} — Row ${rowId}, ${columnLabel}`,
              path: ['rows', rowId, columnId],
              kind,
              ...(beforeValue === MISSING ? {} : { before: beforeValue }),
              ...(afterValue === MISSING ? {} : { after: afterValue }),
              beforeUnit: tableColumnUnit(beforeColumn),
              afterUnit: tableColumnUnit(afterColumn),
              tableId,
              rowId,
              columnId,
            }),
          )
        }
      }
    }

    if (tableChanges.length > 0) {
      tableChanges.sort(compareChanges)
      changes.push(...tableChanges)
      summaries.push({
        tableId,
        label,
        addedRows: tableChanges.filter(
          (change) =>
            change.rowId && !change.columnId && change.kind === 'added',
        ).length,
        removedRows: tableChanges.filter(
          (change) =>
            change.rowId && !change.columnId && change.kind === 'removed',
        ).length,
        modifiedCells: tableChanges.filter(
          (change) => change.rowId && change.columnId,
        ).length,
        schemaChanges: tableChanges.filter((change) => !change.rowId).length,
        changes: tableChanges,
      })
    }
  }
  return summaries
}

function compareChanges(a: RevisionChange, b: RevisionChange): number {
  return (
    AREA_ORDER[a.area] - AREA_ORDER[b.area] ||
    a.identity.localeCompare(b.identity) ||
    a.path.join('.').localeCompare(b.path.join('.')) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  )
}

/**
 * Compare two immutable canonical revision envelopes. The result is stable for
 * identical inputs and retains source values without scientific reformatting.
 */
export function diffRevisionEnvelopes(
  before: CanonicalRevisionEnvelope,
  after: CanonicalRevisionEnvelope,
): RevisionDiffResult {
  const changes: RevisionChange[] = []
  compareValue({
    area: 'metadata',
    identity: String(after.record.id ?? before.record.id ?? 'record'),
    label: 'Record metadata',
    path: [],
    before: before.record,
    after: after.record,
    changes,
  })
  compareBlocks(before.blocks, after.blocks, changes)
  compareEntityCollection({
    area: 'links',
    before: before.links,
    after: after.links,
    label: (entity, id) => displayName(entity, `Link ${id}`),
    changes,
  })
  const tableSummaries = compareTables(
    before.scientificTables,
    after.scientificTables,
    changes,
  )
  compareEntityCollection({
    area: 'formulas',
    before: before.formulas,
    after: after.formulas,
    label: (entity, id) => displayName(entity, `Formula ${id}`),
    changes,
  })
  compareEntityCollection({
    area: 'files',
    before: before.files,
    after: after.files,
    label: (entity, id) => displayName(entity, `File ${id}`),
    changes,
  })
  changes.sort(compareChanges)

  const counts: RevisionDiffResult['counts'] = {
    added: 0,
    removed: 0,
    modified: 0,
    moved: 0,
  }
  for (const change of changes) counts[change.kind] += 1
  return {
    changes,
    counts,
    tableSummaries,
    unchanged: changes.length === 0,
  }
}
