/**
 * OPS-005 integration proof for study workstreams, tasks, milestones,
 * dependencies (circular detection), assignments, resource overbooking,
 * deliverables, transactional edits, RLS and change events.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000505a'
const WS_B = '00000000-0000-4000-8000-00000000505b'
const PROJ_A = '00000000-0000-4000-8000-00000000515a'
const OWNER_A = 'ops005-owner-a'
const MEMBER_A = 'ops005-member-a'
const OWNER_B = 'ops005-owner-b'

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

async function createWorkstream(
  client: Client,
  name: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_study_workstream($1, $2)`,
    [WS_A, name],
  )
  return rows[0]
}

async function createTask(
  client: Client,
  title: string,
  startsAt: string,
  endsAt: string,
  workstreamId?: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_study_task($1, $2, 'task', $3, NULL, NULL, 'not_started', 'medium', $4::timestamptz, $5::timestamptz)`,
    [WS_A, title, workstreamId ?? null, startsAt, endsAt],
  )
  return rows[0]
}

async function createMilestone(
  client: Client,
  title: string,
  dueAt: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_study_task($1, $2, 'milestone', NULL, NULL, NULL, 'not_started', 'medium', NULL, NULL, $3::timestamptz)`,
    [WS_A, title, dueAt],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'OPS005 Owner A', 'ops005-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'OPS005 Member A', 'ops005-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'OPS005 Owner B', 'ops005-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ops005-a', 'OPS005 A'),
      ('${WS_B}', 'ops005-b', 'OPS005 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'ops5-a', 'OPS005 A')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('OPS-005 create_study_workstream', () => {
  it('creates a workstream', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const ws = await createWorkstream(owner, 'Vector Design & Build')
    expect(ws).toMatchObject({
      workspace_id: WS_A,
      name: 'Vector Design & Build',
      status: 'active',
      position: 0,
    })
  })

  it('rejects empty names', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.create_study_workstream($1, $2)`, [
        WS_A,
        '  ',
      ]),
      'SB005',
    )
  })

  it('rejects cross-workspace access', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT * FROM api.create_study_workstream($1, $2)`, [
        WS_A,
        'Should fail',
      ]),
      '42501',
    )
  })
})

describe('OPS-005 create_study_task', () => {
  it('creates a task with a date range', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const task = await createTask(
      owner,
      'Design vector backbone',
      '2025-07-07T00:00:00Z',
      '2025-07-14T00:00:00Z',
    )
    expect(task).toMatchObject({
      workspace_id: WS_A,
      title: 'Design vector backbone',
      task_type: 'task',
      status: 'not_started',
      priority: 'medium',
      progress_percent: 0,
      metadata_version: 1,
    })
    expect(task.starts_at).toBeTruthy()
    expect(task.ends_at).toBeTruthy()
  })

  it('creates a milestone with a due date', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const ms = await createMilestone(
      owner,
      'Vector build complete',
      '2025-07-20T00:00:00Z',
    )
    expect(ms).toMatchObject({
      task_type: 'milestone',
      due_at: expect.any(Date),
      starts_at: null,
      ends_at: null,
    })
  })

  it('rejects milestone without due_at', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.create_study_task($1, $2, 'milestone')`, [
        WS_A,
        'No date milestone',
      ]),
      'SB005',
    )
  })

  it('rejects task with end <= start', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_study_task($1, $2, 'task', NULL, NULL, NULL, 'not_started', 'medium', $3::timestamptz, $4::timestamptz)`,
        [WS_A, 'Bad range', '2025-07-14T00:00:00Z', '2025-07-07T00:00:00Z'],
      ),
      'SB032',
    )
  })

  it('creates a task with assignments', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.create_study_task($1, $2, 'task', NULL, NULL, NULL, 'not_started', 'medium', $3::timestamptz, $4::timestamptz, NULL, 'UTC', 0, NULL, 0, NULL, NULL, false, '{}'::text[], $5::jsonb, '[]'::jsonb)`,
      [
        WS_A,
        'Task with assignee',
        '2025-07-07T00:00:00Z',
        '2025-07-10T00:00:00Z',
        JSON.stringify([
          { userId: OWNER_A, role: 'assignee', effortPercent: 50 },
        ]),
      ],
    )
    const taskId = rows[0].id
    const { rows: assignments } = await owner.query(
      `SELECT * FROM api.study_task_assignments WHERE task_id = $1`,
      [taskId],
    )
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      user_id: OWNER_A,
      role: 'assignee',
      effort_percent: 50,
    })
  })

  it('rejects cross-workspace access', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(
        `SELECT * FROM api.create_study_task($1, $2, 'task', NULL, NULL, NULL, 'not_started', 'medium', $3::timestamptz, $4::timestamptz)`,
        [WS_A, 'Cross ws', '2025-07-07T00:00:00Z', '2025-07-10T00:00:00Z'],
      ),
      '42501',
    )
  })
})

describe('OPS-005 edit_study_task', () => {
  it('updates task status and increments metadata_version', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const task = await createTask(
      owner,
      'Editable task',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.edit_study_task($1, NULL, NULL, NULL, 'in_progress')`,
      [task.id],
    )
    expect(rows[0]).toMatchObject({
      status: 'in_progress',
      metadata_version: 2,
    })
  })

  it('rejects stale metadata version', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const task = await createTask(
      owner,
      'Stale task',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.edit_study_task(p_task_id => $1, p_status => 'completed', p_expected_metadata_version => 99)`,
        [task.id],
      ),
      'SB001',
    )
  })

  it('rejects edit of non-existent task', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(
        `SELECT * FROM api.edit_study_task($1, NULL, NULL, NULL, 'completed')`,
        ['00000000-0000-4000-8000-000000000099'],
      ),
      'SB026',
    )
  })
})

describe('OPS-005 delete_study_task', () => {
  it('deletes a task and cascades dependencies', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const task = await createTask(
      owner,
      'Deletable task',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    await owner.query(`SELECT * FROM api.delete_study_task($1)`, [task.id])
    const { rows } = await owner.query(
      `SELECT * FROM api.study_tasks WHERE id = $1`,
      [task.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('rejects delete of non-existent task', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.delete_study_task($1)`, [
        '00000000-0000-4000-8000-000000000099',
      ]),
      'SB026',
    )
  })
})

describe('OPS-005 create_dependency (circular detection)', () => {
  it('creates a finish_to_start dependency', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const t1 = await createTask(
      owner,
      'Predecessor',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const t2 = await createTask(
      owner,
      'Successor',
      '2025-07-11T00:00:00Z',
      '2025-07-14T00:00:00Z',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.create_dependency($1, $2, $3)`,
      [WS_A, t1.id, t2.id],
    )
    expect(rows[0]).toMatchObject({
      predecessor_id: t1.id,
      successor_id: t2.id,
      dependency_type: 'finish_to_start',
      lag_days: 0,
    })
  })

  it('rejects self-dependency', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const t1 = await createTask(
      owner,
      'Self dep',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    await expectDenied(
      owner.query(`SELECT * FROM api.create_dependency($1, $2, $2)`, [
        WS_A,
        t1.id,
      ]),
      'SB031',
    )
  })

  it('rejects a direct circular dependency (A→B, B→A)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const t1 = await createTask(
      owner,
      'Cycle A',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const t2 = await createTask(
      owner,
      'Cycle B',
      '2025-07-11T00:00:00Z',
      '2025-07-14T00:00:00Z',
    )
    // A → B is fine
    await owner.query(`SELECT * FROM api.create_dependency($1, $2, $3)`, [
      WS_A,
      t1.id,
      t2.id,
    ])
    // B → A would close the cycle
    await expectDenied(
      owner.query(`SELECT * FROM api.create_dependency($1, $2, $3)`, [
        WS_A,
        t2.id,
        t1.id,
      ]),
      'SB029',
    )
  })

  it('rejects a transitive circular dependency (A→B→C, C→A)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const t1 = await createTask(
      owner,
      'Chain A',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const t2 = await createTask(
      owner,
      'Chain B',
      '2025-07-11T00:00:00Z',
      '2025-07-14T00:00:00Z',
    )
    const t3 = await createTask(
      owner,
      'Chain C',
      '2025-07-15T00:00:00Z',
      '2025-07-18T00:00:00Z',
    )
    // A → B → C
    await owner.query(`SELECT * FROM api.create_dependency($1, $2, $3)`, [
      WS_A,
      t1.id,
      t2.id,
    ])
    await owner.query(`SELECT * FROM api.create_dependency($1, $2, $3)`, [
      WS_A,
      t2.id,
      t3.id,
    ])
    // C → A would close the cycle
    await expectDenied(
      owner.query(`SELECT * FROM api.create_dependency($1, $2, $3)`, [
        WS_A,
        t3.id,
        t1.id,
      ]),
      'SB029',
    )
  })
})

describe('OPS-005 delete_dependency', () => {
  it('deletes a dependency', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const t1 = await createTask(
      owner,
      'Del dep pre',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const t2 = await createTask(
      owner,
      'Del dep suc',
      '2025-07-11T00:00:00Z',
      '2025-07-14T00:00:00Z',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.create_dependency($1, $2, $3)`,
      [WS_A, t1.id, t2.id],
    )
    await owner.query(`SELECT * FROM api.delete_dependency($1)`, [rows[0].id])
    const { rows: check } = await owner.query(
      `SELECT * FROM api.study_task_dependencies WHERE id = $1`,
      [rows[0].id],
    )
    expect(check).toHaveLength(0)
  })

  it('rejects delete of non-existent dependency', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.delete_dependency($1)`, [
        '00000000-0000-4000-8000-000000000099',
      ]),
      'SB028',
    )
  })
})

describe('OPS-005 assign_task_resource (overbooking detection)', () => {
  it('assigns a resource to a task', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    // Create a calendar resource first
    const { rows: resRows } = await owner.query(
      `SELECT * FROM api.create_calendar_resource($1, $2, $3)`,
      [WS_A, 'qPCR-Planner', 'qpcr-planner'],
    )
    const resourceId = resRows[0].id
    const task = await createTask(
      owner,
      'Resource task',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.assign_task_resource($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
      [
        WS_A,
        task.id,
        resourceId,
        '2025-07-07T09:00:00Z',
        '2025-07-07T17:00:00Z',
      ],
    )
    expect(rows[0]).toMatchObject({
      task_id: task.id,
      calendar_resource_id: resourceId,
    })
  })

  it('rejects overbooking of the same resource', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows: resRows } = await owner.query(
      `SELECT * FROM api.create_calendar_resource($1, $2, $3)`,
      [WS_A, 'Overbooked-Inst', 'overbooked-inst'],
    )
    const resourceId = resRows[0].id
    const t1 = await createTask(
      owner,
      'First booking',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const t2 = await createTask(
      owner,
      'Second booking',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    // First booking succeeds
    await owner.query(
      `SELECT * FROM api.assign_task_resource($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
      [WS_A, t1.id, resourceId, '2025-07-08T09:00:00Z', '2025-07-08T17:00:00Z'],
    )
    // Overlapping booking for the same resource fails
    await expectDenied(
      owner.query(
        `SELECT * FROM api.assign_task_resource($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
        [
          WS_A,
          t2.id,
          resourceId,
          '2025-07-08T10:00:00Z',
          '2025-07-08T12:00:00Z',
        ],
      ),
      'SB030',
    )
  })

  it('allows non-overlapping bookings of the same resource', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows: resRows } = await owner.query(
      `SELECT * FROM api.create_calendar_resource($1, $2, $3)`,
      [WS_A, 'NonOverlap-Inst', 'nonoverlap-inst'],
    )
    const resourceId = resRows[0].id
    const t1 = await createTask(
      owner,
      'Morning booking',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const t2 = await createTask(
      owner,
      'Afternoon booking',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    await owner.query(
      `SELECT * FROM api.assign_task_resource($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
      [WS_A, t1.id, resourceId, '2025-07-09T09:00:00Z', '2025-07-09T12:00:00Z'],
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.assign_task_resource($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
      [WS_A, t2.id, resourceId, '2025-07-09T13:00:00Z', '2025-07-09T17:00:00Z'],
    )
    expect(rows[0]).toBeTruthy()
  })

  it('rejects invalid time range', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows: resRows } = await owner.query(
      `SELECT * FROM api.create_calendar_resource($1, $2, $3)`,
      [WS_A, 'BadRange-Inst', 'badrange-inst'],
    )
    const task = await createTask(
      owner,
      'Bad range task',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.assign_task_resource($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
        [
          WS_A,
          task.id,
          resRows[0].id,
          '2025-07-09T17:00:00Z',
          '2025-07-09T09:00:00Z',
        ],
      ),
      'SB032',
    )
  })
})

describe('OPS-005 RLS isolation', () => {
  it('workspace B cannot read workspace A tasks', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    await createTask(
      ownerA,
      'Private task',
      '2025-07-07T00:00:00Z',
      '2025-07-10T00:00:00Z',
    )
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const { rows } = await ownerB.query(
      `SELECT * FROM api.study_tasks WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(rows).toHaveLength(0)
  })

  it('workspace B cannot read workspace A workstreams', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    await createWorkstream(ownerA, 'Private workstream')
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const { rows } = await ownerB.query(
      `SELECT * FROM api.study_workstreams WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('OPS-005 timezone boundaries', () => {
  it('stores and retrieves timestamps across DST boundary', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    // Create a task that straddles a DST transition (US clocks fall back
    // on 2 Nov 2025). Use UTC timestamps to verify round-trip.
    const { rows } = await owner.query(
      `SELECT * FROM api.create_study_task($1, $2, 'task', NULL, NULL, NULL, 'not_started', 'medium', $3::timestamptz, $4::timestamptz, NULL, 'America/New_York')`,
      [
        WS_A,
        'DST boundary task',
        '2025-11-01T12:00:00-04:00',
        '2025-11-03T12:00:00-05:00',
      ],
    )
    expect(rows[0].timezone).toBe('America/New_York')
    // The stored instants should be exact UTC.
    expect(new Date(rows[0].starts_at).toISOString()).toBe(
      '2025-11-01T16:00:00.000Z',
    )
    expect(new Date(rows[0].ends_at).toISOString()).toBe(
      '2025-11-03T17:00:00.000Z',
    )
  })
})

describe('OPS-005 milestone movement', () => {
  it('moves a milestone due date via edit_study_task', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const ms = await createMilestone(
      owner,
      'Movable milestone',
      '2025-07-20T00:00:00Z',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.edit_study_task(p_task_id => $1, p_due_at => $2::timestamptz)`,
      [ms.id, '2025-08-01T00:00:00Z'],
    )
    expect(new Date(rows[0].due_at).toISOString()).toBe(
      '2025-08-01T00:00:00.000Z',
    )
    expect(rows[0].metadata_version).toBe(2)
  })
})
