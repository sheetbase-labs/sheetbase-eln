import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAdHocTextField } from '#/lib/sheet-local-data'
import { parseSheetInstanceState } from '#/lib/sheet-instance'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000009201'
const OTHER_WS = '00000000-0000-4000-8000-000000009202'
const PROJECT = '00000000-0000-4000-8000-000000009203'
const RECORD = '00000000-0000-4000-8000-000000009206'
const REVISION = '00000000-0000-4000-8000-000000009207'
const LEAD = 'set02-lead'
const MEMBER = 'set02-member'
const ADMIN = 'set02-admin'
const OWNER = 'set02-owner'
const OUTSIDER = 'set02-outsider'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const id of [LEAD, MEMBER, ADMIN, OWNER, OUTSIDER]) {
    await migrator.query(
      `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES ($1,$1,$2,true)`,
      [id, `${id}@sheetbase.test`],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES ($1,'set02','SET-02'),($2,'set02-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role) VALUES
     ($1,$3,'owner'),($1,$4,'scientist'),($1,$5,'admin'),($2,$6,'scientist')`,
    [WS, OTHER_WS, LEAD, MEMBER, ADMIN, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: LEAD,
      workspace_id: WS,
      role: 'authenticated',
      session_id: 'set02-fixture',
    }),
  ])
  await migrator.query(
    `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'set02','Restricted project',$3)`,
    [PROJECT, WS, LEAD],
  )
  await migrator.query(
    `INSERT INTO api.records (id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     VALUES ($1,$2,$3,'experiment','EXP-9206','Restricted notebook',$4)`,
    [RECORD, WS, PROJECT, LEAD],
  )
  await migrator.query(
    `INSERT INTO api.revisions (id,record_id,workspace_id,structure_version,metadata_version,
      metadata_snapshot,block_snapshot,integrity_digest,reason,created_by_user_id)
     VALUES ($1,$2,$3,1,1,'{}','[]',repeat('a',64),'submit',$4)`,
    [REVISION, RECORD, WS, LEAD],
  )
  const captured = await migrator.query(
    `SELECT id FROM api.change_events WHERE project_id=$1`,
    [PROJECT],
  )
  expect(captured.rows.length).toBeGreaterThan(0)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
})

async function caller(userId: string, workspaceId = WS) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
      session_id: `session-${userId}`,
    }),
  ])
  return client
}

async function visible(client: Client) {
  const result = await client.query(`SELECT id FROM api.projects WHERE id=$1`, [
    PROJECT,
  ])
  return result.rows.length > 0
}

describe('SET-02 canonical group access', () => {
  it('does not leak denied project details or counts through summaries', async () => {
    const admin = await caller(ADMIN)
    const summaries = await admin.query(
      `SELECT * FROM api.project_list_summary()`,
    )
    expect(summaries.rows).toEqual([])
  })

  it('does not leak denied notebook titles through search suggestions', async () => {
    const admin = await caller(ADMIN)
    const suggestions = await admin.query(
      `SELECT * FROM api.search_did_you_mean('EXP-9206')`,
    )
    expect(suggestions.rows).toEqual([])
  })

  it.each([
    ['record_timeline', RECORD],
    ['revision_evidence_package', REVISION],
    ['preview_submission_digest', RECORD],
  ])('denies direct %s RPC on a ruleless project', async (operation, id) => {
    const admin = await caller(ADMIN)
    await expectDenied(
      admin.query(`SELECT api.${operation}($1)`, [id]),
      '42501',
    )
  })

  it('filters audit before page projection even for a real privileged role', async () => {
    const admin = await caller(ADMIN)
    const audit = await admin.query<{
      result: { events: { projectId: string }[] }
    }>(`SELECT api.audit_events() AS result`)
    expect(
      audit.rows[0].result.events.some((e) => e.projectId === PROJECT),
    ).toBe(false)
  })

  it('does not export denied project events for an owner without a rule', async () => {
    const owner = await caller(OWNER)
    const exported = await owner.query<{ result: { project_id: string }[] }>(
      `SELECT api.export_audit_log($1) AS result`,
      [WS],
    )
    expect(exported.rows[0].result.some((e) => e.project_id === PROJECT)).toBe(
      false,
    )
  })

  it('denies the real admin role without a rule, despite workspace membership', async () => {
    const admin = await caller(ADMIN)
    expect(await visible(admin)).toBe(false)
    await expectDenied(
      admin.query(`SELECT api.set_project_member($1,$2,'viewer')`, [
        PROJECT,
        ADMIN,
      ]),
      '42501',
    )
  })

  it('protects file storage metadata and finalization with live View and Edit rules', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    const fileId = crypto.randomUUID()
    const storageKey = `${WS}/${fileId}/${'b'.repeat(32)}`
    const file = (
      await lead.query(
        `SELECT * FROM api.create_file_upload($1,'private.txt','text/plain',8,$2,NULL,'local',$3)`,
        [PROJECT, storageKey, fileId],
      )
    ).rows[0]
    await lead.query(`SELECT api.set_project_member($1,$2,'viewer')`, [
      PROJECT,
      MEMBER,
    ])
    expect(
      (
        await member.query(
          `SELECT storage_key FROM api.file_objects WHERE id=$1`,
          [file.file_object_id],
        )
      ).rows,
    ).toEqual([{ storage_key: storageKey }])
    await expectDenied(
      member.query(`SELECT api.record_file_text($1,'tampered')`, [
        file.file_object_id,
      ]),
      '42501',
    )
    await expectDenied(
      member.query(
        `SELECT api.finalize_file_upload($1,1,$2,$3,9,repeat('a',64))`,
        [
          file.file_object_id,
          storageKey,
          `${WS}/${file.file_object_id}/${'a'.repeat(32)}`,
        ],
      ),
      '42501',
    )
    await lead.query(`SELECT api.remove_project_member($1,$2)`, [
      PROJECT,
      MEMBER,
    ])
    // Both download and upload routes resolve this relation before touching
    // ObjectStorage. A removed rule cannot obtain a storage key or file bytes.
    expect(
      (
        await member.query(
          `SELECT storage_key FROM api.file_objects WHERE record_id=$1`,
          [file.record_id],
        )
      ).rows,
    ).toEqual([])
    expect(
      (
        await lead.query(
          `SELECT storage_key,byte_size,extracted_text FROM api.file_objects WHERE id=$1`,
          [file.file_object_id],
        )
      ).rows,
    ).toEqual([
      {
        storage_key: storageKey,
        byte_size: '8',
        extracted_text: null,
      },
    ])
  })

  it('denies frozen Dataset rows and revision source evidence independently of the readable notebook', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    const schema = (
      await lead.query(
        `SELECT api.create_dataset_schema_definition($1,'set02_private_data','Private data',NULL,'[]') AS result`,
        [WS],
      )
    ).rows[0].result
    await lead.query(`SELECT api.publish_dataset_schema_version($1)`, [
      schema.schema_version_id,
    ])
    const sourceProject = (
      await migrator.query(
        `INSERT INTO api.projects(workspace_id,key,title,lead_user_id) VALUES($1,'set02-source','Private source',$2) RETURNING id`,
        [WS, LEAD],
      )
    ).rows[0].id
    const dataset = (
      await migrator.query(
        `INSERT INTO api.datasets(workspace_id,schema_version_id,name,primary_project_id) VALUES($1,$2,'Restricted source',$3) RETURNING id,revision`,
        [WS, schema.schema_version_id, sourceProject],
      )
    ).rows[0]
    await migrator.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES($1,$2)`,
      [dataset.id, WS],
    )
    const version = (
      await lead.query(
        `SELECT to_jsonb(api.snapshot_dataset($1,$2,'Frozen private data')) AS result`,
        [dataset.id, dataset.revision],
      )
    ).rows[0].result
    expect(
      (
        await lead.query(
          `SELECT api.query_dataset_version_rows($1) AS result`,
          [version.id],
        )
      ).rows[0].result.totalCount,
    ).toBe(1)
    await lead.query(`SELECT api.set_project_member($1,$2,'viewer')`, [
      PROJECT,
      MEMBER,
    ])
    const revision = (
      await migrator.query(
        `INSERT INTO api.revisions(record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,canonical_snapshot,integrity_digest,reason,created_by_user_id)
      VALUES($1,$2,2,2,'{}','[]',$3,repeat('c',64),'submit',$4) RETURNING id`,
        [
          RECORD,
          WS,
          JSON.stringify({ files: [], datasetVersionId: version.id }),
          LEAD,
        ],
      )
    ).rows[0].id
    expect(await visible(member)).toBe(true)
    await expectDenied(
      member.query(`SELECT api.query_dataset_version_rows($1)`, [version.id]),
      '42501',
    )
    await expectDenied(
      member.query(`SELECT api.revision_evidence_package($1)`, [revision]),
      '42501',
    )
    expect(
      (
        await member.query(
          `SELECT row_id FROM api.dataset_version_rows WHERE dataset_version_id=$1`,
          [version.id],
        )
      ).rows,
    ).toEqual([])
    expect(
      (
        await member.query(`SELECT id FROM api.revisions WHERE id=$1`, [
          revision,
        ])
      ).rows,
    ).toEqual([])
    await lead.query(`SELECT api.remove_project_member($1,$2)`, [
      PROJECT,
      MEMBER,
    ])
  })

  it('keeps explicit portal authority separate from internal View and live client membership', async () => {
    const user = 'set02-client'
    const lead = await caller(LEAD)
    await migrator.query(
      `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'Client','set02-client@sheetbase.test',true)`,
      [user],
    )
    const client = (
      await migrator.query(
        `INSERT INTO api.clients(workspace_id,code,name) VALUES($1,'CL-920','SET client') RETURNING id`,
        [WS],
      )
    ).rows[0].id
    await migrator.query(
      `INSERT INTO api.workspace_memberships(workspace_id,user_id,role,client_id) VALUES($1,$2,'client_viewer',$3)`,
      [WS, user, client],
    )
    const project = (
      await migrator.query(
        `INSERT INTO api.projects(workspace_id,key,title,lead_user_id,client_id,auto_share_to_client) VALUES($1,'set02-portal','Portal project',$2,$3,true) RETURNING id`,
        [WS, LEAD, client],
      )
    ).rows[0].id
    const viewer = await caller(user)
    expect(
      (await viewer.query(`SELECT * FROM api.client_portal_projects()`)).rows,
    ).toEqual([])
    await lead.query(
      `SELECT api.set_project_access_rule($1,$2,NULL,false,false,false,true,false)`,
      [project, user],
    )
    expect(
      (
        await viewer.query(
          `SELECT project_id FROM api.client_portal_projects()`,
        )
      ).rows,
    ).toEqual([{ project_id: project }])
    expect(
      (await viewer.query(`SELECT id FROM api.projects WHERE id=$1`, [project]))
        .rows,
    ).toEqual([])
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at=now() WHERE workspace_id=$1 AND user_id=$2`,
      [WS, user],
    )
    expect(
      (await viewer.query(`SELECT * FROM api.client_portal_projects()`)).rows,
    ).toEqual([])
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at=NULL WHERE workspace_id=$1 AND user_id=$2`,
      [WS, user],
    )
    await lead.query(`SELECT api.remove_project_member($1,$2)`, [project, user])
    expect(
      (await viewer.query(`SELECT * FROM api.client_portal_projects()`)).rows,
    ).toEqual([])
  })

  it('denies dynamic readers and tracking of an inaccessible real project', async () => {
    const admin = await caller(ADMIN)
    await expectDenied(
      admin.query(`SELECT api.discover_object_dependencies('record',$1)`, [
        RECORD,
      ]),
      '42501',
    )
    await expectDenied(
      admin.query(`SELECT api.preview_hard_delete('record',$1)`, [RECORD]),
      '42501',
    )
    expect(
      (
        await admin.query(
          `SELECT api.record_recent_view('project',$1) AS result`,
          [PROJECT],
        )
      ).rows[0].result,
    ).toBeNull()
    expect(
      (
        await admin.query(
          `SELECT api.set_record_favourite('project',$1,true) AS result`,
          [PROJECT],
        )
      ).rows[0].result,
    ).toBeNull()
    expect(
      (
        await admin.query(
          `SELECT object_id FROM api.recently_viewed WHERE object_id=$1`,
          [PROJECT],
        )
      ).rows,
    ).toEqual([])
  })

  it('filters actual field usage and dependency titles before projecting counts', async () => {
    const lead = await caller(LEAD)
    const admin = await caller(ADMIN)
    const field = (
      await lead.query<{ id: string }>(
        `SELECT * FROM api.create_model_field($1,'experiment','set02_impact','Restricted impact','text',true,NULL,'{}','{}',NULL)`,
        [WS],
      )
    ).rows[0].id
    await lead.query(`SELECT api.activate_model_field($1)`, [field])
    await lead.query(
      `UPDATE api.records SET custom_fields='{"set02_impact":"Private process observation"}' WHERE id=$1`,
      [RECORD],
    )
    expect(
      (await lead.query(`SELECT api.model_field_usage($1) AS count`, [field]))
        .rows[0].count,
    ).toBe('1')
    expect(
      (await admin.query(`SELECT api.model_field_usage($1) AS count`, [field]))
        .rows[0].count,
    ).toBe('0')
    const result = (
      await admin.query(
        `SELECT api.discover_object_dependencies('model_field',$1) AS result`,
        [field],
      )
    ).rows[0].result
    expect(JSON.stringify(result)).not.toContain('Restricted notebook')
    expect(result.dependencies).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'record', id: RECORD }),
      ]),
    )
  })

  it('rechecks the human rule in a trusted scientific service write without JWT claims', async () => {
    const inputRevision = (
      await migrator.query(
        `SELECT calculation_input_revision FROM api.records WHERE id=$1`,
        [RECORD],
      )
    ).rows[0].calculation_input_revision
    await migrator.query(`SELECT set_config('request.jwt.claims','',false)`)
    await migrator.query('SET ROLE formula_writer')
    try {
      const statement = `SELECT internal.apply_trusted_calculation($1,$2,$3,'completed','[]','{}','fnv1a32-dcfa915f','fnv1a32-00000000',NULL) AS result`
      await expectDenied(
        migrator.query(statement, [ADMIN, RECORD, inputRevision]),
        '42501',
      )
      expect(
        (await migrator.query(statement, [LEAD, RECORD, inputRevision])).rows[0]
          .result,
      ).toEqual({
        recordId: RECORD,
        inputRevision: Number(inputRevision),
        status: 'completed',
        formulaCount: 0,
      })
    } finally {
      await migrator.query('RESET ROLE')
      await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({ sub: LEAD, workspace_id: WS, role: 'authenticated' }),
      ])
    }
  })

  it('resolves explicit group union at query time, revokes immediately and audits changes', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    const outsider = await caller(OUTSIDER, OTHER_WS)
    const first = await lead.query<{ id: string }>(
      `SELECT * FROM api.create_workspace_group('Upstream')`,
    )
    const second = await lead.query<{ id: string }>(
      `SELECT * FROM api.create_workspace_group('Analytical')`,
    )
    const editGroup = first.rows[0].id
    const reviewGroup = second.rows[0].id
    await lead.query(`SELECT api.set_workspace_group_member($1,$2,true)`, [
      editGroup,
      MEMBER,
    ])
    await lead.query(`SELECT api.set_workspace_group_member($1,$2,true)`, [
      reviewGroup,
      MEMBER,
    ])
    // A group without a project rule grants nothing.
    expect(await visible(member)).toBe(false)
    await lead.query(
      `SELECT api.set_project_access_rule($1,NULL,$2,false,true,false,false,false)`,
      [PROJECT, editGroup],
    )
    await lead.query(
      `SELECT api.set_project_access_rule($1,NULL,$2,false,false,true,false,false)`,
      [PROJECT, reviewGroup],
    )
    expect(await visible(member)).toBe(true)
    expect(await visible(outsider)).toBe(false)
    const union = await member.query(
      `SELECT * FROM api.project_permissions($1)`,
      [PROJECT],
    )
    expect(union.rows[0]).toMatchObject({
      can_view: true,
      can_edit: true,
      can_review: true,
      can_manage: false,
      client_portal: false,
    })
    const members = await lead.query('SELECT * FROM api.project_members($1)', [
      PROJECT,
    ])
    expect(members.rows.find((row) => row.user_id === MEMBER)).toMatchObject({
      can_view: true,
      can_edit: true,
      can_review: true,
      client_portal: false,
      can_manage: false,
    })
    const matrix = await lead.query(
      `SELECT * FROM api.project_access_rules($1)`,
      [PROJECT],
    )
    expect(matrix.rows.find((r) => r.group_id === editGroup)).toMatchObject({
      can_edit: true,
      can_review: false,
    })
    await lead.query(`SELECT api.set_workspace_group_member($1,$2,false)`, [
      editGroup,
      MEMBER,
    ])
    const reduced = await member.query(
      `SELECT * FROM api.project_permissions($1)`,
      [PROJECT],
    )
    expect(reduced.rows[0]).toMatchObject({
      can_view: true,
      can_edit: false,
      can_review: true,
    })
    const reducedMembers = await lead.query(
      'SELECT * FROM api.project_members($1)',
      [PROJECT],
    )
    expect(
      reducedMembers.rows.find((row) => row.user_id === MEMBER),
    ).toMatchObject({
      can_view: true,
      can_edit: false,
      can_review: true,
      client_portal: false,
      can_manage: false,
    })
    await lead.query(`SELECT api.delete_workspace_group($1)`, [reviewGroup])
    expect(await visible(member)).toBe(false)
    const audit = await migrator.query(
      `SELECT entity_type,operation FROM api.change_events WHERE workspace_id=$1 AND entity_type IN ('workspace_group','workspace_group_membership','project_access')`,
      [WS],
    )
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'workspace_group_membership',
          operation: 'delete',
        }),
        expect.objectContaining({
          entity_type: 'workspace_group',
          operation: 'delete',
        }),
        expect.objectContaining({
          entity_type: 'project_access',
          operation: 'create',
        }),
      ]),
    )
  })

  it('rejects cross-workspace membership and unauthorised grant changes', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    const result = await lead.query<{ id: string }>(
      `SELECT * FROM api.create_workspace_group('QA')`,
    )
    await expectDenied(
      lead.query(`SELECT api.set_workspace_group_member($1,$2,true)`, [
        result.rows[0].id,
        OUTSIDER,
      ]),
      '42501',
    )
    await expectDenied(
      member.query(
        `SELECT api.set_project_access_rule($1,$2,NULL,true,true,true,false,true)`,
        [PROJECT, MEMBER],
      ),
      '42501',
    )
  })

  it('keeps display levels and workspace roles from manufacturing effective rights', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    await lead.query(
      `SELECT api.set_project_access_rule($1,$2,NULL,false,false,true,false,false)`,
      [PROJECT, MEMBER],
    )
    await migrator.query(
      `UPDATE api.project_access SET access_level='owner' WHERE project_id=$1 AND user_id=$2`,
      [PROJECT, MEMBER],
    )
    const permissions = await member.query(
      `SELECT * FROM api.project_permissions($1)`,
      [PROJECT],
    )
    expect(permissions.rows[0]).toMatchObject({
      can_view: true,
      can_edit: false,
      can_review: true,
      can_manage: false,
    })
    await migrator.query(
      `UPDATE api.workspace_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2`,
      [WS, MEMBER],
    )
    expect(
      (
        await member.query(`SELECT * FROM api.project_permissions($1)`, [
          PROJECT,
        ])
      ).rows[0],
    ).toMatchObject({
      can_view: true,
      can_edit: false,
      can_review: false,
      can_manage: false,
    })
    await migrator.query(
      `UPDATE api.workspace_memberships SET role='scientist',suspended_at=now() WHERE workspace_id=$1 AND user_id=$2`,
      [WS, MEMBER],
    )
    expect(await visible(member)).toBe(false)
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at=NULL WHERE workspace_id=$1 AND user_id=$2`,
      [WS, MEMBER],
    )
    await lead.query(`SELECT api.remove_project_member($1,$2)`, [
      PROJECT,
      MEMBER,
    ])
  })

  it('audits a real viewer request and approval without granting Review or management', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    await lead.query(`SELECT api.set_project_member($1,$2,'viewer')`, [
      PROJECT,
      MEMBER,
    ])
    const request = await member.query<{ id: string }>(
      `SELECT * FROM api.request_project_edit_access($1,'Complete upstream process assessment')`,
      [PROJECT],
    )
    await expectDenied(
      member.query(`SELECT api.decide_project_access_request($1,true)`, [
        request.rows[0].id,
      ]),
      '42501',
    )
    await lead.query(`SELECT api.decide_project_access_request($1,true)`, [
      request.rows[0].id,
    ])
    expect(
      (
        await member.query(`SELECT * FROM api.project_permissions($1)`, [
          PROJECT,
        ])
      ).rows[0],
    ).toMatchObject({
      can_view: true,
      can_edit: true,
      can_review: false,
      can_manage: false,
    })
    expect(
      (
        await migrator.query(
          `SELECT payload FROM api.change_events WHERE entity_type='project_access_request' AND entity_uuid=$1 AND operation='update'`,
          [request.rows[0].id],
        )
      ).rows[0].payload,
    ).toMatchObject({
      before: { status: 'pending' },
      after: { status: 'approved', decided_by_user_id: LEAD },
    })
    await lead.query(`SELECT api.remove_project_member($1,$2)`, [
      PROJECT,
      MEMBER,
    ])
  })

  it('creates explicit owner and configured QA rules without implicit membership or existing-project grants', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    const group = await lead.query<{ id: string }>(
      `SELECT * FROM api.create_workspace_group('Audit QA')`,
    )
    await lead.query(`SELECT api.set_workspace_group_member($1,$2,true)`, [
      group.rows[0].id,
      MEMBER,
    ])
    await expectDenied(
      member.query(`SELECT api.set_project_access_defaults($1)`, [
        group.rows[0].id,
      ]),
      '42501',
    )
    await lead.query(`SELECT api.set_project_access_defaults($1)`, [
      group.rows[0].id,
    ])
    expect(await visible(member)).toBe(false)
    const created = await lead.query<{ id: string }>(
      `SELECT * FROM api.create_project('Private lead project',NULL,NULL,NULL,$1)`,
      [LEAD],
    )
    expect(
      (
        await member.query(`SELECT * FROM api.project_permissions($1)`, [
          created.rows[0].id,
        ])
      ).rows[0],
    ).toMatchObject({
      can_view: true,
      can_edit: false,
      can_review: false,
      can_manage: false,
      client_portal: false,
    })
    expect(
      (
        await lead.query(`SELECT * FROM api.project_access_rules($1)`, [
          created.rows[0].id,
        ])
      ).rows,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: LEAD, can_manage: true }),
        expect.objectContaining({
          group_id: group.rows[0].id,
          can_view: true,
          can_edit: false,
        }),
      ]),
    )
    await lead.query(`SELECT api.delete_workspace_group($1)`, [
      group.rows[0].id,
    ])
    expect(
      (
        await member.query(`SELECT * FROM api.project_permissions($1)`, [
          created.rows[0].id,
        ])
      ).rows[0].can_view,
    ).toBe(false)
    expect(
      (await lead.query(`SELECT * FROM api.project_access_defaults()`)).rows[0]
        .qa_view_group_id,
    ).toBeNull()
  })

  it('returns only own active onboarding membership and real accepted invitation provenance', async () => {
    const member = await caller(MEMBER)
    const absent = (
      await member.query(`SELECT * FROM api.my_onboarding_state()`)
    ).rows
    expect(absent).toEqual([
      expect.objectContaining({
        user_id: MEMBER,
        workspace_role: 'scientist',
        invitation_accepted_at: null,
      }),
    ])
    await migrator.query(
      `INSERT INTO api.workspace_invitations(workspace_id,email,role,token_hash,status,expires_at,accepted_at,accepted_by_user_id,created_by_user_id)
      VALUES($1,'not-an-authority@sheetbase.test','scientist','set02-invitation-hash','accepted',now()+interval '1 day','2026-09-23T08:07:00Z',$2,$3)`,
      [WS, MEMBER, LEAD],
    )
    const actual = (
      await member.query(`SELECT * FROM api.my_onboarding_state()`)
    ).rows[0]
    expect(actual).toEqual({
      user_id: MEMBER,
      workspace_role: 'scientist',
      joined_at: absent[0].joined_at,
      invitation_accepted_at: new Date('2026-09-23T08:07:00Z'),
    })
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at=now() WHERE workspace_id=$1 AND user_id=$2`,
      [WS, MEMBER],
    )
    expect(
      (await member.query(`SELECT * FROM api.my_onboarding_state()`)).rows,
    ).toEqual([])
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at=NULL WHERE workspace_id=$1 AND user_id=$2`,
      [WS, MEMBER],
    )
  })

  it('reauthorizes all live Sheet comment mutations after a project rule is removed', async () => {
    const lead = await caller(LEAD)
    const member = await caller(MEMBER)
    await lead.query(`SELECT api.set_project_member($1,$2,'viewer')`, [
      PROJECT,
      MEMBER,
    ])
    const field = crypto.randomUUID()
    const row = crypto.randomUUID()
    const state = parseSheetInstanceState({
      bindings: [],
      localFields: [
        { ...createAdHocTextField('Observed recovery'), fieldId: field },
      ],
      localValues: { [row]: { [field]: '37' } },
      calculationOverrides: {},
      presentation: {
        columnOrder: [field],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
        filters: [],
        sorts: [],
      },
      provenance: { createdFrom: 'ad_hoc' },
    })
    const sheet = (
      await lead.query(
        `SELECT to_jsonb(api.create_sheet_instance($1,'Restricted Sheet',NULL,NULL,$2,NULL,$3::jsonb)) result`,
        [WS, PROJECT, JSON.stringify(state)],
      )
    ).rows[0].result
    const target = { instanceId: sheet.id, rowKeys: [row], fieldIds: [field] }
    const root = (
      await member.query(
        `SELECT api.create_sheet_comment($1,$2,'sheet_cell',$3::jsonb,'Needs process review','{}') result`,
        [sheet.id, sheet.revision, JSON.stringify(target)],
      )
    ).rows[0].result
    await lead.query(`SELECT api.remove_project_member($1,$2)`, [
      PROJECT,
      MEMBER,
    ])
    for (const statement of [
      () =>
        member.query(
          `SELECT api.create_sheet_comment($1,$2,'sheet_cell',$3::jsonb,'Denied','{}')`,
          [sheet.id, sheet.revision, JSON.stringify(target)],
        ),
      () =>
        member.query(`SELECT api.reply_to_comment($1,'Denied','{}')`, [
          root.id,
        ]),
      () => member.query(`SELECT api.resolve_comment_thread($1)`, [root.id]),
      () => member.query(`SELECT api.reopen_comment_thread($1)`, [root.id]),
    ])
      await expectDenied(statement(), '42501')
    expect(
      (
        await member.query(
          `SELECT id FROM api.comments WHERE sheet_instance_id=$1`,
          [sheet.id],
        )
      ).rows,
    ).toEqual([])
  })
})
