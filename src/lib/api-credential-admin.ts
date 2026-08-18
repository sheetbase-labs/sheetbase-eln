/**
 * Owner-gated admin server functions for API credentials.
 *
 * The table is `internal.api_credentials` (not PostgREST). Handlers load
 * session and database only on the server so this module stays importable
 * from the admin route.
 */
import { createServerFn } from '@tanstack/react-start'

import type { Scope } from '#/lib/api-credential-scopes'

export { SCOPE_GROUPS, VALID_SCOPES } from '#/lib/api-credential-scopes'
export type { Scope } from '#/lib/api-credential-scopes'

export const apiCredentialQueryKey = (workspaceId: string) =>
  ['admin-001', 'api-credentials', workspaceId] as const

export interface CredentialWire {
  id: string
  workspaceId: string
  displayPrefix: string
  name: string
  scopes: Scope[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null
  createdByUserId: string
}

export interface CreatedCredentialWire {
  id: string
  secret: string
  displayPrefix: string
  name: string
  scopes: Scope[]
}

function toWire(row: {
  id: string
  workspaceId: string
  displayPrefix: string
  name: string
  scopes: Scope[]
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date | null
  createdByUserId: string
}): CredentialWire {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    displayPrefix: row.displayPrefix,
    name: row.name,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
  }
}

async function loadSession(workspaceId: string) {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  const { db } = await import('#/db/client.server')
  const credentials = await import('#/lib/api-credentials')

  const context = await getCurrentContext(getRequestHeaders())
  if (!context) throw new Error('You must be signed in.')
  if (!context.workspace || context.workspace.id !== workspaceId) {
    throw new Error('You do not have access to this workspace.')
  }

  const isMember = await credentials.isWorkspaceMember(
    db,
    context.user.id,
    workspaceId,
  )
  if (!isMember) {
    throw new Error('You do not have access to this workspace.')
  }

  return { db, credentials, context }
}

async function requireOwner(workspaceId: string) {
  const session = await loadSession(workspaceId)
  const isOwner = await session.credentials.isWorkspaceOwner(
    session.db,
    session.context.user.id,
    workspaceId,
  )
  if (!isOwner || session.context.workspace?.role !== 'owner') {
    throw new Error('Only workspace owners can manage API credentials.')
  }
  return session
}

export const listApiCredentialsFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    const { db, credentials } = await loadSession(data.workspaceId)
    const rows = await credentials.listCredentials(db, data.workspaceId)
    return rows.map(toWire)
  })

export const createApiCredentialFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      name: string
      scopes: Scope[]
      expiresAt?: string | null
    }) => input,
  )
  .handler(async ({ data }): Promise<CreatedCredentialWire> => {
    const { db, credentials, context } = await requireOwner(data.workspaceId)
    const created = await credentials.createCredential(db, {
      workspaceId: data.workspaceId,
      createdByUserId: context.user.id,
      name: data.name,
      scopes: data.scopes,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    })
    return {
      id: created.id,
      secret: created.secret,
      displayPrefix: created.displayPrefix,
      name: created.name,
      scopes: created.scopes,
    }
  })

export const revokeApiCredentialFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; credentialId: string }) => input)
  .handler(async ({ data }) => {
    const { db, credentials } = await requireOwner(data.workspaceId)
    await credentials.revokeCredential(db, {
      workspaceId: data.workspaceId,
      credentialId: data.credentialId,
    })
    return { ok: true as const }
  })

export const rotateApiCredentialFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; credentialId: string }) => input)
  .handler(async ({ data }): Promise<CreatedCredentialWire> => {
    const { db, credentials, context } = await requireOwner(data.workspaceId)
    const created = await credentials.rotateCredential(db, {
      workspaceId: data.workspaceId,
      credentialId: data.credentialId,
      createdByUserId: context.user.id,
    })
    return {
      id: created.id,
      secret: created.secret,
      displayPrefix: created.displayPrefix,
      name: created.name,
      scopes: created.scopes,
    }
  })
