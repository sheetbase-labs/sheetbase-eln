/**
 * Validation as the app reads and starts it: who may, the runs so far, and the
 * pack download. Runs and the pack go through the session-only routes.
 */
import type { DataClient } from '#/lib/data-client'
import type { ValidationRunRecord } from './types'

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
  return (await res.json()) as ValidationRunRecord
}

export async function fetchValidationPack(): Promise<Blob> {
  const res = await fetch('/api/validation/pack')
  if (!res.ok) throw new Error(await errorText(res))
  return res.blob()
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string }
    if (body.message) return body.message
  } catch {
    // fall through
  }
  return `The request failed (${res.status}).`
}
