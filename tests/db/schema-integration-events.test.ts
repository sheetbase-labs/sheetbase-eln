/**
 * Models, sheets and templates on the change feed and in steward SQL: rules
 * and link rules write events however they are changed, field choices and
 * published versions carry the payload their webhook names pick on, and the
 * steward views exist for a workspace.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '#/lib/webhook-events'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000cf00'
const OWNER = 'schev-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'schev','Schema events')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function owner(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, OWNER, WS)
  return client
}

const events = async (entityType: string) =>
  (
    await migrator.query<{
      entity_uuid: string
      operation: string
      payload: Record<string, unknown>
    }>(
      `select entity_uuid,operation,payload from api.change_events
        where workspace_id=$1 and entity_type=$2 order by sequence`,
      [WS, entityType],
    )
  ).rows

const named = (entityType: string, operation: string, payload: object) =>
  mapEventType(entityType, operation, payload as Record<string, unknown>)

describe('models, sheets and templates on the change feed', () => {
  let field: string

  it('writes a choice added to a category field', async () => {
    const db = await owner()
    const created = await db.query<{ id: string }>(
      `select id from api.create_and_activate_model_field($1,'sample','state','State','category',true,null,'{}'::jsonb,
         '[{"key":"frozen","label":"Frozen"}]'::jsonb)`,
      [WS],
    )
    field = created.rows[0]!.id
    const option = await db.query<{ id: string }>(
      `select id from api.create_model_field_option($1,'thawed','Thawed',2)`,
      [field],
    )
    await db.query(`select api.retire_model_field_option($1)`, [
      option.rows[0]!.id,
    ])
    const seen = await events('model_field_option')
    const mine = seen.filter((row) => row.entity_uuid === option.rows[0]!.id)
    expect(mine.map((row) => row.operation)).toEqual(['create', 'update'])
    expect(named('model_field_option', 'create', mine[0]!.payload)).toBe(
      'model.field.option.created',
    )
    expect(named('model_field_option', 'update', mine[1]!.payload)).toBe(
      'model.field.option.updated',
    )
  })

  it('writes a rule added, changed and removed', async () => {
    const db = await owner()
    const rule = await db.query<{ id: string }>(
      `select id from api.create_model_rule($1,'sample','Needs a state',array['state'],'{}'::jsonb,'warn','Give the state')`,
      [WS],
    )
    const id = rule.rows[0]!.id
    await db.query(
      `select api.update_model_rule($1,'{"message":"Say how it is kept"}'::jsonb)`,
      [id],
    )
    await db.query(`select api.remove_model_rule($1)`, [id])
    const seen = (await events('model_rule')).filter(
      (row) => row.entity_uuid === id,
    )
    expect(seen.map((row) => row.operation)).toEqual([
      'create',
      'update',
      'delete',
    ])
    expect(seen[0]!.payload).toMatchObject({
      modelKey: 'sample',
      name: 'Needs a state',
      effect: 'warn',
      fieldKeys: ['state'],
    })
    expect(seen[1]!.payload.changes).toMatchObject({
      message: { from: 'Give the state', to: 'Say how it is kept' },
    })
    expect(
      seen.map((row) => named('model_rule', row.operation, row.payload)),
    ).toEqual([
      'model.rule.created',
      'model.rule.updated',
      'model.rule.removed',
    ])
  })

  it('writes a link rule set and removed', async () => {
    const db = await owner()
    const rule = await db.query<{ id: string }>(
      `select id from api.configure_model_relationship_rule($1,'sample','sample','sample',0,1,'Parent sample')`,
      [WS],
    )
    const id = rule.rows[0]!.id
    await db.query(`select api.remove_model_relationship_rule($1)`, [id])
    const seen = (await events('model_relationship_rule')).filter(
      (row) => row.entity_uuid === id,
    )
    expect(seen.map((row) => row.operation)).toEqual(['update', 'delete'])
    expect(seen[0]!.payload).toMatchObject({
      sourceModelKey: 'sample',
      linkType: 'sample',
      maxLinks: 1,
    })
    expect(
      seen.map((row) =>
        named('model_relationship_rule', row.operation, row.payload),
      ),
    ).toEqual(['model.link_rule.set', 'model.link_rule.removed'])
  })

  it('names a published sheet definition version', async () => {
    const db = await owner()
    const created = await db.query<{
      result: { version: { id: string; revision: number } }
    }>(
      `select api.create_sheet_definition($1,'growth','Growth',null,$2::jsonb) as result`,
      [WS, JSON.stringify(validSheetDefinitionConfiguration())],
    )
    const version = created.rows[0]!.result.version
    await db.query(`select api.publish_sheet_definition_version($1,$2)`, [
      version.id,
      version.revision,
    ])
    const seen = (await events('sheet_definition_version')).filter(
      (row) => row.entity_uuid === version.id,
    )
    expect(seen[0]!.operation).toBe('create')
    const published = seen.find((row) => row.payload.lifecycle === 'published')
    expect(
      named('sheet_definition_version', 'update', published!.payload),
    ).toBe('sheet.definition.version.published')
    expect(
      named('sheet_definition_version', 'update', { lifecycle: 'draft' }),
    ).toBeNull()
  })

  it('gives stewards the record type, sheet and template views', async () => {
    await migrator.query('select internal.regenerate_reporting_views($1)', [WS])
    const { rows } = await migrator.query<{ view_key: string }>(
      `select view_key from internal.reporting_fixed_view_names where workspace_id=$1`,
      [WS],
    )
    expect(rows.map((row) => row.view_key)).toEqual(
      expect.arrayContaining([
        'record_types',
        'record_type_fields',
        'record_type_rules',
        'record_type_links',
        'record_type_versions',
        'sheet_definitions',
        'sheets',
        'notebook_templates',
      ]),
    )
  })
})
