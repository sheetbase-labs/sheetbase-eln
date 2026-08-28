/**
 * PLAT-02 — stuck-run reconciliation. A process that dies after a connector
 * run enters `running` must not leave the run ambiguous forever: the next
 * start under the same request digest or selector identity reconciles the
 * stale attempt as `failed` (`stale_run_reconciled`), links the new attempt
 * as its retry, and appends a durable reconcile log. A *fresh* running run
 * still conflicts (SB044) — legitimate in-flight work is never failed.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '0e010000-0000-4000-8000-000000000201'
const OWNER = 'plat02-owner'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: OWNER, workspace_id: WS }),
  ])
  return client
}

async function createConnectorFixture(client: Client): Promise<string> {
  await client.query(
    `insert into api.workspaces(id,slug,name,status) values($1,'plat02','PLAT02','active')
     on conflict (id) do nothing`,
    [WS],
  )
  await client.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Owner','plat02@test','f')
     on conflict (id) do nothing`,
    [OWNER],
  )
  await client.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values($1,$2,'owner') on conflict do nothing`,
    [WS, OWNER],
  )
  const connector = (
    await client.query(
      `insert into api.connectors(workspace_id,key,name,connector_type,direction,status)
       values($1,'stale-fixture','Stale fixture','instrument','inbound','active') returning id`,
      [WS],
    )
  ).rows[0]
  return connector.id as string
}

async function insertRunningRun(
  client: Client,
  connectorId: string,
  opts: { requestDigest?: string; selectorDigest?: string; ageSeconds: number },
): Promise<string> {
  const row = (
    await client.query(
      `insert into api.connector_runs(
         workspace_id, connector_id, status, attempt, request_digest, selector_digest, actor_user_id, started_at
       ) values($1,$2,'running',1,$3,$4,$5, clock_timestamp() - make_interval(secs => $6))
       returning id`,
      [
        WS,
        connectorId,
        opts.requestDigest ?? null,
        opts.selectorDigest ?? null,
        OWNER,
        opts.ageSeconds,
      ],
    )
  ).rows[0]
  return row.id as string
}

describe('stale connector run reconciliation', () => {
  let connectorId: string

  beforeAll(async () => {
    const context = await prepareTestDatabase()
    migrator = context.migrator
    asRole = context.asRole
    connectorId = await createConnectorFixture(migrator)
  })

  afterAll(async () => {
    await migrator.end()
    for (const client of clients) await client.end().catch(() => undefined)
  })

  it('reconciles a stale running run on the same request digest', async () => {
    const staleId = await insertRunningRun(migrator, connectorId, {
      requestDigest: 'a'.repeat(64),
      ageSeconds: 3600,
    })
    const owner = await actor()
    const started = (
      await owner.query(
        `select * from api.start_connector_run($1,$2,'manual',$3,NULL,NULL,60)`,
        [WS, connectorId, 'a'.repeat(64)],
      )
    ).rows[0]

    // The stale attempt is failed with the bounded code and durable log.
    const stale = (
      await migrator.query(`select * from api.connector_runs where id=$1`, [
        staleId,
      ])
    ).rows[0]
    expect(stale.status).toBe('failed')
    expect(stale.error_code).toBe('stale_run_reconciled')
    expect(stale.finished_at).not.toBeNull()

    // The new attempt is linked as its retry.
    expect(started.status).toBe('running')
    expect(started.attempt).toBe(2)
    expect(started.retry_of_run_id).toBe(staleId)

    const logs = (
      await migrator.query(
        `select stage, level, message from api.connector_run_logs where run_id=$1`,
        [staleId],
      )
    ).rows
    expect(logs.some((l) => l.stage === 'reconcile')).toBe(true)
  })

  it('still conflicts when the running run is fresh', async () => {
    await insertRunningRun(migrator, connectorId, {
      requestDigest: 'b'.repeat(64),
      ageSeconds: 5,
    })
    const owner = await actor()
    await expect(
      owner.query(
        `select * from api.start_connector_run($1,$2,'manual',$3,NULL,NULL,900)`,
        [WS, connectorId, 'b'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: 'SB044' })
  })

  it('reconciles a stale selector identity and unblocks the unique index', async () => {
    const staleId = await insertRunningRun(migrator, connectorId, {
      selectorDigest: 'c'.repeat(64),
      ageSeconds: 3600,
    })
    const owner = await actor()
    const started = (
      await owner.query(
        `select * from api.start_connector_run($1,$2,'manual',NULL,NULL,$3,60)`,
        [WS, connectorId, 'c'.repeat(64)],
      )
    ).rows[0]

    const stale = (
      await migrator.query(
        `select status, error_code from api.connector_runs where id=$1`,
        [staleId],
      )
    ).rows[0]
    expect(stale.status).toBe('failed')
    expect(stale.error_code).toBe('stale_run_reconciled')
    expect(started.status).toBe('running')
    expect(started.retry_of_run_id).toBe(staleId)
  })

  it('rejects an out-of-range staleness threshold', async () => {
    const owner = await actor()
    await expect(
      owner.query(
        `select * from api.start_connector_run($1,$2,'manual',NULL,NULL,NULL,1)`,
        [WS, connectorId],
      ),
    ).rejects.toMatchObject({ code: 'SB034' })
  })
})
