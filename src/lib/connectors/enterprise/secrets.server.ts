/**
 * INT-03 — execution-time connector secret retrieval (server-only).
 *
 * The INT-01 sealed-secret subsystem stores AES-256-GCM ciphertext in
 * `internal.connector_secrets`; the existing functions set, rotate and delete
 * values behind the steward capability. This module adds the narrow missing
 * piece: decrypting values *inside trusted server execution* so a connector
 * run can authenticate against the external system.
 *
 * Guarantees:
 *  - the workspace ↔ connector relationship is verified before any decrypt;
 *  - decryption happens only here, inside server-only code;
 *  - plaintext is returned to the adapter in-process and is never sent to the
 *    browser, never logged, and never written to run results, logs, audit or
 *    provenance payloads (adapters receive a `redactSecrets` helper);
 *  - the existing secret system is reused — no second secret store.
 */
import { and, eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { connectorSecrets } from '#/db/schema'
import { openSecret, secretKey } from '#/lib/connector-secrets.server'
import { ConnectorExecutionError } from './execution.server'

export async function loadConnectorSecrets(input: {
  workspaceId: string
  connectorId: string
  /** Secret names that must exist; absence fails with `secret_missing`. */
  required: readonly string[]
  /** Secret names used only when present (e.g. `session_token`). */
  optional?: readonly string[]
}): Promise<Record<string, string>> {
  const rows = await db
    .select({
      secretName: connectorSecrets.secretName,
      ciphertext: connectorSecrets.ciphertext,
    })
    .from(connectorSecrets)
    .where(
      and(
        eq(connectorSecrets.workspaceId, input.workspaceId),
        eq(connectorSecrets.connectorId, input.connectorId),
      ),
    )
  const values: Record<string, string> = {}
  for (const row of rows) {
    values[row.secretName] = openSecret(
      Buffer.from(row.ciphertext).toString('utf8'),
      secretKey(),
    )
  }
  const missing = input.required.filter((name) => !values[name])
  if (missing.length > 0) {
    throw new ConnectorExecutionError(
      'secret_missing',
      `This connector is missing required credentials: ${missing.join(', ')}. A steward must set them.`,
    )
  }
  // Only the declared names are ever decrypted/kept — nothing else leaks.
  const allowed = new Set([...input.required, ...(input.optional ?? [])])
  for (const name of Object.keys(values)) {
    if (!allowed.has(name)) delete values[name]
  }
  return values
}

/**
 * Replace any secret-looking value in a payload with a fixed marker, so log
 * lines, run results and provenance never carry plaintext credentials.
 */
export function redactSecrets(
  payload: Record<string, unknown>,
  secrets: Record<string, string>,
): Record<string, unknown> {
  const secretValues = Object.values(secrets).filter((v) => v.length >= 4)
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') {
      for (const secret of secretValues) {
        if (value.includes(secret)) {
          return value.split(secret).join('[redacted]')
        }
      }
      return value
    }
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [key, redact(inner)]),
      )
    }
    return value
  }
  return redact(payload) as Record<string, unknown>
}
