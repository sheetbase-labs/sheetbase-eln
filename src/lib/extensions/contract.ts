/**
 * EXT-01 — Extension capability mapping.
 *
 * Extensions never hold authority of their own. They act through two
 * ordinary mechanisms:
 *
 * - Declared capabilities: subset of the canonical vocabulary
 *   (`src/lib/capability.ts`). On every extension-attributed call the server
 *   checks `api.has_capability` — the manifest declaration alone grants
 *   nothing. `effectiveExtensionCapabilities` computes the declared ∩ granted
 *   intersection so EXT-02 renderers can hide contributions the caller could
 *   never invoke.
 * - Scoped API credentials: the existing credential system
 *   (`src/lib/api-credentials.ts`). A per-extension credential carries only
 *   scopes from `VALID_SCOPES` that the manifest declares; data access then
 *   flows through the external-token allowlist, which stays fail-closed
 *   (no extension tables or RPCs are added to it).
 */
import { capabilitiesForRole } from '../capability'
import type { Capability } from '../capability'
import type { WorkspaceRole } from '../workspace-admin'
import type { ExtensionManifest } from './manifest'
/**
 * Declared capabilities the given role could actually exercise: the
 * manifest's ask intersected with what `api.has_capability` grants the
 * role. Order follows the manifest declaration.
 */
export function effectiveExtensionCapabilities(
  manifest: Pick<ExtensionManifest, 'capabilities'>,
  role: WorkspaceRole | string | null | undefined,
): Capability[] {
  if (!role) return []
  const granted = new Set<Capability>(
    capabilitiesForRole(role as WorkspaceRole),
  )
  return manifest.capabilities.filter((capability) => granted.has(capability))
}

/** Stable fragment stamped into `change_events` payloads for extension work. */
export interface ExtensionAuditIdentity {
  extension_id: string
  extension_key: string
  extension_manifest: string
  extension_version: string
}

export function extensionAuditIdentity(input: {
  extensionId: string
  extensionKey: string
  manifest: Pick<ExtensionManifest, 'id' | 'version'>
}): ExtensionAuditIdentity {
  return {
    extension_id: input.extensionId,
    extension_key: input.extensionKey,
    extension_manifest: input.manifest.id,
    extension_version: input.manifest.version,
  }
}
