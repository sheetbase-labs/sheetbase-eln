/**
 * EXT-01 — Per-extension scoped credentials (server-only).
 *
 * Extensions act through the existing credential system, never through
 * private tables or hidden browser state:
 *
 * - `issueExtensionCredential` mints one service credential per extension
 *   install with minimal scopes: every requested scope must already be
 *   declared in the install's manifest, and the manifest's scopes are
 *   themselves restricted to `VALID_SCOPES`. The credential id is linked
 *   back onto the extension row in the same transaction.
 * - `resolveExtensionCall` attributes an inbound credentialed call to its
 *   extension: the credential must be live, the extension must be enabled,
 *   and the credential must carry the scope the call needs. Callers stamp
 *   the returned identity into `change_events` payloads so extension work
 *   stays auditable.
 *
 * Data access itself still flows through the external-token allowlist
 * (`src/lib/external-token.ts`), which EXT-01 deliberately leaves
 * untouched — fail-closed by default.
 */
import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { hasCapability } from '#/lib/capability'
import type { WorkspaceRole } from '#/lib/workspace-admin'
import { hasScope } from '#/lib/external-token'
import * as schema from '#/db/schema'
import { createCredential, type CreatedCredential } from '#/lib/api-credentials'
import type { Scope } from '#/lib/api-credential-scopes'
import { emitCredentialAuditEvent } from '#/lib/credential-audit'
import { parseExtensionManifest } from './manifest'
import { extensionAuditIdentity, type ExtensionAuditIdentity } from './contract'

export type ExtensionCredentialErrorCode =
  | 'not_found'
  | 'denied'
  | 'scope_not_declared'
  | 'extension_disabled'
  | 'revoked'
  | 'expired'
  | 'insufficient_scope'

export class ExtensionCredentialError extends Error {
  readonly code: ExtensionCredentialErrorCode

  constructor(code: ExtensionCredentialErrorCode, message: string) {
    super(message)
    this.name = 'ExtensionCredentialError'
    this.code = code
  }
}

type ExtensionDb = NodePgDatabase<typeof schema>

export interface IssueExtensionCredentialInput {
  workspaceId: string
  extensionId: string
  /** Role of the human performing the issuance (must hold extensions.manage). */
  actorRole: WorkspaceRole | string
  actorUserId: string
  /** Minimal scopes for this credential; must be ⊆ the manifest's scopes. */
  scopes: Scope[]
  name?: string
  expiresAt?: Date | null
}

/**
 * Mint a service credential bound to one extension install. The issuer
 * needs `extensions.manage`; the scopes must be a non-empty subset of the
 * manifest's declared scopes. Links the credential onto the extension row
 * and emits the credential-create audit event atomically.
 */
export async function issueExtensionCredential(
  db: ExtensionDb,
  input: IssueExtensionCredentialInput,
): Promise<CreatedCredential> {
  if (!hasCapability(input.actorRole, 'extensions.manage')) {
    throw new ExtensionCredentialError(
      'denied',
      'extensions.manage is required to issue an extension credential.',
    )
  }
  if (input.scopes.length === 0) {
    throw new ExtensionCredentialError(
      'scope_not_declared',
      'An extension credential needs at least one scope.',
    )
  }
  const extension = await db.query.extensions.findFirst({
    where: and(
      eq(schema.extensions.id, input.extensionId),
      eq(schema.extensions.workspaceId, input.workspaceId),
    ),
  })
  if (!extension) {
    throw new ExtensionCredentialError('not_found', 'Extension not found.')
  }
  const manifest = parseExtensionManifest(extension.manifest)
  const declared = new Set<string>(manifest.scopes)
  for (const scope of input.scopes) {
    if (!declared.has(scope)) {
      throw new ExtensionCredentialError(
        'scope_not_declared',
        `Scope ${scope} is not declared by this extension's manifest.`,
      )
    }
  }
  return await db.transaction(async (tx) => {
    const created = await createCredential(tx, {
      workspaceId: input.workspaceId,
      createdByUserId: input.actorUserId,
      name: input.name ?? `extension:${extension.key}`,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
    })
    await tx
      .update(schema.extensions)
      .set({ credentialId: created.id, updatedAt: new Date() })
      .where(eq(schema.extensions.id, extension.id))
    await emitCredentialAuditEvent(tx, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      credentialId: created.id,
      operation: 'create',
      payload: {
        name: created.name,
        displayPrefix: created.displayPrefix,
        kind: created.kind,
      },
    })
    return created
  })
}

export interface ResolvedExtensionCall {
  workspaceId: string
  credentialId: string
  extensionId: string
  extensionKey: string
  manifestId: string
  audit: ExtensionAuditIdentity
}

/**
 * Attribute a credentialed call to its extension. Fails closed when the
 * credential is revoked/expired, the extension is not enabled, or the
 * credential lacks the scope the call needs.
 */
export async function resolveExtensionCall(
  db: ExtensionDb,
  input: { credentialId: string; requiredScope: Scope },
): Promise<ResolvedExtensionCall> {
  const credential = await db.query.apiCredentials.findFirst({
    where: eq(schema.apiCredentials.id, input.credentialId),
  })
  if (!credential || credential.revokedAt) {
    throw new ExtensionCredentialError('revoked', 'Credential has been revoked.')
  }
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
    throw new ExtensionCredentialError('expired', 'Credential has expired.')
  }
  if (!hasScope(credential.scopes as Scope[], input.requiredScope)) {
    throw new ExtensionCredentialError(
      'insufficient_scope',
      `Credential lacks scope: ${input.requiredScope}`,
    )
  }
  const extension = await db.query.extensions.findFirst({
    where: and(
      eq(schema.extensions.credentialId, credential.id),
      eq(schema.extensions.workspaceId, credential.workspaceId),
    ),
  })
  if (!extension) {
    throw new ExtensionCredentialError(
      'not_found',
      'Credential is not bound to an extension.',
    )
  }
  if (extension.status !== 'enabled') {
    throw new ExtensionCredentialError(
      'extension_disabled',
      'Extension is not enabled.',
    )
  }
  const manifest = parseExtensionManifest(extension.manifest)
  return {
    workspaceId: credential.workspaceId,
    credentialId: credential.id,
    extensionId: extension.id,
    extensionKey: extension.key,
    manifestId: manifest.id,
    audit: extensionAuditIdentity({
      extensionId: extension.id,
      extensionKey: extension.key,
      manifest,
    }),
  }
}
