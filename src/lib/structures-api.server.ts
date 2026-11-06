/**
 * Structure helpers for the API: turn a SMILES line or molfile into the
 * description the registry keeps, and search the registries by structure. The
 * chemistry cannot run in the database, so these two calls do it for scripts
 * and the Python SDK. Registering and checking go through the ordinary lab
 * calls (`register_compound`, `find_structure_duplicates`) with the description
 * this returns.
 *
 *   POST /api/structures/describe  { "structure": "CC(=O)Oc1ccccc1C(=O)O" }
 *   POST /api/structures/search    { "structure": "…", "mode": "substructure" }
 *
 * Auth is the usual credential (`Authorization: Bearer …`) with `lab:read`.
 */
import { db } from '#/db/client.server'
import { env } from '#/env.server'
import {
  CredentialError,
  mintApiClientToken,
  mintPersonalApiToken,
  verifyCredential,
} from '#/lib/api-credentials'
import { loadOcl } from '#/lib/chemistry-draw'
import { describeStructure, searchStructures } from '#/lib/compound-registry'
import { annotateRequest } from '#/lib/request-log'
import { createServerDataClient } from '#/lib/server-data-client.server'
import { DataClientError } from '#/lib/data-client'
import { z } from 'zod'

const MAX_BODY_BYTES = 200_000

const describeSchema = z
  .object({ structure: z.string().min(1).max(100_000) })
  .strict()

const searchSchema = z
  .object({
    structure: z.string().min(1).max(100_000),
    mode: z.enum(['substructure', 'similarity']).default('substructure'),
    registry: z.string().min(1).max(60).nullish(),
    minSimilarity: z.number().min(0).max(1).default(0.6),
    includeArchived: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict()

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

const problem = (status: number, message: string, headers: HeadersInit = {}) =>
  json({ error: { code: String(status), message } }, status, headers)

export async function handleStructuresRequest(
  request: Request,
  action: string,
): Promise<Response> {
  if (action !== 'describe' && action !== 'search') {
    return problem(
      404,
      'Use /api/structures/describe or /api/structures/search.',
    )
  }
  const header = request.headers.get('authorization')?.trim() ?? ''
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  if (!token) {
    return problem(401, 'A Sheetbase credential is required.', {
      'www-authenticate': 'Bearer realm="sheetbase"',
    })
  }
  let credential
  try {
    credential = await verifyCredential(db, token)
  } catch (error) {
    if (error instanceof CredentialError) {
      return problem(error.code === 'rate_limited' ? 429 : 401, error.message)
    }
    throw error
  }
  annotateRequest({
    auth: credential.kind,
    workspace: { id: credential.workspaceId },
  })
  if (
    !credential.scopes.includes('lab:read') &&
    !credential.scopes.includes('lab:write')
  ) {
    return problem(403, 'This credential lacks the lab:read scope.')
  }
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return problem(413, 'Request too large.')
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return problem(400, 'The request body is not valid JSON.')
  }

  const ocl = await loadOcl()
  if (action === 'describe') {
    const parsed = describeSchema.safeParse(body)
    if (!parsed.success) {
      return problem(400, 'Send {"structure": "<SMILES or molfile>"}.')
    }
    const described = describeStructure(ocl, parsed.data.structure)
    return described
      ? json(described)
      : problem(422, 'That could not be read as a structure.')
  }

  const parsed = searchSchema.safeParse(body)
  if (!parsed.success) {
    return problem(
      400,
      'Send {"structure": "…", "mode": "substructure" | "similarity"}; optional registry, minSimilarity, includeArchived, limit.',
    )
  }
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
  try {
    const hits = await searchStructures(
      client,
      {
        query: parsed.data.structure,
        mode: parsed.data.mode,
        kind: parsed.data.registry ?? null,
        minSimilarity: parsed.data.minSimilarity,
        includeArchived: parsed.data.includeArchived,
        limit: parsed.data.limit,
      },
      ocl,
    )
    return json({ count: hits.length, results: hits })
  } catch (error) {
    if (error instanceof DataClientError) {
      return problem(error.status >= 400 ? error.status : 400, error.message)
    }
    throw error
  }
}
