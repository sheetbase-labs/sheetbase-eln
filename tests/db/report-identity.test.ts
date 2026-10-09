/** Post-migration contract for the canonical notebook-backed Report identity. */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-0000000059aa'
const WS_B = '00000000-0000-4000-8000-0000000059bb'
const PROJECT_A = '00000000-0000-4000-8000-0000000059a1'
const OWNER_A = 'report-identity-owner-a'
const OWNER_B = 'report-identity-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function createReport(client: Client, title: string) {
  const { rows } = await client.query(
    `SELECT * FROM api.create_report_definition($1,$2,NULL,$3)`,
    [WS_A, title, PROJECT_A],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
       ($1,'Report owner A','report-a@sheetbase.test',true),
       ($2,'Report owner B','report-b@sheetbase.test',true)`,
    [OWNER_A, OWNER_B],
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES
       ($1,'report-identity-a','Report identity A'),
       ($2,'report-identity-b','Report identity B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($3,$4,'owner')`,
    [WS_A, OWNER_A, WS_B, OWNER_B],
  )
  await migrator.query(
    `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id) VALUES
       ($1,$2,'RPTA','Report project A',$3)`,
    [PROJECT_A, WS_A, OWNER_A],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('REPORT-001 canonical Report identity', () => {
  it('atomically creates exactly one Report record and its one-to-one extension', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const report = await createReport(owner, 'Canonical report')
    const { rows } = await migrator.query(
      `SELECT d.id,d.record_id,r.kind,r.identifier,r.title,r.status,r.project_id,
              count(*) OVER ()::int AS matches
         FROM api.report_definitions d JOIN api.records r ON r.id=d.record_id
        WHERE d.id=$1`,
      [report.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'report',
      identifier: report.document_identifier,
      title: 'Canonical report',
      status: 'draft',
      project_id: PROJECT_A,
      matches: 1,
    })
    expect(rows[0].record_id).toBe(report.record_id)
  })

  it('updates canonical title and status while keeping identity mirrors synchronised', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const report = await createReport(owner, 'Before update')
    await owner.query(`SELECT api.update_report_definition($1,$2,$3,NULL,$4)`, [
      WS_A,
      report.id,
      'After update',
      'in_review',
    ])
    const { rows } = await migrator.query(
      `SELECT r.title canonical_title,d.title mirror_title,r.status canonical_status,
              d.status mirror_status,r.project_id canonical_project,d.project_id mirror_project
         FROM api.report_definitions d JOIN api.records r ON r.id=d.record_id WHERE d.id=$1`,
      [report.id],
    )
    expect(rows[0]).toEqual({
      canonical_title: 'After update',
      mirror_title: 'After update',
      canonical_status: 'in_review',
      mirror_status: 'in_review',
      canonical_project: PROJECT_A,
      mirror_project: PROJECT_A,
    })

    await owner.query(
      `UPDATE api.records SET title='Canonical edit' WHERE id=$1`,
      [report.record_id],
    )
    expect(
      (
        await migrator.query(
          `SELECT title FROM api.report_definitions WHERE id=$1`,
          [report.id],
        )
      ).rows[0].title,
    ).toBe('Canonical edit')
  })

  it('rejects a second extension and direct mismatched extension writes', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const report = await createReport(owner, 'Guarded report')
    const values = [
      WS_A,
      PROJECT_A,
      report.record_id,
      report.document_identifier,
      OWNER_A,
    ]
    await expect(
      migrator.query(
        `INSERT INTO api.report_definitions
           (workspace_id,project_id,record_id,title,document_identifier,status,created_by_user_id)
         VALUES ($1,$2,$3,'Guarded report',$4,'draft',$5)`,
        values,
      ),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      migrator.query(
        `UPDATE api.report_definitions SET title='Mismatched' WHERE id=$1`,
        [report.id],
      ),
    ).rejects.toMatchObject({ code: 'SB074' })
  })

  it('rejects Report Blocks but accepts ordered Report Sections', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const report = await createReport(owner, 'Structured report')
    await expect(
      migrator.query(
        `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
         VALUES($1,'rich_text','{}',0,$2)`,
        [report.record_id, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: 'SB074' })
    const first = await owner.query(
      `SELECT * FROM api.add_report_section($1,$2,'Second',NULL,'text','free_text')`,
      [WS_A, report.id],
    )
    const second = await owner.query(
      `SELECT * FROM api.add_report_section($1,$2,'First',NULL,'text','free_text')`,
      [WS_A, report.id],
    )
    expect([first.rows[0].position, second.rows[0].position]).toEqual([0, 1])
  })

  it('includes ordered reportStructure sections and Report custom fields in revision envelopes', async () => {
    const owner = await actor(OWNER_A, WS_A)
    await owner.query(
      `SELECT api.create_and_activate_model_field($1,'report','report_code','Report code','text',true,NULL,'{}','[]')`,
      [WS_A],
    )
    const report = await createReport(owner, 'Envelope report')
    await owner.query(
      `UPDATE api.records SET custom_fields='{"report_code":"R-59"}' WHERE id=$1`,
      [report.record_id],
    )
    await owner.query(
      `SELECT api.add_report_section($1,$2,'First',NULL,'text','free_text')`,
      [WS_A, report.id],
    )
    await owner.query(
      `SELECT api.add_report_section($1,$2,'Second',NULL,'text','free_text')`,
      [WS_A, report.id],
    )
    const { rows } = await migrator.query(
      `SELECT internal.build_revision_envelope($1) envelope`,
      [report.record_id],
    )
    expect(rows[0].envelope.record.customFields).toEqual({
      report_code: 'R-59',
    })
    expect(
      rows[0].envelope.reportStructure.sections.map(
        (section: any) => section.title,
      ),
    ).toEqual(['First', 'Second'])
  })

  it('rejects cross-workspace create and update operations', async () => {
    const ownerA = await actor(OWNER_A, WS_A)
    const report = await createReport(ownerA, 'Workspace A report')
    const ownerB = await actor(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT api.create_report_definition($1,'Forbidden')`, [
        WS_A,
      ]),
      '42501',
    )
    await expectDenied(
      ownerB.query(`SELECT api.update_report_definition($1,$2,'Forbidden')`, [
        WS_A,
        report.id,
      ]),
      'SB033',
    )
  })
})
