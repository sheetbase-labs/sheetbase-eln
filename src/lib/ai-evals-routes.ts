/**
 * Start a run of the assistant checks. Session only, and only for someone who
 * manages the AI settings (api.can_run_ai_evals).
 */
import {
  postgrestRpc,
  requestErrorResponse,
  resolveSessionAuth,
} from './request-auth'
import type { SessionAuthDeps } from './request-auth'

export async function handleAiEvalRun(
  request: Request,
  deps: SessionAuthDeps,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)

  if (!auth.ok) {
    return requestErrorResponse(auth.status, auth.code, auth.message)
  }

  const { context } = auth

  const allowed = await postgrestRpc<boolean>(
    'can_run_ai_evals',
    { p_workspace_id: context.workspaceId },
    context.token,
  )

  if (allowed.status >= 400 || allowed.body !== true) {
    return requestErrorResponse(
      403,
      'forbidden',
      'Running the checks needs access to the AI settings.',
    )
  }

  let toolsOnly = false

  try {
    const body = (await request.json()) as { toolsOnly?: unknown }
    toolsOnly = body.toolsOnly === true
  } catch {
    // No body is fine: run everything that can run.
  }

  const { runAndRecordEvals } = await import('./ai-evals-run.server')

  const run = await runAndRecordEvals({
    workspaceId: context.workspaceId,
    userId: context.userId,
    trigger: 'manual',
    headers: request.headers,
    toolsOnly,
  })

  return new Response(JSON.stringify(run), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  })
}
