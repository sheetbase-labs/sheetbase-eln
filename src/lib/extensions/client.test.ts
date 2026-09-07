/**
 * EXT-01 client surface: pins the DataClient → RPC argument mapping so a
 * renamed parameter fails here instead of at runtime.
 */
import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import {
  describeExtensionsError,
  disableExtension,
  enableExtension,
  installExtension,
  removeExtension,
  updateExtension,
} from './client'

function stubClient() {
  const rpc = vi.fn(async () => ({ ok: true }))
  const list = vi.fn(async () => [])
  return { client: { rpc, list } as unknown as DataClient, rpc, list }
}

const manifest = {
  id: 'acme.retest-tracker',
  name: 'Retest Tracker',
  version: '1.0.0',
  source: 'https://extensions.example.com/x.tgz',
  capabilities: ['record.create'],
  scopes: ['projects:read'],
  contributions: {},
} as const

describe('extension client surface', () => {
  it('maps install/enable/disable to the canonical RPC arguments', async () => {
    const { client, rpc } = stubClient()
    await installExtension(client, {
      workspaceId: 'ws',
      key: 'retest',
      name: 'Retest Tracker',
      version: '1.0.0',
      source: 'https://extensions.example.com/x.tgz',
      manifest: {
        ...manifest,
        capabilities: [...manifest.capabilities],
        scopes: [...manifest.scopes],
        contributions: {},
      },
    })
    expect(rpc).toHaveBeenCalledWith('install_extension', {
      p_workspace_id: 'ws',
      p_key: 'retest',
      p_name: 'Retest Tracker',
      p_version: '1.0.0',
      p_source: 'https://extensions.example.com/x.tgz',
      p_manifest: expect.objectContaining({ id: 'acme.retest-tracker' }),
      p_acknowledge_untrusted: false,
    })

    await enableExtension(client, { workspaceId: 'ws', extensionId: 'ext' })
    expect(rpc).toHaveBeenCalledWith('enable_extension', {
      p_workspace_id: 'ws',
      p_extension_id: 'ext',
    })

    await disableExtension(client, { workspaceId: 'ws', extensionId: 'ext' })
    expect(rpc).toHaveBeenCalledWith('disable_extension', {
      p_workspace_id: 'ws',
      p_extension_id: 'ext',
    })

    await updateExtension(client, {
      workspaceId: 'ws',
      extensionId: 'ext',
      name: 'Retest Tracker',
      version: '1.1.0',
      source: 'https://extensions.example.com/x.tgz',
      manifest: {
        ...manifest,
        capabilities: [...manifest.capabilities],
        scopes: [...manifest.scopes],
        contributions: {},
      },
    })
    expect(rpc).toHaveBeenCalledWith('update_extension', {
      p_workspace_id: 'ws',
      p_extension_id: 'ext',
      p_name: 'Retest Tracker',
      p_version: '1.1.0',
      p_source: 'https://extensions.example.com/x.tgz',
      p_manifest: expect.objectContaining({ id: 'acme.retest-tracker' }),
      p_acknowledge_untrusted: false,
    })

    await removeExtension(client, { workspaceId: 'ws', extensionId: 'ext' })
    expect(rpc).toHaveBeenCalledWith('remove_extension', {
      p_workspace_id: 'ws',
      p_extension_id: 'ext',
    })
  })

  it('passes explicit trust acknowledgement for untrusted sources', async () => {
    const { client, rpc } = stubClient()
    await installExtension(client, {
      workspaceId: 'ws',
      key: 'retest',
      name: 'Retest Tracker',
      version: '1.0.0',
      source: 'dev:retest-panel',
      manifest: {
        ...manifest,
        capabilities: [...manifest.capabilities],
        scopes: [...manifest.scopes],
        contributions: {},
      },
      acknowledgeUntrusted: true,
    })
    expect(rpc).toHaveBeenCalledWith(
      'install_extension',
      expect.objectContaining({ p_acknowledge_untrusted: true }),
    )
  })

  it('explains capability and manifest failures without leaking internals', () => {
    expect(
      describeExtensionsError(
        new Error('capability required: extensions.manage'),
      ),
    ).toMatch(/permission/)
    expect(
      describeExtensionsError(new Error('unknown contribution point: widgets')),
    ).toMatch(/manifest/)
    expect(
      describeExtensionsError(
        new Error(
          'untrusted extension source requires explicit acknowledgement',
        ),
      ),
    ).toMatch(/untrusted/)
    expect(describeExtensionsError(new Error('extension not found'))).toMatch(
      /no longer installed/,
    )
  })
})
