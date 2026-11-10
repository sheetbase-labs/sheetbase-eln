import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import {
  CredentialError,
  mintApiClientToken,
  mintPersonalApiToken,
  verifyCredential,
} from '#/lib/api-credentials'
import { noAiFeatureFlags, readAiFeatureFlags } from '#/lib/ai-feature-flags'
import type { AiFeatureFlags } from '#/lib/ai-feature-flags'
import { logger, redact } from '#/lib/logger'
import { handleMcpBody } from '#/lib/mcp/handler'
import { annotateRequest } from '#/lib/request-log'
import { JSON_RPC_ERRORS, failure } from '#/lib/mcp/protocol'
import type { JsonRpcResponse } from '#/lib/mcp/protocol'
import { createServerDataClient } from '#/lib/server-data-client.server'

/**
 * MCP endpoint — POST /api/mcp.
 *
 * Auth is the existing personal/service credential, verified by the same
 * function that serves `/api/token`. The credential's scopes bound discovery
 * and every call; PostgreSQL RLS still bounds the data. The endpoint returns
 * JSON responses (Streamable HTTP permits JSON) and supports no server-
 * initiated SSE stream, so GET is refused rather than left ambiguous.
 *
 * Nothing here writes directly: draft and mutate tools go through
 * `propose_agent_operation`. Signing, approval and execution stay human-only.
 */

const MAX_BODY_BYTES = 1_000_000

function jsonResponse(
  body: JsonRpcResponse,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function rpcFailure(
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(failure(null, code, message), status, headers)
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')

  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())

  return match?.[1] ?? null
}

/** The routing fields of a JSON-RPC body: all this endpoint reads before dispatch and logs. */
const ENVELOPE_METHOD = z.object({ method: z.string() })
const ENVELOPE_TOOL = z.object({ params: z.object({ name: z.string() }) })

function methodOf(body: z.core.util.JSONType): string {
  const declared = ENVELOPE_METHOD.safeParse(body)

  return declared.success ? declared.data.method.slice(0, 80) : 'unknown'
}

function toolOf(body: z.core.util.JSONType): string | null {
  const declared = ENVELOPE_TOOL.safeParse(body)

  return declared.success ? declared.data.params.name.slice(0, 120) : null
}

async function handleMcp(request: Request): Promise<Response> {
  const token = bearerToken(request)

  if (!token) {
    return rpcFailure(
      401,
      JSON_RPC_ERRORS.invalidRequest,
      'A Sheetbase credential is required.',
      { 'www-authenticate': 'Bearer realm="sheetbase"' },
    )
  }

  let credential

  try {
    credential = await verifyCredential(db, token)
  } catch (error) {
    if (error instanceof CredentialError) {
      const status = error.code === 'rate_limited' ? 429 : 401

      return rpcFailure(
        status,
        JSON_RPC_ERRORS.invalidRequest,
        error.message,
        status === 429
          ? {
              'www-authenticate': 'Bearer realm="sheetbase"',
              'retry-after': '60',
            }
          : { 'www-authenticate': 'Bearer realm="sheetbase"' },
      )
    }

    throw error
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')

  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return rpcFailure(413, JSON_RPC_ERRORS.invalidRequest, 'Request too large.')
  }

  const text = await request.text()

  if (text.length > MAX_BODY_BYTES) {
    return rpcFailure(413, JSON_RPC_ERRORS.invalidRequest, 'Request too large.')
  }

  let body: z.core.util.JSONType

  try {
    body = JSON.parse(text)
  } catch {
    return rpcFailure(
      400,
      JSON_RPC_ERRORS.parse,
      'The request body is not valid JSON.',
    )
  }

  const method = methodOf(body)
  const tool = toolOf(body)
  annotateRequest({
    auth: credential.kind,
    workspace: { id: credential.workspaceId },
    mcp: { method, tool },
  })
  logger.info(
    'ai.mcp.request',
    redact({
      workspaceId: credential.workspaceId,
      credentialId: credential.id,
      credentialKind: credential.kind,
      method,
      tool,
    }),
  )

  const postgrestToken =
    credential.kind === 'personal'
      ? await mintPersonalApiToken(env.PGRST_JWT_SECRET, {
          workspaceId: credential.workspaceId,
          credentialId: credential.id,
          userId: credential.createdByUserId,
          scopes: credential.scopes,
        })
      : await mintApiClientToken(env.PGRST_JWT_SECRET, {
          workspaceId: credential.workspaceId,
          credentialId: credential.id,
          scopes: credential.scopes,
        })

  const client = createServerDataClient(postgrestToken)
  let flags: AiFeatureFlags

  try {
    flags = await readAiFeatureFlags(client, credential.workspaceId)
  } catch (error) {
    // Fail closed: a transient settings read must not leave AI tools open.
    flags = noAiFeatureFlags()
    logger.warn(
      'ai.mcp.flags_unavailable',
      redact({
        workspaceId: credential.workspaceId,
        credentialId: credential.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }

  const context = {
    workspaceId: credential.workspaceId,
    actor:
      credential.kind === 'personal'
        ? ({ kind: 'user', id: credential.createdByUserId } as const)
        : ({ kind: 'service_credential', id: credential.id } as const),
    scopes: credential.scopes,
    flags,
    client,
    credentialId: credential.id,
    token: postgrestToken,
  }

  const response = await handleMcpBody(body, context)

  if (response === null) {
    return new Response(null, {
      status: 202,
      headers: { 'cache-control': 'no-store' },
    })
  }

  const headers: Record<string, string> = {}

  if (method === 'initialize') {
    headers['mcp-session-id'] = crypto.randomUUID()
  }

  return jsonResponse(response, 200, headers)
}

export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => handleMcp(request),
      GET: () =>
        rpcFailure(405, JSON_RPC_ERRORS.invalidRequest, 'Use POST /api/mcp.', {
          allow: 'POST, DELETE',
        }),
      DELETE: () =>
        new Response(null, {
          status: 204,
          headers: { 'cache-control': 'no-store' },
        }),
    },
  },
})
