/**
 * Member-gated server functions for personal API tokens. A personal token
 * acts as its creating member under the same canonical scopes and fail-closed
 * external allowlist, but it is edited by the member themselves — not by a
 * workspace owner — so it lives beside the member's account surface rather
 * than in owner-only Administration.
 */
import { createServerFn } from '@tanstack/react-start'

import type { Scope } from '#/lib/api-credential-scopes'
import { emitCredentialAuditEvent } from '#/lib/credential-audit'

export { SCOPE_GROUPS, VALID_SCOPES } from '#/lib/api-credential-scopes'
export type { Scope } from '#/lib/api-credential-scopes'

export const personalTokenQueryKey = (userId: string, workspaceId: string) =>
  ['api-02', 'personal-tokens', userId, workspaceId] as const

export interface PersonalTokenWire {
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

export interface CreatedPersonalTokenWire {
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
}): PersonalTokenWire {
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

export const listPersonalTokensFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    const { db, credentials, context } = await loadSession(data.workspaceId)
    const rows = await credentials.listCredentials(db, data.workspaceId)
    const mine = rows.filter(
      (row) =>
        row.kind === 'personal' &&
        row.createdByUserId === context.user.id,
    )
    return mine.map(toWire)
  })

export const createPersonalTokenFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      name: string
      scopes: Scope[]
      expiresAt?: string | null
    }) => input,
  )
  .handler(async ({ data }): Promise<CreatedPersonalTokenWire> => {
    const { db, credentials, context } = await loadSession(data.workspaceId)
    const created = await credentials.createCredential(db, {
      workspaceId: data.workspaceId,
      createdByUserId: context.user.id,
      name: data.name,
      scopes: data.scopes,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      kind: 'personal',
    })
    await emitCredentialAuditEvent(db, {
      actorUserId: context.user.id,
      workspaceId: data.workspaceId,
      credentialId: created.id,
      operation: 'create',
      payload: {
        name: created.name,
        displayPrefix: created.displayPrefix,
        kind: created.kind,
      },
    })
    return {
      id: created.id,
      secret: created.secret,
      displayPrefix: created.displayPrefix,
      name: created.name,
      scopes: created.scopes,
    }
  })

export const revokePersonalTokenFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; tokenId: string }) => input)
  .handler(async ({ data }) => {
    const { db, credentials, context } = await loadSession(data.workspaceId)
    const mine = await credentials.listCredentials(db, data.workspaceId)
    const target = mine.find(
      (row) =>
        row.id === data.tokenId &&
        row.kind === 'personal' &&
        row.createdByUserId === context.user.id,
    )
    if (!target) throw new Error('Token not found.')
    await credentials.revokeCredential(db, {
      workspaceId: data.workspaceId,
      credentialId: target.id,
      actorUserId: context.user.id,
    })
    await emitCredentialAuditEvent(db, {
      actorUserId: context.user.id,
      workspaceId: data.workspaceId,
      credentialId: target.id,
      operation: 'revoke',
      payload: {},
    })
    return { ok: true as const }
  })

export const rotatePersonalTokenFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; tokenId: string }) => input)
  .handler(async ({ data }): Promise<CreatedPersonalTokenWire> => {
    const { db, credentials, context } = await loadSession(data.workspaceId)
    const mine = await credentials.listCredentials(db, data.workspaceId)
    const target = mine.find(
      (row) =>
        row.id === data.tokenId &&
        row.kind === 'personal' &&
        row.createdByUserId === context.user.id,
    )
    if (!target) throw new Error('Token not found.')
    const created = await credentials.rotateCredential(db, {
      workspaceId: data.workspaceId,
      credentialId: target.id,
      createdByUserId: context.user.id,
    })
    await emitCredentialAuditEvent(db, {
      actorUserId: context.user.id,
      workspaceId: data.workspaceId,
      credentialId: target.id,
      operation: 'revoke',
      payload: {
        rotatedToCredentialId: created.id,
      },
    })
    await emitCredentialAuditEvent(db, {
      actorUserId: context.user.id,
      workspaceId: data.workspaceId,
      credentialId: created.id,
      operation: 'create',
      payload: {
        name: created.name,
        displayPrefix: created.displayPrefix,
        kind: created.kind,
        rotatedFromCredentialId: target.id,
      },
    })
    return {
      id: created.id,
      secret: created.secret,
      displayPrefix: created.displayPrefix,
      name: created.name,
      scopes: created.scopes,
    }
  })
