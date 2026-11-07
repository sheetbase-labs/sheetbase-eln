/**
 * Result quality (migrations 0080-0083): result limits with pass / alert / fail
 * verdicts, the incident log starter model, legal holds and retention rules.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f801'
const OTHER_WS = '00000000-0000-4000-8000-00000000f802'
const PROJECT = '00000000-0000-4000-8000-00000000f811'
const PROJECT_B = '00000000-0000-4000-8000-00000000f813'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000f812'
const OWNER = 'rq-owner'
const MEMBER = 'rq-member'
const VIEWER = 'rq-viewer'
const STRANGER = 'rq-stranger'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let member: Client
let viewer: Client
let stranger: Client

async function actor(userId: string, workspace = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

const ASSAY_FIELDS = [
  { field_name: 'purity', label: 'Purity', logical_type: 'decimal' },
  { field_name: 'titre', label: 'Titre', logical_type: 'integer' },
  { field_name: 'operator', label: 'Operator' },
]

const INCIDENT_FIELDS = [
  {
    field_name: 'severity',
    label: 'Severity',
    logical_type: 'category',
    show_in_list: true,
    options: [
      { key: 'minor', label: 'Minor' },
      { key: 'major', label: 'Major' },
    ],
  },
  { field_name: 'occurred_on', label: 'Occurred on', logical_type: 'date' },
  { field_name: 'description', label: 'What happened' },
]

async function record(
  kind: string,
  title: string,
  custom: Record<string, unknown>,
  project = PROJECT,
  client: Client = owner,
) {
  const { rows } = await client.query(
    `select * from api.create_model_record($1,$2,$3,'draft','{}','{}'::jsonb,$4::jsonb)`,
    [project, kind, title, JSON.stringify(custom)],
  )
  return rows[0] as { id: string; identifier: string }
}

async function verdicts(kind = 'assay') {
  const { rows } = await owner.query(
    `select identifier, field_name, verdict from api.record_spec_results
      where kind = $1 order by identifier, field_name`,
    [kind],
  )
  return rows as { identifier: string; field_name: string; verdict: string }[]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','rq-owner@test.invalid',true),
      ('${MEMBER}','Member','rq-member@test.invalid',true),
      ('${VIEWER}','Viewer','rq-viewer@test.invalid',true),
      ('${STRANGER}','Stranger','rq-stranger@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','quality','Quality'),
      ('${OTHER_WS}','quality-other','Quality other');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${MEMBER}','member'),
      ('${WS}','${VIEWER}','viewer'),
      ('${OTHER_WS}','${STRANGER}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJECT}','${WS}','rq','Quality','${OWNER}'),
      ('${PROJECT_B}','${WS}','rqb','Quality B','${OWNER}'),
      ('${OTHER_PROJECT}','${OTHER_WS}','rqo','Quality other','${STRANGER}')`)
  owner = await actor(OWNER)
  member = await actor(MEMBER)
  viewer = await actor(VIEWER)
  stranger = await actor(STRANGER, OTHER_WS)
  await owner.query(
    `select api.create_starter_model('assay','Assay','ASY',null,$1::jsonb)`,
    [JSON.stringify(ASSAY_FIELDS)],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('result limits', () => {
  it('judge nothing until the model has the feature', async () => {
    await owner.query(
      `select * from api.set_field_spec_limits('assay','purity',90,100,95,null,null)`,
    )
    await record('assay', 'Batch 1', { purity: 99 })
    expect(await verdicts()).toEqual([])
    await owner.query(
      `select api.set_model_capability('assay','result_limits',true)`,
    )
    expect((await verdicts()).map((v) => v.verdict)).toEqual(['pass'])
  })

  it('call a value pass, alert or fail from the limits and the alert band', async () => {
    await record('assay', 'Batch 2', { purity: 93 })
    await record('assay', 'Batch 3', { purity: 89.9 })
    await record('assay', 'Batch 4', { purity: 101.5 })
    await record('assay', 'Batch 5', { purity: 90 })
    await record('assay', 'Batch 7', { operator: 'Sam' })
    expect(await verdicts()).toEqual([
      { identifier: 'ASY-0001', field_name: 'purity', verdict: 'pass' },
      { identifier: 'ASY-0002', field_name: 'purity', verdict: 'alert' },
      { identifier: 'ASY-0003', field_name: 'purity', verdict: 'fail' },
      { identifier: 'ASY-0004', field_name: 'purity', verdict: 'fail' },
      { identifier: 'ASY-0005', field_name: 'purity', verdict: 'alert' },
    ])
  })

  it('re-judge every record when a limit changes, and stop when cleared', async () => {
    await owner.query(
      `select * from api.set_field_spec_limits('assay','purity',89,102,null,null,'looser')`,
    )
    expect((await verdicts()).map((v) => v.verdict)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ])
    await owner.query(
      `select * from api.set_field_spec_limits('assay','purity',null,null,null,null,null)`,
    )
    expect(await verdicts()).toEqual([])
  })

  it('accept a one-sided limit and refuse nonsense', async () => {
    await owner.query(
      `select * from api.set_field_spec_limits('assay','titre',1000,null,null,null,null)`,
    )
    await record('assay', 'Batch 8', { titre: 500 })
    expect((await verdicts()).map((v) => v.verdict)).toEqual(['fail'])
    await expect(
      owner.query(
        `select * from api.set_field_spec_limits('assay','titre',10,5,null,null,null)`,
      ),
    ).rejects.toThrow(/chk_field_spec_limits_order/)
    await expect(
      owner.query(
        `select * from api.set_field_spec_limits('assay','operator',1,2,null,null,null)`,
      ),
    ).rejects.toThrow(/number field/)
    await expect(
      owner.query(
        `select * from api.set_field_spec_limits('assay','titre',null,null,1,2,null)`,
      ),
    ).rejects.toThrow(/lowest or highest/)
  })

  it('need schema rights to change and workspace membership to read', async () => {
    await expectDenied(
      viewer.query(
        `select * from api.set_field_spec_limits('assay','titre',1,2,null,null,null)`,
      ),
      '42501',
    )
    await expectDenied(
      member.query(
        `select api.set_model_capability('assay','result_limits',false)`,
      ),
      '42501',
    )
    const seen = await stranger.query(`select * from api.record_spec_results`)
    expect(seen.rows).toEqual([])
    const limits = await stranger.query(`select * from api.field_spec_limits`)
    expect(limits.rows).toEqual([])
  })
})

describe('the incident log', () => {
  it('sets up a starter model with choices and gives it the Incident log feature', async () => {
    await owner.query(
      `select * from api.create_starter_model('incident','Incident','INC','Things that went wrong.',$1::jsonb,true)`,
      [JSON.stringify(INCIDENT_FIELDS)],
    )
    const logs = await owner.query(
      `select model_key from api.model_capabilities where capability = 'incident_log' order by 1`,
    )
    expect(logs.rows).toEqual([{ model_key: 'incident' }])
    const options = await migrator.query(
      `select o.key from api.model_field_options o
         join api.record_field_definitions d on d.id = o.definition_id
        where d.workspace_id = $1 and d.kind = 'incident' order by o.display_order`,
      [WS],
    )
    expect(options.rows.map((r) => r.key)).toEqual(['minor', 'major'])
    const made = await record('incident', 'Freezer alarm', {
      severity: 'major',
      occurred_on: '2026-11-01',
      description: 'Door left open',
    })
    expect(made.identifier).toBe('INC-0001')
  })

  it('can be ticked and unticked on any model, by someone who may edit models', async () => {
    await owner.query(
      `select api.set_model_capability('assay','incident_log',true)`,
    )
    await owner.query(
      `select api.set_model_capability('assay','incident_log',false)`,
    )
    const logs = await owner.query(
      `select model_key from api.model_capabilities where capability = 'incident_log'`,
    )
    expect(logs.rows).toEqual([{ model_key: 'incident' }])
    await expectDenied(
      viewer.query(
        `select api.set_model_capability('assay','incident_log',true)`,
      ),
      '42501',
    )
  })

  it('keeps one lab out of another', async () => {
    const seen = await stranger.query(`select * from api.model_capabilities`)
    expect(seen.rows).toEqual([])
  })
})

describe('legal holds', () => {
  let held: { id: string }
  let free: { id: string }
  let otherProject: { id: string }

  beforeAll(async () => {
    held = await record('assay', 'Held batch', { purity: 95 })
    free = await record('assay', 'Free batch', { purity: 95 })
    otherProject = await record('assay', 'Other project batch', {}, PROJECT_B)
  })

  it('freeze the records they cover and nothing else', async () => {
    await owner.query(
      `select * from api.create_legal_hold('Case 12','Dispute with a supplier',null,null,$1)`,
      [[held.id]],
    )
    await expectDenied(
      owner.query(`select api.archive_record($1, 1)`, [held.id]),
      'SB301',
    )
    await expectDenied(
      migrator.query(`delete from api.records where id = $1`, [held.id]),
      'SB301',
    )
    expect(
      (await owner.query(`select api.is_record_on_hold($1) as held`, [held.id]))
        .rows[0].held,
    ).toBe(true)
    expect(
      (await owner.query(`select api.is_record_on_hold($1) as held`, [free.id]))
        .rows[0].held,
    ).toBe(false)
    await owner.query(`select api.archive_record($1, 1)`, [free.id])
  })

  it('can cover a whole project, or a model within a project', async () => {
    const hold = (
      await owner.query(
        `select * from api.create_legal_hold('Project B','All of B',$1,null,'{}')`,
        [PROJECT_B],
      )
    ).rows[0]
    await expectDenied(
      owner.query(`select api.archive_record($1, 1)`, [otherProject.id]),
      'SB301',
    )
    await expectDenied(
      owner.query(`select api.archive_project($1)`, [PROJECT_B]),
      'SB301',
    )
    const counts = (await owner.query(`select * from api.legal_hold_counts()`))
      .rows as { hold_id: string; records: string }[]
    expect(counts.find((c) => c.hold_id === hold.id)?.records).toBe('1')
    await owner.query(`select * from api.release_legal_hold($1,'Settled')`, [
      hold.id,
    ])
    await owner.query(`select api.archive_record($1, 1)`, [otherProject.id])
  })

  it('stay in force when the lab switches the feature off', async () => {
    await owner.query(
      `select api.set_model_capability('assay','legal_hold',false)`,
    )
    await expectDenied(
      owner.query(`select api.archive_record($1, 1)`, [held.id]),
      'SB301',
    )
  })

  it('are readable only by people who can see general settings, and managed by those who manage them', async () => {
    const mine = await owner.query(`select name from api.legal_holds`)
    expect(mine.rows.map((r) => r.name)).toContain('Case 12')
    expect(
      (await viewer.query(`select name from api.legal_holds`)).rows,
    ).toEqual([])
    await expectDenied(
      member.query(
        `select * from api.create_legal_hold('x',null,null,'assay','{}')`,
      ),
      'SB056',
    )
    expect(
      (await stranger.query(`select * from api.legal_holds`)).rows,
    ).toEqual([])
    await expect(
      owner.query(
        `select * from api.create_legal_hold('Nothing',null,null,null,'{}')`,
      ),
    ).rejects.toThrow(/what the hold covers/)
  })

  it('lift when released, and then the record can go', async () => {
    const hold = (
      await owner.query(`select id from api.legal_holds where name = 'Case 12'`)
    ).rows[0]
    await owner.query(`select * from api.release_legal_hold($1,'Closed')`, [
      hold.id,
    ])
    await expect(
      owner.query(`select * from api.release_legal_hold($1,'again')`, [
        hold.id,
      ]),
    ).rejects.toThrow(/already released/)
    await owner.query(`select api.archive_record($1, 1)`, [held.id])
  })
})

describe('retention rules', () => {
  it('list records past their keep time and archive them, leaving held ones alone', async () => {
    const old = await record('incident', 'Old incident', { severity: 'minor' })
    const heldOld = await record('incident', 'Old held incident', {})
    const recent = await record('incident', 'Recent incident', {})
    await migrator.query(
      `alter table api.records disable trigger set_updated_at`,
    )
    await migrator.query(
      `update api.records set updated_at = now() - interval '30 months'
        where id in ($1,$2)`,
      [old.id, heldOld.id],
    )
    await migrator.query(
      `alter table api.records enable trigger set_updated_at`,
    )
    await owner.query(
      `select * from api.create_legal_hold('Hold old',null,null,null,$1)`,
      [[heldOld.id]],
    )
    await owner.query(
      `select * from api.set_retention_rule('incident',24,'Quality procedure')`,
    )
    expect(
      (await owner.query(`select * from api.retention_due()`)).rows,
    ).toEqual([])
    await owner.query(
      `select api.set_model_capability('incident','retention',true)`,
    )
    const due = (await owner.query(`select * from api.retention_due()`)).rows
    expect(due.map((d) => d.title)).toEqual(['Old incident'])
    expect(
      (await owner.query(`select * from api.retention_due('assay')`)).rows,
    ).toEqual([])
    const archived = (await owner.query(`select api.apply_retention() as n`))
      .rows[0].n
    expect(archived).toBe(1)
    const { rows } = await migrator.query(
      `select title, archived_at is not null as archived from api.records
        where id in ($1,$2,$3) order by title`,
      [old.id, heldOld.id, recent.id],
    )
    expect(rows).toEqual([
      { title: 'Old held incident', archived: false },
      { title: 'Old incident', archived: true },
      { title: 'Recent incident', archived: false },
    ])
    expect(
      (await owner.query(`select api.apply_retention() as n`)).rows[0].n,
    ).toBe(0)
  })

  it('validate the rule, and can be removed', async () => {
    await expect(
      owner.query(`select * from api.set_retention_rule('incident',0,null)`),
    ).rejects.toThrow(/chk_retention_rules_months/)
    await expect(
      owner.query(`select * from api.set_retention_rule('nope',12,null)`),
    ).rejects.toThrow(/model not found/)
    await owner.query(
      `select * from api.set_retention_rule('incident',null,null)`,
    )
    expect(
      (await owner.query(`select * from api.retention_rules`)).rows,
    ).toEqual([])
  })

  it('are an administrator job', async () => {
    await expectDenied(
      member.query(`select * from api.set_retention_rule('incident',12,null)`),
      'SB056',
    )
    await expectDenied(member.query(`select api.apply_retention()`), 'SB056')
    await expectDenied(
      member.query(`select * from api.retention_due()`),
      'SB056',
    )
    expect(
      (await member.query(`select * from api.retention_rules`)).rows,
    ).toEqual([])
  })
})
