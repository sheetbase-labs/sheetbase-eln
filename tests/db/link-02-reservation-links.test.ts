/**
 * LINK-02: reserving a sample for an experiment links the experiment to the
 * sample in `record_links` (0530), and the backfill (0531) links reservations
 * made before that, additively, audited and without touching cancelled ones.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000003120a'
const PROJ_A = '00000000-0000-4000-8000-00000003220a'
const OWNER_A = 'link02-owner-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, $2, $3, $4, ARRAY[]::text[], $5::jsonb)`,
    [
      project,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(properties),
    ],
  )
  return rows[0]
}

const createExperiment = (client: Client, project: string, title: string) =>
  createRecord(client, project, 'experiment', title)

const sampleWithVolume = (client: Client, quantity: number) =>
  createRecord(client, PROJ_A, 'sample', 'Link sample', {
    quantity,
    quantityUnit: 'mL',
  })

async function experimentLinks(experimentId: string) {
  const { rows } = await migrator.query(
    `SELECT target_identifier, target_record_id, link_type, link_metadata
       FROM api.record_links
      WHERE source_record_id = $1 AND target_kind = 'sample'`,
    [experimentId],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'LINK02 Owner', 'link02-owner-a@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'link02-a', 'LINK02 A');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'link02-a', 'LINK02 A', '${OWNER_A}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

const BACKFILL = readFileSync(
  resolve(__dirname, '../../drizzle/0531_backfill_reservation_links.sql'),
  'utf8',
)

/** Run the backfill as the migrator, the way a migration run does. */
async function runBackfill() {
  for (const statement of BACKFILL.split('--> statement-breakpoint')) {
    if (statement.trim()) await migrator.query(statement)
  }
}

async function insertLegacyReservation(
  experimentId: string,
  sampleId: string,
  state: 'active' | 'cancelled',
) {
  await migrator.query(
    `INSERT INTO api.sample_reservations
       (workspace_id, sample_record_id, experiment_record_id, quantity, unit,
        planned, state, created_by_user_id)
     VALUES ($1, $2, $3, 1, 'mL', true, $4, $5)`,
    [WS_A, sampleId, experimentId, state, OWNER_A],
  )
}

describe('LINK-02: an experiment links the samples reserved for it', () => {
  it('links the experiment when a sample is reserved for it', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createExperiment(owner, PROJ_A, 'Reserve')
    const sample = await sampleWithVolume(owner, 10)
    const { rows } = await owner.query(
      `SELECT * FROM api.create_sample_reservation($1, $2, 2, 'mL', true, null)`,
      [sample.id, experiment.id],
    )
    const links = await experimentLinks(experiment.id)
    expect(links).toHaveLength(1)
    expect(links[0].target_identifier).toBe(sample.identifier)
    expect(links[0].target_record_id).toBe(sample.id)
    expect(links[0].link_type).toBe('sample')
    expect(links[0].link_metadata.origin).toBe('create_sample_reservation')
    expect(links[0].link_metadata.reservationId).toBe(rows[0].id)
  })

  it('keeps one link however many times the sample is reserved and withdrawn for the experiment', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createExperiment(owner, PROJ_A, 'Twice')
    const sample = await sampleWithVolume(owner, 10)
    for (let i = 0; i < 2; i++) {
      await owner.query(
        `SELECT * FROM api.create_sample_reservation($1, $2, 1, 'mL', true, null)`,
        [sample.id, experiment.id],
      )
    }
    await owner.query(`SELECT api.withdraw_sample($1, 1, $2, $3)`, [
      sample.id,
      sample.metadata_version,
      experiment.id,
    ])
    expect(await experimentLinks(experiment.id)).toHaveLength(1)
  })

  it('refuses the reservation, and writes no link, when it is above the free balance', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createExperiment(owner, PROJ_A, 'Too much')
    const sample = await sampleWithVolume(owner, 1)
    await expect(
      owner.query(
        `SELECT * FROM api.create_sample_reservation($1, $2, 5, 'mL', true, null)`,
        [sample.id, experiment.id],
      ),
    ).rejects.toThrow(/insufficient free quantity/)
    expect(await experimentLinks(experiment.id)).toHaveLength(0)
  })
})

describe('LINK-02 backfill (0531)', () => {
  it('links a past live reservation once, audited and tagged, and leaves a cancelled one alone', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const live = await createExperiment(owner, PROJ_A, 'Backfill live')
    const cancelled = await createExperiment(
      owner,
      PROJ_A,
      'Backfill cancelled',
    )
    const sample = await sampleWithVolume(owner, 10)
    await insertLegacyReservation(live.id, sample.id, 'active')
    await insertLegacyReservation(cancelled.id, sample.id, 'cancelled')
    expect(await experimentLinks(live.id)).toHaveLength(0)

    await runBackfill()

    const links = await experimentLinks(live.id)
    expect(links).toHaveLength(1)
    expect(links[0].target_identifier).toBe(sample.identifier)
    expect(links[0].link_metadata.backfill).toBe(
      '0531_backfill_reservation_links',
    )
    expect(await experimentLinks(cancelled.id)).toHaveLength(0)

    const { rows: events } = await migrator.query(
      `SELECT actor_user_id FROM api.change_events
        WHERE entity_type = 'record_link' AND record_id = $1
          AND payload ->> 'backfill' = '0531_backfill_reservation_links'`,
      [live.id],
    )
    expect(events).toHaveLength(1)
    expect(events[0].actor_user_id).toBe(OWNER_A)
  })

  it('is additive and repeatable: a hand-made link is kept and a second run adds nothing', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createExperiment(owner, PROJ_A, 'Backfill twice')
    const sample = await sampleWithVolume(owner, 10)
    await owner.query(
      `SELECT api.create_record_link($1, 'sample', $2, 'sample', $3, 'by hand')`,
      [experiment.id, sample.identifier, sample.id],
    )
    await insertLegacyReservation(experiment.id, sample.id, 'active')

    await runBackfill()
    await runBackfill()

    const links = await experimentLinks(experiment.id)
    expect(links).toHaveLength(1)
    expect(links[0].link_metadata.backfill).toBeUndefined()
  })
})
