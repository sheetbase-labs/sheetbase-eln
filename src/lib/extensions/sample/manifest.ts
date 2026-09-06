/**
 * EXT-02 sample extension — manifest.
 *
 * A minimal read-only extension proving the contribution path end to end:
 * one object action plus one palette command, both opening a data panel.
 * It declares no capabilities (only the `projects:read` scope, the minimum
 * authority a manifest may carry), so its contributions carry no
 * `requiredCapability` and any workspace member sees them once the
 * extension is enabled.
 *
 * Sample-scoped by construction: everything lives under
 * `src/lib/extensions/sample/`, nothing here is imported by product
 * surfaces unless the install is present and enabled, and the panel takes
 * a loader injected by the host — the sample imports no data layer, no
 * store and no private component. The install helper below goes through
 * the public EXT-01 client surface only.
 */
import type { ExtensionManifest } from '../manifest'

export const SAMPLE_EXTENSION_KEY = 'sample-panel'

export const SAMPLE_EXTENSION_MANIFEST = {
  id: 'sheetbase.sample-panel',
  name: 'Sample Panel',
  version: '1.0.0',
  source: 'dev:sheetbase-sample-panel',
  // The dev sample runs against any app version; declared explicitly so
  // compat reads `compatible`, never `unknown`.
  compatibleWith: '*',
  capabilities: [],
  scopes: ['projects:read'],
  contributions: {
    'object-actions': [{ id: 'open-panel', title: 'Open sample panel' }],
    panels: [{ id: 'sample-panel', title: 'Sample panel' }],
    commands: [{ id: 'sample-overview', title: 'Open sample overview' }],
  },
} as const satisfies {
  id: string
  name: string
  version: string
  source: string
  compatibleWith: string
  capabilities: ExtensionManifest['capabilities']
  scopes: ExtensionManifest['scopes']
  contributions: Record<string, Array<{ id: string; title: string }>>
}
