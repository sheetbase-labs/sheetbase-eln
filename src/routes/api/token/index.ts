import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import {
  CredentialError,
  exchangeCredential,
  isValidScope,
  mintApiClientToken,
  mintPersonalApiToken,
} from '#/lib/api-credentials'

/**
 * API-005: external credential exchange. POST /api/token with
 * { credential, scopes } returns a short-lived PostgREST JWT that carries
 * the workspace_id, credential_id, scopes and role: 'api_client'. The
 * endpoint is unauthenticated by design — the credential is the auth.
 *
 * Rate-limiting, revocation and scope checks happen in exchangeCredential.
 * The response is a consistent, non-sensitive envelope; errors never echo
 * the credential or hint which part was wrong.
 */
const exchangeSchema = z.object({
  credential: z.string().min(1),
  scopes: z.array(z.string()).min(1),
})

const exchange = createServerFn({ method: 'POST' }).handler(async () => {
  const { getRequest } = await import('@tanstack/react-start/server')
  const request = getRequest()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: { code: 'invalid_request', message: 'Invalid JSON body.' } },
      { status: 400 },
    )
  }

  const parsed = exchangeSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'invalid_request',
          message: 'credential and at least one scope are required.',
        },
      },
      { status: 400 },
    )
  }

  if (!parsed.data.scopes.every(isValidScope)) {
    return Response.json(
      {
        error: {
          code: 'invalid_scope',
          message: 'Unknown or retired scope requested.',
        },
      },
      { status: 400 },
    )
  }

  try {
    const token = await exchangeCredential(
      db,
      parsed.data.credential,
      parsed.data.scopes,
      {
        mintToken: (input) =>
          input.kind === 'personal'
            ? mintPersonalApiToken(env.PGRST_JWT_SECRET, {
                workspaceId: input.workspaceId,
                credentialId: input.credentialId,
                userId: input.userId!,
                scopes: input.scopes,
              })
            : mintApiClientToken(env.PGRST_JWT_SECRET, {
                workspaceId: input.workspaceId,
                credentialId: input.credentialId,
                scopes: input.scopes,
              }),
      },
    )
    return Response.json({ token }, { status: 200 })
  } catch (error) {
    if (error instanceof CredentialError) {
      const status =
        error.code === 'rate_limited'
          ? 429
          : error.code === 'revoked' || error.code === 'expired'
            ? 403
            : error.code === 'insufficient_scope'
              ? 403
              : error.code === 'invalid_scope'
                ? 400
                : 401
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status },
      )
    }
    return Response.json(
      { error: { code: 'server_error', message: 'Token exchange failed.' } },
      { status: 500 },
    )
  }
})

export const Route = createFileRoute('/api/token/')({
  server: {
    handlers: {
      POST: () => exchange(),
    },
  },
})
