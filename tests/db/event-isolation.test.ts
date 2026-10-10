/**
 * EVENT-03 — Event consumption isolation and trigger coverage proof.
 *
 * Proves against a real PostgreSQL surface that:
 *
 *  - event schedules store canonical catalogue names (aliases and the
 *    legacy `dataset_version_created` name are accepted at intake);
 *  - schedules fire for the catalogued record/dataset/sheet/review families,
 *    not just `dataset.versioned`;
 *  - webhook subscriptions and pipeline schedules in one workspace never
 *    observe another workspace's events (RLS + engine matching);
 *  - a webhook delivery and a pipeline run for the same domain change share
 *    identity (`change_event_id` / `evt:<change_event_id>`) and the same
 *    stable event name.
 */
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { canonicalNameFor } from '#/lib/event-catalogue'
import { sweepPipelines } from '#/lib/pipeline-scheduler.server'
import type {
  PipelineSchedulerDeps,
  SchedulerConnection,
} from '#/lib/pipeline-scheduler.server'
import {
  createDeliveryRecord,
  findMatchingSubscriptions,
} from '#/lib/webhook-delivery'
import { buildEventPayload, mapEventType } from '#/lib/webhook-events'
import { signPayload } from '#/lib/webhook-signing'
import {
  prepareTestDatabase,
  setActorJwt,
  TEST_DATABASE,
  testDatabaseName,
} from './helpers'

const WS_A = '0e030000-0000-4000-8000-000000000a01'
const WS_B = '0e030000-0000-4000-8000-000000000b02'
const OWNER_A = 'event-iso-owner-a'
const OWNER_B = 'event-iso-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const inputVersionByWs: Record<string, string> = {}
const scheduleByWs: Record<string, string> = {}
const subscriptionByWs: Record<string, string> = {}

function superuserTestUrl(): string {
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${testDatabaseName()}`
  return url.toString()
}

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

const RPC_ARG_TYPES: Record<string, string[]> = {
  create_pipeline_definition: ['uuid', 'text', 'text', 'text'],
  create_pipeline_definition_version: ['uuid', 'uuid', 'jsonb'],
  publish_pipeline_definition_version: ['uuid', 'uuid'],
  create_pipeline_schedule: ['uuid', 'uuid', 'text', 'jsonb', 'boolean'],
  create_dataset_schema_definition: ['uuid', 'text', 'text', 'text', 'jsonb'],
  publish_dataset_schema_version: ['uuid'],
  commit_dataset_row_batch: ['uuid', 'bigint', 'jsonb', 'text'],
  snapshot_dataset: ['uuid', 'bigint', 'text'],
}

async function rpc<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const types = RPC_ARG_TYPES[name]
  if (!types) throw new Error(`no argument types registered for ${name}`)
  const raw = Object.values(args)
  const values = raw.map((value, index) =>
    value !== null && types[index] === 'jsonb' ? JSON.stringify(value) : value,
  )
  while (values.length < types.length) values.push(null)
  const placeholders = types
    .map((type, index) => `$${index + 1}::${type}`)
    .join(',')
  const { rows } = await client.query(
    `select * from api.${name}(${placeholders})`,
    values,
  )
  const row = rows[0]
  if (!row) return undefined as T
  const keys = Object.keys(row)
  if (keys.length === 1) {
    const value = row[keys[0]]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as T
    }
  }
  return row as T
}

function schedulerConnection(conn: Client): SchedulerConnection {
  return {
    query: async (text, values = []) => conn.query(text, values),
    begin: () => conn.query('BEGIN').then(() => undefined),
    commit: () => conn.query('COMMIT').then(() => undefined),
    rollback: () => conn.query('ROLLBACK').then(() => undefined),
    end: () => Promise.resolve(),
  }
}

async function makeSweepDeps(conn: PgClient): Promise<PipelineSchedulerDeps> {
  return {
    connect: () => Promise.resolve(schedulerConnection(conn)),
    // No-op executor: the run is started (durable) but never executed, so
    // this suite proves trigger/matching semantics without running transforms.
    run: async () => undefined,
  }
}

function pipelineConfig(schemaVersionId: string): Record<string, unknown> {
  return {
    configVersion: 1,
    description: 'scale measurement values',
    parameters: [{ name: 'factor', type: 'decimal', required: true }],
    inputs: [{ name: 'measurements', required: true }],
    transform: {
      language: 'sql',
      statement:
        'SELECT batch, value, value * {{factor}} AS scaled FROM measurements',
    },
    output: {
      mode: 'create',
      schemaVersionId,
      datasetName: 'Scaled measurements',
      datasetLabel: 'pipeline output',
      fieldMapping: null,
    },
  }
}

async function setupWorkspace(
  ws: string,
  ownerId: string,
  slug: string,
  rowId: string,
) {
  await migrator.query(
    `insert into api.workspaces(id, slug, name) values($1, $2, $3)`,
    [ws, slug, `Event iso ${slug}`],
  )
  await migrator.query(
    `insert into internal."user"(id, name, email) values ($1, $2, $3)`,
    [ownerId, `Owner ${slug}`, `${slug}@event-iso.test`],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [ws, ownerId],
  )
  const owner = await actor(ownerId, ws)
  const safeSlug = slug.replace(/-/g, '_')

  const definition = await rpc<{
    schema_definition_id: string
    schema_version_id: string
  }>(owner, 'create_dataset_schema_definition', {
    p_workspace_id: ws,
    p_key: `iso_measurement_${safeSlug}`,
    p_name: 'Iso measurement',
    p_description: null,
    p_fields: [
      { key: 'batch', label: 'Batch', logicalType: 'text', nullable: false },
      { key: 'value', label: 'Value', logicalType: 'decimal', nullable: false },
    ],
  })
  await rpc(owner, 'publish_dataset_schema_version', {
    p_schema_version_id: definition.schema_version_id,
  })
  const schemaVersionId = definition.schema_version_id

  // A real Dataset Version — also emits the dataset_version/create event.
  const created = await owner.query<{ id: string }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, $3, $4) returning id`,
    [ws, schemaVersionId, 'Raw measurements', ownerId],
  )
  const datasetId = created.rows[0].id
  const fields = await migrator.query<{ id: string; key: string }>(
    `select field_id as id, key from api.dataset_schema_version_fields
      where schema_version_id = $1 and lifecycle = 'active'`,
    [schemaVersionId],
  )
  const fieldId = Object.fromEntries(fields.rows.map((f) => [f.key, f.id]))
  await rpc(owner, 'commit_dataset_row_batch', {
    p_dataset_id: datasetId,
    p_expected_dataset_revision: 1,
    p_rows: [
      {
        operation: 'create',
        rowId,
        values: { [fieldId.batch]: 'A', [fieldId.value]: 2 },
      },
    ],
    p_idempotency_key: `iso-input-${slug}`,
  })
  const snapshot = await rpc<{ id: string }>(owner, 'snapshot_dataset', {
    p_dataset_id: datasetId,
    p_expected_dataset_revision: 2,
    p_label: 'raw input',
  })
  inputVersionByWs[ws] = snapshot.id

  const pipeDef = await rpc<{ id: string }>(
    owner,
    'create_pipeline_definition',
    { p_workspace_id: ws, p_key: `iso_scale_${safeSlug}`, p_name: 'Iso scale' },
  )
  const pipeVersion = await rpc<{ id: string }>(
    owner,
    'create_pipeline_definition_version',
    {
      p_workspace_id: ws,
      p_definition_id: pipeDef.id,
      p_configuration: pipelineConfig(schemaVersionId),
    },
  )
  await rpc(owner, 'publish_pipeline_definition_version', {
    p_workspace_id: ws,
    p_version_id: pipeVersion.id,
  })

  const schedule = await rpc<{ id: string }>(
    owner,
    'create_pipeline_schedule',
    {
      p_workspace_id: ws,
      p_definition_id: pipeDef.id,
      p_kind: 'event',
      p_spec: {
        eventType: 'dataset.versioned',
        inputName: 'measurements',
        parameters: { factor: 5 },
      },
      p_enabled: true,
    },
  )
  scheduleByWs[ws] = schedule.id

  const { rows: subRows } = await owner.query(
    `SELECT api.create_webhook_subscription($1, $2, $3, $4, $5) AS result`,
    [
      ws,
      `iso-hook-${slug}`,
      'https://example.com/iso-hook',
      JSON.stringify(['dataset.versioned', 'record.created']),
      'Isolation probe subscription',
    ],
  )
  subscriptionByWs[ws] = subRows[0].result.subscription.id

  // Park the schedule cursor past the fixture events so each test observes
  // only the events it emits.
  await migrator.query(
    `update api.pipeline_schedules set last_evaluated_sequence =
       (select coalesce(max(sequence), 0) from api.change_events where workspace_id = $2)
     where id = $1`,
    [schedule.id, ws],
  )
  return { owner, pipeDefId: pipeDef.id }
}

let pipeDefByWs: Record<string, string> = {}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  asRole = prepared.asRole
  const a = await setupWorkspace(
    WS_A,
    OWNER_A,
    'iso-a',
    '11111111-1111-4111-8111-111111111111',
  )
  const b = await setupWorkspace(
    WS_B,
    OWNER_B,
    'iso-b',
    '22222222-2222-4222-8222-222222222222',
  )
  pipeDefByWs = { [WS_A]: a.pipeDefId, [WS_B]: b.pipeDefId }
})

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => {})
  await migrator?.end()
})

async function insertSyntheticEvent(
  ws: string,
  entityType: string,
  operation: string,
): Promise<{ id: string; sequence: number }> {
  // Allocate the sequence through the workspace counter — the same path
  // internal.emit_change_event uses — so later trigger-emitted events never
  // collide with synthetic rows.
  const { rows: seqRows } = await migrator.query<{ last_seq: string }>(
    `insert into api.workspace_change_seq(workspace_id, last_seq)
     values ($1, 1)
     on conflict (workspace_id) do update
       set last_seq = api.workspace_change_seq.last_seq + 1, updated_at = now()
     returning last_seq`,
    [ws],
  )
  const sequence = Number(seqRows[0].last_seq)
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.change_events(workspace_id, sequence, entity_type, entity_uuid, operation, payload)
     values ($1, $2, $3, gen_random_uuid(), $4, '{}') returning id`,
    [ws, sequence, entityType, operation],
  )
  return { id: rows[0].id, sequence }
}

describe('EVENT-03 trigger configuration', () => {
  it('stores canonical names, accepting the legacy name and wire aliases', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const legacy = await rpc<{ id: string; spec: { eventType: string } }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS_A,
        p_definition_id: pipeDefByWs[WS_A],
        p_kind: 'event',
        p_spec: { eventType: 'dataset_version_created' },
        p_enabled: false,
      },
    )
    expect(legacy.spec.eventType).toBe('dataset.versioned')
    const aliased = await rpc<{ id: string; spec: { eventType: string } }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS_A,
        p_definition_id: pipeDefByWs[WS_A],
        p_kind: 'event',
        p_spec: { eventType: 'sheet_instance.created' },
        p_enabled: false,
      },
    )
    expect(aliased.spec.eventType).toBe('sheet.created')
    await expect(
      rpc(owner, 'create_pipeline_schedule', {
        p_workspace_id: WS_A,
        p_definition_id: pipeDefByWs[WS_A],
        p_kind: 'event',
        p_spec: { eventType: 'project.created' },
        p_enabled: false,
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
  })

  it('fires schedules for record and review families, not just dataset versions', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const recordSchedule = await rpc<{ id: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS_A,
        p_definition_id: pipeDefByWs[WS_A],
        p_kind: 'event',
        p_spec: {
          eventType: 'record.created',
          inputVersions: { measurements: inputVersionByWs[WS_A] },
          parameters: { factor: 5 },
        },
        p_enabled: true,
      },
    )
    const reviewSchedule = await rpc<{ id: string }>(
      owner,
      'create_pipeline_schedule',
      {
        p_workspace_id: WS_A,
        p_definition_id: pipeDefByWs[WS_A],
        p_kind: 'event',
        p_spec: {
          eventType: 'review.decided',
          inputVersions: { measurements: inputVersionByWs[WS_A] },
          parameters: { factor: 5 },
        },
        p_enabled: true,
      },
    )
    const recordEvt = await insertSyntheticEvent(WS_A, 'record', 'create')
    const reviewEvt = await insertSyntheticEvent(
      WS_A,
      'review_decision',
      'create',
    )

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    const deps = await makeSweepDeps(conn)
    const started = await sweepPipelines(deps)
    await conn.end()
    expect(started).toBeGreaterThanOrEqual(2)

    const { rows } = await migrator.query<{
      trigger_occurrence_id: string
      schedule_id: string
    }>(
      `select trigger_occurrence_id, schedule_id from api.pipeline_runs
        where trigger_occurrence_id in ($1, $2)`,
      [`evt:${recordEvt.id}`, `evt:${reviewEvt.id}`],
    )
    expect(rows.map((r) => r.trigger_occurrence_id).sort()).toEqual(
      [`evt:${recordEvt.id}`, `evt:${reviewEvt.id}`].sort(),
    )
    expect(
      rows.find((r) => r.trigger_occurrence_id === `evt:${recordEvt.id}`)
        ?.schedule_id,
    ).toBe(recordSchedule.id)
    expect(
      rows.find((r) => r.trigger_occurrence_id === `evt:${reviewEvt.id}`)
        ?.schedule_id,
    ).toBe(reviewSchedule.id)

    // Park the new schedules so later tests observe only their own events.
    await migrator.query(
      `update api.pipeline_schedules set last_evaluated_sequence =
         (select coalesce(max(sequence), 0) from api.change_events where workspace_id = $2)
       where id = any($1)`,
      [[recordSchedule.id, reviewSchedule.id], WS_A],
    )
  })
})

describe('EVENT-03 workspace isolation', () => {
  it('engine matching returns only same-workspace subscriptions', async () => {
    const inA = await findMatchingSubscriptions(
      WS_A,
      'dataset.versioned',
      superuserTestUrl(),
    )
    const inB = await findMatchingSubscriptions(
      WS_B,
      'dataset.versioned',
      superuserTestUrl(),
    )
    expect(inA.map((s) => s.workspace_id)).toEqual([WS_A])
    expect(inA.map((s) => s.id)).toEqual([subscriptionByWs[WS_A]])
    expect(inB.map((s) => s.workspace_id)).toEqual([WS_B])
    expect(inB.map((s) => s.id)).toEqual([subscriptionByWs[WS_B]])
  })

  it('RLS hides the other workspace subscriptions and deliveries', async () => {
    // A delivery for A's latest domain event, recorded out of band.
    const { rows: evt } = await migrator.query<{ id: string }>(
      `select id from api.change_events where workspace_id = $1
        order by sequence desc limit 1`,
      [WS_A],
    )
    const eventId = evt[0].id
    const created = await createDeliveryRecord(
      WS_A,
      subscriptionByWs[WS_A],
      eventId,
      'dataset.versioned',
      { schemaVersion: '1' } as Record<string, unknown>,
      JSON.stringify({ eventId }),
      'sha256=probe',
      superuserTestUrl(),
    )
    expect(created).not.toBeNull()

    const ownerA = await actor(OWNER_A, WS_A)
    const ownerB = await actor(OWNER_B, WS_B)
    const subsA = await ownerA.query(
      `select key from api.webhook_subscriptions`,
    )
    const subsB = await ownerB.query(
      `select key from api.webhook_subscriptions`,
    )
    expect(subsA.rows.map((r) => r.key)).toEqual(['iso-hook-iso-a'])
    expect(subsB.rows.map((r) => r.key)).toEqual(['iso-hook-iso-b'])

    const delA = await ownerA.query(`select id from api.webhook_deliveries`)
    const delB = await ownerB.query(`select id from api.webhook_deliveries`)
    expect(delA.rows.length).toBeGreaterThanOrEqual(1)
    expect(delB.rows).toHaveLength(0)

    const schedA = await ownerA.query(`select id from api.pipeline_schedules`)
    const schedB = await ownerB.query(`select id from api.pipeline_schedules`)
    expect(schedA.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([scheduleByWs[WS_A]]),
    )
    expect(schedA.rows.map((r) => r.id)).not.toContain(scheduleByWs[WS_B])
    expect(schedB.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([scheduleByWs[WS_B]]),
    )
    expect(schedB.rows.map((r) => r.id)).not.toContain(scheduleByWs[WS_A])
  })

  it('the pipeline sweep consumes only same-workspace events', async () => {
    const ownerA = await actor(OWNER_A, WS_A)
    // A new Dataset Version in A only — emits dataset_version/create in A.
    const created = await ownerA.query<{ id: string }>(
      `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
       values ($1, (select schema_version_id from api.datasets where workspace_id = $1 limit 1), $2, $3)
       returning id`,
      [WS_A, 'Isolation probe dataset', OWNER_A],
    )
    const datasetId = created.rows[0].id
    const fields = await migrator.query<{ id: string; key: string }>(
      `select field_id as id, key from api.dataset_schema_version_fields
        where schema_version_id =
          (select schema_version_id from api.datasets where id = $1)
          and lifecycle = 'active'`,
      [datasetId],
    )
    const fieldId = Object.fromEntries(fields.rows.map((f) => [f.key, f.id]))
    await rpc(ownerA, 'commit_dataset_row_batch', {
      p_dataset_id: datasetId,
      p_expected_dataset_revision: 1,
      p_rows: [
        {
          operation: 'create',
          rowId: '33333333-3333-4333-8333-333333333333',
          values: { [fieldId.batch]: 'A', [fieldId.value]: 3 },
        },
      ],
      p_idempotency_key: 'iso-probe-version',
    })
    const snapshot = await rpc<{ id: string }>(ownerA, 'snapshot_dataset', {
      p_dataset_id: datasetId,
      p_expected_dataset_revision: 2,
      p_label: 'iso probe',
    })
    const { rows: evt } = await migrator.query<{ id: string }>(
      `select id from api.change_events
        where workspace_id = $1 and entity_type = 'dataset_version' and entity_uuid = $2`,
      [WS_A, snapshot.id],
    )
    expect(evt).toHaveLength(1)
    const eventId = evt[0].id

    const beforeA = await migrator.query<{ n: number }>(
      `select count(*)::int as n from api.pipeline_runs where schedule_id = $1`,
      [scheduleByWs[WS_A]],
    )
    const beforeB = await migrator.query<{ n: number }>(
      `select count(*)::int as n from api.pipeline_runs where schedule_id = $1`,
      [scheduleByWs[WS_B]],
    )
    const cursorB = await migrator.query<{ seq: string | null }>(
      `select last_evaluated_sequence as seq from api.pipeline_schedules where id = $1`,
      [scheduleByWs[WS_B]],
    )

    const conn = new PgClient({ connectionString: superuserTestUrl() })
    await conn.connect()
    await sweepPipelines(await makeSweepDeps(conn))
    await conn.end()

    const afterA = await migrator.query<{ n: number }>(
      `select count(*)::int as n from api.pipeline_runs where schedule_id = $1`,
      [scheduleByWs[WS_A]],
    )
    const afterB = await migrator.query<{ n: number }>(
      `select count(*)::int as n from api.pipeline_runs where schedule_id = $1`,
      [scheduleByWs[WS_B]],
    )
    expect(afterA.rows[0].n).toBeGreaterThan(beforeA.rows[0].n)
    expect(afterB.rows[0].n).toBe(beforeB.rows[0].n)

    // The new event was consumed by A's schedule with the shared identity.
    const { rows: runs } = await migrator.query<{
      trigger_occurrence_id: string
    }>(
      `select trigger_occurrence_id from api.pipeline_runs
        where schedule_id = $1 and trigger_occurrence_id = $2`,
      [scheduleByWs[WS_A], `evt:${eventId}`],
    )
    expect(runs).toHaveLength(1)

    // B's cursor never moved — B observed nothing.
    const cursorBAfter = await migrator.query<{ seq: string | null }>(
      `select last_evaluated_sequence as seq from api.pipeline_schedules where id = $1`,
      [scheduleByWs[WS_B]],
    )
    expect(cursorBAfter.rows[0].seq).toEqual(cursorB.rows[0].seq)
  })

  it('webhook delivery and pipeline run share identity and vocabulary', async () => {
    const { rows: evt } = await migrator.query<{
      id: string
      sequence: string
    }>(
      `select id, sequence::text as sequence from api.change_events
        where workspace_id = $1 and entity_type = 'dataset_version'
        order by sequence::bigint desc limit 1`,
      [WS_A],
    )
    const eventId = evt[0].id
    // Same stable name through every layer: delivery map, catalogue, trigger.
    expect(mapEventType('dataset_version', 'create')).toBe('dataset.versioned')
    expect(canonicalNameFor('dataset_version', 'create')).toBe(
      'dataset.versioned',
    )
    const { rows: change } = await migrator.query<{
      entity_type: string
      operation: string
    }>(`select entity_type, operation from api.change_events where id = $1`, [
      eventId,
    ])
    const payload = buildEventPayload(
      {
        id: eventId,
        workspaceId: WS_A,
        sequence: Number(evt[0].sequence),
        entityType: change[0].entity_type,
        entityUuid: '00000000-0000-4000-8000-000000000000',
        operation: change[0].operation,
        recordId: null,
        projectId: null,
        actorUserId: OWNER_A,
        actorCredentialId: null,
        clientId: null,
        payload: {},
        createdAt: new Date().toISOString(),
      },
      'dataset.versioned',
    )
    const body = JSON.stringify(payload)
    const secret = 'iso-shared-identity-secret'
    const signature = signPayload(body, secret)
    const delivery = await createDeliveryRecord(
      WS_A,
      subscriptionByWs[WS_A],
      eventId,
      'dataset.versioned',
      payload as unknown as Record<string, unknown>,
      body,
      signature,
      superuserTestUrl(),
    )
    // Idempotent re-record of the same (subscription, event) pair is a no-op.
    const duplicate = await createDeliveryRecord(
      WS_A,
      subscriptionByWs[WS_A],
      eventId,
      'dataset.versioned',
      payload as unknown as Record<string, unknown>,
      body,
      signature,
      superuserTestUrl(),
    )
    expect(delivery).not.toBeNull()
    expect(duplicate).toBeNull()
    expect(delivery?.change_event_id).toBe(eventId)

    const { rows: runs } = await migrator.query<{
      trigger_occurrence_id: string
    }>(
      `select trigger_occurrence_id from api.pipeline_runs
        where schedule_id = $1 and trigger_occurrence_id = $2`,
      [scheduleByWs[WS_A], `evt:${eventId}`],
    )
    expect(runs).toHaveLength(1)
  })
})
