/**
 * Robots: sending a worklist to an instrument that does the pipetting, and
 * reading back what it did (migration automation_robots_scheduler_code_cells).
 *
 * A robot is an instrument with robot settings. A job takes a worklist to it:
 * the folder agent on the lab computer puts the run on the robot, a person
 * presses Start, and the robot's log comes back as the worklist's completed
 * transfers. This module is the shared part: the kinds of robot, the wire
 * shapes, the file a robot is given, and the calls the screens make.
 */
import type { DataClient } from '#/lib/data-client'
import type { Transfer, WorklistFormat, WriteOptions } from './plate-worklist'
import { WORKLIST_FILE_EXTENSION, writeWorklist } from './plate-worklist'
import type { PlateFormat } from './plate-map'

/** How Sheetbase reaches a robot. Each is a driver in the folder agent. */
export const ROBOT_DRIVERS = [
  {
    key: 'opentrons',
    worklistFormat: 'opentrons',
    needsAddress: true,
  },
  {
    key: 'file',
    worklistFormat: 'csv',
    needsAddress: false,
  },
] as const satisfies ReadonlyArray<{
  key: string
  worklistFormat: WorklistFormat
  needsAddress: boolean
}>

export type RobotDriver = (typeof ROBOT_DRIVERS)[number]['key']

export function isRobotDriver(value: string): value is RobotDriver {
  return ROBOT_DRIVERS.some((driver) => driver.key === value)
}

/** The worklist formats a file robot can be given. */
export const FILE_ROBOT_FORMATS: readonly WorklistFormat[] = [
  'csv',
  'echo',
  'tecan_gwl',
  'hamilton',
]

export type RobotJobStatus =
  | 'queued'
  | 'staged'
  | 'starting'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'

export const OPEN_JOB_STATUSES: readonly RobotJobStatus[] = [
  'queued',
  'staged',
  'starting',
  'running',
]

export function isOpenJob(status: string): boolean {
  return (OPEN_JOB_STATUSES as readonly string[]).includes(status)
}

/** The labware a robot's worklist file names. Same keys as the worklist writers. */
export type RobotLabware = Pick<
  WriteOptions,
  | 'opentronsSourceLabware'
  | 'opentronsDestLabware'
  | 'opentronsPipette'
  | 'opentronsTiprack'
  | 'opentronsMount'
  | 'liquidClass'
  | 'tecanSourceType'
  | 'tecanDestType'
  | 'echoSourceType'
>

export interface RobotSettingsWire {
  instrument_id: string
  workspace_id: string
  driver: RobotDriver
  worklist_format: WorklistFormat
  labware: RobotLabware
  updated_at: string
  updated_by_user_id: string | null
}

export interface InstrumentJobWire {
  id: string
  workspace_id: string
  number: number
  instrument_id: string
  worklist_id: string
  record_id: string | null
  driver: RobotDriver
  worklist_format: WorklistFormat
  labware: RobotLabware
  status: RobotJobStatus
  cancel_requested: boolean
  note: string | null
  remote_ref: string | null
  log: Array<{ at: string; status: string; message: string }>
  error_message: string | null
  result: {
    transfers: number
    byStatus: Record<string, number>
    withdrawals?: {
      recorded?: boolean
      withdrawn?: Array<{ identifier?: string }>
      skipped?: Array<{ identifier?: string; reason?: string }>
    } | null
    manual?: boolean
  } | null
  agent_seen_at: string | null
  queued_by_user_id: string
  started_by_user_id: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
  /** The worklist's name, when the list asked for it. */
  plate_worklists?: { name: string; number: number } | null
}

/** "IJ-0007". */
export function jobReference(number: number): string {
  return `IJ-${String(number).padStart(4, '0')}`
}

/** An agent that asked for work this recently counts as connected. */
export const ROBOT_AGENT_SEEN_MINUTES = 3

export function agentIsConnected(
  seenAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!seenAt) return false

  return nowMs - Date.parse(seenAt) <= ROBOT_AGENT_SEEN_MINUTES * 60_000
}

export const robotQueryKeys = {
  settings: (instrumentId: string) =>
    ['robots', 'settings', instrumentId] as const,
  allSettings: ['robots', 'settings'] as const,
  jobs: (instrumentId: string) => ['robots', 'jobs', instrumentId] as const,
  jobsForWorklist: (worklistId: string) =>
    ['robots', 'jobs', 'worklist', worklistId] as const,
  recentJobs: ['robots', 'jobs'] as const,
}

export function fetchRobotSettings(
  client: DataClient,
): Promise<RobotSettingsWire[]> {
  return client.list<RobotSettingsWire>(
    'instrument_robot_settings',
    '?select=*&order=updated_at.desc',
  )
}

export function fetchInstrumentJobs(
  client: DataClient,
  filter: { instrumentId?: string; worklistId?: string; limit?: number } = {},
): Promise<InstrumentJobWire[]> {
  const query = new URLSearchParams({
    select: '*,plate_worklists(name,number)',
    order: 'created_at.desc',
    limit: String(filter.limit ?? 50),
  })

  if (filter.instrumentId)
    query.set('instrument_id', `eq.${filter.instrumentId}`)

  if (filter.worklistId) query.set('worklist_id', `eq.${filter.worklistId}`)

  return client.list<InstrumentJobWire>(
    'instrument_jobs',
    `?${query.toString()}`,
  )
}

export function saveRobotSettings(
  client: DataClient,
  input: {
    instrumentId: string
    driver: RobotDriver
    worklistFormat?: WorklistFormat
    labware?: RobotLabware
  },
): Promise<RobotSettingsWire> {
  return client.rpc<RobotSettingsWire>('set_instrument_robot', {
    p_instrument_id: input.instrumentId,
    p_driver: input.driver,
    p_worklist_format: input.worklistFormat ?? null,
    p_labware: input.labware ?? {},
  })
}

export async function clearRobotSettings(
  client: DataClient,
  instrumentId: string,
): Promise<void> {
  await client.rpc<unknown>('clear_instrument_robot', {
    p_instrument_id: instrumentId,
  })
}

export function queueJob(
  client: DataClient,
  input: { instrumentId: string; worklistId: string; note?: string },
): Promise<InstrumentJobWire> {
  return client.rpc<InstrumentJobWire>('queue_instrument_job', {
    p_instrument_id: input.instrumentId,
    p_worklist_id: input.worklistId,
    p_note: input.note?.trim() ? input.note.trim() : null,
  })
}

export function startJob(
  client: DataClient,
  jobId: string,
): Promise<InstrumentJobWire> {
  return client.rpc<InstrumentJobWire>('start_instrument_job', {
    p_job_id: jobId,
  })
}

export function cancelJob(
  client: DataClient,
  jobId: string,
): Promise<InstrumentJobWire> {
  return client.rpc<InstrumentJobWire>('cancel_instrument_job', {
    p_job_id: jobId,
  })
}

/** What the agent is given for one job: the file the robot reads. */
export interface RobotFile {
  name: string
  content: string
}

/** Slug for a file name: letters, digits, dashes. */
function fileSlug(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.slice(0, 40) || 'worklist'
}

export interface JobWorklist {
  name: string
  sourceFormat: PlateFormat
  destFormat: PlateFormat
  transfers: Array<{
    sourceWell: string
    destWell: string
    volumeUl: number
    label?: string
    sampleId?: string | null
  }>
  sourcePlate?: string
  destPlate?: string
}

/** The worklist file for a job, in the format its robot reads. */
export function robotFileFor(job: {
  number: number
  format: WorklistFormat
  labware: RobotLabware
  worklist: JobWorklist
}): RobotFile {
  const transfers: Transfer[] = job.worklist.transfers.map((t) => ({
    sourcePlate: job.worklist.sourcePlate ?? 'Source',
    sourceWell: t.sourceWell,
    destPlate: job.worklist.destPlate ?? 'Destination',
    destWell: t.destWell,
    volumeUl: Number(t.volumeUl),
    label: t.label ?? '',
    sampleId: t.sampleId ?? null,
  }))

  const content = writeWorklist(job.format, transfers, {
    ...job.labware,
    sourceFormat: job.worklist.sourceFormat,
    destFormat: job.worklist.destFormat,
    title: `${jobReference(job.number)} ${job.worklist.name}`,
  })

  const extension = WORKLIST_FILE_EXTENSION[job.format]

  return {
    name: `${jobReference(job.number).toLowerCase()}-${fileSlug(job.worklist.name)}.${extension}`,
    content,
  }
}

/** Robot settings of every robot, keyed by instrument. */
export function robotsById(
  settings: readonly RobotSettingsWire[],
): Map<string, RobotSettingsWire> {
  return new Map(settings.map((row) => [row.instrument_id, row]))
}

/** Which labware fields a robot's setup asks for, given its driver and file format. */
export function labwareFieldsFor(
  driver: RobotDriver,
  format: WorklistFormat,
): ReadonlyArray<keyof RobotLabware> {
  if (driver === 'opentrons') {
    return [
      'opentronsSourceLabware',
      'opentronsDestLabware',
      'opentronsPipette',
      'opentronsTiprack',
      'opentronsMount',
    ]
  }

  if (format === 'tecan_gwl') {
    return ['liquidClass', 'tecanSourceType', 'tecanDestType']
  }

  if (format === 'echo') return ['echoSourceType']

  return []
}
