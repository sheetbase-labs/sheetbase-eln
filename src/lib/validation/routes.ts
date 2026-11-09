/**
 * Validation routes: start a run, and download the pack. Session only, and only
 * for someone who manages the audit settings in a workspace that has the
 * Regulated lab switch on (api.can_run_validation).
 */
import {
  postgrestRpc,
  postgrestSelect,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import type { ValidationRunRecord } from './types'

async function authorise(request: Request, deps: SessionAuthDeps) {
  const auth = await resolveSessionAuth(request.headers, deps)

  if (!auth.ok) {
    return {
      error: requestErrorResponse(auth.status, auth.code, auth.message),
    }
  }

  const { context } = auth

  const allowed = await postgrestRpc<boolean>(
    'can_run_validation',
    { p_workspace_id: context.workspaceId },
    context.token,
  )

  if (allowed.status >= 400 || allowed.body !== true) {
    return {
      error: requestErrorResponse(
        403,
        'forbidden',
        'The validation pack is for regulated labs, and needs audit access.',
      ),
    }
  }

  return { context }
}

export async function handleValidationRun(
  request: Request,
  deps: SessionAuthDeps,
): Promise<Response> {
  const checked = await authorise(request, deps)

  if (checked.error) return checked.error
  const { runAndRecordValidation } = await import('./run.server')

  const run = await runAndRecordValidation({
    workspaceId: checked.context.workspaceId,
    userId: checked.context.userId,
  })

  return new Response(JSON.stringify(run), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  })
}

export async function handleValidationPack(
  request: Request,
  deps: SessionAuthDeps,
): Promise<Response> {
  const checked = await authorise(request, deps)

  if (checked.error) return checked.error
  const { context } = checked

  const runs = await postgrestSelect<ValidationRunRecord[]>(
    'validation_runs',
    'select=*&order=finished_at.desc&limit=5',
    context.token,
  )

  if (runs.status >= 400 || !Array.isArray(runs.body)) {
    return requestErrorResponse(502, 'upstream_error', 'Could not read runs.')
  }

  const workspace = await postgrestSelect<Array<{ name: string }>>(
    'workspaces',
    'select=name&limit=1',
    context.token,
  )

  const { buildValidationPack } = await import('./pack')
  const { ensureWorkspaceKey } = await import('../export/bundle-key.server')
  const { signWithKey } = await import('../export/bundle-key')
  const { appVersion } = await import('./run.server')
  const { recordDataExportReceipt } = await import('../request-auth')
  const key = await ensureWorkspaceKey(context.workspaceId)
  const latest = runs.body[0]

  const bytes = await buildValidationPack({
    workspaceName:
      Array.isArray(workspace.body) && workspace.body[0]
        ? workspace.body[0].name
        : 'Workspace',
    generatedAt: new Date().toISOString(),
    appVersion: appVersion(),
    migration: (latest as ValidationRunRecord | undefined)?.migration ?? null,
    system: { node: process.version, regulatedLab: true },
    runs: runs.body,
    publicKeyPem: key.publicKeyPem,
    fingerprint: key.fingerprint,
    sign: (manifest) => signWithKey(key.privateKeyPem, manifest),
  })

  await recordDataExportReceipt({
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    objectType: 'record',
    objectId: context.workspaceId,
    format: 'validation-pack-zip',
    byteSize: bytes.byteLength,
  })

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="validation-pack.zip"',
      'cache-control': 'no-store',
    },
  })
}
