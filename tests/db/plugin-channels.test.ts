/**
 * Plugin sending (migration 20261108150000).
 *
 * Proves: the SQL validator accepts the outbound example and refuses a
 * publisher or channel with a bad declaration; a notification queues one
 * message for a person who turned a channel on (phone-scope follows the event's
 * phone setting, all-scope follows every row) and none for anyone else; a
 * failed send retries then gives up and the channel row shows the error; a
 * success clears it; old outcomes are pruned.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validateExtensionManifest } from '#/lib/extensions/manifest'
import { buildPluginPackage } from '#/lib/extensions/package'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000e00001'
const ANN = 'chan-ann'
const BEN = 'chan-ben'
const EXAMPLE = join(
  process.cwd(),
  'sdks/plugin-python/examples/outbound-tools',
)

function exampleFiles(dir = '', out: Record<string, string> = {}) {
  for (const entry of readdirSync(join(EXAMPLE, dir), {
    withFileTypes: true,
  })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) exampleFiles(path, out)
    else if (/^(plugin\.json|README\.md|python\/.*\.py)$/.test(path))
      out[path] = readFileSync(join(EXAMPLE, path), 'utf8')
  }
  return out
}
const sample = () =>
  structuredClone(buildPluginPackage(exampleFiles()).manifest) as any

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let extensionId = ''

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: userId, workspace_id: WS }),
  ])
  return client
}

async function install(manifest: any, key: string) {
  const client = await actor(ANN)
  return (
    await client.query(
      `select * from api.install_extension($1,$2,$3,$4,$5,$6::jsonb,true)`,
      [
        WS,
        key,
        manifest.name,
        manifest.version,
        manifest.source,
        JSON.stringify(manifest),
      ],
    )
  ).rows[0] as { id: string }
}

const subscribe = (user: string, scope: 'phone' | 'all', channel = 'slack') =>
  migrator.query(
    `INSERT INTO internal.plugin_channel_subscriptions
       (workspace_id,user_id,extension_id,channel_id,destination,scope)
     VALUES ($1,$2,$3,$4,'U01',$5)
     ON CONFLICT (user_id,extension_id,channel_id) DO UPDATE SET scope = EXCLUDED.scope`,
    [WS, user, extensionId, channel, scope],
  )

const notify = (user: string, eventType: string, title = 'Hello') =>
  migrator.query(
    `INSERT INTO internal.notifications (workspace_id,user_id,event_type,title,body,link)
     VALUES ($1,$2,$3,$4,'Details','/records/x')`,
    [WS, user, eventType, title],
  )

const outbox = (user: string) =>
  migrator.query<{ status: string; payload: any; event_type: string }>(
    `SELECT status, payload, event_type FROM internal.plugin_channel_deliveries
      WHERE user_id = $1 ORDER BY created_at, id`,
    [user],
  )

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'chan','Channels')`,
    [WS],
  )
  for (const user of [ANN, BEN]) {
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')`,
    [WS, ANN, BEN],
  )
  extensionId = (await install(sample(), 'outbound-tools')).id
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()))
  await migrator?.end()
})

describe('manifests', () => {
  it('the example validates in TypeScript and installs in SQL', () => {
    expect(validateExtensionManifest(sample())).toEqual([])
    expect(extensionId).toMatch(/[0-9a-f-]{36}/)
  })

  it('refuses the same bad declarations as TypeScript', async () => {
    const bad: Array<[string, (m: any) => void]> = [
      [
        'publisher without hosts',
        (m) => (m.contributions.publishers[0].hosts = []),
      ],
      [
        'publisher with a parameter named rows',
        (m) =>
          m.contributions.publishers[0].parameters.push({
            name: 'rows',
            type: 'text',
            required: false,
            label: 'Rows',
          }),
      ],
      [
        'channel without a destination label',
        (m) =>
          delete m.contributions['notification-channels'][0].destination.label,
      ],
      [
        'channel with a non-https host',
        (m) =>
          (m.contributions['notification-channels'][0].hosts = [
            'http://slack.com',
          ]),
      ],
    ]
    let n = 0
    for (const [label, mutate] of bad) {
      const m = sample()
      mutate(m)
      expect(
        validateExtensionManifest(m).length,
        `ts: ${label}`,
      ).toBeGreaterThan(0)
      await expect(
        install(m, `bad-chan-${n++}`),
        `sql: ${label}`,
      ).rejects.toMatchObject({
        code: 'SB034',
      })
    }
  })
})

describe('the outbox', () => {
  it('queues nothing for a person with no channel', async () => {
    await notify(BEN, 'run.done')
    expect((await outbox(BEN)).rows).toHaveLength(0)
  })

  it('queues one message with the link and body for an all-scope channel', async () => {
    await subscribe(ANN, 'all')
    await notify(ANN, 'run.done', 'Run finished')
    const rows = (await outbox(ANN)).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toMatchObject({
      event: 'run.done',
      title: 'Run finished',
      body: 'Details',
      link: '/records/x',
    })
  })

  it('a phone-scope channel follows the event’s phone setting', async () => {
    await migrator.query(
      `DELETE FROM internal.plugin_channel_deliveries WHERE user_id=$1`,
      [ANN],
    )
    await subscribe(ANN, 'phone')
    const ann = await actor(ANN)
    await ann.query(
      `SELECT api.save_notification_preference('step_timer', true, false, false, false)`,
    )
    await notify(ANN, 'step_timer')
    await notify(ANN, 'signature_requested')
    const events = (await outbox(ANN)).rows.map((r) => r.event_type)
    expect(events).toContain('signature_requested')
    expect(events).not.toContain('step_timer')
  })
})

describe('delivery outcomes', () => {
  it('retries a failure up to three times then gives up, and a success clears the error', async () => {
    await migrator.query(
      `DELETE FROM internal.plugin_channel_deliveries WHERE user_id=$1`,
      [ANN],
    )
    await subscribe(ANN, 'all')
    await notify(ANN, 'x.event')
    for (let attempt = 1; attempt <= 3; attempt++) {
      await migrator.query(
        `UPDATE internal.plugin_channel_deliveries SET next_attempt_at = now() - interval '1 second' WHERE user_id=$1`,
        [ANN],
      )
      const claimed = await migrator.query(
        `SELECT * FROM internal.claim_due_plugin_channel_deliveries(10)`,
      )
      expect(claimed.rows).toHaveLength(1)
      expect(claimed.rows[0].attempt).toBe(attempt)
      expect(claimed.rows[0].channel_id).toBe('slack')
      await migrator.query(
        `SELECT internal.finish_plugin_channel_delivery($1,false,'Slack said: nope.')`,
        [claimed.rows[0].id],
      )
    }
    expect((await outbox(ANN)).rows[0]!.status).toBe('dead')
    const sub = await migrator.query(
      `SELECT last_error FROM internal.plugin_channel_subscriptions WHERE user_id=$1`,
      [ANN],
    )
    expect(sub.rows[0].last_error).toBe('Slack said: nope.')

    await notify(ANN, 'y.event')
    const claimed = await migrator.query(
      `SELECT * FROM internal.claim_due_plugin_channel_deliveries(10)`,
    )
    await migrator.query(
      `SELECT internal.finish_plugin_channel_delivery($1,true,null)`,
      [claimed.rows[0].id],
    )
    const after = await migrator.query(
      `SELECT last_error, last_sent_at FROM internal.plugin_channel_subscriptions WHERE user_id=$1`,
      [ANN],
    )
    expect(after.rows[0].last_error).toBeNull()
    expect(after.rows[0].last_sent_at).not.toBeNull()
  })

  it('prunes old sent and dead rows only', async () => {
    await migrator.query(
      `UPDATE internal.plugin_channel_deliveries SET created_at = now() - interval '8 days' WHERE status IN ('sent','dead')`,
    )
    const { rows } = await migrator.query(
      `SELECT internal.prune_plugin_channel_deliveries() AS n`,
    )
    expect(rows[0].n).toBeGreaterThanOrEqual(2)
  })
})
