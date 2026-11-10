/**
 * The browser's side of instrument intake: upload a kept file, try a failed one
 * again, and read or dismiss the problems left behind. The work itself happens
 * on the server (`/api/connectors/intake`) so every route reads files with the
 * same approved parsers.
 */
import { z } from 'zod'

import type { DataClient } from '../data-client'

const intakeResultSchema = z.looseObject({
  runId: z.string(),
  alreadyCompleted: z.boolean(),
  datasetId: z.string(),
  datasetRevision: z.number().nullable(),
  rowCount: z.number(),
  parser: z.string(),
  fileRecordId: z.string().nullable(),
  warnings: z.array(z.string()),
})

export type IntakeResultWire = z.infer<typeof intakeResultSchema>

const intakeFailureSchema = z.object({
  error: z
    .object({
      code: z.string().optional().catch(undefined),
      message: z.string().optional().catch(undefined),
    })
    .nullish(),
  failureId: z.string().nullish().catch(null),
})

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
  fetchImpl: typeof fetch = fetch,
): Promise<IntakeResultWire> {
  const response = await fetchImpl('/api/connectors/intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => null)
  const failure = intakeFailureSchema.safeParse(payload)
  const result = intakeResultSchema.safeParse(payload)
  const error = failure.success ? failure.data.error : undefined

  if (!response.ok || !result.success || error) {
    throw new IntakeClientError(
      error?.code ?? 'intake_failed',
      error?.message ?? 'The file couldn’t be read.',
      failure.success ? (failure.data.failureId ?? null) : null,
    )
  }

  return result.data
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
