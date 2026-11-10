/**
 * Validation as the app reads and starts it: who may, the runs so far, and the
 * pack download. Runs and the pack go through the session-only routes.
 */
import { z } from 'zod'
import type { DataClient } from '#/lib/data-client'
import type { ValidationRunRecord } from './types'

/** One check result as the run route serialises it. */
const checkResultSchema = z.object({
  id: z.string(),
  kind: z.enum(['iq', 'oq']),
  title: z.string(),
  method: z.string(),
  expected: z.string(),
  requirements: z.array(z.string()),
  status: z.enum(['passed', 'failed', 'skipped']),
  detail: z.string(),
  evidence: z.record(z.string(), z.json()),
  durationMs: z.number(),
})

/** A finished run: the record the validation page reads and reports. */
const validationRunSchema: z.ZodType<ValidationRunRecord> = z.object({
  id: z.string(),
  workspace_id: z.string(),
  run_by_user_id: z.string().nullable(),
  app_version: z.string(),
  migration: z.string().nullable(),
  status: z.enum(['passed', 'failed']),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  results: z.array(checkResultSchema),
  started_at: z.string(),
  finished_at: z.string(),
})

const errorBodySchema = z.object({ message: z.string().optional() })

export const validationKeys = {
  allowed: (workspaceId: string) =>
    ['validation-allowed', workspaceId] as const,
  runs: (workspaceId: string) => ['validation-runs', workspaceId] as const,
}

export async function fetchCanRunValidation(
  client: Pick<DataClient, 'rpc'>,
  workspaceId: string,
): Promise<boolean> {
  return (
    (await client.rpc<boolean>('can_run_validation', {
      p_workspace_id: workspaceId,
    })) === true
  )
}

export async function fetchValidationRuns(
  client: Pick<DataClient, 'list'>,
  limit = 10,
): Promise<ValidationRunRecord[]> {
  return client.list<ValidationRunRecord>(
    'validation_runs',
    `?select=*&order=finished_at.desc&limit=${limit}`,
  )
}

export async function startValidationRun(): Promise<ValidationRunRecord> {
  const res = await fetch('/api/validation/run', { method: 'POST' })

  if (!res.ok) throw new Error(await errorText(res))

  return validationRunSchema.parse(await res.json())
}

export async function fetchValidationPack(): Promise<Blob> {
  const res = await fetch('/api/validation/pack')

  if (!res.ok) throw new Error(await errorText(res))

  return res.blob()
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = errorBodySchema.safeParse(await res.json())

    if (body.success && body.data.message) return body.data.message
  } catch {
    // fall through
  }

  return `The request failed (${res.status}).`
}
