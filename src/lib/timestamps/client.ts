/**
 * Trusted timestamps as the app reads and changes them: the workspace's
 * choice of authority, and the stamp each signature has (or is waiting for).
 */
import type { DataClient } from '#/lib/data-client'

export interface TimestampSettings {
  enabled: boolean
  authority: 'dfn' | 'digicert' | 'custom' | null
  url: string | null
}

export type TimestampStatus = 'pending' | 'stamped' | 'failed'

export interface SignatureTimestampWire {
  id: string
  workspace_id: string
  signature_id: string
  revision_id: string
  status: TimestampStatus
  authority_name: string | null
  gen_time: string | null
  attempts: number
  last_error: string | null
  created_at: string
}

export interface SigningKeyInfo {
  algorithm: 'ed25519'
  publicKeyPem: string
  fingerprint: string
  createdAt: string
}

export const timestampKeys = {
  settings: (workspaceId: string) =>
    ['timestamp-settings', workspaceId] as const,
  list: (workspaceId: string) => ['signature-timestamps', workspaceId] as const,
  key: (workspaceId: string) => ['signing-key', workspaceId] as const,
}

export async function fetchTimestampSettings(
  client: Pick<DataClient, 'rpc'>,
  workspaceId: string,
): Promise<TimestampSettings> {
  return client.rpc<TimestampSettings>('timestamp_settings', {
    p_workspace_id: workspaceId,
  })
}

export async function setTimestampSettings(
  client: Pick<DataClient, 'rpc'>,
  input: {
    workspaceId: string
    enabled: boolean
    authority?: TimestampSettings['authority']
    url?: string | null
  },
): Promise<TimestampSettings> {
  return client.rpc<TimestampSettings>('set_timestamp_settings', {
    p_workspace_id: input.workspaceId,
    p_enabled: input.enabled,
    p_authority: input.authority ?? null,
    p_url: input.url ?? null,
  })
}

/** Newest first. The token itself is left out; bundles carry it. */
export async function fetchSignatureTimestamps(
  client: Pick<DataClient, 'list'>,
  limit = 50,
): Promise<SignatureTimestampWire[]> {
  return client.list<SignatureTimestampWire>(
    'signature_timestamps',
    `?select=id,workspace_id,signature_id,revision_id,status,authority_name,gen_time,attempts,last_error,created_at&order=created_at.desc&limit=${limit}`,
  )
}

export async function requestSignatureTimestamp(
  client: Pick<DataClient, 'rpc'>,
  signatureId: string,
): Promise<SignatureTimestampWire> {
  return client.rpc<SignatureTimestampWire>('request_signature_timestamp', {
    p_signature_id: signatureId,
  })
}

export async function fetchSigningKey(
  client: Pick<DataClient, 'rpc'>,
  workspaceId: string,
): Promise<SigningKeyInfo | null> {
  return (
    (await client.rpc<SigningKeyInfo | null>('workspace_signing_key', {
      p_workspace_id: workspaceId,
    })) ?? null
  )
}
