import { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

import {
  migrateTestDatabase,
  migratorUrl,
  resetTestDatabase,
  roleUrl,
  setActorJwt,
} from './helpers'

const workspace = '00000000-0000-4000-8000-000000009401'
const project = '00000000-0000-4000-8000-000000009402'
const clientId = '00000000-0000-4000-8000-000000009403'
const author = 'portal-evidence-author'
const viewer = 'portal-evidence-viewer'
const otherViewer = 'portal-evidence-other-client'
const records: string[] = []
const revisions: string[] = []
const frozenBlocks = [
  {
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Frozen approved note, not live replacement',
              },
            ],
          },
        ],
      },
    },
  },
]
const frozenTables = [
  {
    id: 'frozen-table',
    name: 'Frozen assay',
    columns: [{ field_name: 'titre', label: 'Titre' }],
    rows: [
      { id: 'row-a', titre: 17 },
      { id: 'row-b', titre: 29 },
    ],
  },
]
let admin: Client
let caller: Client

beforeAll(async () => {
  await resetTestDatabase()
  await migrateTestDatabase()
  admin = new Client({ connectionString: migratorUrl() })
  await admin.connect()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
    ($1,'Current Author Name','portal-evidence-author@sheetbase.test',true),
    ($2,'Portal Client','portal-evidence-viewer@sheetbase.test',true),
    ($3,'Other Client','portal-evidence-other@sheetbase.test',true)`,
    [author, viewer, otherViewer],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'portal-evidence','Portal evidence')`,
    [workspace],
  )
  await admin.query(
    `INSERT INTO api.clients(id,workspace_id,code,name) VALUES($1,$2,'CL-9403','Evidence Client')`,
    [clientId, workspace],
  )
  const otherClient = (
    await admin.query(
      `INSERT INTO api.clients(workspace_id,code,name) VALUES($1,'CL-9404','Other Client') RETURNING id`,
      [workspace],
    )
  ).rows[0].id
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role,client_id) VALUES($1,$2,'owner',NULL),($1,$3,'client_viewer',$4),($1,$5,'client_viewer',$6)`,
    [workspace, author, viewer, clientId, otherViewer, otherClient],
  )
  await setActorJwt(admin, author, workspace)
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id,client_id,auto_share_to_client) VALUES($1,$2,'PORTAL-EVIDENCE','Portal evidence project',$3,$4,true)`,
    [project, workspace, author, clientId],
  )
  await admin.query(
    `SELECT api.set_project_access_rule($1,$2,NULL,false,false,false,true,false)`,
    [project, viewer],
  )
  for (const [index, meaning] of [
    'approve-for-record',
    'reviewed-and-approved',
  ].entries()) {
    const record = (
      await admin.query(
        `INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES($1,$2,'experiment',$3,'Live renamed title','approved',$4) RETURNING id`,
        [workspace, project, `EXP-PORTAL-${index}`, author],
      )
    ).rows[0].id
    records.push(record)
    const recordRevisions: string[] = []
    for (const version of [1, 2]) {
      const revision = (
        await admin.query(
          `INSERT INTO api.revisions(record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,canonical_snapshot,integrity_digest,reason,created_by_user_id)
        VALUES($1,$2,$3,1,'{"title":"Frozen approved title"}',$4,$5,repeat($6,64),'submit',$7) RETURNING id`,
          [
            record,
            workspace,
            version,
            JSON.stringify(
              version === 1
                ? frozenBlocks
                : [
                    {
                      type: 'rich_text',
                      payload: {
                        doc: {
                          content: [{ text: 'Later unrelated revision' }],
                        },
                      },
                    },
                  ],
            ),
            JSON.stringify({
              formatVersion: 1,
              record: { id: record, workspaceId: workspace },
              blocks: [],
              files: [],
              scientificTables: version === 1 ? frozenTables : [],
            }),
            version === 1 ? 'a' : 'b',
            author,
          ],
        )
      ).rows[0].id
      if (version === 1) revisions.push(revision)
      recordRevisions.push(revision)
    }
    for (const [offset, revision] of recordRevisions.entries()) {
      const version = offset + 1
      const submission = (
        await admin.query(
          `INSERT INTO api.review_submissions(workspace_id,record_id,revision_id,state,workflow_definition_key,workflow_definition_version,assigned_reviewer_user_ids,submitted_by_user_id,submitted_session_id,submitted_role,submitted_at,idempotency_key)
        VALUES($1,$2,$3,'approved','default-scientific-review',1,$4,$5,'historical-session','authenticated',now(),$6) RETURNING id`,
          [
            workspace,
            record,
            revision,
            [author],
            author,
            `portal-${index}-${version}`,
          ],
        )
      ).rows[0].id
      // Stored evidence fixtures, not authentication/grant acceptance. Native
      // signing is separately exercised by the REV browser and DB suites.
      await admin.query(
        `INSERT INTO api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,revision_integrity_digest,signer_user_id,signer_name,signer_session_id,signer_role,auth_method,confirmation_phrase,signed_at)
        VALUES($1,$2,$3,$4,$5,repeat($6,64),$7,$8,'historical-session','owner','session+name-confirmation','Stored attestation',$9)`,
        [
          workspace,
          submission,
          revision,
          record,
          meaning,
          version === 1 ? 'a' : 'b',
          author,
          index === 0 ? null : 'Immutable Approver Name',
          version === 1
            ? '2026-09-19T09:03:14.123456Z'
            : '2026-09-20T11:17:55.987654Z',
        ],
      )
      if (version === 1)
        await admin.query(
          `INSERT INTO api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,revision_integrity_digest,signer_user_id,signer_name,signer_session_id,signer_role,auth_method,confirmation_phrase,signed_at)
        VALUES($1,$2,$3,$4,'witness',repeat('a',64),$5,'Immutable Witness Name','historical-session','owner','session+name-confirmation','Stored witness','2026-09-19T08:01:02.654321Z')`,
          [workspace, submission, revision, record, author],
        )
    }
    await admin.query(
      `UPDATE api.records SET locked_at='2026-09-19T09:03:14.123456Z',locked_by_revision_id=$2 WHERE id=$1`,
      [record, revisions[index]],
    )
  }
  caller = new Client({ connectionString: roleUrl('authenticator') })
  await caller.connect()
  await caller.query('SET ROLE authenticated')
  await setActorJwt(caller, viewer, workspace)
})

afterAll(async () => {
  await caller?.end()
  await admin?.end()
})

async function document(record = records[0]) {
  return (
    await caller.query(
      `SELECT api.client_portal_record_document($1) AS document`,
      [record],
    )
  ).rows[0].document
}

it.each([0, 1])(
  'selects exact locking revision for legacy/new approval%s, preserving every immutable signature',
  async (index) => {
    const result = await document(records[index])
    expect(result.revisionId).toBe(revisions[index])
    expect(result.title).toBe('Frozen approved title')
    expect(result.blockSnapshot).toEqual(frozenBlocks)
    expect(result.scientificTables).toEqual(frozenTables)
    expect(result.integrityDigest).toBe('a'.repeat(64))
    expect(result.approvedAt).toBe('2026-09-19T09:03:14.123456+00:00')
    expect(result.approvedByName).toBe(
      index === 0 ? null : 'Immutable Approver Name',
    )
    expect(result.signatureMeaning).toBe(
      index === 0 ? 'approve-for-record' : 'reviewed-and-approved',
    )
    expect(result.signatures).toHaveLength(2)
    expect(
      result.signatures.map(
        (signature: { signatureMeaning: string }) => signature.signatureMeaning,
      ),
    ).toEqual([
      'witness',
      index === 0 ? 'approve-for-record' : 'reviewed-and-approved',
    ])
    expect(result.signatures[0]).toMatchObject({
      revisionId: revisions[index],
      signerName: 'Immutable Witness Name',
      signedAt: '2026-09-19T08:01:02.654321+00:00',
      integrityDigest: 'a'.repeat(64),
    })
    const ids = (
      await admin.query(
        `SELECT id FROM api.signatures WHERE revision_id=$1 ORDER BY signed_at,id`,
        [revisions[index]],
      )
    ).rows.map((row) => row.id)
    expect(
      result.signatures.map((signature: { id: string }) => signature.id),
    ).toEqual(ids)
    const summary = (
      await caller.query(
        `SELECT approved_at,approved_by_name FROM api.client_portal_records() WHERE record_id=$1`,
        [records[index]],
      )
    ).rows[0]
    expect(summary).toEqual({
      approved_at: new Date('2026-09-19T09:03:14.123Z'),
      approved_by_name: index === 0 ? null : 'Immutable Approver Name',
    })
  },
)

it('keeps stored/null signer names after a current profile rename', async () => {
  await admin.query(
    `UPDATE internal."user" SET name='Renamed current profile' WHERE id=$1`,
    [author],
  )
  expect((await document(records[0])).approvedByName).toBeNull()
  expect((await document(records[1])).approvedByName).toBe(
    'Immutable Approver Name',
  )
  expect(JSON.stringify(await document(records[1]))).not.toContain(
    'Renamed current profile',
  )
})

it('retains live explicit portal authority, active client identity and approved/share boundaries', async () => {
  expect(await document()).not.toBeNull()
  expect((await caller.query(`SELECT id FROM api.records`)).rows).toEqual([])
  await admin.query(
    `UPDATE api.projects SET auto_share_to_client=false WHERE id=$1`,
    [project],
  )
  expect(await document()).toBeNull()
  await admin.query(
    `INSERT INTO api.client_portal_shares(workspace_id,project_id,client_id,record_id,shared_by_user_id) VALUES($1,$2,$3,$4,$5)`,
    [workspace, project, clientId, records[0], author],
  )
  expect(await document()).not.toBeNull()
  await admin.query(
    `UPDATE api.records SET status='draft',locked_at=NULL,locked_by_revision_id=NULL WHERE id=$1`,
    [records[0]],
  )
  expect(await document()).toBeNull()
  await admin.query(
    `UPDATE api.records SET status='approved',locked_at=now(),locked_by_revision_id=$2 WHERE id=$1`,
    [records[0], revisions[0]],
  )
  await setActorJwt(caller, otherViewer, workspace)
  expect(await document()).toBeNull()
  await setActorJwt(caller, viewer, workspace)
  await admin.query(
    `UPDATE api.workspace_memberships SET suspended_at=now() WHERE workspace_id=$1 AND user_id=$2`,
    [workspace, viewer],
  )
  expect(await document()).toBeNull()
  await admin.query(
    `UPDATE api.workspace_memberships SET suspended_at=NULL WHERE workspace_id=$1 AND user_id=$2`,
    [workspace, viewer],
  )
  await admin.query(
    `DELETE FROM api.project_access WHERE project_id=$1 AND user_id=$2`,
    [project, viewer],
  )
  expect(await document()).toBeNull()
  expect(
    (await caller.query(`SELECT * FROM api.client_portal_records()`)).rows,
  ).toEqual([])
})
