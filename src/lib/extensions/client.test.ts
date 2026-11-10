/**
 * EXT-01 client surface: pins the DataClient → RPC argument mapping so a
 * renamed parameter fails here instead of at runtime.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import {
  describeExtensionsError,
  disableExtension,
  enableExtension,
  installExtension,
  removeExtension,
  updateExtension,
} from './client'

/** One RPC the fake transport received, named as the wire names it. */
const sentRpcSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.json()),
})

type SentRpc = z.infer<typeof sentRpcSchema>

/**
 * A data client over a fake transport, so the test reads the request the app
 * actually sends instead of a mock's idea of it.
 */
function stubClient() {
  const sent: SentRpc[] = []

  const client = createDataClient(async (input, init) => {
    const url = z.string().parse(input)
    const body = z.string().parse(init?.body)

    sent.push(
      sentRpcSchema.parse({
        name: url.replace('/api/db/rpc/', ''),
        args: JSON.parse(body),
      }),
    )

    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  return { client, sent }
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
    const { client, sent } = stubClient()
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
    expect(sent).toContainEqual({
      name: 'install_extension',
      args: {
        p_workspace_id: 'ws',
        p_key: 'retest',
        p_name: 'Retest Tracker',
        p_version: '1.0.0',
        p_source: 'https://extensions.example.com/x.tgz',
        p_manifest: expect.objectContaining({ id: 'acme.retest-tracker' }),
        p_acknowledge_untrusted: false,
      },
    })

    await enableExtension(client, { workspaceId: 'ws', extensionId: 'ext' })
    expect(sent).toContainEqual({
      name: 'enable_extension',
      args: {
        p_workspace_id: 'ws',
        p_extension_id: 'ext',
      },
    })

    await disableExtension(client, { workspaceId: 'ws', extensionId: 'ext' })
    expect(sent).toContainEqual({
      name: 'disable_extension',
      args: {
        p_workspace_id: 'ws',
        p_extension_id: 'ext',
      },
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
    expect(sent).toContainEqual({
      name: 'update_extension',
      args: {
        p_workspace_id: 'ws',
        p_extension_id: 'ext',
        p_name: 'Retest Tracker',
        p_version: '1.1.0',
        p_source: 'https://extensions.example.com/x.tgz',
        p_manifest: expect.objectContaining({ id: 'acme.retest-tracker' }),
        p_acknowledge_untrusted: false,
      },
    })

    await removeExtension(client, { workspaceId: 'ws', extensionId: 'ext' })
    expect(sent).toContainEqual({
      name: 'remove_extension',
      args: {
        p_workspace_id: 'ws',
        p_extension_id: 'ext',
      },
    })
  })

  it('passes explicit trust acknowledgement for untrusted sources', async () => {
    const { client, sent } = stubClient()
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
    expect(sent).toContainEqual({
      name: 'install_extension',
      args: expect.objectContaining({ p_acknowledge_untrusted: true }),
    })
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
