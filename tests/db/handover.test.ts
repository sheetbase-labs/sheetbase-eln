/**
 * Handing over a leaver's work (migration 0090).
 *
 * Proves, against a freshly migrated database:
 *  - the preview counts only open work the person still holds;
 *  - handing over moves records, tasks, reviews, instruments and standing
 *    reviewer roles to the recipient, and leaves signed or finished work alone;
 *  - work in a project the recipient cannot open stays put and is reported;
 *  - a review never moves to the person who wrote it;
 *  - a lead can hand over for anyone, a person can hand over their own work,
 *    and nobody else can;
 *  - the recipient has to be an active member who can do work.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000009a000'
const OPEN = '00000000-0000-4000-8000-00000009a001'
const CLOSED = '00000000-0000-4000-8000-00000009a002'
const LEAVER = 'handover-leaver'
const LEAD = 'handover-lead'
const HEIR = 'handover-heir'
const OTHER = 'handover-other'
const VIEWER = 'handover-viewer'
const SUSPENDED = 'handover-suspended'
const AUTHOR = 'handover-author'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

const id = (group: string, n: number) =>
  `00000000-0000-4000-${group}-${n.toString(16).padStart(12, '0')}`

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
      ('${LEAVER}','Leaver','handover-leaver@test.invalid',true),
      ('${LEAD}','Lead','handover-lead@test.invalid',true),
      ('${HEIR}','Heir','handover-heir@test.invalid',true),
      ('${OTHER}','Other','handover-other@test.invalid',true),
      ('${VIEWER}','Viewer','handover-viewer@test.invalid',true),
      ('${SUSPENDED}','Suspended','handover-suspended@test.invalid',true),
      ('${AUTHOR}','Author','handover-author@test.invalid',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES ('${WS}','handover','Handover')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role,suspended_at) VALUES
      ('${WS}','${LEAVER}','scientist',NULL),
      ('${WS}','${LEAD}','owner',NULL),
      ('${WS}','${HEIR}','scientist',NULL),
      ('${WS}','${OTHER}','scientist',NULL),
      ('${WS}','${VIEWER}','viewer',NULL),
      ('${WS}','${SUSPENDED}','scientist',now()),
      ('${WS}','${AUTHOR}','scientist',NULL)`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id,workspace_id,key,title,lead_user_id,default_reviewer_user_id) VALUES
      ('${OPEN}','${WS}','open','Open project','${LEAD}','${LEAVER}'),
      ('${CLOSED}','${WS}','closed','Closed project','${LEAD}','${LEAVER}')`,
  )
  // The heir can open and review the first project and cannot open the second.
  for (const user of [LEAVER, AUTHOR]) {
    for (const project of [OPEN, CLOSED]) {
      await grantProjectAccess(migrator, {
        workspaceId: WS,
        projectId: project,
        userId: user,
        canView: true,
        canEdit: true,
        canReview: true,
      })
    }
  }
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: OPEN,
    userId: HEIR,
    canView: true,
    canEdit: true,
    canReview: true,
  })

  // Records: two experiments and a sample in the open project, an experiment in
  // the closed project, a signed experiment and an archived one.
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id,
        assignee_user_id, reviewer_user_id)
     VALUES
      ('${id('9001', 1)}','${WS}','${OPEN}','experiment','EXP-1','One','in_progress','${AUTHOR}','${LEAVER}','${LEAVER}'),
      ('${id('9001', 2)}','${WS}','${OPEN}','experiment','EXP-2','Two','in_progress','${AUTHOR}','${LEAVER}',NULL),
      ('${id('9001', 3)}','${WS}','${OPEN}','sample','SMP-1','Sample','in_progress','${AUTHOR}','${LEAVER}',NULL),
      ('${id('9001', 4)}','${WS}','${CLOSED}','experiment','EXP-4','Closed','in_progress','${AUTHOR}','${LEAVER}',NULL),
      ('${id('9001', 5)}','${WS}','${OPEN}','experiment','EXP-5','Archived','in_progress','${AUTHOR}','${LEAVER}',NULL)`,
  )
  await migrator.query(
    `UPDATE api.records SET archived_at = now() WHERE id = '${id('9001', 5)}'`,
  )

  // Tasks: one open, one done.
  await migrator.query(
    `INSERT INTO api.study_tasks (id, workspace_id, project_id, title, status) VALUES
      ('${id('9002', 1)}','${WS}','${OPEN}','Open task','in_progress'),
      ('${id('9002', 2)}','${WS}','${OPEN}','Done task','completed'),
      ('${id('9002', 3)}','${WS}','${OPEN}','Shared task','in_progress'),
      ('${id('9002', 4)}','${WS}','${OPEN}','Other role task','in_progress')`,
  )
  await migrator.query(
    `INSERT INTO api.study_task_assignments (workspace_id, task_id, user_id, role) VALUES
      ('${WS}','${id('9002', 1)}','${LEAVER}','assignee'),
      ('${WS}','${id('9002', 2)}','${LEAVER}','assignee'),
      ('${WS}','${id('9002', 3)}','${LEAVER}','assignee'),
      ('${WS}','${id('9002', 3)}','${HEIR}','assignee'),
      ('${WS}','${id('9002', 4)}','${LEAVER}','assignee'),
      ('${WS}','${id('9002', 4)}','${HEIR}','reviewer')`,
  )

  // Instrument and a review waiting on the leaver (and one the heir wrote).
  await migrator.query(
    `INSERT INTO api.instruments (id, workspace_id, name, owner_id) VALUES
      ('${id('9003', 1)}','${WS}','Plate reader','${LEAVER}')`,
  )
  await migrator.query(
    `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
     VALUES ('default-review', 1, '{"steps":[]}'::jsonb) ON CONFLICT DO NOTHING`,
  )
  await migrator.query(
    `INSERT INTO api.revisions
       (id, record_id, workspace_id, structure_version, metadata_version,
        metadata_snapshot, block_snapshot, integrity_digest, reason, created_by_user_id)
     VALUES
      ('${id('9004', 1)}','${id('9001', 1)}','${WS}',1,2,'{}','[]',repeat('b',64),'submit','${AUTHOR}'),
      ('${id('9004', 2)}','${id('9001', 2)}','${WS}',1,2,'{}','[]',repeat('c',64),'submit','${HEIR}')`,
  )
  await migrator.query(
    `INSERT INTO api.review_submissions
       (id, workspace_id, record_id, revision_id, workflow_definition_key,
        workflow_definition_version, assigned_reviewer_user_ids,
        submitted_by_user_id, submitted_session_id, submitted_role,
        submitted_at, idempotency_key)
     VALUES
      ('${id('9005', 1)}','${WS}','${id('9001', 1)}','${id('9004', 1)}','default-review',1,
        ARRAY['${LEAVER}','${OTHER}']::text[],'${AUTHOR}','s','authenticated',now(),'h-1'),
      ('${id('9005', 2)}','${WS}','${id('9001', 2)}','${id('9004', 2)}','default-review',1,
        ARRAY['${LEAVER}']::text[],'${HEIR}','s','authenticated',now(),'h-2')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('preview_member_handover', () => {
  it('counts only the open work the person still holds', async () => {
    const lead = await asAuthenticated(LEAD)
    const { rows } = await lead.query(
      `SELECT category, record_kind, n FROM api.preview_member_handover($1::uuid, $2)
        ORDER BY category, record_kind`,
      [WS, LEAVER],
    )
    const count = (category: string, kind: string | null = null) =>
      rows.find((r) => r.category === category && r.record_kind === kind)?.n
    expect(count('record', 'experiment')).toBe(3)
    expect(count('record', 'sample')).toBe(1)
    expect(count('record_reviewer')).toBe(1)
    expect(count('task')).toBe(3)
    expect(count('review')).toBe(2)
    expect(count('instrument')).toBe(1)
    expect(count('project_reviewer')).toBe(2)
  })

  it('lets a person look at their own work and nobody else look at theirs', async () => {
    const own = await asAuthenticated(LEAVER)
    const { rows } = await own.query(
      `SELECT * FROM api.preview_member_handover($1::uuid, $2)`,
      [WS, LEAVER],
    )
    expect(rows.length).toBeGreaterThan(0)

    const other = await asAuthenticated(OTHER)
    await expectDenied(
      other.query(`SELECT * FROM api.preview_member_handover($1::uuid, $2)`, [
        WS,
        LEAVER,
      ]),
      'SB052',
    )
  })
})

describe('hand_over_member_work', () => {
  it('refuses a recipient who cannot do work', async () => {
    const lead = await asAuthenticated(LEAD)
    for (const recipient of [VIEWER, SUSPENDED, LEAVER, 'nobody']) {
      await expectDenied(
        lead.query(
          `SELECT api.hand_over_member_work($1::uuid, $2, $3, ARRAY['task'])`,
          [WS, LEAVER, recipient],
        ),
        '22023',
      )
    }
  })

  it('refuses someone who is neither a lead nor the person themselves', async () => {
    const other = await asAuthenticated(OTHER)
    await expectDenied(
      other.query(
        `SELECT api.hand_over_member_work($1::uuid, $2, $3, ARRAY['task'])`,
        [WS, LEAVER, HEIR],
      ),
      'SB052',
    )
  })

  it('moves what the recipient can take and reports what stays', async () => {
    const lead = await asAuthenticated(LEAD)
    const { rows } = await lead.query(
      `SELECT api.hand_over_member_work($1::uuid, $2, $3, $4::text[]) AS result`,
      [
        WS,
        LEAVER,
        HEIR,
        [
          'record:experiment',
          'record:sample',
          'record_reviewer',
          'task',
          'review',
          'instrument',
          'project_reviewer',
        ],
      ],
    )
    const { moved, kept } = rows[0].result
    // Of the three open experiments, the one in the closed project cannot move.
    expect(moved['record:experiment']).toBe(2)
    expect(kept['record:experiment']).toBe(1)
    expect(moved['record:sample']).toBe(1)
    expect(moved.record_reviewer).toBe(1)
    // The shared task drops the leaver; the open task passes on.
    expect(moved.task).toBe(3)
    // The review the heir wrote stays; the other moves, replacing the leaver.
    expect(moved.review).toBe(1)
    expect(kept.review).toBe(1)
    expect(moved.instrument).toBe(1)
    // The closed project cannot be taken by someone who cannot open it.
    expect(moved.project_reviewer).toBe(1)
    expect(kept.project_reviewer).toBe(1)

    const assignees = await migrator.query(
      `SELECT identifier, assignee_user_id, reviewer_user_id FROM api.records
        WHERE workspace_id = $1 ORDER BY identifier`,
      [WS],
    )
    const byId = Object.fromEntries(
      assignees.rows.map((r) => [r.identifier, r]),
    )
    expect(byId['EXP-1'].assignee_user_id).toBe(HEIR)
    expect(byId['EXP-1'].reviewer_user_id).toBe(HEIR)
    expect(byId['EXP-2'].assignee_user_id).toBe(HEIR)
    expect(byId['SMP-1'].assignee_user_id).toBe(HEIR)
    expect(byId['EXP-4'].assignee_user_id).toBe(LEAVER)
    expect(byId['EXP-5'].assignee_user_id).toBe(LEAVER)

    const tasks = await migrator.query(
      `SELECT task_id, user_id FROM api.study_task_assignments WHERE workspace_id = $1`,
      [WS],
    )
    const holders = (task: string) =>
      tasks.rows.filter((r) => r.task_id === task).map((r) => r.user_id)
    expect(holders(id('9002', 1))).toEqual([HEIR])
    expect(holders(id('9002', 2))).toEqual([LEAVER])
    expect(holders(id('9002', 3))).toEqual([HEIR])
    expect(holders(id('9002', 4))).toEqual([HEIR])

    const reviews = await migrator.query(
      `SELECT id, assigned_reviewer_user_ids FROM api.review_submissions ORDER BY idempotency_key`,
    )
    expect(reviews.rows[0].assigned_reviewer_user_ids).toEqual([HEIR, OTHER])
    expect(reviews.rows[1].assigned_reviewer_user_ids).toEqual([LEAVER])

    const instrument = await migrator.query(
      `SELECT owner_id FROM api.instruments WHERE id = $1`,
      [id('9003', 1)],
    )
    expect(instrument.rows[0].owner_id).toBe(HEIR)
    const projects = await migrator.query(
      `SELECT key, default_reviewer_user_id FROM api.projects WHERE workspace_id = $1 ORDER BY key`,
      [WS],
    )
    expect(projects.rows).toEqual([
      { key: 'closed', default_reviewer_user_id: LEAVER },
      { key: 'open', default_reviewer_user_id: HEIR },
    ])
  })

  it('lets a person hand over their own work', async () => {
    const own = await asAuthenticated(LEAVER)
    const { rows } = await own.query(
      `SELECT api.hand_over_member_work($1::uuid, $2, $3, ARRAY['record:experiment']) AS result`,
      [WS, LEAVER, OTHER],
    )
    // The one left sits in the project the other member cannot open.
    expect(rows[0].result.moved).toEqual({})
    expect(rows[0].result.kept['record:experiment']).toBe(1)
  })

  it('records the handover in the audit trail', async () => {
    const { rows } = await migrator.query(
      `SELECT payload FROM api.change_events
        WHERE workspace_id = $1 AND payload->>'action' = 'work-handed-over'
        ORDER BY created_at LIMIT 1`,
      [WS],
    )
    expect(rows[0].payload.toUserId).toBe(HEIR)
    expect(rows[0].payload.moved.task).toBe(3)
  })
})
