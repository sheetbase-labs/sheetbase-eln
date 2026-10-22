/**
 * Test-run a Python step on sample rows, before anything is saved or published.
 *
 * The code runs where every Python step runs: in the broker's fresh, network-less
 * container. Nothing here is stored. The sample rows, the code and the logs travel
 * to the runner and back; no run, log entry, dataset or file is created. What a
 * person gets back is the same thing a run would give them: rows, the step's own
 * output, the environment it ran in, and on failure the message and the line.
 */
import { eq } from 'drizzle-orm'

import { pickActiveMembership } from '#/lib/active-membership'
import { getAppSession } from '#/lib/auth'
import { createRateLimiter } from '#/lib/rate-limit'
import { INPUT_NAME_RE, MAX_STATEMENT_LENGTH } from './pipelines/config'
import {
  contractErrors,
  inferColumns,
  requirementErrors,
} from './pipelines/python'
import type {
  PythonContract,
  PythonTestRunFailure,
  PythonTestRunSuccess,
} from './pipelines/python'
import {
  PipelinePythonError,
  executePythonTransform,
} from './pipeline-python.server'
import type { PythonTransformResult } from './pipeline-python.server'

/** Sample data is a sample: bounded well below what a real run may read. */
export const TEST_ROW_LIMIT = 1_000
export const TEST_CELL_LIMIT = 50_000
export const TEST_BODY_BYTES = 2 * 1024 * 1024
/** Rows echoed back; the count says how many there were. */
export const TEST_RESULT_ROWS = 200

export interface PythonTestRunDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  /** The workspace the person writes in, or null when they are a viewer or have none. */
  getWriterWorkspace: (userId: string) => Promise<string | null>
  execute: (
    input: Parameters<typeof executePythonTransform>[0],
  ) => Promise<PythonTransformResult>
  now?: () => number
}

const limiter = createRateLimiter({ maxRequests: 20, windowSeconds: 60 })
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const refuse = (status: number, message: string) =>
  reply({ error: message }, status)

/** Why a request body cannot be run; null when it can. */
export function testRunRequestError(body: unknown): string | null {
  if (!isObject(body)) return 'Send a JSON object.'
  if (
    typeof body.statement !== 'string' ||
    !body.statement.trim() ||
    body.statement.length > MAX_STATEMENT_LENGTH
  )
    return 'Code must be between 1 and 20000 characters.'
  if (!isObject(body.inputs)) return 'inputs must map input names to rows.'
  let cells = 0
  for (const [alias, rows] of Object.entries(body.inputs)) {
    if (
      !INPUT_NAME_RE.test(alias) &&
      alias !== 'previous' &&
      alias !== 'answer'
    )
      return `“${alias}” is not a valid input name.`
    if (!Array.isArray(rows) || rows.length > TEST_ROW_LIMIT)
      return `Input ${alias} must be at most ${TEST_ROW_LIMIT} sample rows.`
    for (const row of rows) {
      if (!isObject(row)) return `Input ${alias} must contain row objects.`
      cells += Object.keys(row).length
    }
  }
  if (cells > TEST_CELL_LIMIT)
    return `The sample has ${cells} cells; keep it under ${TEST_CELL_LIMIT}.`
  if (!isObject(body.parameters)) return 'parameters must be an object.'
  if (body.requirements !== undefined) {
    const problems = requirementErrors(body.requirements)
    if (problems.length) return problems[0]
  }
  if (body.contract !== undefined) {
    const problems = contractErrors(body.contract)
    if (problems.length) return problems[0]
  }
  return null
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > TEST_BODY_BYTES) throw new RangeError('body_limit')
  const text = await request.text()
  if (text.length > TEST_BODY_BYTES) throw new RangeError('body_limit')
  return JSON.parse(text) as unknown
}

export async function handlePythonTestRun(
  request: Request,
  deps: PythonTestRunDeps = defaultDeps,
): Promise<Response> {
  const session = await deps.getSession(request.headers)
  if (!session) return refuse(401, 'Sign in to test a Python step.')
  if (!(await deps.getWriterWorkspace(session.user.id)))
    return refuse(403, 'Testing a step needs a workspace you can edit.')
  const decision = limiter.hit(`test:${session.user.id}`)
  if (!decision.allowed)
    return refuse(
      429,
      `Too many test runs. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
    )
  let body: unknown
  try {
    body = await readBody(request)
  } catch (error) {
    return error instanceof RangeError
      ? refuse(413, 'The sample is too large. Use fewer rows.')
      : refuse(400, 'Send a JSON body.')
  }
  const problem = testRunRequestError(body)
  if (problem) return refuse(400, problem)
  const job = body as {
    statement: string
    inputs: Record<string, Array<Record<string, unknown>>>
    parameters: Record<string, unknown>
    requirements?: string[]
    contract?: PythonContract
  }
  const clock = deps.now ?? Date.now
  const started = clock()
  try {
    const result = await deps.execute({
      statement: job.statement,
      inputs: job.inputs,
      parameters: job.parameters,
      requirements: job.requirements,
      contract: job.contract,
    })
    const success: PythonTestRunSuccess = {
      ok: true,
      rows: result.rows.slice(0, TEST_RESULT_ROWS),
      rowCount: result.rows.length,
      truncated: result.rows.length > TEST_RESULT_ROWS,
      columns: inferColumns(result.rows),
      logs: result.logs,
      runtime: result.runtime,
      environment: result.environment,
      durationMs: clock() - started,
    }
    return reply(success)
  } catch (error) {
    if (!(error instanceof PipelinePythonError))
      return refuse(500, 'The test run failed unexpectedly.')
    if (error.code === 'runner_unavailable') return refuse(503, error.message)
    const failure: PythonTestRunFailure = {
      ok: false,
      error: error.message,
      code: error.code,
      logs: error.logs,
      ...(error.line ? { line: error.line } : {}),
      durationMs: clock() - started,
    }
    return reply(failure)
  }
}

const defaultDeps: PythonTestRunDeps = {
  getSession: getAppSession,
  execute: executePythonTransform,
  async getWriterWorkspace(userId) {
    const [{ db }, schema] = await Promise.all([
      import('#/db/client.server'),
      import('#/db/schema'),
    ])
    const [preference, memberships] = await Promise.all([
      db.query.userPreferences.findFirst({
        where: eq(schema.userPreferences.userId, userId),
      }),
      db.query.workspaceMemberships.findMany({
        where: eq(schema.workspaceMemberships.userId, userId),
      }),
    ])
    const membership = pickActiveMembership(
      memberships,
      preference?.activeWorkspaceId,
    )
    // GOV-01 writer set: anyone but the read-only viewer.
    return membership && !membership.suspendedAt && membership.role !== 'viewer'
      ? membership.workspaceId
      : null
  },
}
