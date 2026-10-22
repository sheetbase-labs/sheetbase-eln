/** Real PostgreSQL recovery/ownership. Only the outbound HTTP boundary is fake. */
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  processChangeEvent,
  processRetries,
  reconcileWebhookDeliveries,
  startWebhookDeliveryEngine,
} from '#/lib/webhook-delivery'
import { migratorUrl, prepareTestDatabase, testDatabaseName } from './helpers'

const receiver = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('#/lib/webhook-http.server', () => ({
  safeWebhookFetch: receiver.post,
}))

let db: Client
let stop: (() => Promise<void>) | undefined
const WS = randomUUID()
const WS2 = randomUUID()
const SUB = randomUUID()
const SUB2 = randomUUID()

beforeAll(async () => {
  db = (await prepareTestDatabase()).migrator
  await db.query(
    `insert into api.workspaces(id,slug,name) values
    ($1,'wh-recovery','Recovery'),($2,'wh-recovery-2','Recovery 2')`,
    [WS, WS2],
  )
  await db.query(
    `insert into api.webhook_subscriptions
    (id,workspace_id,key,url,created_at,failure_threshold,max_retries)
    values ($1,$3,'first','https://example.com/first',now()-interval '10 days',0,1),
           ($2,$3,'second','https://example.com/second',now()-interval '10 days',0,1)`,
    [SUB, SUB2, WS],
  )
  await db.query(
    `insert into internal.webhook_secrets(subscription_id,workspace_id,secret_name,ciphertext)
    values ($1,$4,'signing_secret',$3),($2,$4,'signing_secret',$3)`,
    [SUB, SUB2, Buffer.from('local-recovery-test-secret'), WS],
  )
})

beforeEach(async () => {
  await stop?.()
  stop = undefined
  await db.query('delete from api.webhook_deliveries')
  // Change events are append-only. Deactivate subscriptions between cases,
  // and give the next case a creation boundary after previous test events.
  await db.query(
    `update api.webhook_subscriptions set status='active', created_at=now(), event_types='[]'`,
  )
  receiver.post.mockReset().mockResolvedValue(new Response('ok'))
})

afterAll(async () => {
  await stop?.()
  await db?.end()
})

async function event(age = '0 seconds', workspace = WS) {
  const { rows } = await db.query(
    `insert into api.change_events
    (workspace_id,sequence,entity_type,entity_uuid,operation,payload,created_at)
    values ($1,(select coalesce(max(sequence),0)+1 from api.change_events where workspace_id=$1),
      'record',gen_random_uuid(),'create','{}',clock_timestamp()-$2::interval)
    returning id, workspace_id, sequence, entity_type, operation`,
    [workspace, age],
  )
  return rows[0]
}

async function count(status?: string) {
  return (
    await db.query(
      `select count(*)::int as n from api.webhook_deliveries
    where ($1::text is null or status=$1)`,
      [status ?? null],
    )
  ).rows[0].n
}

it('drains more than 500 events, repairs partial fan-out, and reconciles older retained events', async () => {
  await db.query(
    `update api.webhook_subscriptions set created_at=now()-interval '10 days'`,
  )
  const old = await event('2 days')
  await processChangeEvent(old, migratorUrl())
  // A partial delivery for just one of two subscriptions must not hide the event.
  await db.query(
    'delete from api.webhook_deliveries where subscription_id=$1',
    [SUB2],
  )
  await db.query(
    `insert into api.change_events
    (workspace_id,sequence,entity_type,entity_uuid,operation,payload)
    select $1,g+100,'record',gen_random_uuid(),'create','{}' from generate_series(1,501) g`,
    [WS],
  )
  const third = randomUUID()
  await db.query(
    `insert into api.webhook_subscriptions(id,workspace_id,key,url)
    values($1,$2,'third','https://example.com/third')`,
    [third, WS2],
  )
  await db.query(
    `insert into internal.webhook_secrets(subscription_id,workspace_id,secret_name,ciphertext)
    values($1,$2,'signing_secret',$3)`,
    [third, WS2, Buffer.from('third-test-secret')],
  )
  // Sequence is per workspace. Two events straddle the page at sequence 599.
  await db.query(
    `insert into api.change_events
    (workspace_id,sequence,entity_type,entity_uuid,operation,payload)
    values($1,599,'record',gen_random_uuid(),'create','{}')`,
    [WS2],
  )
  await reconcileWebhookDeliveries(migratorUrl())
  expect(await count()).toBe(1005)
  await reconcileWebhookDeliveries(migratorUrl())
  expect(await count()).toBe(1005)
  const { rows } = await db.query(
    `select payload->>'eventId' as event_id
    from api.webhook_deliveries where change_event_id=$1`,
    [old.id],
  )
  expect(rows).toEqual([{ event_id: old.id }, { event_id: old.id }])
}, 120_000)

it('does not backfill events older than the subscription or let filtered events starve later work', async () => {
  const older = await event('20 days')
  await db.query(
    `update api.webhook_subscriptions set event_types='["dataset.created"]' where id=$1`,
    [SUB2],
  )
  const current = await event()
  await reconcileWebhookDeliveries(migratorUrl())
  expect(await count()).toBe(1)
  const { rows } = await db.query(
    'select change_event_id,subscription_id from api.webhook_deliveries',
  )
  expect(rows).toEqual([{ change_event_id: current.id, subscription_id: SUB }])
  expect(rows[0].change_event_id).not.toBe(older.id)
})

it('holds atomic ownership through HTTP and settlement across overlapping workers', async () => {
  await db.query(
    `update api.webhook_subscriptions set status='disabled' where id=$1`,
    [SUB2],
  )
  const e = await event()
  await processChangeEvent(e, migratorUrl())
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  receiver.post.mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
    return new Response('ok')
  })
  const first = processRetries(migratorUrl())
  await entered.promise
  try {
    expect(await processRetries(migratorUrl())).toBe(0)
    expect(await count('pending')).toBe(1)
  } finally {
    release.resolve()
  }
  expect(await first).toBe(1)
  expect(await count('delivered')).toBe(1)
  expect(receiver.post).toHaveBeenCalledTimes(1)
})

it('rolls back a lost settlement and reuses the event ID so a receiver can deduplicate', async () => {
  await db.query(
    `update api.webhook_subscriptions set status='disabled' where id=$1`,
    [SUB2],
  )
  const e = await event()
  await processChangeEvent(e, migratorUrl())
  const received = new Set<string>()
  let effects = 0
  receiver.post.mockImplementation(async (_url: string, init: RequestInit) => {
    const id = new Headers(init.headers).get('x-sheetbase-event-id')!
    expect(id).toBe(e.id)
    expect(JSON.parse(String(init.body)).eventId).toBe(id)
    if (!received.has(id)) {
      effects++
      received.add(id)
    }
    return new Response('ok')
  })
  await db.query(`create function public.reject_webhook_settlement() returns trigger
    language plpgsql as $$ begin raise exception 'settlement unavailable'; end $$;
    create trigger reject_settlement before update on api.webhook_deliveries
    for each row execute function public.reject_webhook_settlement()`)
  try {
    await expect(processRetries(migratorUrl())).rejects.toThrow(
      'settlement unavailable',
    )
    expect(await count('pending')).toBe(1)
  } finally {
    await db.query(
      'drop trigger reject_settlement on api.webhook_deliveries; drop function public.reject_webhook_settlement()',
    )
  }
  expect(await processRetries(migratorUrl())).toBe(1)
  expect(receiver.post).toHaveBeenCalledTimes(2)
  expect(effects).toBe(1)
  expect(await count('delivered')).toBe(1)
})

it('allows the configured retry, then dead-letters without an infinite retry loop', async () => {
  await db.query(
    `update api.webhook_subscriptions set status='disabled' where id=$1`,
    [SUB2],
  )
  await processChangeEvent(await event(), migratorUrl())
  receiver.post.mockImplementation(
    async () => new Response('unavailable', { status: 503 }),
  )
  expect(await processRetries(migratorUrl())).toBe(1)
  expect(await count('retrying')).toBe(1)
  await db.query('update api.webhook_deliveries set next_attempt_at=now()')
  expect(await processRetries(migratorUrl())).toBe(1)
  expect(await count('dead_letter')).toBe(1)
  expect(await processRetries(migratorUrl())).toBe(0)
  expect(receiver.post).toHaveBeenCalledTimes(2)
})

it('drains one pending item under a rate budget instead of counting its queued neighbours as attempts', async () => {
  await db.query(
    `update api.webhook_subscriptions set status='disabled' where id=$1`,
    [SUB2],
  )
  await db.query(
    'update api.webhook_subscriptions set rate_limit_per_minute=1 where id=$1',
    [SUB],
  )
  try {
    await processChangeEvent(await event(), migratorUrl())
    await processChangeEvent(await event(), migratorUrl())
    await Promise.all([
      processRetries(migratorUrl()),
      processRetries(migratorUrl()),
    ])
    expect(await count('delivered')).toBe(1)
    expect(await count('pending')).toBe(1)
    expect(receiver.post).toHaveBeenCalledTimes(1)
  } finally {
    await db.query(
      'update api.webhook_subscriptions set rate_limit_per_minute=null where id=$1',
      [SUB],
    )
  }
})

it('repairs events committed while LISTEN is disconnected, without waiting for the minute timer', async () => {
  await db.query(
    `update api.webhook_subscriptions set status='disabled' where id=$1`,
    [SUB2],
  )
  await event()
  stop = startWebhookDeliveryEngine(migratorUrl(), 60_000)
  await expect.poll(async () => count('delivered'), { timeout: 10_000 }).toBe(1)
  let listenerPid = 0
  await expect
    .poll(async () => {
      const { rows } = await db.query(
        `select pid from pg_stat_activity
      where datname=$1 and query='LISTEN sheetbase_change'`,
        [testDatabaseName()],
      )
      listenerPid = rows[0]?.pid ?? 0
      return listenerPid
    })
    .toBeGreaterThan(0)
  await db.query('select pg_terminate_backend($1)', [listenerPid])
  const missed = await event()
  await expect
    .poll(
      async () => {
        return (
          await db.query(
            `select status from api.webhook_deliveries where change_event_id=$1`,
            [missed.id],
          )
        ).rows[0]?.status
      },
      { timeout: 15_000 },
    )
    .toBe('delivered')
  const reconnected = await db.query(
    `select pid from pg_stat_activity
     where datname=$1 and query='LISTEN sheetbase_change'`,
    [testDatabaseName()],
  )
  expect(reconnected.rows).toHaveLength(1)
  expect(reconnected.rows[0].pid).not.toBe(listenerPid)
})

it('periodically repairs events without any notification while the listener stays connected', async () => {
  await db.query(
    `update api.webhook_subscriptions set status='disabled' where id=$1`,
    [SUB2],
  )
  await event()
  stop = startWebhookDeliveryEngine(migratorUrl(), 100)
  await expect.poll(async () => count('delivered'), { timeout: 10_000 }).toBe(1)
  const e = await event()
  await expect.poll(async () => count('delivered'), { timeout: 10_000 }).toBe(2)
  expect(
    (
      await db.query(
        `select status from api.webhook_deliveries where change_event_id=$1`,
        [e.id],
      )
    ).rows[0].status,
  ).toBe('delivered')
})
