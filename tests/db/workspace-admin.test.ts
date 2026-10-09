/**
 * ADMIN-001 integration proof for workspace invitations, membership
 * administration, sessions, project access, audit export, and settings.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS_A = '00000000-0000-4000-8000-000000001a01'
const WS_B = '00000000-0000-4000-8000-000000001b01'
const PROJ_A = '00000000-0000-4000-8000-000000001a02'
const OWNER_A = 'admin001-owner-a'
const OWNER_B = 'admin001-owner-b'
const MEMBER_A = 'admin001-member-a'
const INVITED = 'admin001-invited'
const EXPIRED = 'admin001-expired'
const REMOVABLE = 'admin001-removable'
const LAST_OWNER_TARGET = 'admin001-last-owner-target'
const SESSION_A = 'admin001-session-1'
const SESSION_B = 'admin001-session-2'

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

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'ADMIN001 Owner A', 'admin001-owner-a@sheetbase.test', true),
      ('${OWNER_B}', 'ADMIN001 Owner B', 'admin001-owner-b@sheetbase.test', true),
      ('${MEMBER_A}', 'ADMIN001 Member A', 'admin001-member-a@sheetbase.test', true),
      ('${INVITED}', 'ADMIN001 Invited', 'admin001-invited@sheetbase.test', true),
      ('${EXPIRED}', 'ADMIN001 Expired', 'admin001-expired@sheetbase.test', true),
      ('${REMOVABLE}', 'ADMIN001 Removable', 'admin001-removable@sheetbase.test', true),
      ('${LAST_OWNER_TARGET}', 'ADMIN001 Last Owner Target', 'admin001-last-owner@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'admin001-a', 'ADMIN001 A'),
      ('${WS_B}', 'admin001-b', 'ADMIN001 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role, suspended_at) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner', NULL),
      ('${WS_A}', '${MEMBER_A}', 'member', NULL),
      ('${WS_A}', '${REMOVABLE}', 'member', NULL),
      ('${WS_A}', '${LAST_OWNER_TARGET}', 'owner', now()),
      ('${WS_B}', '${OWNER_B}', 'owner', NULL);
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'admin001-proj-a', 'ADMIN001 Project A');
     INSERT INTO internal.session (id, "expiresAt", token, "userId", "ipAddress", "userAgent") VALUES
      ('${SESSION_A}', now() + interval '1 day', 'token-admin001-1', '${MEMBER_A}', '10.0.0.1', 'Test Agent'),
      ('${SESSION_B}', now() + interval '1 day', 'token-admin001-2', '${OWNER_B}', '10.0.0.2', 'Test Agent');`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJ_A,
    userId: OWNER_A,
    canView: true,
    canEdit: true,
    canReview: true,
    canManage: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJ_A,
    userId: MEMBER_A,
    canView: true,
    canEdit: false,
  })
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('ADMIN-001 invitations', () => {
  it('allows an owner to create and revoke a pending invitation', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.create_invitation($1, $2, $3, $4) AS invitation`,
      [WS_A, 'revoke-admin001@sheetbase.test', 'member', 7],
    )
    expect(rows[0].invitation.token).toBeTypeOf('string')
    const { rows: revoked } = await owner.query(
      `SELECT * FROM api.revoke_invitation($1, $2)`,
      [WS_A, rows[0].invitation.id],
    )
    expect(revoked[0].status).toBe('revoked')
  })

  it('denies invitation creation by members and cross-workspace owners', async () => {
    const member = await asAuthenticated(MEMBER_A, WS_A)
    await expectDenied(
      member.query(`SELECT api.create_invitation($1, $2)`, [
        WS_A,
        'denied-admin001@sheetbase.test',
      ]),
      'SB061',
    )
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT api.create_invitation($1, $2)`, [
        WS_A,
        'cross-admin001@sheetbase.test',
      ]),
      'SB061',
    )
  })

  it('accepts a valid token once and creates the invited role membership', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.create_invitation($1, $2, 'scientist', 7) AS invitation`,
      [WS_A, 'admin001-invited@sheetbase.test'],
    )
    const token = rows[0].invitation.token
    const invited = await asAuthenticated(INVITED, WS_A)
    const { rows: accepted } = await invited.query(
      `SELECT * FROM api.accept_invitation($1, $2)`,
      [token, INVITED],
    )
    expect(accepted[0].status).toBe('accepted')
    const { rows: memberships } = await migrator.query(
      `SELECT role FROM api.workspace_memberships WHERE workspace_id=$1 AND user_id=$2`,
      [WS_A, INVITED],
    )
    expect(memberships[0].role).toBe('scientist')
    await expectDenied(
      invited.query(`SELECT * FROM api.accept_invitation($1, $2)`, [
        token,
        INVITED,
      ]),
      'SB061',
    )
  })

  it('rejects invalid and expired invitation tokens', async () => {
    const expiredUser = await asAuthenticated(EXPIRED, WS_A)
    await expectDenied(
      expiredUser.query(`SELECT * FROM api.accept_invitation($1, $2)`, [
        'invalid-admin001-token',
        EXPIRED,
      ]),
      'SB061',
    )
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.create_invitation($1, $2, 'member', 7) AS invitation`,
      [WS_A, 'admin001-expired@sheetbase.test'],
    )
    await migrator.query(
      `UPDATE api.workspace_invitations SET expires_at = now() - interval '1 day' WHERE id = $1`,
      [rows[0].invitation.id],
    )
    await expectDenied(
      expiredUser.query(`SELECT * FROM api.accept_invitation($1, $2)`, [
        rows[0].invitation.token,
        EXPIRED,
      ]),
      'SB061',
    )
  })
})

describe('ADMIN-001 member roles and removal', () => {
  it('prevents self role changes and validates roles', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.change_member_role($1, $2, 'member')`, [
        WS_A,
        OWNER_A,
      ]),
      'SB050',
    )
    await expectDenied(
      owner.query(`SELECT * FROM api.change_member_role($1, $2, 'invalid')`, [
        WS_A,
        MEMBER_A,
      ]),
      'SB053',
    )
  })

  it('changes another member role and protects the last active owner', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.change_member_role($1, $2, 'scientist')`,
      [WS_A, MEMBER_A],
    )
    expect(rows[0].role).toBe('scientist')
    await expectDenied(
      owner.query(`SELECT * FROM api.change_member_role($1, $2, 'member')`, [
        WS_A,
        LAST_OWNER_TARGET,
      ]),
      'SB051',
    )
  })

  it('removes a member but cannot remove self or the last active owner', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await owner.query(`SELECT api.remove_member($1, $2)`, [WS_A, REMOVABLE])
    const { rows } = await migrator.query(
      `SELECT count(*)::int AS n FROM api.workspace_memberships WHERE workspace_id=$1 AND user_id=$2`,
      [WS_A, REMOVABLE],
    )
    expect(rows[0].n).toBe(0)
    await expectDenied(
      owner.query(`SELECT api.remove_member($1, $2)`, [WS_A, OWNER_A]),
      'SB050',
    )
    await expectDenied(
      owner.query(`SELECT api.remove_member($1, $2)`, [
        WS_A,
        LAST_OWNER_TARGET,
      ]),
      'SB051',
    )
  })
})

describe('ADMIN-001 suspension and immediate enforcement', () => {
  it('suspends and reinstates a member with immediate project RLS enforcement', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const member = await asAuthenticated(MEMBER_A, WS_A)
    const { rows: before } = await member.query(
      `SELECT id FROM api.projects WHERE id=$1`,
      [PROJ_A],
    )
    expect(before).toHaveLength(1)
    const { rows: suspended } = await owner.query(
      `SELECT * FROM api.suspend_member($1, $2)`,
      [WS_A, MEMBER_A],
    )
    expect(suspended[0].suspended_at).not.toBeNull()
    const { rows: hidden } = await member.query(
      `SELECT id FROM api.projects WHERE id=$1`,
      [PROJ_A],
    )
    expect(hidden).toHaveLength(0)
    const { rows: reinstated } = await owner.query(
      `SELECT * FROM api.reinstate_member($1, $2)`,
      [WS_A, MEMBER_A],
    )
    expect(reinstated[0].suspended_at).toBeNull()
    const { rows: visible } = await member.query(
      `SELECT id FROM api.projects WHERE id=$1`,
      [PROJ_A],
    )
    expect(visible).toHaveLength(1)
  })

  it('does not allow an owner to suspend themselves', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.suspend_member($1, $2)`, [WS_A, OWNER_A]),
      'SB050',
    )
  })
})

describe('ADMIN-001 session administration', () => {
  it('lists workspace sessions for owners but not members', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.list_workspace_sessions($1)::text AS sessions`,
      [WS_A],
    )
    const sessions = JSON.parse(rows[0].sessions)
    expect(sessions.some((session: any) => session.id === SESSION_A)).toBe(true)
    const member = await asAuthenticated(MEMBER_A, WS_A)
    await expectDenied(
      member.query(`SELECT api.list_workspace_sessions($1)`, [WS_A]),
      'SB055',
    )
  })

  it('revokes a workspace session and rejects one from another workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT api.revoke_user_session($1, $2)`, [WS_A, SESSION_B]),
      'SB055',
    )
    await owner.query(`SELECT api.revoke_user_session($1, $2)`, [
      WS_A,
      SESSION_A,
    ])
    const { rows } = await migrator.query(
      `SELECT count(*)::int AS n FROM internal.session WHERE id=$1`,
      [SESSION_A],
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('ADMIN-001 project access', () => {
  it('allows owners to grant and revoke project access', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.grant_project_access($1, $2, $3, 'editor')`,
      [WS_A, PROJ_A, MEMBER_A],
    )
    expect(rows[0].access_level).toBe('editor')
    await owner.query(`SELECT api.revoke_project_access($1, $2, $3)`, [
      WS_A,
      PROJ_A,
      MEMBER_A,
    ])
    const { rows: remaining } = await migrator.query(
      `SELECT count(*)::int AS n FROM api.project_access WHERE project_id=$1 AND user_id=$2`,
      [PROJ_A, MEMBER_A],
    )
    expect(remaining[0].n).toBe(0)
  })

  it('denies members and invalid access levels', async () => {
    const member = await asAuthenticated(MEMBER_A, WS_A)
    await expectDenied(
      member.query(
        `SELECT * FROM api.grant_project_access($1, $2, $3, 'viewer')`,
        [WS_A, PROJ_A, MEMBER_A],
      ),
      // The 0323 entry guard fails closed before the capability check.
      '42501',
    )
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(
        `SELECT * FROM api.grant_project_access($1, $2, $3, 'invalid')`,
        [WS_A, PROJ_A, MEMBER_A],
      ),
      '22023',
    )
  })
})

describe('ADMIN-001 audit export and workspace settings', () => {
  it('exports a bounded audit array for owners only', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT api.export_audit_log($1, NULL, NULL, 100)::text AS events`,
      [WS_A],
    )
    expect(Array.isArray(JSON.parse(rows[0].events))).toBe(true)
    const member = await asAuthenticated(MEMBER_A, WS_A)
    await expectDenied(
      member.query(`SELECT api.export_audit_log($1)`, [WS_A]),
      'SB060',
    )
    await expectDenied(
      owner.query(`SELECT api.export_audit_log($1, NULL, NULL, 5001)`, [WS_A]),
      'SB060',
    )
  })

  it('allows owners to update valid settings and rejects invalid values', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.update_workspace_settings($1, 'invitation_only', true, NULL, NULL, 365, NULL)`,
      [WS_A],
    )
    expect(rows[0]).toMatchObject({
      registration_mode: 'invitation_only',
      review_workflow_enabled: true,
      audit_retention_days: 365,
    })
    await expectDenied(
      owner.query(
        `SELECT * FROM api.update_workspace_settings($1, 'invalid')`,
        [WS_A],
      ),
      'SB056',
    )
    await expectDenied(
      owner.query(
        `SELECT * FROM api.update_workspace_settings($1, NULL, NULL, NULL, NULL, 0, NULL)`,
        [WS_A],
      ),
      'SB057',
    )
    const member = await asAuthenticated(MEMBER_A, WS_A)
    await expectDenied(
      member.query(`SELECT * FROM api.update_workspace_settings($1, 'open')`, [
        WS_A,
      ]),
      'SB056',
    )
  })
})

describe('ADMIN-001 cross-workspace isolation', () => {
  it('prevents workspace B owner from managing workspace A resources', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT * FROM api.change_member_role($1, $2, 'viewer')`, [
        WS_A,
        MEMBER_A,
      ]),
      'SB052',
    )
    await expectDenied(
      ownerB.query(`SELECT * FROM api.update_workspace_settings($1, 'open')`, [
        WS_A,
      ]),
      'SB056',
    )
    await expectDenied(
      ownerB.query(`SELECT api.list_workspace_sessions($1)`, [WS_A]),
      'SB055',
    )
    await expectDenied(
      ownerB.query(`SELECT api.create_invitation($1, $2)`, [
        WS_A,
        'isolated-admin001@sheetbase.test',
      ]),
      'SB061',
    )
  })
})
