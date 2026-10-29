/**
 * The browser's side of instrument intake: upload a kept file, try a failed one
 * again, and read or dismiss the problems left behind. The work itself happens
 * on the server (`/api/connectors/intake`) so every route reads files with the
 * same approved parsers.
 */
import type { DataClient } from '../data-client'

export interface IntakeResultWire {
  runId: string
  alreadyCompleted: boolean
  datasetId: string
  datasetRevision: number | null
  rowCount: number
  parser: string
  fileRecordId: string | null
  warnings: string[]
}

export interface IntakeProblem {
  id: string
  connector_id: string
  instrument_id: string | null
  file_name: string
  source: 'agent' | 'upload'
  code: string
  message: string
  parser_key: string | null
  file_record_id: string | null
  attempts: number
  created_at: string
  last_attempt_at: string
}

export class IntakeClientError extends Error {
  readonly code: string
  readonly failureId: string | null
  constructor(code: string, message: string, failureId: string | null) {
    super(message)
    this.name = 'IntakeClientError'
    this.code = code
    this.failureId = failureId
  }
}

export const intakeQueryKeys = {
  problems: (scope: string) => ['intake-problems', scope] as const,
  all: ['intake-problems'] as const,
}

type IntakeRequest =
  | {
      kind: 'upload'
      connectorId: string
      fileRecordId: string
      fileName: string
      projectId: string
      schemaVersionId: string
      datasetId?: string | null
      newDatasetName?: string | null
    }
  | { kind: 'retry'; failureId: string; parserKey?: string | null }

export async function postIntake(
  body: IntakeRequest,
): Promise<IntakeResultWire> {
  const response = await fetch('/api/connectors/intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as
    | (Partial<IntakeResultWire> & {
        error?: { code?: string; message?: string }
        failureId?: string | null
      })
    | null
  if (!response.ok || !payload || payload.error) {
    throw new IntakeClientError(
      payload?.error?.code ?? 'intake_failed',
      payload?.error?.message ?? 'The file couldn’t be read.',
      payload?.failureId ?? null,
    )
  }
  return payload as IntakeResultWire
}

const PROBLEM_COLUMNS =
  'id,connector_id,instrument_id,file_name,source,code,message,parser_key,file_record_id,attempts,created_at,last_attempt_at'

/** Open problems, newest first, for one instrument or one connector. */
export function fetchIntakeProblems(
  client: DataClient,
  scope: { instrumentId?: string; connectorId?: string },
) {
  const filter = scope.instrumentId
    ? `instrument_id=eq.${encodeURIComponent(scope.instrumentId)}`
    : scope.connectorId
      ? `connector_id=eq.${encodeURIComponent(scope.connectorId)}`
      : ''
  return client.list<IntakeProblem>(
    'intake_failures',
    `?status=eq.open${filter ? `&${filter}` : ''}&select=${PROBLEM_COLUMNS}&order=last_attempt_at.desc&limit=50`,
  )
}

export function dismissIntakeProblem(client: DataClient, failureId: string) {
  return client.rpc('resolve_intake_failure', {
    p_failure_id: failureId,
    p_resolution: 'dismissed',
  })
}
