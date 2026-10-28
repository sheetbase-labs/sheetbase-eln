/**
 * Settings → Storage and labels: the storage hierarchy an admin manages.
 *
 * A site holds rooms, a room holds freezers and other units, a unit holds
 * shelves, a shelf holds racks and a rack holds boxes. A box has a grid of
 * positions, which is where a sample sits. Nothing here deletes: a location is
 * archived, and one that still holds a sample cannot be (the database refuses).
 */
import type { DataClient } from '#/lib/data-client'

export const STORAGE_LEVELS = [
  'site',
  'room',
  'unit',
  'shelf',
  'rack',
  'box',
] as const
export type StorageLevel = (typeof STORAGE_LEVELS)[number]

export const UNIT_TYPES = [
  'freezer',
  'fridge',
  'cryo',
  'incubator',
  'ambient',
  'dewar',
  'cabinet',
] as const
export type UnitType = (typeof UNIT_TYPES)[number]

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  freezer: 'Freezer',
  fridge: 'Fridge',
  cryo: 'Cryo store',
  incubator: 'Incubator',
  ambient: 'Ambient cabinet',
  dewar: 'Dewar',
  cabinet: 'Cabinet',
}

interface LevelMeta {
  table: string
  /** The column that points at the parent level. */
  parentColumn: string | null
  parent: StorageLevel | null
  child: StorageLevel | null
  label: string
  plural: string
  /** Shelves and racks are numbered rather than coded. */
  hasCode: boolean
}

export const LEVEL_META: Record<StorageLevel, LevelMeta> = {
  site: {
    table: 'storage_sites',
    parentColumn: null,
    parent: null,
    child: 'room',
    label: 'Site',
    plural: 'sites',
    hasCode: true,
  },
  room: {
    table: 'storage_rooms',
    parentColumn: 'site_id',
    parent: 'site',
    child: 'unit',
    label: 'Room',
    plural: 'rooms',
    hasCode: true,
  },
  unit: {
    table: 'storage_units',
    parentColumn: 'room_id',
    parent: 'room',
    child: 'shelf',
    label: 'Unit',
    plural: 'units',
    hasCode: true,
  },
  shelf: {
    table: 'storage_shelves',
    parentColumn: 'unit_id',
    parent: 'unit',
    child: 'rack',
    label: 'Shelf',
    plural: 'shelves',
    hasCode: false,
  },
  rack: {
    table: 'storage_racks',
    parentColumn: 'shelf_id',
    parent: 'shelf',
    child: 'box',
    label: 'Rack',
    plural: 'racks',
    hasCode: false,
  },
  box: {
    table: 'storage_boxes',
    parentColumn: 'rack_id',
    parent: 'rack',
    child: null,
    label: 'Box',
    plural: 'boxes',
    hasCode: true,
  },
}

/** The child level a node can hold, or null for a box. */
export function childLevel(level: StorageLevel): StorageLevel | null {
  return LEVEL_META[level].child
}

export interface StorageNode {
  level: StorageLevel
  id: string
  parentId: string | null
  name: string
  code: string | null
  /** Shelves and racks: where it sits among its siblings. */
  position: number | null
  unitType: UnitType | null
  temperatureMinC: number | null
  temperatureMaxC: number | null
  rows: number | null
  cols: number | null
  archivedAt: string | null
  /** Samples sitting in this location or anything below it. */
  held: number
}

interface RawNode {
  id: string
  name: string
  code?: string | null
  position?: number | null
  unit_type?: string | null
  temperature_min_c?: string | number | null
  temperature_max_c?: string | number | null
  rows?: number | null
  cols?: number | null
  archived_at: string | null
  [key: string]: unknown
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function nodeFromRow(level: StorageLevel, row: RawNode): StorageNode {
  const parentColumn = LEVEL_META[level].parentColumn
  const parent = parentColumn ? row[parentColumn] : null
  return {
    level,
    id: row.id,
    parentId: typeof parent === 'string' ? parent : null,
    name: row.name,
    code: row.code ?? null,
    position: row.position ?? null,
    unitType:
      level === 'unit' && row.unit_type ? (row.unit_type as UnitType) : null,
    temperatureMinC: num(row.temperature_min_c),
    temperatureMaxC: num(row.temperature_max_c),
    rows: row.rows ?? null,
    cols: row.cols ?? null,
    archivedAt: row.archived_at ?? null,
    held: 0,
  }
}

export interface StorageTree {
  nodes: StorageNode[]
  /** Children of a node (or the sites, for null), in display order. */
  childrenOf: (node: StorageNode | null) => StorageNode[]
  byId: Map<string, StorageNode>
}

function byOrder(a: StorageNode, b: StorageNode): number {
  if (a.position !== null && b.position !== null && a.position !== b.position)
    return a.position - b.position
  return a.name.localeCompare(b.name, undefined, { numeric: true })
}

/** Assembles the nodes of every level, and rolls the held-sample counts up. */
export function buildStorageTree(
  nodes: StorageNode[],
  heldByBox: ReadonlyMap<string, number> = new Map(),
): StorageTree {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]))
  const children = new Map<string | null, StorageNode[]>()
  for (const node of byId.values()) {
    const list = children.get(node.parentId) ?? []
    list.push(node)
    children.set(node.parentId, list)
  }
  for (const list of children.values()) list.sort(byOrder)
  const roll = (node: StorageNode): number => {
    const own = node.level === 'box' ? (heldByBox.get(node.id) ?? 0) : 0
    node.held =
      own + (children.get(node.id) ?? []).reduce((s, c) => s + roll(c), 0)
    return node.held
  }
  for (const site of children.get(null) ?? []) roll(site)
  return {
    nodes: [...byId.values()],
    byId,
    childrenOf: (node) => children.get(node?.id ?? null) ?? [],
  }
}

/** Site / Room / Freezer … — the way a sample's location is written. */
export function nodePath(tree: StorageTree, node: StorageNode): string[] {
  const names: string[] = []
  let cursor: StorageNode | undefined = node
  while (cursor) {
    names.unshift(cursor.name)
    cursor = cursor.parentId ? tree.byId.get(cursor.parentId) : undefined
  }
  return names
}

export function formatNodePath(tree: StorageTree, node: StorageNode): string {
  return nodePath(tree, node).join(' / ')
}

/** True when the node or anything above it is archived. */
export function isArchived(tree: StorageTree, node: StorageNode): boolean {
  let cursor: StorageNode | undefined = node
  while (cursor) {
    if (cursor.archivedAt) return true
    cursor = cursor.parentId ? tree.byId.get(cursor.parentId) : undefined
  }
  return false
}

/**
 * The places a sample can be put: every box that is not archived, written as
 * the path down to it. A person adds the position inside the box themselves.
 */
export function locationSuggestions(tree: StorageTree): string[] {
  return tree.nodes
    .filter((n) => n.level === 'box' && !isArchived(tree, n))
    .map((n) => formatNodePath(tree, n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** A short code taken from a name: "Cold room 1" → "COLD-ROOM-1". */
export function suggestCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

export function describeTemperature(node: StorageNode): string | null {
  const { temperatureMinC: lo, temperatureMaxC: hi } = node
  if (lo === null && hi === null) return null
  if (lo !== null && hi !== null) return `${lo} to ${hi} °C`
  return lo !== null ? `from ${lo} °C` : `up to ${hi} °C`
}

export function describeBoxGrid(node: StorageNode): string | null {
  if (node.rows === null || node.cols === null) return null
  return `${node.rows} × ${node.cols}`
}

export interface NodeInput {
  name: string
  code: string
  unitType: UnitType
  temperatureMinC: string
  temperatureMaxC: string
  rows: string
  cols: string
}

export const EMPTY_NODE_INPUT: NodeInput = {
  name: '',
  code: '',
  unitType: 'freezer',
  temperatureMinC: '',
  temperatureMaxC: '',
  rows: '9',
  cols: '9',
}

export function inputFromNode(node: StorageNode): NodeInput {
  return {
    name: node.name,
    code: node.code ?? '',
    unitType: node.unitType ?? 'freezer',
    temperatureMinC: node.temperatureMinC?.toString() ?? '',
    temperatureMaxC: node.temperatureMaxC?.toString() ?? '',
    rows: node.rows?.toString() ?? '9',
    cols: node.cols?.toString() ?? '9',
  }
}

/** The first thing wrong with a form, in the words the person would use. */
export function validateNodeInput(
  level: StorageLevel,
  input: NodeInput,
  editing: boolean,
): string | null {
  if (!input.name.trim())
    return `Give the ${LEVEL_META[level].label.toLowerCase()} a name.`
  if (input.name.trim().length > 200)
    return 'Use 200 characters or fewer for the name.'
  if (LEVEL_META[level].hasCode && !input.code.trim())
    return 'Give it a short code.'
  if (level === 'unit' || level === 'room' || level === 'site') {
    const lo = input.temperatureMinC.trim()
    const hi = input.temperatureMaxC.trim()
    if ((lo && Number.isNaN(Number(lo))) || (hi && Number.isNaN(Number(hi))))
      return 'Temperatures are numbers in °C.'
    if (lo && hi && Number(lo) > Number(hi))
      return 'The lowest temperature is above the highest.'
  }
  if (level === 'box' && !editing) {
    for (const [label, raw] of [
      ['rows', input.rows],
      ['columns', input.cols],
    ] as const) {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1 || n > 26)
        return `A box has 1 to 26 ${label}.`
    }
  }
  return null
}

function temperatureColumns(input: NodeInput): Record<string, number | null> {
  const lo = input.temperatureMinC.trim()
  const hi = input.temperatureMaxC.trim()
  return {
    temperature_min_c: lo ? Number(lo) : null,
    temperature_max_c: hi ? Number(hi) : null,
  }
}

export const storageKeys = {
  all: (workspaceId: string) => ['storage-locations', workspaceId] as const,
}

const SELECT: Record<StorageLevel, string> = {
  site: 'id,name,code,temperature_min_c,temperature_max_c,archived_at',
  room: 'id,site_id,name,code,temperature_min_c,temperature_max_c,archived_at',
  unit: 'id,room_id,name,code,unit_type,temperature_min_c,temperature_max_c,archived_at',
  shelf: 'id,unit_id,name,position,archived_at',
  rack: 'id,shelf_id,name,position,archived_at',
  box: 'id,rack_id,name,code,rows,cols,archived_at',
}

export async function fetchStorageTree(
  client: DataClient,
  { occupancy = true }: { occupancy?: boolean } = {},
): Promise<StorageTree> {
  const [levels, occupied] = await Promise.all([
    Promise.all(
      STORAGE_LEVELS.map(async (level) => {
        const rows = await client.list<RawNode>(
          LEVEL_META[level].table,
          `?select=${SELECT[level]}&limit=5000`,
        )
        return rows.map((row) => nodeFromRow(level, row))
      }),
    ),
    occupancy
      ? client.list<{ box_id: string }>(
          'storage_positions',
          '?select=box_id&occupied_record_id=not.is.null&limit=20000',
        )
      : Promise.resolve([] as { box_id: string }[]),
  ])
  const held = new Map<string, number>()
  for (const { box_id } of occupied)
    held.set(box_id, (held.get(box_id) ?? 0) + 1)
  return buildStorageTree(levels.flat(), held)
}

export async function createStorageNode(
  client: DataClient,
  workspaceId: string,
  level: StorageLevel,
  parent: StorageNode | null,
  input: NodeInput,
  nextPosition: number,
): Promise<void> {
  const meta = LEVEL_META[level]
  const name = input.name.trim()
  if (level === 'box') {
    await client.rpc('create_storage_box', {
      p_workspace_id: workspaceId,
      p_rack_id: parent?.id,
      p_name: name,
      p_code: input.code.trim(),
      p_rows: Number(input.rows),
      p_cols: Number(input.cols),
    })
    return
  }
  const row: Record<string, unknown> = { workspace_id: workspaceId, name }
  if (meta.parentColumn) row[meta.parentColumn] = parent?.id
  if (meta.hasCode) row.code = input.code.trim()
  if (level === 'shelf' || level === 'rack') row.position = nextPosition
  if (level === 'unit') row.unit_type = input.unitType
  if (level === 'site' || level === 'room' || level === 'unit')
    Object.assign(row, temperatureColumns(input))
  await client.insert(meta.table, row)
}

export async function updateStorageNode(
  client: DataClient,
  node: StorageNode,
  input: NodeInput,
): Promise<void> {
  const meta = LEVEL_META[node.level]
  const row: Record<string, unknown> = { name: input.name.trim() }
  if (meta.hasCode) row.code = input.code.trim()
  if (node.level === 'unit') row.unit_type = input.unitType
  if (node.level === 'site' || node.level === 'room' || node.level === 'unit')
    Object.assign(row, temperatureColumns(input))
  await client.patch(meta.table, `?id=eq.${node.id}`, row)
}

export async function setStorageNodeArchived(
  client: DataClient,
  node: StorageNode,
  archived: boolean,
): Promise<void> {
  await client.patch(LEVEL_META[node.level].table, `?id=eq.${node.id}`, {
    archived_at: archived ? new Date().toISOString() : null,
  })
}

export type SettingsAccessLevel = 'none' | 'view' | 'manage'

/**
 * What the signed-in person may do in Storage and labels, as the workspace has
 * configured it. The database answers, so a role granted access in Members and
 * roles gets it here without a deploy.
 */
export async function fetchStorageAccess(
  client: DataClient,
  workspaceId: string,
): Promise<SettingsAccessLevel> {
  const level = await client.rpc<string>('settings_access_level', {
    p_workspace_id: workspaceId,
    p_area: 'storage',
  })
  return level === 'manage' || level === 'view' ? level : 'none'
}
