/**
 * OPS-006 — Instrument Run Monitor domain model and persistence boundary.
 *
 * Wire mappers, typed RPC wrappers, qPCR normalisation helpers, and a
 * deterministic fixture stream. PostgreSQL and RLS remain authoritative.
 */
import type { DataClient } from './data-client'
import { DataClientError } from './data-client'

export type JsonObject = Record<string, unknown>
export type InstrumentType =
  'qpcr' | 'sequencer' | 'spectrophotometer' | 'other'
export type ConnectionStatus = 'connected' | 'disconnected' | 'error'
export type RunStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StageType = 'hold' | 'cycling' | 'melt' | 'image' | 'custom'
export type StageStatus =
  'pending' | 'running' | 'completed' | 'skipped' | 'failed'
export type ObservationType =
  | 'telemetry'
  | 'stage_start'
  | 'stage_complete'
  | 'run_start'
  | 'run_complete'
  | 'run_fail'
  | 'plate_snapshot'
  | 'qc_result'
  | 'status_change'
  | 'heartbeat'
export type IngestionStatus = 'received' | 'processed' | 'failed' | 'duplicate'
export type QcCheckType = 'pass' | 'warning' | 'fail' | 'info'
export type FileIngestionStatus = 'pending' | 'complete' | 'partial' | 'failed'
export type LinkType = 'experiment' | 'sample' | 'protocol' | 'file'
export type PlateFormat = '6' | '24' | '48' | '96' | '384'

// Wire shapes (PostgREST snake_case).
export interface InstrumentWire {
  id: string
  workspace_id: string
  name: string
  instrument_type: InstrumentType
  model: string | null
  serial_number: string | null
  vendor: string | null
  connection_status: ConnectionStatus
  last_connected_at: string | null
  config: JsonObject
  position: number
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}
export interface InstrumentRunWire {
  id: string
  workspace_id: string
  instrument_id: string
  project_id: string | null
  name: string
  run_identifier: string
  protocol_name: string | null
  status: RunStatus
  progress_percent: number
  plate_format: PlateFormat
  started_at: string | null
  completed_at: string | null
  estimated_duration_seconds: number | null
  elapsed_seconds: number | null
  operator: string | null
  error_message: string | null
  metadata_version: number
  queue_position: number
  tags: string[]
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}
export interface InstrumentRunStageWire {
  id: string
  workspace_id: string
  run_id: string
  name: string
  stage_type: StageType
  position: number
  status: StageStatus
  cycle_count: number | null
  current_cycle: number
  target_temperature: number | null
  started_at: string | null
  completed_at: string | null
  duration_seconds: number | null
  config: JsonObject
  created_at: string
  updated_at: string
}
export interface InstrumentObservationWire {
  id: string
  workspace_id: string
  run_id: string
  stage_id: string | null
  source_id: string
  observation_type: ObservationType
  source_timestamp: string
  ingestion_status: IngestionStatus
  payload: JsonObject
  error_detail: string | null
  ingested_at: string
}
export interface InstrumentPlateSnapshotWire {
  id: string
  workspace_id: string
  run_id: string
  observation_id: string | null
  plate_format: PlateFormat
  wells: JsonObject
  captured_at: string
  cycle_number: number | null
  created_at: string
}
export interface InstrumentQcCheckWire {
  id: string
  workspace_id: string
  run_id: string
  check_name: string
  check_type: QcCheckType
  message: string | null
  detail: JsonObject
  checked_at: string
  created_at: string
}
export interface InstrumentRawFileWire {
  id: string
  workspace_id: string
  run_id: string
  file_id: string | null
  filename: string
  media_type: string | null
  size_bytes: number | null
  storage_key: string | null
  checksum: string | null
  ingestion_status: FileIngestionStatus
  error_detail: string | null
  received_at: string
  created_at: string
}
export interface InstrumentRunLinkWire {
  id: string
  workspace_id: string
  run_id: string
  linked_record_id: string | null
  linked_record_identifier: string | null
  linked_record_title: string | null
  link_type: LinkType
  created_at: string
}

// Domain shapes (camelCase).
export interface Instrument {
  id: string
  workspaceId: string
  name: string
  instrumentType: InstrumentType
  model: string | null
  serialNumber: string | null
  vendor: string | null
  connectionStatus: ConnectionStatus
  lastConnectedAt: string | null
  config: JsonObject
  position: number
  createdAt: string
  updatedAt: string
  createdByUserId: string | null
  updatedByUserId: string | null
}
export interface InstrumentRun {
  id: string
  workspaceId: string
  instrumentId: string
  projectId: string | null
  name: string
  runIdentifier: string
  protocolName: string | null
  status: RunStatus
  progressPercent: number
  plateFormat: PlateFormat
  startedAt: string | null
  completedAt: string | null
  estimatedDurationSeconds: number | null
  elapsedSeconds: number | null
  operator: string | null
  errorMessage: string | null
  metadataVersion: number
  queuePosition: number
  tags: string[]
  createdAt: string
  updatedAt: string
  createdByUserId: string | null
  updatedByUserId: string | null
}
export interface InstrumentRunStage {
  id: string
  workspaceId: string
  runId: string
  name: string
  stageType: StageType
  position: number
  status: StageStatus
  cycleCount: number | null
  currentCycle: number
  targetTemperature: number | null
  startedAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  config: JsonObject
  createdAt: string
  updatedAt: string
}
export interface InstrumentObservation {
  id: string
  workspaceId: string
  runId: string
  stageId: string | null
  sourceId: string
  observationType: ObservationType
  sourceTimestamp: string
  ingestionStatus: IngestionStatus
  payload: JsonObject
  errorDetail: string | null
  ingestedAt: string
}
export interface InstrumentPlateSnapshot {
  id: string
  workspaceId: string
  runId: string
  observationId: string | null
  plateFormat: PlateFormat
  wells: JsonObject
  capturedAt: string
  cycleNumber: number | null
  createdAt: string
}
export interface InstrumentQcCheck {
  id: string
  workspaceId: string
  runId: string
  checkName: string
  checkType: QcCheckType
  message: string | null
  detail: JsonObject
  checkedAt: string
  createdAt: string
}
export interface InstrumentRawFile {
  id: string
  workspaceId: string
  runId: string
  fileId: string | null
  filename: string
  mediaType: string | null
  sizeBytes: number | null
  storageKey: string | null
  checksum: string | null
  ingestionStatus: FileIngestionStatus
  errorDetail: string | null
  receivedAt: string
  createdAt: string
}
export interface InstrumentRunLink {
  id: string
  workspaceId: string
  runId: string
  linkedRecordId: string | null
  linkedRecordIdentifier: string | null
  linkedRecordTitle: string | null
  linkType: LinkType
  createdAt: string
}

export const toInstrument = (w: InstrumentWire): Instrument => ({
  id: w.id,
  workspaceId: w.workspace_id,
  name: w.name,
  instrumentType: w.instrument_type,
  model: w.model,
  serialNumber: w.serial_number,
  vendor: w.vendor,
  connectionStatus: w.connection_status,
  lastConnectedAt: w.last_connected_at,
  config: w.config,
  position: w.position,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
  createdByUserId: w.created_by_user_id,
  updatedByUserId: w.updated_by_user_id,
})
export const toInstrumentRun = (w: InstrumentRunWire): InstrumentRun => ({
  id: w.id,
  workspaceId: w.workspace_id,
  instrumentId: w.instrument_id,
  projectId: w.project_id,
  name: w.name,
  runIdentifier: w.run_identifier,
  protocolName: w.protocol_name,
  status: w.status,
  progressPercent: w.progress_percent,
  plateFormat: w.plate_format,
  startedAt: w.started_at,
  completedAt: w.completed_at,
  estimatedDurationSeconds: w.estimated_duration_seconds,
  elapsedSeconds: w.elapsed_seconds,
  operator: w.operator,
  errorMessage: w.error_message,
  metadataVersion: w.metadata_version,
  queuePosition: w.queue_position,
  tags: w.tags,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
  createdByUserId: w.created_by_user_id,
  updatedByUserId: w.updated_by_user_id,
})
export const toInstrumentRunStage = (
  w: InstrumentRunStageWire,
): InstrumentRunStage => ({
  id: w.id,
  workspaceId: w.workspace_id,
  runId: w.run_id,
  name: w.name,
  stageType: w.stage_type,
  position: w.position,
  status: w.status,
  cycleCount: w.cycle_count,
  currentCycle: w.current_cycle,
  targetTemperature: w.target_temperature,
  startedAt: w.started_at,
  completedAt: w.completed_at,
  durationSeconds: w.duration_seconds,
  config: w.config,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
})
export const toInstrumentObservation = (
  w: InstrumentObservationWire,
): InstrumentObservation => ({
  id: w.id,
  workspaceId: w.workspace_id,
  runId: w.run_id,
  stageId: w.stage_id,
  sourceId: w.source_id,
  observationType: w.observation_type,
  sourceTimestamp: w.source_timestamp,
  ingestionStatus: w.ingestion_status,
  payload: w.payload,
  errorDetail: w.error_detail,
  ingestedAt: w.ingested_at,
})
export const toInstrumentPlateSnapshot = (
  w: InstrumentPlateSnapshotWire,
): InstrumentPlateSnapshot => ({
  id: w.id,
  workspaceId: w.workspace_id,
  runId: w.run_id,
  observationId: w.observation_id,
  plateFormat: w.plate_format,
  wells: w.wells,
  capturedAt: w.captured_at,
  cycleNumber: w.cycle_number,
  createdAt: w.created_at,
})
export const toInstrumentQcCheck = (
  w: InstrumentQcCheckWire,
): InstrumentQcCheck => ({
  id: w.id,
  workspaceId: w.workspace_id,
  runId: w.run_id,
  checkName: w.check_name,
  checkType: w.check_type,
  message: w.message,
  detail: w.detail,
  checkedAt: w.checked_at,
  createdAt: w.created_at,
})
export const toInstrumentRawFile = (
  w: InstrumentRawFileWire,
): InstrumentRawFile => ({
  id: w.id,
  workspaceId: w.workspace_id,
  runId: w.run_id,
  fileId: w.file_id,
  filename: w.filename,
  mediaType: w.media_type,
  sizeBytes: w.size_bytes,
  storageKey: w.storage_key,
  checksum: w.checksum,
  ingestionStatus: w.ingestion_status,
  errorDetail: w.error_detail,
  receivedAt: w.received_at,
  createdAt: w.created_at,
})
export const toInstrumentRunLink = (
  w: InstrumentRunLinkWire,
): InstrumentRunLink => ({
  id: w.id,
  workspaceId: w.workspace_id,
  runId: w.run_id,
  linkedRecordId: w.linked_record_id,
  linkedRecordIdentifier: w.linked_record_identifier,
  linkedRecordTitle: w.linked_record_title,
  linkType: w.link_type,
  createdAt: w.created_at,
})

export const instrumentMonitorQueryKeys = {
  instruments: (id: string) => ['ops-006', 'instruments', id] as const,
  runs: (id: string) => ['ops-006', 'runs', id] as const,
  runDetail: (id: string) => ['ops-006', 'run-detail', id] as const,
  stages: (id: string) => ['ops-006', 'stages', id] as const,
  observations: (id: string) => ['ops-006', 'observations', id] as const,
  plateSnapshots: (id: string) => ['ops-006', 'plate-snapshots', id] as const,
  qcChecks: (id: string) => ['ops-006', 'qc-checks', id] as const,
  rawFiles: (id: string) => ['ops-006', 'raw-files', id] as const,
  runLinks: (id: string) => ['ops-006', 'run-links', id] as const,
}

const filter = (column: string, id: string, order: string) =>
  `?${column}=eq.${encodeURIComponent(id)}&order=${order}`
export async function fetchInstruments(c: DataClient, workspaceId: string) {
  return (
    await c.list<InstrumentWire>(
      'instruments',
      filter('workspace_id', workspaceId, 'position,name'),
    )
  ).map(toInstrument)
}
export async function fetchInstrumentRuns(c: DataClient, workspaceId: string) {
  return (
    await c.list<InstrumentRunWire>(
      'instrument_runs',
      filter('workspace_id', workspaceId, 'queue_position,created_at.desc'),
    )
  ).map(toInstrumentRun)
}
export async function fetchRunStages(c: DataClient, runId: string) {
  return (
    await c.list<InstrumentRunStageWire>(
      'instrument_run_stages',
      filter('run_id', runId, 'position'),
    )
  ).map(toInstrumentRunStage)
}
export async function fetchObservations(c: DataClient, runId: string) {
  return (
    await c.list<InstrumentObservationWire>(
      'instrument_observations',
      filter('run_id', runId, 'source_timestamp'),
    )
  ).map(toInstrumentObservation)
}
export async function fetchPlateSnapshots(c: DataClient, runId: string) {
  return (
    await c.list<InstrumentPlateSnapshotWire>(
      'instrument_plate_snapshots',
      filter('run_id', runId, 'captured_at'),
    )
  ).map(toInstrumentPlateSnapshot)
}
export async function fetchQcChecks(c: DataClient, runId: string) {
  return (
    await c.list<InstrumentQcCheckWire>(
      'instrument_qc_checks',
      filter('run_id', runId, 'checked_at'),
    )
  ).map(toInstrumentQcCheck)
}
export async function fetchRawFiles(c: DataClient, runId: string) {
  return (
    await c.list<InstrumentRawFileWire>(
      'instrument_raw_files',
      filter('run_id', runId, 'received_at'),
    )
  ).map(toInstrumentRawFile)
}
export async function fetchRunLinks(c: DataClient, runId: string) {
  return (
    await c.list<InstrumentRunLinkWire>(
      'instrument_run_links',
      filter('run_id', runId, 'created_at'),
    )
  ).map(toInstrumentRunLink)
}

export interface InstrumentRunStageInput {
  name: string
  stageType: StageType
  cycleCount?: number | null
  targetTemperature?: number | null
  durationSeconds?: number | null
  config?: JsonObject
}
export async function createInstrument(
  c: DataClient,
  i: {
    workspaceId: string
    name: string
    instrumentType?: InstrumentType
    model?: string | null
    serialNumber?: string | null
    vendor?: string | null
    config?: JsonObject
    position?: number
  },
): Promise<InstrumentWire> {
  return c.rpc('create_instrument', {
    p_workspace_id: i.workspaceId,
    p_name: i.name,
    p_instrument_type: i.instrumentType ?? 'qpcr',
    p_model: i.model ?? null,
    p_serial_number: i.serialNumber ?? null,
    p_vendor: i.vendor ?? null,
    p_config: i.config ?? {},
    p_position: i.position ?? 0,
  })
}
export async function updateInstrumentConnection(
  c: DataClient,
  i: {
    workspaceId: string
    instrumentId: string
    connectionStatus: ConnectionStatus
    lastConnectedAt?: string | null
  },
): Promise<InstrumentWire> {
  return c.rpc('update_instrument_connection', {
    p_workspace_id: i.workspaceId,
    p_instrument_id: i.instrumentId,
    p_connection_status: i.connectionStatus,
    p_last_connected_at: i.lastConnectedAt ?? null,
  })
}
export async function createInstrumentRun(
  c: DataClient,
  i: {
    workspaceId: string
    name: string
    runIdentifier: string
    instrumentId: string
    protocolName?: string | null
    projectId?: string | null
    plateFormat?: PlateFormat
    operator?: string | null
    estimatedDurationSeconds?: number | null
    tags?: string[]
    stages: InstrumentRunStageInput[]
  },
): Promise<InstrumentRunWire> {
  return c.rpc('create_instrument_run', {
    p_workspace_id: i.workspaceId,
    p_name: i.name,
    p_run_identifier: i.runIdentifier,
    p_instrument_id: i.instrumentId,
    p_protocol_name: i.protocolName ?? null,
    p_project_id: i.projectId ?? null,
    p_plate_format: i.plateFormat ?? '96',
    p_operator: i.operator ?? null,
    p_estimated_duration_seconds: i.estimatedDurationSeconds ?? null,
    p_tags: i.tags ?? [],
    p_stages: i.stages.map((s) => ({
      name: s.name,
      stageType: s.stageType,
      cycleCount: s.cycleCount ?? null,
      targetTemperature: s.targetTemperature ?? null,
      durationSeconds: s.durationSeconds ?? null,
      config: s.config ?? {},
    })),
  })
}
const runRpc = (
  c: DataClient,
  name: string,
  workspaceId: string,
  runId: string,
) =>
  c.rpc<InstrumentRunWire>(name, {
    p_workspace_id: workspaceId,
    p_run_id: runId,
  })
export const startInstrumentRun = (c: DataClient, w: string, r: string) =>
  runRpc(c, 'start_instrument_run', w, r)
export const completeInstrumentRun = (c: DataClient, w: string, r: string) =>
  runRpc(c, 'complete_instrument_run', w, r)
export function failInstrumentRun(
  c: DataClient,
  w: string,
  r: string,
  errorMessage?: string | null,
): Promise<InstrumentRunWire> {
  return c.rpc('fail_instrument_run', {
    p_workspace_id: w,
    p_run_id: r,
    p_error_message: errorMessage ?? null,
  })
}
export function ingestObservation(
  c: DataClient,
  i: {
    workspaceId: string
    runId: string
    sourceId: string
    observationType: ObservationType
    sourceTimestamp: string
    payload?: JsonObject
    stageId?: string | null
  },
): Promise<InstrumentObservationWire> {
  return c.rpc('ingest_observation', {
    p_workspace_id: i.workspaceId,
    p_run_id: i.runId,
    p_source_id: i.sourceId,
    p_observation_type: i.observationType,
    p_source_timestamp: i.sourceTimestamp,
    p_payload: i.payload ?? {},
    p_stage_id: i.stageId ?? null,
  })
}
export function createPlateSnapshot(
  c: DataClient,
  i: {
    workspaceId: string
    runId: string
    wells: JsonObject
    plateFormat?: PlateFormat
    cycleNumber?: number | null
    capturedAt?: string | null
    observationId?: string | null
  },
): Promise<InstrumentPlateSnapshotWire> {
  return c.rpc('create_plate_snapshot', {
    p_workspace_id: i.workspaceId,
    p_run_id: i.runId,
    p_wells: i.wells,
    p_plate_format: i.plateFormat ?? '96',
    p_cycle_number: i.cycleNumber ?? null,
    p_captured_at: i.capturedAt ?? null,
    p_observation_id: i.observationId ?? null,
  })
}
export function recordQcCheck(
  c: DataClient,
  i: {
    workspaceId: string
    runId: string
    checkName: string
    checkType?: QcCheckType
    message?: string | null
    detail?: JsonObject
  },
): Promise<InstrumentQcCheckWire> {
  return c.rpc('record_qc_check', {
    p_workspace_id: i.workspaceId,
    p_run_id: i.runId,
    p_check_name: i.checkName,
    p_check_type: i.checkType ?? 'info',
    p_message: i.message ?? null,
    p_detail: i.detail ?? {},
  })
}
export function registerRawFile(
  c: DataClient,
  i: {
    workspaceId: string
    runId: string
    filename: string
    mediaType?: string | null
    sizeBytes?: number | null
    storageKey?: string | null
    checksum?: string | null
    fileId?: string | null
    ingestionStatus?: FileIngestionStatus
    errorDetail?: string | null
  },
): Promise<InstrumentRawFileWire> {
  return c.rpc('register_raw_file', {
    p_workspace_id: i.workspaceId,
    p_run_id: i.runId,
    p_filename: i.filename,
    p_media_type: i.mediaType ?? null,
    p_size_bytes: i.sizeBytes ?? null,
    p_storage_key: i.storageKey ?? null,
    p_checksum: i.checksum ?? null,
    p_file_id: i.fileId ?? null,
    p_ingestion_status: i.ingestionStatus ?? 'pending',
    p_error_detail: i.errorDetail ?? null,
  })
}
export function linkRunRecord(
  c: DataClient,
  i: {
    workspaceId: string
    runId: string
    linkedRecordId: string
    linkType?: LinkType
  },
): Promise<InstrumentRunLinkWire> {
  return c.rpc('link_run_record', {
    p_workspace_id: i.workspaceId,
    p_run_id: i.runId,
    p_linked_record_id: i.linkedRecordId,
    p_link_type: i.linkType ?? 'experiment',
  })
}
export function updateRunProgress(
  c: DataClient,
  i: {
    workspaceId: string
    runId: string
    progressPercent: number
    elapsedSeconds?: number | null
  },
): Promise<InstrumentRunWire> {
  return c.rpc('update_run_progress', {
    p_workspace_id: i.workspaceId,
    p_run_id: i.runId,
    p_progress_percent: i.progressPercent,
    p_elapsed_seconds: i.elapsedSeconds ?? null,
  })
}

export function describeInstrumentMonitorError(error: unknown): string {
  if (!(error instanceof DataClientError))
    return 'Could not complete the instrument monitor operation. Try again.'
  const messages: Record<string, string> = {
    SB033: 'The selected item belongs to a different workspace.',
    SB034: 'The instrument was not found.',
    SB035: 'That run identifier is already in use.',
    SB036: 'The run status transition is not allowed.',
    SB037: 'This observation has already been ingested.',
    SB038: 'The selected stage is invalid.',
    SB039: 'The instrument run was not found.',
    SB040: 'The plate format is invalid.',
    SB041: 'The observation type is invalid.',
    SB042: 'The instrument run is not running.',
    SB043: 'The supplied input is invalid.',
    '42501': 'You do not have access to this instrument monitor.',
  }
  return messages[error.code] ?? error.message
}

export const RUN_STATUS_TOKENS: Record<RunStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-selection text-info',
  completed: 'bg-success-wash text-success-text',
  failed: 'bg-danger-wash text-danger-text',
  cancelled: 'bg-muted text-muted-foreground',
}
/**
 * Semantic Badge variants for run status. Status is always conveyed by text
 * (the label) as well as colour (UI-005). Mirrors the
 * `TASK_STATUS_BADGE_VARIANT` pattern from the Planner surface.
 */
export const RUN_STATUS_BADGE_VARIANT: Record<
  RunStatus,
  'secondary' | 'info' | 'success' | 'danger' | 'outline'
> = {
  queued: 'secondary',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'outline',
}
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}
export const CONNECTION_STATUS_TOKENS: Record<ConnectionStatus, string> = {
  connected: 'bg-success-wash text-success-text',
  disconnected: 'bg-muted text-muted-foreground',
  error: 'bg-danger-wash text-danger-text',
}
export const CONNECTION_STATUS_BADGE_VARIANT: Record<
  ConnectionStatus,
  'success' | 'outline' | 'danger'
> = {
  connected: 'success',
  disconnected: 'outline',
  error: 'danger',
}
export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
}
export const STAGE_STATUS_TOKENS: Record<StageStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-selection text-info',
  completed: 'bg-success-wash text-success-text',
  skipped: 'bg-muted text-muted-foreground',
  failed: 'bg-danger-wash text-danger-text',
}
export const STAGE_STATUS_BADGE_VARIANT: Record<
  StageStatus,
  'outline' | 'info' | 'success' | 'secondary' | 'danger'
> = {
  pending: 'outline',
  running: 'info',
  completed: 'success',
  skipped: 'secondary',
  failed: 'danger',
}
export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  skipped: 'Skipped',
  failed: 'Failed',
}
export const QC_CHECK_TOKENS: Record<QcCheckType, string> = {
  pass: 'bg-success-wash text-success-text',
  warning: 'bg-warning-wash text-warning-text',
  fail: 'bg-danger-wash text-danger-text',
  info: 'bg-selection text-info',
}
export const QC_CHECK_BADGE_VARIANT: Record<
  QcCheckType,
  'success' | 'warning' | 'danger' | 'info'
> = {
  pass: 'success',
  warning: 'warning',
  fail: 'danger',
  info: 'info',
}
export const QC_CHECK_LABELS: Record<QcCheckType, string> = {
  pass: 'Pass',
  warning: 'Warning',
  fail: 'Fail',
  info: 'Info',
}
export const INGESTION_STATUS_TOKENS: Record<IngestionStatus, string> = {
  received: 'bg-selection text-info',
  processed: 'bg-success-wash text-success-text',
  failed: 'bg-danger-wash text-danger-text',
  duplicate: 'bg-warning-wash text-warning-text',
}
export const INGESTION_STATUS_LABELS: Record<IngestionStatus, string> = {
  received: 'Received',
  processed: 'Processed',
  failed: 'Failed',
  duplicate: 'Duplicate',
}
export const FILE_INGESTION_BADGE_VARIANT: Record<
  FileIngestionStatus,
  'outline' | 'success' | 'warning' | 'danger'
> = {
  pending: 'outline',
  complete: 'success',
  partial: 'warning',
  failed: 'danger',
}

export const WELL_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const
export const WELL_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
export function wellCode(row: string, col: number): string {
  return `${row.toUpperCase()}${col}`
}
export function parseWellCode(
  code: string,
): { row: string; col: number } | null {
  const m = /^([A-H])(\d{1,2})$/i.exec(code.trim())
  if (!m) return null
  const col = Number(m[2])
  return col >= 1 && col <= 12 ? { row: m[1].toUpperCase(), col } : null
}
export const PLATE_WELL_CODES = WELL_ROWS.flatMap((row) =>
  WELL_COLS.map((col) => wellCode(row, col)),
)

export interface QpcrRawReading {
  cycle: number
  well: string
  fluorescence: number
}
export interface CanonicalObservation {
  source_id: string
  observation_type: ObservationType
  source_timestamp: string
  payload: JsonObject
}
export function parseAmplificationCurve(
  rawData: QpcrRawReading[],
): JsonObject[] {
  const byCycle = new Map<number, QpcrRawReading[]>()
  for (const reading of rawData)
    byCycle.set(reading.cycle, [...(byCycle.get(reading.cycle) ?? []), reading])
  return [...byCycle]
    .sort(([a], [b]) => a - b)
    .map(([cycle, readings]) => ({
      cycle,
      readings: readings.map(({ well, fluorescence }) => ({
        well,
        fluorescence,
      })),
    }))
}
export function createStageObservations(
  stages: Array<{
    name: string
    stageType: StageType
    startedAt: string
    completedAt: string
    cycleCount?: number
    targetTemperature?: number
  }>,
): CanonicalObservation[] {
  return stages.flatMap((s, index) => [
    {
      source_id: `qpcr-stage-${index + 1}-start`,
      observation_type: 'stage_start' as const,
      source_timestamp: s.startedAt,
      payload: {
        name: s.name,
        stageType: s.stageType,
        cycleCount: s.cycleCount ?? null,
        targetTemperature: s.targetTemperature ?? null,
      },
    },
    {
      source_id: `qpcr-stage-${index + 1}-complete`,
      observation_type: 'stage_complete' as const,
      source_timestamp: s.completedAt,
      payload: { name: s.name, stageType: s.stageType },
    },
  ])
}
export function createPlateSnapshotObservation(
  wells: JsonObject,
  cycle: number,
): Omit<CanonicalObservation, 'source_id' | 'source_timestamp'> {
  return {
    observation_type: 'plate_snapshot',
    payload: { plateFormat: '96', cycle, wells },
  }
}
export function createQcCheckObservation(
  checks: Array<{
    name: string
    checkType: QcCheckType
    message?: string
    detail?: JsonObject
  }>,
): Omit<CanonicalObservation, 'source_id' | 'source_timestamp'> {
  return { observation_type: 'qc_result', payload: { checks } }
}
export class QpcrAdapter {
  parseAmplificationCurve = parseAmplificationCurve
  createStageObservations = createStageObservations
  createPlateSnapshotObservation = createPlateSnapshotObservation
  createQcCheckObservation = createQcCheckObservation
}

/** Deterministic, realistic stream suitable for demos and adapter tests. */
export function createQpcrFixtureStream(): CanonicalObservation[] {
  const start = Date.parse('2026-01-15T09:00:00.000Z')
  let sequence = 0
  const observation = (
    type: ObservationType,
    payload: JsonObject,
    minute: number,
  ): CanonicalObservation => ({
    source_id: `qpcr-fix-${String(++sequence).padStart(3, '0')}`,
    observation_type: type,
    source_timestamp: new Date(start + minute * 60_000).toISOString(),
    payload,
  })
  const stream = [
    observation('run_start', { instrument: 'qPCR', plateFormat: '96' }, 0),
  ]
  stream.push(
    observation(
      'stage_start',
      {
        name: 'Hold',
        stageType: 'hold',
        targetTemperature: 50,
        durationSeconds: 120,
      },
      1,
    ),
    observation('stage_complete', { name: 'Hold', stageType: 'hold' }, 3),
    observation(
      'stage_start',
      {
        name: 'Cycling',
        stageType: 'cycling',
        cycleCount: 40,
        steps: [
          { temperature: 95, durationSeconds: 15 },
          { temperature: 60, durationSeconds: 60 },
        ],
      },
      4,
    ),
  )
  const wells = [
    { well: 'A1', sample: 'Sample 1', ct: 18.4, amplitude: 1.05 },
    { well: 'A2', sample: 'Sample 1', ct: 18.8, amplitude: 1.02 },
    { well: 'B1', sample: 'Sample 2', ct: 27.5, amplitude: 0.9 },
    { well: 'B2', sample: 'Sample 2', ct: 28.1, amplitude: 0.88 },
    { well: 'C1', sample: 'Positive control', ct: 20.2, amplitude: 1.1 },
    { well: 'C2', sample: 'Positive control', ct: 20.5, amplitude: 1.08 },
    { well: 'D1', sample: 'Negative control', ct: null, amplitude: 0 },
    { well: 'D2', sample: 'Blank', ct: null, amplitude: 0 },
  ]
  for (const cycle of [1, 5, 10, 15, 20, 25, 30, 35, 40]) {
    const readings = wells.map((w, index) => ({
      well: w.well,
      sample: w.sample,
      fluorescence: Number(
        (
          0.08 +
          (w.ct === null
            ? 0.003 * cycle
            : w.amplitude / (1 + Math.exp(-0.65 * (cycle - w.ct)))) +
          0.001 * index
        ).toFixed(4),
      ),
    }))
    stream.push(
      observation(
        'telemetry',
        { stage: 'Cycling', cycle, temperature: 60, readings },
        4 + cycle * 2,
      ),
    )
  }
  stream.push(
    observation(
      'stage_complete',
      { name: 'Cycling', stageType: 'cycling', cyclesCompleted: 40 },
      85,
    ),
    observation(
      'stage_start',
      {
        name: 'Melt',
        stageType: 'melt',
        temperatureStart: 65,
        temperatureEnd: 95,
      },
      86,
    ),
    observation(
      'stage_complete',
      {
        name: 'Melt',
        stageType: 'melt',
        temperatureStart: 65,
        temperatureEnd: 95,
      },
      101,
    ),
  )
  const plateWells = Object.fromEntries(
    wells.map((w) => [
      w.well,
      {
        sample: w.sample,
        status:
          w.sample === 'Blank'
            ? 'blank'
            : w.ct === null
              ? 'no_amplification'
              : 'amplified',
        ct: w.ct,
      },
    ]),
  )
  stream.push(
    observation(
      'plate_snapshot',
      { plateFormat: '96', cycle: 40, wells: plateWells },
      102,
    ),
    observation(
      'qc_result',
      {
        checks: [
          {
            name: 'Positive control amplified',
            checkType: 'pass',
            detail: { ct: 20.2 },
          },
          { name: 'Negative control clean', checkType: 'pass' },
          {
            name: 'Standard curve R² > 0.98',
            checkType: 'pass',
            detail: { rSquared: 0.992 },
          },
        ],
      },
      103,
    ),
    observation(
      'run_complete',
      { cyclesCompleted: 40, progressPercent: 100 },
      104,
    ),
  )
  return stream
}
