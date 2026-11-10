/**
 * Robot jobs for the folder agent.
 *
 * `POST /api/connectors/jobs` is how the agent on the lab computer next to a
 * robot works through the jobs queued for it:
 *
 *   { "action": "list",   "instrumentId": "<uuid>" }
 *       → { jobs: [{ id, number, status, driver, remoteRef, cancelRequested, file? }] }
 *         `file` (name and content) is sent for a job that is still queued.
 *   { "action": "report", "instrumentId": "<uuid>", "jobId": "<uuid>", "status": "staged" | "running" | "complete" | "failed" | "cancelled",
 *     "remoteRef"?, "message"?, "entries"?, "runLog"?, "volumeUnit"? }
 *       → { job }
 *         `entries` (what the robot moved, well to well) or `runLog` (the robot's log
 *         as text) come with "complete" and are matched to the worklist here.
 *
 * It uses the same personal API token as the rest of the agent, so who may run a
 * robot is decided by the database exactly as it is for a person in the app.
 */
import { z } from 'zod'
import { DataClientError } from '../data-client'
import type { DataClient } from '../data-client'
import type { ExternalClaims } from '../external-token'
import { annotateRequest } from '#/lib/request-log'
import { boundedErrorMessage } from './enterprise/errors'
import { PickupError, readBearer } from './pickup.server'
import { parseRunLog, reconcileRunLog } from '../plate-worklist'
import type { LogEntry, Transfer } from '../plate-worklist'
import { robotFileFor } from '../robots'
import type { InstrumentJobWire, JobWorklist, RobotFile } from '../robots'

export const JOBS_MAX_BYTES = 2 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const reportStatusSchema = z.enum([
  'staged',
  'running',
  'complete',
  'failed',
  'cancelled',
])

export interface JobsDeps {
  verifyCredential: (token: string) => Promise<ExternalClaims>
  createClient: (token: string) => DataClient
}

interface JobRpcRow {
  id: string
  number: number
  status: string
  driver: string
  format: InstrumentJobWire['worklist_format']
  labware: Record<string, string>
  remoteRef: string | null
  cancelRequested: boolean
  recordId: string | null
  worklist: {
    id: string
    number: number
    name: string
    sourcePlate: string
    sourceFormat: JobWorklist['sourceFormat']
    destPlate: string
    destFormat: JobWorklist['destFormat']
    transfers: Array<{
      sourceWell: string
      destWell: string
      volumeUl: number
      label?: string
      sampleId?: string | null
    }>
  }
}

export interface AgentJob {
  id: string
  number: number
  status: string
  driver: string
  format: string
  remoteRef: string | null
  cancelRequested: boolean
  recordId: string | null
  worklistName: string
  transfers: number
  /** Only for a queued job: the file to put on the robot. */
  file?: RobotFile
}

/** What the agent is told about a job. */
export function toAgentJob(row: JobRpcRow): AgentJob {
  const base: AgentJob = {
    id: row.id,
    number: row.number,
    status: row.status,
    driver: row.driver,
    format: row.format,
    remoteRef: row.remoteRef,
    cancelRequested: row.cancelRequested,
    recordId: row.recordId,
    worklistName: row.worklist.name,
    transfers: row.worklist.transfers.length,
  }

  if (row.status === 'queued') {
    base.file = robotFileFor({
      number: row.number,
      format: row.format,
      labware: row.labware,
      worklist: {
        name: row.worklist.name,
        sourceFormat: row.worklist.sourceFormat,
        destFormat: row.worklist.destFormat,
        sourcePlate: row.worklist.sourcePlate,
        destPlate: row.worklist.destPlate,
        transfers: row.worklist.transfers,
      } satisfies JobWorklist,
    })
  }

  return base
}

function errorResponse(status: number, code: string, message: string) {
  if (status >= 500) annotateRequest({ error: { code, message } })

  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export interface JobsRequest {
  action: 'list' | 'report'
  instrumentId: string
  jobId?: string
  status?: z.infer<typeof reportStatusSchema>
  remoteRef?: string
  message?: string
  entries?: LogEntry[]
  runLog?: string
  volumeUnit?: 'ul' | 'nl' | 'ml'
}

/** The body, checked down to what the database will accept. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- HTTP JSON enters untrusted and is decoded here with ordered, actionable request errors.
export function parseJobsBody(raw: unknown): JobsRequest {
  const envelope = z.record(z.string(), z.unknown()).safeParse(raw)

  if (!envelope.success) {
    throw new PickupError(400, 'invalid_request', 'Send a JSON body.')
  }

  const data = envelope.data
  const action = data['action']

  if (action !== 'list' && action !== 'report') {
    throw new PickupError(
      400,
      'invalid_request',
      'action must be list or report.',
    )
  }

  const instrumentId = z.string().regex(UUID).safeParse(data['instrumentId'])

  if (!instrumentId.success) {
    throw new PickupError(
      400,
      'invalid_request',
      'instrumentId must be the id of the robot.',
    )
  }

  if (action === 'list') return { action, instrumentId: instrumentId.data }
  const jobId = z.string().regex(UUID).safeParse(data['jobId'])

  if (!jobId.success) {
    throw new PickupError(400, 'invalid_request', 'jobId must be a job id.')
  }

  const status = reportStatusSchema.safeParse(data['status'])

  if (!status.success) {
    throw new PickupError(
      400,
      'invalid_request',
      'status must be staged, running, complete, failed or cancelled.',
    )
  }

  const out: JobsRequest = {
    action,
    instrumentId: instrumentId.data,
    jobId: jobId.data,
    status: status.data,
  }

  const remoteRef = z.string().safeParse(data['remoteRef'])
  const message = z.string().safeParse(data['message'])

  if (remoteRef.success) out.remoteRef = remoteRef.data.slice(0, 200)

  if (message.success) out.message = message.data.slice(0, 500)

  if (data['runLog'] !== undefined) {
    const runLog = z.string().safeParse(data['runLog'])

    if (!runLog.success) {
      throw new PickupError(400, 'invalid_request', 'runLog must be text.')
    }

    out.runLog = runLog.data
  }

  if (data['volumeUnit'] !== undefined) {
    const volumeUnit = z.enum(['ul', 'nl', 'ml']).safeParse(data['volumeUnit'])

    if (!volumeUnit.success) {
      throw new PickupError(
        400,
        'invalid_request',
        'volumeUnit must be ul, nl or ml.',
      )
    }

    out.volumeUnit = volumeUnit.data
  }

  if (data['entries'] !== undefined) {
    const entries = z.array(z.unknown()).max(20000).safeParse(data['entries'])

    if (!entries.success) {
      throw new PickupError(
        400,
        'invalid_request',
        'entries must be a list of up to 20000 transfers.',
      )
    }

    out.entries = entries.data.map((item, index): LogEntry => {
      const row = z
        .object({
          sourceWell: z.string(),
          destWell: z.string(),
          actualUl: z.unknown().optional(),
          status: z.unknown().optional(),
        })
        .safeParse(item)

      if (!row.success) {
        throw new PickupError(
          400,
          'invalid_request',
          `Entry ${index + 1} needs sourceWell and destWell.`,
        )
      }

      const actual = z.number().safeParse(row.data.actualUl)
      const entryStatus = row.data.status

      return {
        sourceWell: row.data.sourceWell.toUpperCase(),
        destWell: row.data.destWell.toUpperCase(),
        actualUl: actual.success ? actual.data : null,
        status:
          entryStatus === 'failed' || entryStatus === 'skipped'
            ? entryStatus
            : ('ok' as const),
      }
    })
  }

  if (status.data === 'complete' && !out.entries && out.runLog === undefined) {
    throw new PickupError(
      400,
      'invalid_request',
      'Completing a job needs entries or runLog: what the robot moved.',
    )
  }

  return out
}

/** Match what the robot did to the planned transfers. */
export function reconcileJobLog(
  planned: Transfer[],
  report: Pick<JobsRequest, 'entries' | 'runLog' | 'volumeUnit'>,
): ReturnType<typeof reconcileRunLog> {
  let entries = report.entries

  if (!entries && report.runLog !== undefined) {
    const parsed = parseRunLog(report.runLog, { volumeUnit: report.volumeUnit })

    if (parsed.entries.length === 0) {
      throw new PickupError(
        422,
        'unreadable_log',
        'The robot’s log has no transfers Sheetbase can read.',
      )
    }

    entries = parsed.entries
  }

  return reconcileRunLog(planned, entries ?? [])
}

export async function runJobs(request: Request, deps: JobsDeps) {
  const token = readBearer(request.headers)

  if (!token) {
    throw new PickupError(401, 'unauthenticated', 'Bearer token required.')
  }

  let claims: ExternalClaims

  try {
    claims = await deps.verifyCredential(token)
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? z.coerce.string().parse(error.code)
        : 'invalid_token'

    throw new PickupError(
      code === 'insufficient_scope' ? 403 : 401,
      code,
      boundedErrorMessage(error),
    )
  }

  if (claims.role !== 'authenticated') {
    throw new PickupError(
      403,
      'personal_token_required',
      'Robot jobs need a personal API token; service credentials cannot run a robot.',
    )
  }

  if (!claims.scopes.includes('datasets:write')) {
    throw new PickupError(
      403,
      'insufficient_scope',
      'Credential lacks scope: datasets:write',
    )
  }

  const declared = Number(request.headers.get('content-length') ?? '')

  if (Number.isFinite(declared) && declared > JOBS_MAX_BYTES) {
    throw new PickupError(413, 'too_large', 'That request is too large.')
  }

  const text = await request.text()

  if (text.length > JOBS_MAX_BYTES) {
    throw new PickupError(413, 'too_large', 'That request is too large.')
  }

  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch {
    throw new PickupError(400, 'invalid_request', 'The body is not JSON.')
  }

  const body = parseJobsBody(raw)
  annotateRequest({
    auth: 'api_credential',
    workspace: { id: claims.workspace_id },
    instrument: { id: body.instrumentId },
  })
  const client = deps.createClient(token)

  if (body.action === 'list') {
    const rows = await client.rpc<JobRpcRow[]>('agent_instrument_jobs', {
      p_instrument_id: body.instrumentId,
    })

    return { jobs: rows.map(toAgentJob) }
  }

  let reconciled: ReturnType<typeof reconcileJobLog> | null = null

  if (body.status === 'complete') {
    const jobs = await client.list<Pick<InstrumentJobWire, 'worklist_id'>>(
      'instrument_jobs',
      `?select=worklist_id&id=eq.${body.jobId}&limit=1`,
    )

    const worklistId = jobs[0]?.worklist_id

    if (!worklistId) {
      throw new PickupError(404, 'not_found', 'That job is not here.')
    }

    const lists = await client.list<{
      transfers: Array<{
        sourceWell: string
        destWell: string
        volumeUl: number
        label?: string
        sampleId?: string | null
      }>
      source_plate: string
      dest_plate: string
    }>(
      'plate_worklists',
      `?select=transfers,source_plate,dest_plate&id=eq.${worklistId}&limit=1`,
    )

    const list = lists.at(0)

    if (!list) {
      throw new PickupError(404, 'not_found', 'That worklist is not here.')
    }

    const planned: Transfer[] = list.transfers.map((t) => ({
      sourcePlate: list.source_plate,
      sourceWell: t.sourceWell,
      destPlate: list.dest_plate,
      destWell: t.destWell,
      volumeUl: Number(t.volumeUl),
      label: t.label ?? '',
      sampleId: t.sampleId ?? null,
    }))

    reconciled = reconcileJobLog(planned, body)
  }

  const job = await client.rpc<InstrumentJobWire>(
    'agent_report_instrument_job',
    {
      p_job_id: body.jobId,
      p_status: body.status,
      p_remote_ref: body.remoteRef ?? null,
      p_message: body.message ?? null,
      p_reconciled: reconciled,
    },
  )

  return { job: { id: job.id, number: job.number, status: job.status } }
}

export async function handleJobs(
  request: Request,
  deps: JobsDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Use POST.')
  }

  try {
    const result = await runJobs(request, deps)

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    if (error instanceof PickupError) {
      return errorResponse(error.status, error.code, error.message)
    }

    if (error instanceof DataClientError) {
      if (error.status === 401 || error.status === 403) {
        return errorResponse(
          403,
          'forbidden',
          `The token’s owner cannot run this robot: ${boundedErrorMessage(error)}`,
        )
      }

      if (
        error.status === 400 ||
        error.status === 409 ||
        error.status === 422
      ) {
        return errorResponse(422, 'refused', boundedErrorMessage(error))
      }
    }

    // The data client reports a refusal from the database as a plain Error; a
    // network failure is a TypeError. Only the second is worth retrying.
    if (error instanceof Error && !(error instanceof TypeError)) {
      return errorResponse(422, 'refused', boundedErrorMessage(error))
    }

    return errorResponse(502, 'jobs_failed', boundedErrorMessage(error))
  }
}
