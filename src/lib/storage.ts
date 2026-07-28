/**
 * OPS-002: Freezer & Storage Map domain library.
 *
 * Application-boundary helpers over the `api.storage_*` hierarchy and the
 * controlled `move_sample_to_position` / `remove_sample_from_position` /
 * `set_position_status` / `lookup_sample_by_barcode` / `create_storage_box`
 * RPCs (migration 0048). PostgreSQL and RLS remain the authoritative
 * access-control boundary; these helpers drive the UI, normalise wire shapes
 * and map RPC error codes to actionable messages.
 */
import type { DataClient } from './data-client'
import { DataClientError } from './data-client'
import { notebookDataClient, toRecord } from './notebook-data'
import type { RecordWire } from './notebook-data'

// ---------------------------------------------------------------------------
// Wire shapes (PostgREST snake_case).
// ---------------------------------------------------------------------------

export interface StorageSiteWire {
  id: string
  workspace_id: string
  name: string
  code: string
  description: string | null
  temperature_min_c: string | null
  temperature_max_c: string | null
  capacity: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StorageRoomWire {
  id: string
  workspace_id: string
  site_id: string
  name: string
  code: string
  temperature_min_c: string | null
  temperature_max_c: string | null
  capacity: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StorageUnitWire {
  id: string
  workspace_id: string
  room_id: string
  name: string
  code: string
  unit_type: string
  temperature_min_c: string | null
  temperature_max_c: string | null
  capacity: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StorageShelfWire {
  id: string
  workspace_id: string
  unit_id: string
  name: string
  position: number
  capacity: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StorageRackWire {
  id: string
  workspace_id: string
  shelf_id: string
  name: string
  position: number
  capacity: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StorageBoxWire {
  id: string
  workspace_id: string
  rack_id: string
  name: string
  code: string
  rows: number
  cols: number
  capacity: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StoragePositionWire {
  id: string
  workspace_id: string
  box_id: string
  row_index: number
  col_index: number
  label: string
  status: string
  occupied_record_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StorageMovementWire {
  id: string
  workspace_id: string
  record_id: string
  operation: string
  from_position_id: string | null
  to_position_id: string | null
  from_path: string | null
  to_path: string | null
  actor_user_id: string | null
  notes: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Typed domain views.
// ---------------------------------------------------------------------------

function num(v: string | null): number | null {
  return v == null ? null : Number(v)
}

export interface StorageSite {
  id: string
  name: string
  code: string
  description: string | null
  temperatureMinC: number | null
  temperatureMaxC: number | null
  capacity: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StorageRoom {
  id: string
  siteId: string
  name: string
  code: string
  temperatureMinC: number | null
  temperatureMaxC: number | null
  capacity: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StorageUnit {
  id: string
  roomId: string
  name: string
  code: string
  unitType: string
  temperatureMinC: number | null
  temperatureMaxC: number | null
  capacity: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StorageShelf {
  id: string
  unitId: string
  name: string
  position: number
  capacity: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StorageRack {
  id: string
  shelfId: string
  name: string
  position: number
  capacity: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StorageBox {
  id: string
  rackId: string
  name: string
  code: string
  rows: number
  cols: number
  capacity: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type PositionStatus =
  'available' | 'occupied' | 'quarantined' | 'missing'

export interface StoragePosition {
  id: string
  boxId: string
  rowIndex: number
  colIndex: number
  label: string
  status: PositionStatus
  occupiedRecordId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StorageMovement {
  id: string
  recordId: string
  operation: 'place' | 'move' | 'remove'
  fromPositionId: string | null
  toPositionId: string | null
  fromPath: string | null
  toPath: string | null
  actorUserId: string | null
  notes: string | null
  createdAt: string
}

export function toStorageSite(row: StorageSiteWire): StorageSite {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    temperatureMinC: num(row.temperature_min_c),
    temperatureMaxC: num(row.temperature_max_c),
    capacity: row.capacity,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toStorageRoom(row: StorageRoomWire): StorageRoom {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    code: row.code,
    temperatureMinC: num(row.temperature_min_c),
    temperatureMaxC: num(row.temperature_max_c),
    capacity: row.capacity,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toStorageUnit(row: StorageUnitWire): StorageUnit {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    code: row.code,
    unitType: row.unit_type,
    temperatureMinC: num(row.temperature_min_c),
    temperatureMaxC: num(row.temperature_max_c),
    capacity: row.capacity,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toStorageShelf(row: StorageShelfWire): StorageShelf {
  return {
    id: row.id,
    unitId: row.unit_id,
    name: row.name,
    position: row.position,
    capacity: row.capacity,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toStorageRack(row: StorageRackWire): StorageRack {
  return {
    id: row.id,
    shelfId: row.shelf_id,
    name: row.name,
    position: row.position,
    capacity: row.capacity,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toStorageBox(row: StorageBoxWire): StorageBox {
  return {
    id: row.id,
    rackId: row.rack_id,
    name: row.name,
    code: row.code,
    rows: row.rows,
    cols: row.cols,
    capacity: row.capacity,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toStoragePosition(row: StoragePositionWire): StoragePosition {
  return {
    id: row.id,
    boxId: row.box_id,
    rowIndex: row.row_index,
    colIndex: row.col_index,
    label: row.label,
    status: row.status as PositionStatus,
    occupiedRecordId: row.occupied_record_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toStorageMovement(row: StorageMovementWire): StorageMovement {
  return {
    id: row.id,
    recordId: row.record_id,
    operation: row.operation as StorageMovement['operation'],
    fromPositionId: row.from_position_id,
    toPositionId: row.to_position_id,
    fromPath: row.from_path,
    toPath: row.to_path,
    actorUserId: row.actor_user_id,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Occupancy helpers and accessible status treatment.
//
// Status is never communicated by colour alone: each status has a text label,
// an icon and a tone. The UI uses these tokens so a screen-reader user gets
// the same information as a sighted one.
// ---------------------------------------------------------------------------

export interface PositionStatusDef {
  label: string
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  /** Short glyph rendered alongside the label; the label always carries the
   * meaning, never the glyph alone. */
  glyph: string
}

export const POSITION_STATUS_DEFS: Record<PositionStatus, PositionStatusDef> = {
  available: { label: 'Available', tone: 'success', glyph: '·' },
  occupied: { label: 'Occupied', tone: 'info', glyph: '●' },
  quarantined: { label: 'Quarantined', tone: 'warning', glyph: '⚠' },
  missing: { label: 'Missing', tone: 'danger', glyph: '?' },
}

export function positionStatusDef(status: string): PositionStatusDef {
  if (Object.hasOwn(POSITION_STATUS_DEFS, status)) {
    return POSITION_STATUS_DEFS[status as PositionStatus]
  }
  return {
    label: status,
    tone: 'neutral' as const,
    glyph: '·',
  }
}

export const UNIT_TYPE_LABELS: Record<string, string> = {
  freezer: 'Freezer',
  fridge: 'Fridge',
  cryo: 'Cryo',
  incubator: 'Incubator',
  ambient: 'Ambient',
  dewar: 'Dewar',
  cabinet: 'Cabinet',
}

/** Temperature range label, e.g. "-80 °C to -60 °C". */
export function temperatureLabel(
  min: number | null,
  max: number | null,
): string | null {
  if (min == null && max == null) return null
  if (min != null && max != null) return `${min} °C to ${max} °C`
  return `${min ?? max} °C`
}

// ---------------------------------------------------------------------------
// Hierarchy fetch helpers. Each level lists the children of a parent, scoped
// to the workspace by RLS. The route walks the hierarchy lazily.
// ---------------------------------------------------------------------------

export const storageQueryKeys = {
  sites: ['ops-002', 'storage', 'sites'] as const,
  rooms: (siteId: string) => ['ops-002', 'storage', 'rooms', siteId] as const,
  units: (roomId: string) => ['ops-002', 'storage', 'units', roomId] as const,
  shelves: (unitId: string) =>
    ['ops-002', 'storage', 'shelves', unitId] as const,
  racks: (shelfId: string) => ['ops-002', 'storage', 'racks', shelfId] as const,
  boxes: (rackId: string) => ['ops-002', 'storage', 'boxes', rackId] as const,
  positions: (boxId: string) =>
    ['ops-002', 'storage', 'positions', boxId] as const,
  movements: (recordId: string) =>
    ['ops-002', 'storage', 'movements', recordId] as const,
  positionMovements: (positionId: string) =>
    ['ops-002', 'storage', 'position-movements', positionId] as const,
  barcode: (barcode: string) =>
    ['ops-002', 'storage', 'barcode', barcode] as const,
}

export async function fetchStorageSites(
  client: DataClient = notebookDataClient,
): Promise<StorageSite[]> {
  return client
    .list<StorageSiteWire>('storage_sites', '?order=code.asc')
    .then((rs) => rs.map(toStorageSite))
}

export async function fetchStorageRooms(
  client: DataClient,
  siteId: string,
): Promise<StorageRoom[]> {
  return client
    .list<StorageRoomWire>(
      'storage_rooms',
      `?site_id=eq.${siteId}&order=code.asc`,
    )
    .then((rs) => rs.map(toStorageRoom))
}

export async function fetchStorageUnits(
  client: DataClient,
  roomId: string,
): Promise<StorageUnit[]> {
  return client
    .list<StorageUnitWire>(
      'storage_units',
      `?room_id=eq.${roomId}&order=code.asc`,
    )
    .then((rs) => rs.map(toStorageUnit))
}

export async function fetchStorageShelves(
  client: DataClient,
  unitId: string,
): Promise<StorageShelf[]> {
  return client
    .list<StorageShelfWire>(
      'storage_shelves',
      `?unit_id=eq.${unitId}&order=position.asc`,
    )
    .then((rs) => rs.map(toStorageShelf))
}

export async function fetchStorageRacks(
  client: DataClient,
  shelfId: string,
): Promise<StorageRack[]> {
  return client
    .list<StorageRackWire>(
      'storage_racks',
      `?shelf_id=eq.${shelfId}&order=position.asc`,
    )
    .then((rs) => rs.map(toStorageRack))
}

export async function fetchStorageBoxes(
  client: DataClient,
  rackId: string,
): Promise<StorageBox[]> {
  return client
    .list<StorageBoxWire>(
      'storage_boxes',
      `?rack_id=eq.${rackId}&order=code.asc`,
    )
    .then((rs) => rs.map(toStorageBox))
}

export async function fetchStoragePositions(
  client: DataClient,
  boxId: string,
): Promise<StoragePosition[]> {
  return client
    .list<StoragePositionWire>(
      'storage_positions',
      `?box_id=eq.${boxId}&order=row_index.asc,col_index.asc`,
    )
    .then((rs) => rs.map(toStoragePosition))
}

export async function fetchStorageMovements(
  client: DataClient,
  recordId: string,
): Promise<StorageMovement[]> {
  return client
    .list<StorageMovementWire>(
      'storage_movements',
      `?record_id=eq.${recordId}&order=created_at.desc&limit=50`,
    )
    .then((rs) => rs.map(toStorageMovement))
}

export async function fetchPositionMovements(
  client: DataClient,
  positionId: string,
): Promise<StorageMovement[]> {
  return client
    .list<StorageMovementWire>(
      'storage_movements',
      `?or=(from_position_id.eq.${positionId},to_position_id.eq.${positionId})&order=created_at.desc&limit=25`,
    )
    .then((rs) => rs.map(toStorageMovement))
}

// ---------------------------------------------------------------------------
// CRUD helpers for the hierarchy levels (direct PostgREST, RLS-gated).
// ---------------------------------------------------------------------------

export async function createStorageSite(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    code: string
    description?: string
    temperatureMinC?: number
    temperatureMaxC?: number
    capacity?: number
    metadata?: Record<string, unknown>
  },
): Promise<StorageSite> {
  const row = await client.insert<StorageSiteWire>('storage_sites', {
    workspace_id: input.workspaceId,
    name: input.name,
    code: input.code,
    description: input.description ?? null,
    temperature_min_c: input.temperatureMinC ?? null,
    temperature_max_c: input.temperatureMaxC ?? null,
    capacity: input.capacity ?? 0,
    metadata: input.metadata ?? {},
  })
  return toStorageSite(row)
}

export async function createStorageRoom(
  client: DataClient,
  input: {
    workspaceId: string
    siteId: string
    name: string
    code: string
    temperatureMinC?: number
    temperatureMaxC?: number
    capacity?: number
  },
): Promise<StorageRoom> {
  const row = await client.insert<StorageRoomWire>('storage_rooms', {
    workspace_id: input.workspaceId,
    site_id: input.siteId,
    name: input.name,
    code: input.code,
    temperature_min_c: input.temperatureMinC ?? null,
    temperature_max_c: input.temperatureMaxC ?? null,
    capacity: input.capacity ?? 0,
    metadata: {},
  })
  return toStorageRoom(row)
}

export async function createStorageUnit(
  client: DataClient,
  input: {
    workspaceId: string
    roomId: string
    name: string
    code: string
    unitType?: string
    temperatureMinC?: number
    temperatureMaxC?: number
    capacity?: number
  },
): Promise<StorageUnit> {
  const row = await client.insert<StorageUnitWire>('storage_units', {
    workspace_id: input.workspaceId,
    room_id: input.roomId,
    name: input.name,
    code: input.code,
    unit_type: input.unitType ?? 'freezer',
    temperature_min_c: input.temperatureMinC ?? null,
    temperature_max_c: input.temperatureMaxC ?? null,
    capacity: input.capacity ?? 0,
    metadata: {},
  })
  return toStorageUnit(row)
}

export async function createStorageShelf(
  client: DataClient,
  input: {
    workspaceId: string
    unitId: string
    name: string
    position?: number
    capacity?: number
  },
): Promise<StorageShelf> {
  const row = await client.insert<StorageShelfWire>('storage_shelves', {
    workspace_id: input.workspaceId,
    unit_id: input.unitId,
    name: input.name,
    position: input.position ?? 1,
    capacity: input.capacity ?? 0,
    metadata: {},
  })
  return toStorageShelf(row)
}

export async function createStorageRack(
  client: DataClient,
  input: {
    workspaceId: string
    shelfId: string
    name: string
    position?: number
    capacity?: number
  },
): Promise<StorageRack> {
  const row = await client.insert<StorageRackWire>('storage_racks', {
    workspace_id: input.workspaceId,
    shelf_id: input.shelfId,
    name: input.name,
    position: input.position ?? 1,
    capacity: input.capacity ?? 0,
    metadata: {},
  })
  return toStorageRack(row)
}

// ---------------------------------------------------------------------------
// Box creation goes through the create_storage_box RPC so the position grid is
// generated transactionally.
// ---------------------------------------------------------------------------

export async function createStorageBox(
  client: DataClient,
  input: {
    workspaceId: string
    rackId: string
    name: string
    code: string
    rows: number
    cols: number
    metadata?: Record<string, unknown>
  },
): Promise<StorageBox> {
  const row = await client.rpc<StorageBoxWire>('create_storage_box', {
    p_workspace_id: input.workspaceId,
    p_rack_id: input.rackId,
    p_name: input.name,
    p_code: input.code,
    p_rows: input.rows,
    p_cols: input.cols,
    p_metadata: input.metadata ?? {},
  })
  return toStorageBox(row)
}

// ---------------------------------------------------------------------------
// Controlled sample-move workflow + position status RPCs.
// ---------------------------------------------------------------------------

export interface MoveSampleInput {
  recordId: string
  toPositionId: string
  expectedMetadataVersion: number
  notes?: string
}

export async function moveSampleToPosition(
  client: DataClient,
  input: MoveSampleInput,
): Promise<RecordWire> {
  return client.rpc<RecordWire>('move_sample_to_position', {
    p_record_id: input.recordId,
    p_to_position_id: input.toPositionId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_notes: input.notes ?? null,
  })
}

export interface RemoveSampleInput {
  recordId: string
  expectedMetadataVersion: number
  notes?: string
}

export async function removeSampleFromPosition(
  client: DataClient,
  input: RemoveSampleInput,
): Promise<RecordWire> {
  return client.rpc<RecordWire>('remove_sample_from_position', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_notes: input.notes ?? null,
  })
}

export async function setPositionStatus(
  client: DataClient,
  positionId: string,
  status: 'available' | 'quarantined' | 'missing',
  notes?: string,
): Promise<StoragePosition> {
  const row = await client.rpc<StoragePositionWire>('set_position_status', {
    p_position_id: positionId,
    p_status: status,
    p_notes: notes ?? null,
  })
  return toStoragePosition(row)
}

// ---------------------------------------------------------------------------
// Barcode lookup. Returns a typed NotebookRecord (the sample) or null.
// ---------------------------------------------------------------------------

export async function lookupSampleByBarcode(
  client: DataClient,
  barcode: string,
): Promise<RecordWire | null> {
  const rows = await client.rpc<RecordWire[]>('lookup_sample_by_barcode', {
    p_barcode: barcode,
  })
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

// ---------------------------------------------------------------------------
// Box contents: fetch positions plus the occupying sample records in one
// round trip per resource, then join in the browser.
// ---------------------------------------------------------------------------

export interface BoxPositionWithSample extends StoragePosition {
  sample: {
    id: string
    identifier: string
    title: string
    status: string
    barcode: string | null
    sampleType: string | null
  } | null
}

export async function fetchBoxContents(
  client: DataClient,
  boxId: string,
): Promise<{ box: StorageBox | null; positions: BoxPositionWithSample[] }> {
  const [box, positions] = await Promise.all([
    client
      .list<StorageBoxWire>(`storage_boxes`, `?id=eq.${boxId}`)
      .then((rs) => (rs.length > 0 ? toStorageBox(rs[0]) : null)),
    client
      .list<StoragePositionWire>(
        'storage_positions',
        `?box_id=eq.${boxId}&order=row_index.asc,col_index.asc`,
      )
      .then((rs) => rs.map(toStoragePosition)),
  ])
  const occupiedIds = positions
    .map((p) => p.occupiedRecordId)
    .filter((id): id is string => Boolean(id))
  let records: RecordWire[] = []
  if (occupiedIds.length > 0) {
    records = await client.list<RecordWire>(
      'records',
      `?id=in.(${occupiedIds.join(',')})&select=id,identifier,title,status,properties`,
    )
  }
  const byId = new Map(records.map((r) => [r.id, r]))
  return {
    box,
    positions: positions.map((p) => {
      const rec = p.occupiedRecordId ? byId.get(p.occupiedRecordId) : undefined
      return {
        ...p,
        sample: rec
          ? {
              id: rec.id,
              identifier: rec.identifier,
              title: rec.title,
              status: rec.status,
              barcode: (rec.properties?.barcode as string | undefined) ?? null,
              sampleType:
                (rec.properties?.sampleType as string | undefined) ?? null,
            }
          : null,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Occupancy summary for a box (used by the visual grid header).
// ---------------------------------------------------------------------------

export interface BoxOccupancySummary {
  total: number
  occupied: number
  available: number
  quarantined: number
  missing: number
}

export function boxOccupancy(
  positions: StoragePosition[],
): BoxOccupancySummary {
  const s: BoxOccupancySummary = {
    total: positions.length,
    occupied: 0,
    available: 0,
    quarantined: 0,
    missing: 0,
  }
  for (const p of positions) {
    s[p.status as keyof BoxOccupancySummary] += 1
  }
  return s
}

// ---------------------------------------------------------------------------
// Error mapping for the controlled-move RPCs.
// ---------------------------------------------------------------------------

export function describeStorageError(error: unknown): string {
  if (error instanceof DataClientError) {
    switch (error.code) {
      case 'SB010':
        return 'That position is already occupied.'
      case 'SB011':
        return 'That position or sample was not found in this workspace.'
      case 'SB012':
        return 'The sample is already at that position.'
      case 'SB013':
        return 'That position is not available (quarantined or missing).'
      case 'SB014':
        return 'Storage capacity has been reached.'
      case 'SB009':
        return 'That record is not a sample.'
      case 'SB004':
        return 'This operation is not allowed for the sample lifecycle state.'
      case 'SB001':
        return 'This sample was edited by someone else. Refresh and try again.'
      case '42501':
        return 'You do not have access to that storage location.'
      default:
        return error.message
    }
  }
  return 'Could not complete the storage operation. Try again.'
}

export { toRecord }
