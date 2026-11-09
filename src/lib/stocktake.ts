/**
 * Stocktake: counting a freezer, shelf, rack or box with the scanner
 * (migration 0063).
 *
 * Reads go straight to `api.stocktakes` and `api.stocktake_items` under
 * row-level security; every change goes through an RPC, so what a count may do
 * to a sample or lot stays in the database and uses the same move and dispose
 * steps as doing it by hand.
 */

import type { DataClient } from '#/lib/data-client'
import { nodePath } from '#/lib/storage-locations'
import type {
  StorageLevel,
  StorageNode,
  StorageTree,
} from '#/lib/storage-locations'

/** The parts of the storage tree a count can cover. */
export const STOCKTAKE_LEVELS = ['unit', 'shelf', 'rack', 'box'] as const

export type StocktakeLevel = (typeof STOCKTAKE_LEVELS)[number]

export function isStocktakeLevel(level: StorageLevel): level is StocktakeLevel {
  return (STOCKTAKE_LEVELS as readonly string[]).includes(level)
}

export type StocktakeStatus = 'open' | 'completed' | 'cancelled'

/**
 * Where an item stands once it has been looked for.
 *   expected    on the list, not seen yet
 *   confirmed   where the records say
 *   misplaced   on the list but found in a different box
 *   unexpected  found here although the records put it elsewhere
 *   missing     on the list and never found
 */
export type StocktakeItemState =
  'expected' | 'confirmed' | 'misplaced' | 'unexpected' | 'missing'

/** The differences a finished count asks someone to deal with. */
export const DIFFERENCE_STATES = ['misplaced', 'unexpected', 'missing'] as const

export type DifferenceState = (typeof DIFFERENCE_STATES)[number]

export type StocktakeAction =
  'accept' | 'returned' | 'refile' | 'mark_lost' | 'clear_location'

export type StocktakeItemKind = 'sample' | 'material'

export interface StocktakeWire {
  id: string
  number: number
  scope_level: string
  scope_id: string
  scope_name: string
  scope_path: string
  status: string
  note: string | null
  started_by: string | null
  started_at: string
  completed_by: string | null
  completed_at: string | null
  cancelled_at: string | null
}

export interface Stocktake {
  id: string
  /** "ST-0007": the number a person quotes in a message or a record. */
  reference: string
  scopeLevel: StocktakeLevel
  scopeId: string
  scopeName: string
  /** Site / Room / Freezer … up to the part that was counted. */
  scopePath: string
  status: StocktakeStatus
  note: string | null
  startedBy: string | null
  startedAt: string
  completedBy: string | null
  completedAt: string | null
  cancelledAt: string | null
}

export interface StocktakeItemWire {
  id: string
  stocktake_id: string
  record_id: string
  identifier: string
  title: string | null
  record_kind: string
  expected: boolean
  state: string
  expected_box_id: string | null
  expected_path: string | null
  found_box_id: string | null
  found_path: string | null
  scanned_at: string | null
  resolution: string | null
  resolution_note: string | null
  resolved_at: string | null
}

export interface StocktakeItem {
  id: string
  stocktakeId: string
  recordId: string
  identifier: string
  title: string | null
  kind: StocktakeItemKind
  expected: boolean
  state: StocktakeItemState
  expectedBoxId: string | null
  expectedPath: string | null
  foundBoxId: string | null
  foundPath: string | null
  scannedAt: string | null
  resolution: StocktakeAction | null
  resolutionNote: string | null
  resolvedAt: string | null
}

export function stocktakeReference(number: number): string {
  return `ST-${String(number).padStart(4, '0')}`
}

function asLevel(value: string): StocktakeLevel {
  return (STOCKTAKE_LEVELS as readonly string[]).includes(value)
    ? (value as StocktakeLevel)
    : 'box'
}

function asStatus(value: string): StocktakeStatus {
  return value === 'completed' || value === 'cancelled' ? value : 'open'
}

const STATES: readonly StocktakeItemState[] = [
  'expected',
  'confirmed',
  'misplaced',
  'unexpected',
  'missing',
]

function asState(value: string): StocktakeItemState {
  return (STATES as readonly string[]).includes(value)
    ? (value as StocktakeItemState)
    : 'expected'
}

export function toStocktake(row: StocktakeWire): Stocktake {
  return {
    id: row.id,
    reference: stocktakeReference(row.number),
    scopeLevel: asLevel(row.scope_level),
    scopeId: row.scope_id,
    scopeName: row.scope_name,
    scopePath: row.scope_path,
    status: asStatus(row.status),
    note: row.note,
    startedBy: row.started_by,
    startedAt: row.started_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  }
}

export function toStocktakeItem(row: StocktakeItemWire): StocktakeItem {
  return {
    id: row.id,
    stocktakeId: row.stocktake_id,
    recordId: row.record_id,
    identifier: row.identifier,
    title: row.title,
    kind: row.record_kind === 'material' ? 'material' : 'sample',
    expected: row.expected,
    state: asState(row.state),
    expectedBoxId: row.expected_box_id,
    expectedPath: row.expected_path,
    foundBoxId: row.found_box_id,
    foundPath: row.found_path,
    scannedAt: row.scanned_at,
    resolution: (row.resolution as StocktakeAction | null) ?? null,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
  }
}

export interface StocktakeSummary {
  /** Everything the count looked at: the list plus whatever turned up. */
  total: number
  confirmed: number
  misplaced: number
  unexpected: number
  missing: number
  /** Still on the list and not seen yet (only while the count is open). */
  remaining: number
  /** Differences someone has dealt with. */
  resolved: number
  /** Differences still waiting for a decision. */
  toFix: number
}

export function summariseItems(
  items: readonly Pick<StocktakeItem, 'state' | 'resolvedAt'>[],
): StocktakeSummary {
  const count = (state: StocktakeItemState) =>
    items.filter((item) => item.state === state).length

  const differences = items.filter((item) =>
    (DIFFERENCE_STATES as readonly string[]).includes(item.state),
  )

  const resolved = differences.filter((item) => item.resolvedAt).length

  return {
    total: items.length,
    confirmed: count('confirmed'),
    misplaced: count('misplaced'),
    unexpected: count('unexpected'),
    missing: count('missing'),
    remaining: count('expected'),
    resolved,
    toFix: differences.length - resolved,
  }
}

/** What can be done about an item, best first. Mirrors the database's rules. */
export function actionsFor(item: StocktakeItem): StocktakeAction[] {
  if (item.resolvedAt) return []

  switch (item.state) {
    case 'misplaced':
    case 'unexpected':
      return ['refile', 'returned', 'accept']
    case 'missing':
      return [item.kind === 'sample' ? 'mark_lost' : 'clear_location', 'accept']
    default:
      return []
  }
}

/** Differences first (what needs a person), then the rest by identifier. */
export function sortItems(items: readonly StocktakeItem[]): StocktakeItem[] {
  const rank: Record<StocktakeItemState, number> = {
    missing: 0,
    misplaced: 1,
    unexpected: 2,
    expected: 3,
    confirmed: 4,
  }

  return [...items].sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      a.identifier.localeCompare(b.identifier, undefined, { numeric: true }),
  )
}

export interface CountBox {
  id: string
  name: string
  code: string | null
  path: string
}

/** The boxes inside the part of the tree a count covers. */
export function boxesInScope(
  tree: StorageTree,
  stocktake: Pick<Stocktake, 'scopeId' | 'scopeLevel'>,
): CountBox[] {
  const scope = tree.byId.get(stocktake.scopeId)

  if (!scope) return []
  const boxes: CountBox[] = []

  const walk = (node: StorageNode) => {
    if (node.level === 'box') {
      boxes.push({
        id: node.id,
        name: node.name,
        code: node.code,
        path: nodePath(tree, node).join(' / '),
      })

      return
    }

    for (const child of tree.childrenOf(node)) walk(child)
  }

  walk(scope)

  return boxes.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true }),
  )
}

/** The box a scanned or typed code names, by its code or its name. */
export function matchBoxCode(
  boxes: readonly CountBox[],
  code: string,
): CountBox | null {
  const wanted = code.trim().toLowerCase()

  if (!wanted) return null

  return (
    boxes.find((box) => box.code?.toLowerCase() === wanted) ??
    boxes.find((box) => box.name.toLowerCase() === wanted) ??
    null
  )
}

export const stocktakeKeys = {
  all: ['stocktake'] as const,
  list: ['stocktake', 'list'] as const,
  detail: (id: string) => ['stocktake', 'detail', id] as const,
  items: (id: string) => ['stocktake', 'items', id] as const,
  tree: ['stocktake', 'tree'] as const,
}

/** Newest first; a lab's count history is short enough to read in one go. */
export async function fetchStocktakes(
  client: DataClient,
): Promise<Stocktake[]> {
  const rows = await client.list<StocktakeWire>(
    'stocktakes',
    '?order=started_at.desc&limit=200',
  )

  return rows.map(toStocktake)
}

export async function fetchStocktake(
  client: DataClient,
  id: string,
): Promise<Stocktake | null> {
  const rows = await client.list<StocktakeWire>(
    'stocktakes',
    `?id=eq.${id}&limit=1`,
  )

  return rows[0] ? toStocktake(rows[0]) : null
}

export async function fetchStocktakeItems(
  client: DataClient,
  id: string,
): Promise<StocktakeItem[]> {
  const rows = await client.list<StocktakeItemWire>(
    'stocktake_items',
    `?stocktake_id=eq.${id}&order=identifier&limit=5000`,
  )

  return rows.map(toStocktakeItem)
}

export function startStocktake(
  client: DataClient,
  input: { level: StocktakeLevel; scopeId: string; note?: string | null },
): Promise<StocktakeWire> {
  return client.rpc<StocktakeWire>('start_stocktake', {
    p_scope_level: input.level,
    p_scope_id: input.scopeId,
    p_note: input.note ?? null,
  })
}

export function recordStocktakeScan(
  client: DataClient,
  input: { stocktakeId: string; recordId: string; boxId?: string | null },
): Promise<StocktakeItemWire> {
  return client.rpc<StocktakeItemWire>('record_stocktake_scan', {
    p_stocktake_id: input.stocktakeId,
    p_record_id: input.recordId,
    p_box_id: input.boxId ?? null,
  })
}

export function completeStocktake(
  client: DataClient,
  id: string,
): Promise<StocktakeWire> {
  return client.rpc<StocktakeWire>('complete_stocktake', {
    p_stocktake_id: id,
  })
}

export function cancelStocktake(
  client: DataClient,
  id: string,
): Promise<StocktakeWire> {
  return client.rpc<StocktakeWire>('cancel_stocktake', { p_stocktake_id: id })
}

export function resolveStocktakeItem(
  client: DataClient,
  input: { itemId: string; action: StocktakeAction; notes?: string | null },
): Promise<StocktakeItemWire> {
  return client.rpc<StocktakeItemWire>('resolve_stocktake_item', {
    p_item_id: input.itemId,
    p_action: input.action,
    p_notes: input.notes ?? null,
  })
}
