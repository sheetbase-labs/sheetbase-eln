/**
 * Publishers and notification channels, run end to end with the example plugin's
 * real Python: the plugin plans, the app sends (to a stand-in, never the
 * network), the plugin reads the answers.
 */
import { describe, expect, it, vi } from 'vitest'

import { buildPluginPackage } from './package'
import {
  runChannelDelivery,
  runExtensionPublisher,
} from './outgoing-runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'
import {
  localPython,
  pythonAvailable,
  readExample,
} from './testing/local-python'

const files = readExample('outbound-tools')
const pkg = buildPluginPackage(files)

const answer = (status: number, body: unknown) => ({
  status,
  headers: {},
  body: new TextEncoder().encode(JSON.stringify(body)),
})

function setup(settings: Record<string, string> = {}) {
  const audit = vi.fn(async () => undefined)

  const deps: ExtensionRuntimeDeps = {
    loadInstall: async () => ({
      id: 'e1',
      key: 'outbound-tools',
      name: 'Outbound tools',
      status: 'enabled',
      manifest: structuredClone(pkg.manifest),
      disabledPoints: [],
    }),
    loadPackage: async () => files,
    loadSettings: async () => settings,
    executePython: localPython,
    audit,
    now: () => 0,
  }

  return { deps, audit }
}

const caller = {
  workspaceId: 'w1',
  actorUserId: 'u1',
  extensionKey: 'outbound-tools',
}

describe.skipIf(!pythonAvailable)('publishers', () => {
  const args = {
    ...caller,
    publisherId: 'send-to-lims',
    rows: [{ a: 1 }, { a: 2 }],
    name: 'Run 7',
    parameters: { project: 'P1' },
  }

  it('plans, sends to the declared host with the secret, and reads the answer', async () => {
    const { deps, audit } = setup({ token: 'sekret' })

    const fetchUrl = vi.fn(async () =>
      answer(200, {
        batch: { id: 'B9', count: 2, url: 'https://lims.example.org/b/B9' },
      }),
    )

    const out = await runExtensionPublisher(args, deps, fetchUrl)
    expect(out.message).toBe('Sent 2 results as batch B9.')
    expect(out.link).toBe('https://lims.example.org/b/B9')
    expect(out.requests).toBe(1)
    const [url, init] = fetchUrl.mock.calls[0] as unknown as [URL, any]
    expect(url.toString()).toBe(
      'https://lims.example.org/api/projects/P1/batches',
    )
    expect(init.headers.Authorization).toBe('Bearer sekret')
    expect(JSON.parse(init.body)).toEqual({
      name: 'Run 7',
      results: [{ a: 1 }, { a: 2 }],
    })
    expect(JSON.stringify(audit.mock.calls)).not.toContain('sekret')
  })

  it('says what is missing when the connection is not set up', async () => {
    const { deps } = setup()
    const fetchUrl = vi.fn()
    await expect(
      runExtensionPublisher(args, deps, fetchUrl as never),
    ).rejects.toMatchObject({ code: 'not_set_up' })
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it('turns the plugin’s reading of a refusal into a plain error', async () => {
    const { deps } = setup({ token: 'x' })
    const fetchUrl = vi.fn(async () => answer(401, {}))
    await expect(
      runExtensionPublisher(args, deps, fetchUrl as never),
    ).rejects.toThrow(/did not accept the API token/)
  })

  it('refuses rows that are not a list of objects', async () => {
    const { deps } = setup({ token: 'x' })
    await expect(
      runExtensionPublisher({ ...args, rows: [1] }, deps, vi.fn() as never),
    ).rejects.toMatchObject({ code: 'bad_input' })
  })
})

describe.skipIf(!pythonAvailable)('notification channels', () => {
  const args = {
    ...caller,
    channelId: 'slack',
    destination: 'U01ABC',
    notification: {
      event: 'x',
      title: 'Run done',
      body: 'It finished.',
      link: 'https://app.example/x',
      at: '2026-11-08T00:00:00Z',
    },
  }

  it('delivers to the declared host', async () => {
    const { deps } = setup({ bot_token: 'xoxb' })
    const fetchUrl = vi.fn(async () => answer(200, { ok: true }))
    await runChannelDelivery(args, deps, fetchUrl)
    const [url, init] = fetchUrl.mock.calls[0] as unknown as [URL, any]
    expect(url.hostname).toBe('slack.com')
    expect(JSON.parse(init.body).channel).toBe('U01ABC')
  })

  it('reads a refusal Slack sends with a 200', async () => {
    const { deps } = setup({ bot_token: 'xoxb' })

    const fetchUrl = vi.fn(async () =>
      answer(200, { ok: false, error: 'channel_not_found' }),
    )

    await expect(
      runChannelDelivery(args, deps, fetchUrl as never),
    ).rejects.toThrow(/channel_not_found/)
  })
})
