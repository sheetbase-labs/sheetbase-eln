/**
 * Runs the assistant checks for a workspace and keeps the result.
 *
 * With a model connected the checks put each question to it. With none, the
 * tool checks still run, so the lookups, cards and guardrails are covered
 * either way, and the run says which it was.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { resolveAssistantRuntime } from './assistant-actions'
import { runEvalTasks } from './ai-evals.server'
import type { AiEvalRunRow, EvalMode } from './ai-eval-tasks'
import { logger, redact } from './logger'

export type EvalTrigger = 'manual' | 'profile_change'

export async function runAndRecordEvals(input: {
  workspaceId: string
  userId: string
  trigger: EvalTrigger
  headers: Headers
  /** Run the tool checks only, even when a model is connected. */
  toolsOnly?: boolean
}): Promise<AiEvalRunRow> {
  const startedAt = new Date()

  const runtime = await resolveAssistantRuntime(
    input.workspaceId,
    input.headers,
  )

  let mode: EvalMode = 'tools'
  let profile: string | null = null
  let model: string | null = null
  let message: string | null = null
  let harness: Parameters<typeof runEvalTasks>[0]['harness']

  if (runtime.ok && runtime.mode === 'provider' && !input.toolsOnly) {
    mode = 'model'
    profile = runtime.providerProfile
    model = runtime.deps.settings.model
    const { client: _client, toolkit: _toolkit, ...deps } = runtime.deps
    harness = { deps }
  } else if (input.toolsOnly) {
    message = 'Tool checks only, as asked.'
  } else if (runtime.ok) {
    message =
      'No AI model is connected, so only the tool and guardrail checks ran.'
  } else {
    message = `${runtime.result.message} Only the tool and guardrail checks ran.`
  }

  const results = await runEvalTasks({ mode, harness })

  const client = new PooledClient({
    connectionString: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
  })

  await client.connect()

  try {
    const { rows } = await client.query<AiEvalRunRow>(
      `SELECT * FROM internal.record_ai_eval_run($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        input.workspaceId,
        input.userId,
        mode,
        input.trigger,
        profile,
        model,
        message,
        JSON.stringify(results),
        startedAt,
      ],
    )

    logger.info(
      'ai.evals.completed',
      redact({
        workspaceId: input.workspaceId,
        mode,
        trigger: input.trigger,
        status: rows[0]?.status,
      }),
    )

    return rows[0]
  } finally {
    await client.end()
  }
}
