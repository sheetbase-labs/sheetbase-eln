/**
 * INT-01 — typed DataClient surface for the EXT-01 extension registry.
 * All writes go through the `api.*_extension` RPCs so capability checks,
 * manifest validation and change events fire server-side.
 */
import type { DataClient } from '../data-client'
import type { ExtensionManifest } from './manifest'

export type ExtensionStatus = 'installed' | 'enabled' | 'disabled'

export interface ExtensionWire {
  id: string
  workspace_id: string
  key: string
  name: string
  version: string
  source: string
  manifest: ExtensionManifest
  status: ExtensionStatus
  credential_id: string | null
  created_at: string
  updated_at: string
}

export interface InstallExtensionInput {
  workspaceId: string
  key: string
  name: string
  version: string
  source: string
  manifest: ExtensionManifest
}

export async function installExtension(
  client: DataClient,
  input: InstallExtensionInput,
): Promise<ExtensionWire> {
  return client.rpc('install_extension', {
    p_workspace_id: input.workspaceId,
    p_key: input.key,
    p_name: input.name,
    p_version: input.version,
    p_source: input.source,
    p_manifest: input.manifest,
  })
}

export async function enableExtension(
  client: DataClient,
  input: { workspaceId: string; extensionId: string },
): Promise<ExtensionWire> {
  return client.rpc('enable_extension', {
    p_workspace_id: input.workspaceId,
    p_extension_id: input.extensionId,
  })
}

export async function disableExtension(
  client: DataClient,
  input: { workspaceId: string; extensionId: string },
): Promise<ExtensionWire> {
  return client.rpc('disable_extension', {
    p_workspace_id: input.workspaceId,
    p_extension_id: input.extensionId,
  })
}

// ---------------------------------------------------------------------------
// Reads (PostgREST resource queries).
// ---------------------------------------------------------------------------

const EXTENSION_FIELDS =
  'id,workspace_id,key,name,version,source,manifest,status,credential_id,created_at,updated_at'

export async function listExtensions(
  client: DataClient,
): Promise<ExtensionWire[]> {
  return client.list<ExtensionWire>(
    'extensions',
    `?select=${EXTENSION_FIELDS}&order=name.asc`,
  )
}

export async function getExtension(
  client: DataClient,
  extensionId: string,
): Promise<ExtensionWire | undefined> {
  const rows = await client.list<ExtensionWire>(
    'extensions',
    `?select=${EXTENSION_FIELDS}&id=eq.${encodeURIComponent(extensionId)}`,
  )
  return rows[0]
}

export const extensionQueryKeys = {
  extensions: ['extensions'] as const,
  extension: (id: string) => ['extensions', id] as const,
}

export function describeExtensionsError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'The request failed.'
  if (/capability required/i.test(message)) {
    return 'You do not have permission to manage extensions in this workspace.'
  }
  if (/extension key|invalid extension/i.test(message)) {
    return 'Choose a different lowercase key for this workspace.'
  }
  if (/unknown contribution point|unknown capability|unknown scope|unknown event subscription/i.test(message)) {
    return 'The extension manifest declares something this workspace does not support.'
  }
  return message
}
