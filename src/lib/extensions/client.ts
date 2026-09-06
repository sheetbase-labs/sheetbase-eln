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
  /**
   * Required when `source` is untrusted (anything but `https:`). The admin
   * distribution UI sets this only through an explicit acknowledgement
   * checkbox — trust is never silent. The server re-checks regardless.
   */
  acknowledgeUntrusted?: boolean
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
    p_acknowledge_untrusted: input.acknowledgeUntrusted ?? false,
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

export interface UpdateExtensionInput {
  workspaceId: string
  extensionId: string
  name: string
  version: string
  source: string
  manifest: ExtensionManifest
  acknowledgeUntrusted?: boolean
}

/**
 * Update an install to a new manifest/version. The server resets the row
 * to `installed` and revokes the bound credential: new code never
 * auto-runs and new scopes never inherit old authority. The admin
 * re-enables after review and re-issues credentials.
 */
export async function updateExtension(
  client: DataClient,
  input: UpdateExtensionInput,
): Promise<ExtensionWire> {
  return client.rpc('update_extension', {
    p_workspace_id: input.workspaceId,
    p_extension_id: input.extensionId,
    p_name: input.name,
    p_version: input.version,
    p_source: input.source,
    p_manifest: input.manifest,
    p_acknowledge_untrusted: input.acknowledgeUntrusted ?? false,
  })
}

/**
 * Remove an install entirely. The server revokes the bound credential
 * first (no orphan authority), deletes the row — contributions resolve
 * nothing once the row is gone — and audits the removal. Extensions have
 * no dependents yet, so removal is unconditional besides capability
 * gating; the function documents that instead of inventing a dependency
 * check.
 */
export async function removeExtension(
  client: DataClient,
  input: { workspaceId: string; extensionId: string },
): Promise<void> {
  await client.rpc('remove_extension', {
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
  if (/untrusted extension source|acknowledgement/i.test(message)) {
    return 'That source is untrusted. Acknowledge the source explicitly to install or update from it.'
  }
  if (/extension not found/i.test(message)) {
    return 'That extension is no longer installed in this workspace.'
  }
  if (/extension key|invalid extension/i.test(message)) {
    return 'Choose a different lowercase key for this workspace.'
  }
  if (/unknown contribution point|unknown capability|unknown scope|unknown event subscription/i.test(message)) {
    return 'The extension manifest declares something this workspace does not support.'
  }
  return message
}
