/**
 * INT-01/INT-03 — client-callable server functions for sealed connector
 * secrets (steward-gated).
 *
 * Lives in a non-`.server` module so client components can import the
 * server-function references; every server-only dependency (crypto, DB,
 * sealed-secret helpers) is loaded lazily inside the handlers. Plaintext
 * values are set/rotated once and never returned to any caller.
 */
import { createServerFn } from '@tanstack/react-start'

export interface ConnectorSecretEntry {
  secretName: string
  updatedAt: string
}

const SECRET_NAME = /^[a-z][a-z0-9_]{0,48}$/

export const listConnectorSecretNamesFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; connectorId: string }) => input)
  .handler(async ({ data }): Promise<ConnectorSecretEntry[]> => {
    const { listConnectorSecretNames } = await import(
      './connector-secrets.server'
    )
    return listConnectorSecretNames(data.workspaceId, data.connectorId)
  })

export const setConnectorSecretFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      connectorId: string
      secretName: string
      value: string
    }) =>
      input,
  )
  .handler(async ({ data }) => {
    if (!SECRET_NAME.test(data.secretName)) {
      throw new Error(
        'Secret names are lowercase snake_case identifiers (e.g. api_key).',
      )
    }
    if (!data.value.trim()) throw new Error('Secret value cannot be empty.')
    const { setConnectorSecret } = await import('./connector-secrets.server')
    return setConnectorSecret(
      data.workspaceId,
      data.connectorId,
      data.secretName,
      data.value,
    )
  })

export const deleteConnectorSecretFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; connectorId: string; secretName: string }) => input)
  .handler(async ({ data }) => {
    const { deleteConnectorSecret } = await import('./connector-secrets.server')
    return deleteConnectorSecret(data.workspaceId, data.connectorId, data.secretName)
  })
