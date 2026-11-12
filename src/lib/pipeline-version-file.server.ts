/**
 * HTTP surface for the version file (Advanced mode): the same reader and
 * writer the editor uses, for the SDKs and the command line, so a file pushed
 * from git is judged by exactly the rules the app uses and gets the same line
 * and column for each mistake.
 *
 * POST /api/pipelines/version-file
 *   { text, pipeline?, pythonRuntime?, sets? }                     -> { ok, configuration, startRules, problems, lineCount }
 *   { configuration, pipeline, version?, title?, startRules? } -> { text }
 *
 * Nothing is saved. The caller saves the configuration as a draft through
 * `create_pipeline_definition_version` or
 * `update_pipeline_definition_version_draft`, as the person it acts for.
 * Allowed for a session, or a token with `pipelines:read`.
 */
import { z } from 'zod'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import {
  hasScope,
  readBearerToken,
  verifyExternalCredential,
} from '#/lib/external-token'
import { createRateLimiter } from '#/lib/rate-limit'
import { readStoredConfig } from '#/lib/pipelines/step-list'
import type { PipelineParameter } from '#/lib/pipelines/config'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import { startRulesSchema } from '#/lib/pipelines/start-rules'
import { checkVersionFile, versionFileText } from '#/lib/pipelines/version-file'

export interface VersionFileDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  /** True when the request carries a live token with `pipelines:read`. */
  checkToken: (headers: Headers) => Promise<boolean>
}

const defaultDeps: VersionFileDeps = {
  getSession: getAppSession,
  checkToken: async (headers) => {
    const token = readBearerToken(headers)

    if (!token) return false

    try {
      const claims = await verifyExternalCredential(
        db,
        token,
        env.PGRST_JWT_SECRET,
      )

      return hasScope(claims.scopes, 'pipelines:read')
    } catch {
      return false
    }
  },
}

const limiter = createRateLimiter({ maxRequests: 120, windowSeconds: 60 })
const BODY_BYTES = 1024 * 1024

const readBody = z.object({
  text: z.string(),
  pipeline: z.union([z.string(), z.array(z.string())]).optional(),
  pythonRuntime: z.string().optional(),
  /** The workspace's parameter sets by key, for `include:`. Read them from `pipeline_parameter_sets`. */
  sets: z.record(z.string(), z.array(pipelineJsonObjectSchema)).optional(),
})

const writeBody = z.object({
  configuration: pipelineJsonObjectSchema,
  pipeline: z.string().min(1),
  version: z.number().int().nullable().optional(),
  title: z.string().optional(),
  /** The pipeline's start rules (`pipeline_definitions.start_rules`), written as `starts:`. */
  startRules: startRulesSchema.optional(),
})

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}

/** POST /api/pipelines/version-file */
export async function handleVersionFile(
  request: Request,
  deps: VersionFileDeps = defaultDeps,
): Promise<Response> {
  const session = await deps.getSession(request.headers)

  if (!session && !(await deps.checkToken(request.headers))) {
    return fail(401, 'unauthenticated', 'Authentication is required.')
  }

  const who =
    session?.user.id ??
    request.headers.get('authorization')?.slice(-16) ??
    'token'

  const decision = limiter.hit(`version-file:${who}`)

  if (!decision.allowed) {
    return fail(
      429,
      'rate_limited',
      `Too many requests. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
    )
  }

  let raw: unknown

  try {
    const text = await request.text()

    if (text.length > BODY_BYTES)
      return fail(413, 'body_too_large', 'The file is too large.')

    raw = JSON.parse(text)
  } catch {
    return fail(400, 'invalid_request', 'A JSON request body is required.')
  }

  const reading = readBody.safeParse(raw)

  if (reading.success) {
    const { text, pipeline, pythonRuntime, sets } = reading.data
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the request allows one name or a list; this is the one place that tells them apart.
    const names = typeof pipeline === 'string' ? [pipeline] : pipeline

    const result = checkVersionFile(text, {
      pipeline: names,
      pythonRuntime,
      // A malformed set parameter fails when the version is judged.
      sets: z
        .record(z.string(), z.custom<PipelineParameter[]>())
        .parse(sets ?? {}),
    })

    return Response.json({
      ok: result.config !== null,
      configuration: result.config,
      startRules: result.startRules ?? null,
      problems: result.problems.map(({ fix: _fix, ...problem }) => problem),
      lineCount: result.lineCount,
    })
  }

  const writing = writeBody.safeParse(raw)

  if (writing.success) {
    const config = readStoredConfig(writing.data.configuration)

    if (!config)
      return fail(
        400,
        'invalid_configuration',
        'The configuration is not a version of this format.',
      )

    return Response.json({
      text: versionFileText(config, {
        pipeline: writing.data.pipeline,
        version: writing.data.version ?? null,
        title: writing.data.title,
        startRules: writing.data.startRules,
      }),
    })
  }

  return fail(
    400,
    'invalid_request',
    'Send { text } to read a file, or { configuration, pipeline } to write one.',
  )
}
