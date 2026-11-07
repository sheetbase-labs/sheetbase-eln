/**
 * Registry, incident log, result limits, legal hold and retention moved onto the
 * Features list (migration model_features_move). The old flags are written into
 * a database built up to the step before, the migration is applied, and every
 * value has to come out as a feature row.
 */
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyMigrations } from '../../scripts/lib/migrations.mjs'

const MIGRATION = 'model_features_move'
const DATABASE = 'sheetbase_features_move_test'
const WS_ON = '00000000-0000-4000-8000-00000000fe01'
const WS_OFF = '00000000-0000-4000-8000-00000000fe02'
const OWNER = 'features-owner'
const AUTHOR = 'features-author'

function urlFor(base: string | undefined, database: string): string {
  if (!base) throw new Error('database url is not set')
  const url = new URL(base)
  url.pathname = `/${database}`
  return url.toString()
}

let migrator: Client
let before: string
let admin: Client

beforeAll(async () => {
  admin = new Client({
    connectionString: urlFor(process.env.DATABASE_URL, 'postgres'),
  })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${DATABASE} OWNER migrator`)

  // The history as it stood before the migration under test.
  before = await mkdtemp(join(tmpdir(), 'features-move-'))
  await cp('drizzle', before, { recursive: true })
  for (const name of await readdir(before)) {
    if (name.endsWith(`_${MIGRATION}.sql`)) await rm(join(before, name))
  }
  migrator = new Client({
    connectionString: urlFor(process.env.MIGRATION_DATABASE_URL, DATABASE),
  })
  await migrator.connect()
  await applyMigrations(migrator, before)

  for (const id of [OWNER, AUTHOR]) {
    await migrator.query(
      `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES ($1, $1, $1 || '@sheetbase.test', true)`,
      [id],
    )
  }
  for (const [id, slug] of [
    [WS_ON, 'features-on'],
    [WS_OFF, 'features-off'],
  ]) {
    await migrator.query(
      `INSERT INTO api.workspaces (id, slug, name) VALUES ($1, $2, $2)`,
      [id, slug],
    )
  }
  // One lab with the two lab-wide switches on, one with them off.
  await migrator.query(
    `INSERT INTO api.workspace_settings (workspace_id, spec_limits_enabled, retention_enabled, created_by_user_id)
     VALUES ($1, true, true, $3), ($2, false, false, $3)`,
    [WS_ON, WS_OFF, OWNER],
  )
  for (const [ws, key, registry] of [
    [WS_ON, 'cell_line', true],
    [WS_ON, 'assay', false],
    [WS_ON, 'incident', false],
    [WS_OFF, 'assay', false],
    [WS_OFF, 'plasmid', true],
    [WS_OFF, 'sop', false],
  ] as const) {
    await migrator.query(
      `INSERT INTO api.record_models
         (workspace_id, key, name, identifier_prefix, lifecycle, created_by_user_id, updated_by_user_id,
          is_registry, registry_key_fields, registry_sequence_field, registry_structure_field, registry_lot_kind)
       VALUES ($1, $2, $2, upper(left($2, 3)), 'published', $3, $4, $5, $6, $7, $8, $9)`,
      [
        ws,
        key,
        AUTHOR,
        key === 'cell_line' ? OWNER : null,
        registry,
        registry && key === 'cell_line' ? ['name', 'species'] : [],
        registry && key === 'plasmid' ? 'sequence' : null,
        registry && key === 'cell_line' ? 'structure' : null,
        registry && key === 'cell_line' ? 'assay' : null,
      ],
    )
  }
  await migrator.query(
    `INSERT INTO api.model_incident_logs (workspace_id, model_key, created_by_user_id)
     VALUES ($1, 'incident', $2)`,
    [WS_ON, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.field_spec_limits (workspace_id, kind, field_name, lower_limit, created_by_user_id)
     VALUES ($1, 'assay', 'purity', 90, $2), ($3, 'assay', 'purity', 90, $2)`,
    [WS_ON, OWNER, WS_OFF],
  )
  // A rule and a hold set up while the lab-wide switch was off stay in force:
  // the database never looked at the switch for either.
  await migrator.query(
    `INSERT INTO api.retention_rules (workspace_id, kind, keep_months, created_by_user_id, updated_by_user_id)
     VALUES ($1, 'sop', 60, $2, $2)`,
    [WS_OFF, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.legal_holds (workspace_id, name, kind, created_by_user_id)
     VALUES ($1, 'Dispute', 'plasmid', $2)`,
    [WS_OFF, OWNER],
  )
  // Data with an archived project in it, as a long-lived lab has.
  await migrator.query(
    `INSERT INTO api.projects (workspace_id, key, title, archived_at)
     VALUES ($1, 'old', 'Closed project', now())`,
    [WS_ON],
  )

  await applyMigrations(migrator, 'drizzle')
}, 120_000)

afterAll(async () => {
  await migrator?.end()
  await admin?.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`)
  await admin?.end()
  await rm(before, { recursive: true, force: true })
})

async function features(ws: string): Promise<string[]> {
  const { rows } = await migrator.query<{ f: string }>(
    `SELECT model_key || ':' || capability AS f FROM api.model_capabilities
      WHERE workspace_id = $1 ORDER BY 1`,
    [ws],
  )
  return rows.map((r) => r.f)
}

describe('carrying the old flags onto the Features list', () => {
  it('turns each registry into a registry feature with its settings', async () => {
    const { rows } = await migrator.query(
      `SELECT model_key, settings, created_by_user_id FROM api.model_capabilities
        WHERE capability = 'registry' ORDER BY model_key`,
    )
    expect(rows).toEqual([
      {
        model_key: 'cell_line',
        settings: {
          keyFields: ['name', 'species'],
          sequenceField: null,
          structureField: 'structure',
          lotKind: 'assay',
        },
        created_by_user_id: OWNER,
      },
      {
        model_key: 'plasmid',
        settings: {
          keyFields: [],
          sequenceField: 'sequence',
          structureField: null,
          lotKind: null,
        },
        // Created by someone, never the owner: the model's own author is used.
        created_by_user_id: AUTHOR,
      },
    ])
  })

  it('turns a ticked incident log into the Incident log feature', async () => {
    const { rows } = await migrator.query(
      `SELECT workspace_id, model_key, created_by_user_id FROM api.model_capabilities
        WHERE capability = 'incident_log'`,
    )
    expect(rows).toEqual([
      { workspace_id: WS_ON, model_key: 'incident', created_by_user_id: OWNER },
    ])
  })

  it('gives every model of a lab with the switches on the result limits, retention and hold features', async () => {
    expect(await features(WS_ON)).toEqual([
      'assay:legal_hold',
      'assay:result_limits',
      'assay:retention',
      'cell_line:legal_hold',
      'cell_line:registry',
      'cell_line:result_limits',
      'cell_line:retention',
      'incident:incident_log',
      'incident:legal_hold',
      'incident:result_limits',
      'incident:retention',
    ])
  })

  it('leaves a lab with the switches off without them, except where a rule or hold was already in force', async () => {
    expect(await features(WS_OFF)).toEqual([
      'plasmid:legal_hold',
      'plasmid:registry',
      'sop:retention',
    ])
    const { rows } = await migrator.query(
      `SELECT count(*)::int AS n FROM api.record_spec_results WHERE workspace_id = $1`,
      [WS_OFF],
    )
    expect(rows[0].n).toBe(0)
  })

  it('keeps every limit and rule as it was', async () => {
    const limits = await migrator.query(
      `SELECT count(*)::int AS n FROM api.field_spec_limits`,
    )
    expect(limits.rows[0].n).toBe(2)
    const rules = await migrator.query(
      `SELECT keep_months FROM api.retention_rules WHERE workspace_id = $1`,
      [WS_OFF],
    )
    expect(rules.rows).toEqual([{ keep_months: 60 }])
  })

  it('removes the old flags', async () => {
    const columns = await migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'api'
          AND ((table_name = 'record_models' AND column_name LIKE '%registry%')
            OR (table_name = 'workspace_settings'
                AND column_name IN ('spec_limits_enabled', 'retention_enabled')))`,
    )
    expect(columns.rows).toEqual([])
    const table = await migrator.query(
      `SELECT to_regclass('api.model_incident_logs') AS t`,
    )
    expect(table.rows[0].t).toBeNull()
  })

  it('follows a renamed model key and goes with a deleted model', async () => {
    await migrator.query(
      `UPDATE api.record_models SET key = 'cell_line_v2' WHERE workspace_id = $1 AND key = 'cell_line'`,
      [WS_ON],
    )
    expect(await features(WS_ON)).toContain('cell_line_v2:registry')
    await migrator.query(
      `DELETE FROM api.record_models WHERE workspace_id = $1 AND key = 'cell_line_v2'`,
      [WS_ON],
    )
    expect(await features(WS_ON)).not.toContain('cell_line_v2:registry')
  })
})
