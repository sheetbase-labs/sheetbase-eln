import { createFileRoute } from '@tanstack/react-router'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import {
  CredentialError,
  mintApiClientToken,
  mintPersonalApiToken,
  verifyCredential,
} from '#/lib/api-credentials'
import { logger, redact } from '#/lib/logger'
import { handleMcpBody } from '#/lib/mcp/handler'
import { JSON_RPC_ERRORS, failure } from '#/lib/mcp/protocol'
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
  body: unknown,
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

function methodOf(body: unknown): string {
  if (body === null || typeof body !== 'object') return 'unknown'
  const method = (body as Record<string, unknown>).method
  return typeof method === 'string' ? method.slice(0, 80) : 'unknown'
}

function toolOf(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const params = (body as Record<string, unknown>).params
  if (params === null || typeof params !== 'object') return null
  const name = (params as Record<string, unknown>).name
  return typeof name === 'string' ? name.slice(0, 120) : null
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
      return rpcFailure(status, JSON_RPC_ERRORS.invalidRequest, error.message, {
        'www-authenticate': 'Bearer realm="sheetbase"',
        ...(status === 429 ? { 'retry-after': '60' } : {}),
      })
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
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return rpcFailure(
      400,
      JSON_RPC_ERRORS.parse,
      'The request body is not valid JSON.',
    )
  }

  const method = methodOf(body)
  const tool = toolOf(body)
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

  const context = {
    workspaceId: credential.workspaceId,
    actor:
      credential.kind === 'personal'
        ? ({ kind: 'user', id: credential.createdByUserId } as const)
        : ({ kind: 'service_credential', id: credential.id } as const),
    scopes: credential.scopes,
    client: createServerDataClient(postgrestToken),
    credentialId: credential.id,
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
