/**
 * Where a sample sits: a position in a box, from the storage tree under
 * Settings → Storage and labels. A box is a grid; a position is a cell in it
 * and holds one sample. The database keeps the count (`storage_positions`), so
 * a freezer that still holds a sample cannot be archived.
 */
import type { DataClient } from '#/lib/data-client'
import {
  fetchStorageTree,
  formatNodePath,
  isArchived,
  nodePath,
} from '#/lib/storage-locations'
import type { StorageNode, StorageTree } from '#/lib/storage-locations'

export type PositionStatus =
  'available' | 'occupied' | 'quarantined' | 'missing'

export interface BoxChoice {
  id: string
  name: string
  code: string | null
  rows: number
  cols: number
  held: number
  free: number
  /** The names above the box, outermost first: site, room, unit, shelf, rack. */
  above: string[]
  /** Site / Room / Unit / … / Box */
  path: string
}

export interface PositionCell {
  id: string
  boxId: string
  rowIndex: number
  colIndex: number
  /** A1, B7 … */
  label: string
  status: PositionStatus
  occupant: { id: string; identifier: string; title: string | null } | null
}

/** Where a sample is going: a position in a box, or a place typed in. */
export type PlaceChoice =
  | { kind: 'position'; position: PositionCell; box: BoxChoice }
  | { kind: 'text'; text: string }

export type PositionChoice = Extract<PlaceChoice, { kind: 'position' }>

/** The words for a choice, the way the sample's location will read. */
export function describePlace(choice: PlaceChoice | null): string {
  if (!choice) return ''
  if (choice.kind === 'text') return choice.text.trim()
  return [...choice.box.above, choice.box.name, choice.position.label].join(
    ' / ',
  )
}

/** Letters down the side of a box: 0 → A, 25 → Z. */
export function rowLetter(rowIndex: number): string {
  return String.fromCharCode(65 + rowIndex)
}

/** Every box a sample can be put in: not archived, nor inside something archived. */
export function boxChoices(tree: StorageTree): BoxChoice[] {
  return tree.nodes
    .filter(
      (node): node is StorageNode & { rows: number; cols: number } =>
        node.level === 'box' &&
        !isArchived(tree, node) &&
        node.rows !== null &&
        node.cols !== null,
    )
    .map((node) => {
      const names = nodePath(tree, node)
      return {
        id: node.id,
        name: node.name,
        code: node.code,
        rows: node.rows,
        cols: node.cols,
        held: node.held,
        free: Math.max(0, node.rows * node.cols - node.held),
        above: names.slice(0, -1),
        path: formatNodePath(tree, node),
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
}

export async function fetchBoxChoices(
  client: DataClient,
): Promise<BoxChoice[]> {
  return boxChoices(await fetchStorageTree(client, { occupancy: true }))
}

interface PositionRow {
  id: string
  box_id: string
  row_index: number
  col_index: number
  label: string
  status: PositionStatus
  occupied_record_id: string | null
}

/** The positions of one box, with who sits in each occupied one. */
export async function fetchBoxPositions(
  client: DataClient,
  boxId: string,
): Promise<PositionCell[]> {
  const rows = await client.list<PositionRow>(
    'storage_positions',
    `?box_id=eq.${boxId}&select=id,box_id,row_index,col_index,label,status,occupied_record_id&order=row_index,col_index&limit=1000`,
  )
  const ids = rows
    .map((row) => row.occupied_record_id)
    .filter((id): id is string => Boolean(id))
  const people = new Map<string, { identifier: string; title: string | null }>()
  if (ids.length) {
    const records = await client.list<{
      id: string
      identifier: string
      title: string | null
    }>('records', `?id=in.(${ids.join(',')})&select=id,identifier,title`)
    for (const record of records) people.set(record.id, record)
  }
  return rows.map((row) => {
    const held = row.occupied_record_id
      ? people.get(row.occupied_record_id)
      : undefined
    return {
      id: row.id,
      boxId: row.box_id,
      rowIndex: row.row_index,
      colIndex: row.col_index,
      label: row.label,
      status: row.status,
      occupant: row.occupied_record_id
        ? {
            id: row.occupied_record_id,
            identifier: held?.identifier ?? '…',
            title: held?.title ?? null,
          }
        : null,
    }
  })
}

/** The first free position reading along the rows, or null when the box is full. */
export function firstFreePosition(
  cells: readonly PositionCell[],
): PositionCell | null {
  return (
    [...cells]
      .sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex)
      .find((cell) => cell.status === 'available') ?? null
  )
}

/**
 * Free positions to fill, in reading order, starting from the first free one.
 * Used by bulk registration, which files a list of new tubes in one go.
 */
export function freePositions(
  cells: readonly PositionCell[],
  count: number,
): PositionCell[] {
  return [...cells]
    .sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex)
    .filter((cell) => cell.status === 'available')
    .slice(0, count)
}

export interface PositionMoveInput {
  recordId: string
  positionId: string
  expectedMetadataVersion: number
  notes?: string
}

export async function moveSampleToPosition(
  client: DataClient,
  input: PositionMoveInput,
): Promise<{ id: string; metadata_version: number }> {
  return client.rpc<{ id: string; metadata_version: number }>(
    'move_sample_to_position',
    {
      p_record_id: input.recordId,
      p_to_position_id: input.positionId,
      p_expected_metadata_version: input.expectedMetadataVersion,
      p_notes: input.notes ?? null,
    },
  )
}

/** Files samples whose typed place names exactly one free position. */
export async function matchSampleLocations(
  client: DataClient,
  workspaceId: string,
): Promise<{ matched: number; unmatched: number }> {
  return client.rpc<{ matched: number; unmatched: number }>(
    'match_sample_locations',
    { p_workspace_id: workspaceId },
  )
}

export const positionKeys = {
  boxes: ['storage-positions', 'boxes'] as const,
  box: (boxId: string) => ['storage-positions', 'box', boxId] as const,
}

/** The position a sample holds now, if it is filed in one. */
export async function fetchSamplePosition(
  client: DataClient,
  recordId: string,
): Promise<{ id: string; boxId: string } | null> {
  const rows = await client.list<{ id: string; box_id: string }>(
    'storage_positions',
    `?occupied_record_id=eq.${recordId}&select=id,box_id&limit=1`,
  )
  return rows[0] ? { id: rows[0].id, boxId: rows[0].box_id } : null
}
