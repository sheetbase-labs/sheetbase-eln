/**
 * EXT-02 sample extension — dev install helper.
 *
 * Installs + enables the sample manifest in a dev workspace through the
 * public EXT-01 client surface (`install_extension` / `enable_extension`
 * RPCs). Distribution and trust UI belong to EXT-03; this helper exists
 * so the sample's contribution path can be exercised without either.
 */
import type { DataClient } from '../../data-client'
import { enableExtension, installExtension } from '../client'
import type { ExtensionWire } from '../client'
import { SAMPLE_EXTENSION_KEY, SAMPLE_EXTENSION_MANIFEST } from './manifest'

export async function installSampleExtension(
  client: DataClient,
  workspaceId: string,
): Promise<ExtensionWire> {
  const installed = await installExtension(client, {
    workspaceId,
    key: SAMPLE_EXTENSION_KEY,
    name: SAMPLE_EXTENSION_MANIFEST.name,
    version: SAMPLE_EXTENSION_MANIFEST.version,
    source: SAMPLE_EXTENSION_MANIFEST.source,
    // The sample ships from a `dev:` source, untrusted under the EXT-03
    // policy: the acknowledgement is explicit here, never silent.
    acknowledgeUntrusted: true,
    manifest: {
      id: SAMPLE_EXTENSION_MANIFEST.id,
      name: SAMPLE_EXTENSION_MANIFEST.name,
      version: SAMPLE_EXTENSION_MANIFEST.version,
      source: SAMPLE_EXTENSION_MANIFEST.source,
      capabilities: [...SAMPLE_EXTENSION_MANIFEST.capabilities],
      scopes: [...SAMPLE_EXTENSION_MANIFEST.scopes],
      contributions: {
        'object-actions': [
          ...SAMPLE_EXTENSION_MANIFEST.contributions['object-actions'],
        ],
        panels: [...SAMPLE_EXTENSION_MANIFEST.contributions.panels],
        commands: [...SAMPLE_EXTENSION_MANIFEST.contributions.commands],
      },
    },
  })
  return enableExtension(client, { workspaceId, extensionId: installed.id })
}
