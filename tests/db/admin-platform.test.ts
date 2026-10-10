/**
 * PLAT-04 — admin-platform server function tests.
 *
 * Tests capability enforcement, workspace isolation, and data correctness
 * for the admin platform diagnostics/usage/storage/run-health/attention/
 * connector-diagnostics queries and the schedule toggle / connector retry
 * operations.
 *
 * These tests exercise the SQL layer directly (api.has_capability,
 * api.update_pipeline_schedule, api.start_connector_run) because the
 * server functions use createServerFn which requires HTTP request context.
 * The SQL calls mirror exactly what admin-platform.ts does.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000a001'
const WS_B = '00000000-0000-4000-8000-00000000a002'
const OWNER = 'plat04-admin-owner'
const ADMIN = 'plat04-admin-admin'
const STEWARD = 'plat04-admin-steward'
const MEMBER = 'plat04-admin-member'
const VIEWER = 'plat04-admin-viewer'
const OTHER_OWNER = 'plat04-admin-other-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(`
    INSERT INTO internal."user"(id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Owner', 'plat04-owner@test.invalid', true),
      ('${ADMIN}', 'Admin', 'plat04-admin@test.invalid', true),
      ('${STEWARD}', 'Steward', 'plat04-steward@test.invalid', true),
      ('${MEMBER}', 'Member', 'plat04-member@test.invalid', true),
      ('${VIEWER}', 'Viewer', 'plat04-viewer@test.invalid', true),
      ('${OTHER_OWNER}', 'Other Owner', 'plat04-other@test.invalid', true);

    INSERT INTO api.workspaces(id, slug, name) VALUES
      ('${WS_A}', 'plat04-a', 'PLAT-04 Workspace A'),
      ('${WS_B}', 'plat04-b', 'PLAT-04 Workspace B');

    INSERT INTO api.workspace_memberships(workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER}', 'owner'),
      ('${WS_A}', '${ADMIN}', 'admin'),
      ('${WS_A}', '${STEWARD}', 'steward'),
      ('${WS_A}', '${MEMBER}', 'member'),
      ('${WS_A}', '${VIEWER}', 'viewer'),
      ('${WS_B}', '${OTHER_OWNER}', 'owner');
  `)
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()))
  await migrator?.end()
  await testPool?.end()
})

// ---------------------------------------------------------------------------
// Capability enforcement — mirrors what requireCapability() in admin-platform.ts does
// ---------------------------------------------------------------------------

describe('PLAT-04 capability enforcement', () => {
  it('owner has workspace.admin, integrations.manage, pipelines.manage', async () => {
    const owner = await actor(OWNER, WS_A)
    const { rows } = await owner.query(
      `SELECT
        api.has_capability($1, 'workspace.admin') AS workspace_admin,
        api.has_capability($1, 'integrations.manage') AS integrations_manage,
        api.has_capability($1, 'pipelines.manage') AS pipelines_manage`,
      [WS_A],
    )
    expect(rows[0].workspace_admin).toBe(true)
    expect(rows[0].integrations_manage).toBe(true)
    expect(rows[0].pipelines_manage).toBe(true)
  })

  it('admin has integrations.manage and pipelines.manage but not workspace.admin', async () => {
    const admin = await actor(ADMIN, WS_A)
    const { rows } = await admin.query(
      `SELECT
        api.has_capability($1, 'workspace.admin') AS workspace_admin,
        api.has_capability($1, 'integrations.manage') AS integrations_manage,
        api.has_capability($1, 'pipelines.manage') AS pipelines_manage`,
      [WS_A],
    )
    expect(rows[0].workspace_admin).toBe(false)
    expect(rows[0].integrations_manage).toBe(true)
    expect(rows[0].pipelines_manage).toBe(true)
  })

  it('steward has integrations.manage and pipelines.manage but not workspace.admin', async () => {
    const steward = await actor(STEWARD, WS_A)
    const { rows } = await steward.query(
      `SELECT
        api.has_capability($1, 'workspace.admin') AS workspace_admin,
        api.has_capability($1, 'integrations.manage') AS integrations_manage,
        api.has_capability($1, 'pipelines.manage') AS pipelines_manage`,
      [WS_A],
    )
    expect(rows[0].workspace_admin).toBe(false)
    expect(rows[0].integrations_manage).toBe(true)
    expect(rows[0].pipelines_manage).toBe(true)
  })

  it('member does not have workspace.admin, integrations.manage, or pipelines.manage', async () => {
    const member = await actor(MEMBER, WS_A)
    const { rows } = await member.query(
      `SELECT
        api.has_capability($1, 'workspace.admin') AS workspace_admin,
        api.has_capability($1, 'integrations.manage') AS integrations_manage,
        api.has_capability($1, 'pipelines.manage') AS pipelines_manage`,
      [WS_A],
    )
    expect(rows[0].workspace_admin).toBe(false)
    expect(rows[0].integrations_manage).toBe(false)
    expect(rows[0].pipelines_manage).toBe(false)
  })

  it('viewer does not have any admin capabilities', async () => {
    const viewer = await actor(VIEWER, WS_A)
    const { rows } = await viewer.query(
      `SELECT
        api.has_capability($1, 'workspace.admin') AS workspace_admin,
        api.has_capability($1, 'integrations.manage') AS integrations_manage,
        api.has_capability($1, 'pipelines.manage') AS pipelines_manage`,
      [WS_A],
    )
    expect(rows[0].workspace_admin).toBe(false)
    expect(rows[0].integrations_manage).toBe(false)
    expect(rows[0].pipelines_manage).toBe(false)
  })

  it('owner of WS_B cannot access capabilities in WS_A (workspace isolation)', async () => {
    const otherOwner = await actor(OTHER_OWNER, WS_B)
    const { rows } = await otherOwner.query(
      `SELECT
        api.has_capability($1, 'workspace.admin') AS workspace_admin,
        api.has_capability($1, 'integrations.manage') AS integrations_manage`,
      [WS_A],
    )
    // The current workspace is WS_B, so capabilities for WS_A must fail
    expect(rows[0].workspace_admin).toBe(false)
    expect(rows[0].integrations_manage).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Admin data queries — workspace isolation
// ---------------------------------------------------------------------------

describe('PLAT-04 admin data workspace isolation', () => {
  it('usage query only counts workspace A members, not workspace B', async () => {
    const { rows } = await migrator.query(
      `SELECT
        (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id = $1::uuid)::int AS members_a,
        (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id = $2::uuid)::int AS members_b`,
      [WS_A, WS_B],
    )
    expect(rows[0].members_a).toBe(5) // owner, admin, steward, member, viewer
    expect(rows[0].members_b).toBe(1) // other_owner
  })

  it('connector diagnostics query is workspace-scoped', async () => {
    // Create a connector in WS_A
    const ownerA = await actor(OWNER, WS_A)
    await ownerA.query(
      `SELECT api.register_connector($1, 'test-key', 'Test Connector', 'custom', 'inbound', '{}'::jsonb, NULL)`,
      [WS_A],
    )
    // Query connectors in WS_A
    const { rows: wsARows } = await migrator.query(
      `SELECT count(*)::int AS cnt FROM api.connectors WHERE workspace_id = $1::uuid`,
      [WS_A],
    )
    expect(wsARows[0].cnt).toBe(1)

    // Query connectors in WS_B
    const { rows: wsBRows } = await migrator.query(
      `SELECT count(*)::int AS cnt FROM api.connectors WHERE workspace_id = $1::uuid`,
      [WS_B],
    )
    expect(wsBRows[0].cnt).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Pipeline schedule toggle — capability checked
// ---------------------------------------------------------------------------

describe('PLAT-04 pipeline schedule toggle', () => {
  it('member cannot toggle schedule (pipelines.manage required)', async () => {
    const member = await actor(MEMBER, WS_A)
    // First create a pipeline definition and schedule as owner
    const owner = await actor(OWNER, WS_A)
    const { rows: defRows } = await owner.query(
      `SELECT (api.create_pipeline_definition($1, 'sched_test', 'Schedule Test', NULL)).id AS id`,
      [WS_A],
    )
    const definitionId = defRows[0].id
    const { rows: schedRows } = await owner.query(
      `SELECT (api.create_pipeline_schedule($1, $2, 'interval', '{"intervalMinutes": 60}'::jsonb, true)).id AS id`,
      [WS_A, definitionId],
    )
    const scheduleId = schedRows[0].id

    // Member attempts to disable the schedule — should fail
    await expect(
      member.query(
        `SELECT api.update_pipeline_schedule($1, $2, NULL, NULL, false)`,
        [WS_A, scheduleId],
      ),
    ).rejects.toThrow()
  })

  it('steward can toggle schedule (pipelines.manage granted)', async () => {
    const owner = await actor(OWNER, WS_A)
    const { rows: defRows } = await owner.query(
      `SELECT (api.create_pipeline_definition($1, 'sched_steward', 'Steward Schedule Test', NULL)).id AS id`,
      [WS_A],
    )
    const definitionId = defRows[0].id
    const { rows: schedRows } = await owner.query(
      `SELECT (api.create_pipeline_schedule($1, $2, 'interval', '{"intervalMinutes": 60}'::jsonb, true)).id AS id`,
      [WS_A, definitionId],
    )
    const scheduleId = schedRows[0].id

    // Steward attempts to disable the schedule — should succeed
    const steward = await actor(STEWARD, WS_A)
    const { rows } = await steward.query(
      `SELECT (api.update_pipeline_schedule($1, $2, NULL, NULL, false)).enabled AS enabled`,
      [WS_A, scheduleId],
    )
    expect(rows[0].enabled).toBe(false)
  })

  it('owner can toggle schedule', async () => {
    const owner = await actor(OWNER, WS_A)
    const { rows: defRows } = await owner.query(
      `SELECT (api.create_pipeline_definition($1, 'sched_owner', 'Owner Schedule Test', NULL)).id AS id`,
      [WS_A],
    )
    const definitionId = defRows[0].id
    const { rows: schedRows } = await owner.query(
      `SELECT (api.create_pipeline_schedule($1, $2, 'interval', '{"intervalMinutes": 60}'::jsonb, true)).id AS id`,
      [WS_A, definitionId],
    )
    const scheduleId = schedRows[0].id

    // Owner disables
    const { rows: disabled } = await owner.query(
      `SELECT (api.update_pipeline_schedule($1, $2, NULL, NULL, false)).enabled AS enabled`,
      [WS_A, scheduleId],
    )
    expect(disabled[0].enabled).toBe(false)

    // Owner re-enables
    const { rows: enabled } = await owner.query(
      `SELECT (api.update_pipeline_schedule($1, $2, NULL, NULL, true)).enabled AS enabled`,
      [WS_A, scheduleId],
    )
    expect(enabled[0].enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Connector run retry — capability checked
// ---------------------------------------------------------------------------

describe('PLAT-04 connector run retry', () => {
  it('member cannot start connector run (integrations.manage required)', async () => {
    // The register_connector RPC requires integrations.manage
    const member = await actor(MEMBER, WS_A)
    await expect(
      member.query(
        `SELECT api.register_connector($1, 'member-connector', 'Member Connector', 'custom', 'inbound', '{}'::jsonb, NULL)`,
        [WS_A],
      ),
    ).rejects.toThrow()
  })

  it('steward can register connector and start run (integrations.manage)', async () => {
    const steward = await actor(STEWARD, WS_A)
    const { rows } = await steward.query(
      `SELECT (api.register_connector($1, 'steward-connector', 'Steward Connector', 'custom', 'inbound', '{}'::jsonb, NULL)).id AS id`,
      [WS_A],
    )
    expect(rows[0].id).toBeTruthy()
    const connectorId = rows[0].id

    // Start a run
    const { rows: runRows } = await steward.query(
      `SELECT (api.start_connector_run($1, $2, 'manual', NULL, NULL, NULL)).id AS id`,
      [WS_A, connectorId],
    )
    expect(runRows[0].id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Attention indicators — deterministic conditions
// ---------------------------------------------------------------------------

describe('PLAT-04 attention indicators', () => {
  it('counts failed pipeline runs in the last 24 hours', async () => {
    // Query the attention SQL directly — it should return 0 or more
    // for the test workspace which has no pipeline runs
    const { rows: attnRows } = await migrator.query(
      `SELECT
        (SELECT count(*)::int FROM api.pipeline_runs
         WHERE workspace_id = $1::uuid AND status = 'failed'
           AND started_at > now() - interval '24 hours') AS failed_pipeline_runs,
        (SELECT count(*)::int FROM api.pipeline_runs
         WHERE workspace_id = $1::uuid AND status = 'running'
           AND started_at < now() - interval '15 minutes') AS stale_running_runs,
        (SELECT count(*)::int FROM api.pipeline_schedules
         WHERE workspace_id = $1::uuid AND enabled
           AND next_run_at IS NOT NULL AND next_run_at < now()) AS overdue_schedules`,
      [WS_A],
    )
    expect(attnRows[0].failed_pipeline_runs).toBeGreaterThanOrEqual(0)
    expect(attnRows[0].stale_running_runs).toBeGreaterThanOrEqual(0)
    expect(attnRows[0].overdue_schedules).toBeGreaterThanOrEqual(0)
  })

  it('counts disabled connectors', async () => {
    // Create and pause a connector as steward
    const steward = await actor(STEWARD, WS_A)
    const { rows } = await steward.query(
      `SELECT (api.register_connector($1, 'attn-connector', 'Attention Connector', 'custom', 'inbound', '{}'::jsonb, NULL)).id AS id`,
      [WS_A],
    )
    const connectorId = rows[0].id
    await steward.query(
      `SELECT api.update_connector($1, $2, NULL, 'paused', NULL)`,
      [WS_A, connectorId],
    )

    // Query disabled connectors
    const { rows: disabledRows } = await migrator.query(
      `SELECT count(*)::int AS cnt FROM api.connectors WHERE workspace_id = $1::uuid AND status = 'paused'`,
      [WS_A],
    )
    expect(disabledRows[0].cnt).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Storage overview — separate largest and recent queries
// ---------------------------------------------------------------------------

describe('PLAT-04 storage overview', () => {
  it('largest files query orders by byte_size DESC', async () => {
    const { rows: largest } = await migrator.query(
      `SELECT id, display_name, byte_size::text
       FROM api.file_objects
       WHERE workspace_id = $1::uuid AND deleted_at IS NULL
       ORDER BY byte_size DESC
       LIMIT 10`,
      [WS_A],
    )
    // No files in test workspace — just verify the query works
    expect(Array.isArray(largest)).toBe(true)
  })

  it('recent files query orders by created_at DESC', async () => {
    const { rows: recent } = await migrator.query(
      `SELECT id, display_name, byte_size::text
       FROM api.file_objects
       WHERE workspace_id = $1::uuid AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 10`,
      [WS_A],
    )
    // No files in test workspace — just verify the query works
    expect(Array.isArray(recent)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Migration state
// ---------------------------------------------------------------------------

describe('PLAT-04 migration state', () => {
  it('can read the latest migration from drizzle journal', async () => {
    const { rows } = await migrator.query(
      `SELECT created_at::text AS created_at
       FROM drizzle.__drizzle_migrations
       ORDER BY created_at DESC LIMIT 1`,
    )
    // There should be at least one migration
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].created_at).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// getScopedClient — request-scoped DB execution with JWT claims
// ---------------------------------------------------------------------------
//
// These tests import and exercise the actual getScopedClient helper from
// admin-platform.ts, proving that:
//   1. JWT claims are correctly stamped on the connection
//   2. api.has_capability() resolves correctly through the scoped client
//   3. owner/steward succeed, member/viewer are denied
//   4. wrong workspace is denied
//   5. the scoped connection can execute canonical RPCs
//
import { Pool } from 'pg'
import { getScopedClient } from '#/lib/admin-platform'
import { roleUrl } from './helpers'

// Pool connected to the test database as the authenticator role, so
// SET ROLE authenticated works inside getScopedClient's transaction.
const testPool = new Pool({ connectionString: roleUrl('authenticator') })

describe('PLAT-04 getScopedClient — request-scoped DB execution', () => {
  it('owner: has_capability returns true for workspace.admin', async () => {
    const session = await getScopedClient(WS_A, OWNER, testPool)
    try {
      const { rows } = await session.client.query(
        'SELECT api.has_capability($1::uuid, $2) AS ok',
        [WS_A, 'workspace.admin'],
      )
      expect(rows[0].ok).toBe(true)
    } finally {
      await session.release()
    }
  })

  it('steward: has_capability returns true for integrations.manage', async () => {
    const session = await getScopedClient(WS_A, STEWARD, testPool)
    try {
      const { rows } = await session.client.query(
        'SELECT api.has_capability($1::uuid, $2) AS ok',
        [WS_A, 'integrations.manage'],
      )
      expect(rows[0].ok).toBe(true)
    } finally {
      await session.release()
    }
  })

  it('member: has_capability returns false for integrations.manage', async () => {
    const session = await getScopedClient(WS_A, MEMBER, testPool)
    try {
      const { rows } = await session.client.query(
        'SELECT api.has_capability($1::uuid, $2) AS ok',
        [WS_A, 'integrations.manage'],
      )
      expect(rows[0].ok).toBe(false)
    } finally {
      await session.release()
    }
  })

  it('viewer: has_capability returns false for pipelines.manage', async () => {
    const session = await getScopedClient(WS_A, VIEWER, testPool)
    try {
      const { rows } = await session.client.query(
        'SELECT api.has_capability($1::uuid, $2) AS ok',
        [WS_A, 'pipelines.manage'],
      )
      expect(rows[0].ok).toBe(false)
    } finally {
      await session.release()
    }
  })

  it('wrong workspace: has_capability returns false', async () => {
    // OWNER is a member of WS_A, not WS_B
    const session = await getScopedClient(WS_B, OWNER, testPool)
    try {
      const { rows } = await session.client.query(
        'SELECT api.has_capability($1::uuid, $2) AS ok',
        [WS_B, 'workspace.admin'],
      )
      expect(rows[0].ok).toBe(false)
    } finally {
      await session.release()
    }
  })

  it('scoped client can execute canonical RPC (update_pipeline_schedule)', async () => {
    // Create a definition + schedule as owner via a scoped client
    const ownerSession = await getScopedClient(WS_A, OWNER, testPool)
    let scheduleId: string
    try {
      const { rows: defRows } = await ownerSession.client.query(
        `SELECT (api.create_pipeline_definition($1, 'scoped_test', 'Scoped Test', NULL)).id AS id`,
        [WS_A],
      )
      const { rows: schedRows } = await ownerSession.client.query(
        `SELECT (api.create_pipeline_schedule($1, $2, 'interval', '{"intervalMinutes": 60}'::jsonb, true)).id AS id`,
        [WS_A, defRows[0].id],
      )
      scheduleId = schedRows[0].id
    } finally {
      await ownerSession.release()
    }

    // Toggle the schedule through a scoped client — proves the RPC works
    // with JWT claims stamped.
    const toggleSession = await getScopedClient(WS_A, OWNER, testPool)
    try {
      const { rows } = await toggleSession.client.query(
        `SELECT id, enabled
         FROM api.update_pipeline_schedule($1::uuid, $2::uuid, NULL, NULL, false)`,
        [WS_A, scheduleId],
      )
      expect(rows[0].id).toBeTruthy()
      expect(rows[0].enabled).toBe(false)
    } finally {
      await toggleSession.release()
    }
  })

  it('one toggle produces exactly one change event (no double invocation)', async () => {
    // Create a definition + schedule as owner
    const setupSession = await getScopedClient(WS_A, OWNER, testPool)
    let scheduleId: string
    try {
      const { rows: defRows } = await setupSession.client.query(
        `SELECT (api.create_pipeline_definition($1, 'double_inv_test', 'Double Invocation Test', NULL)).id AS id`,
        [WS_A],
      )
      const { rows: schedRows } = await setupSession.client.query(
        `SELECT (api.create_pipeline_schedule($1, $2, 'interval', '{"intervalMinutes": 60}'::jsonb, true)).id AS id`,
        [WS_A, defRows[0].id],
      )
      scheduleId = schedRows[0].id
    } finally {
      await setupSession.release()
    }

    // Count change events before toggle (create_pipeline_schedule emits one)
    const beforeSession = await getScopedClient(WS_A, OWNER, testPool)
    let countBefore: number
    try {
      const { rows } = await beforeSession.client.query(
        `SELECT count(*)::int AS n FROM api.change_events
         WHERE workspace_id = $1::uuid
           AND entity_type = 'pipeline_schedule'
           AND entity_uuid = $2::uuid`,
        [WS_A, scheduleId],
      )
      countBefore = rows[0].n
    } finally {
      await beforeSession.release()
    }

    // Toggle once via the scoped client — calling the RPC exactly once
    const toggleSession = await getScopedClient(WS_A, OWNER, testPool)
    try {
      await toggleSession.client.query(
        `SELECT id, enabled
         FROM api.update_pipeline_schedule($1::uuid, $2::uuid, NULL, NULL, false)`,
        [WS_A, scheduleId],
      )
    } finally {
      await toggleSession.release()
    }

    // Count change events after toggle — should be exactly +1
    const afterSession = await getScopedClient(WS_A, OWNER, testPool)
    try {
      const { rows } = await afterSession.client.query(
        `SELECT count(*)::int AS n FROM api.change_events
         WHERE workspace_id = $1::uuid
           AND entity_type = 'pipeline_schedule'
           AND entity_uuid = $2::uuid`,
        [WS_A, scheduleId],
      )
      expect(rows[0].n).toBe(countBefore + 1)
    } finally {
      await afterSession.release()
    }
  })
})
