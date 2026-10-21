/**
 * Pipeline SQL sandbox boundary.
 *
 * Transform SQL runs on its own connection that logs in as `pipeline_sandbox`.
 * These tests drive that connection with payloads that get past the static
 * statement filter's intent (role resets, XML table readers, forged claims)
 * and prove the role, not the filter, is what holds: the session user is an
 * unprivileged login with no memberships, so resetting the role lands on the
 * same login and every read of a governed table is refused by PostgreSQL.
 */
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  SandboxSession,
  SandboxUnavailableError,
} from '#/lib/pipeline-sandbox.server'
import type { SandboxConnection } from '#/lib/pipeline-sandbox.server'
import { connectTestSandbox, prepareTestDatabase } from './helpers'

const connectSandbox = connectTestSandbox

let admin: Client
const open: SandboxConnection[] = []

async function sandbox(): Promise<SandboxConnection> {
  const conn = await connectSandbox()
  open.push(conn)
  return conn
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  admin = prepared.migrator
  // A governed row the sandbox must never be able to read.
  await admin.query(
    `insert into api.workspaces(id, slug, name)
     values ('0e010000-0000-4000-8000-0000000005b1', 'sandbox-ws', 'Sandbox WS')`,
  )
})

afterAll(async () => {
  for (const conn of open) await conn.end().catch(() => {})
  await admin?.end()
})

describe('pipeline_sandbox login', () => {
  it('is an unprivileged login with no memberships and no bypass', async () => {
    const { rows } = await admin.query(
      `select r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
              r.rolbypassrls, r.rolcanlogin,
              (select count(*) from pg_auth_members m where m.member = r.oid) as memberships,
              (select count(*) from pg_auth_members m where m.roleid = r.oid) as members
         from pg_roles r where r.rolname = 'pipeline_sandbox'`,
    )
    expect(rows[0]).toMatchObject({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
      rolcanlogin: true,
      memberships: '0',
      members: '0',
    })
  })

  it('resetting the role inside a statement lands on the same login', async () => {
    const conn = await sandbox()
    for (const reset of [
      `select set_config('role', 'none', false)`,
      `select set_config('role', 'authenticated', false)`,
      `select set_config('role', 'migrator', false)`,
      `select set_config('session_authorization', 'sheetbase', false)`,
    ]) {
      // The reset itself may be refused (not a member) or silently no-op; what
      // matters is that the identity afterwards is still the sandbox login.
      await conn.query(reset).catch(() => undefined)
      const after = await conn.query<{
        current_user: string
        session_user: string
        super: boolean
      }>(
        `select current_user, session_user,
                (select rolsuper from pg_roles where rolname = current_user) as super`,
      )
      expect(after.rows[0]).toEqual({
        current_user: 'pipeline_sandbox',
        session_user: 'pipeline_sandbox',
        super: false,
      })
    }
  })

  it('cannot switch to any other role', async () => {
    const conn = await sandbox()
    const roles = await admin.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname <> 'pipeline_sandbox'
        and rolname !~ '^pg_'`,
    )
    expect(roles.rows.length).toBeGreaterThan(3)
    for (const { rolname } of roles.rows) {
      await expect(
        conn.query(`set role "${rolname}"`),
        `set role ${rolname}`,
      ).rejects.toThrow(/permission denied to set role/)
    }
    await expect(
      conn.query('set session authorization default'),
    ).resolves.toBeDefined()
    const after = await conn.query<{ u: string }>('select current_user u')
    expect(after.rows[0].u).toBe('pipeline_sandbox')
  })

  it('cannot read governed tables directly or through the XML readers', async () => {
    const conn = await sandbox()
    await expect(conn.query('select * from api.workspaces')).rejects.toThrow(
      /permission denied for schema api/,
    )
    for (const payload of [
      `select query_to_xml('select * from api.workspaces', true, false, '')`,
      `select table_to_xml('api.workspaces'::regclass, true, false, '')`,
      `select schema_to_xml('api', true, false, '')`,
      `select database_to_xml(true, false, '')`,
      `select set_config('role', 'none', false), query_to_xml('select * from api.workspaces', true, false, '')`,
    ]) {
      // The schema/database readers filter by privilege instead of raising, so
      // the proof is that nothing readable comes back either way.
      const outcome = await conn.query(payload).then(
        (result) => JSON.stringify(result.rows),
        (error: Error) => error.message,
      )
      expect(outcome, payload).not.toMatch(/sandbox-ws|Sandbox WS/)
    }
    await expect(
      conn.query(
        `select query_to_xml('select * from api.workspaces', true, false, '')`,
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('holds no privilege on any table, view or schema outside its temp schema', async () => {
    const conn = await sandbox()
    const tables = await conn.query<{ n: string }>(
      `select count(*) n from pg_class c
         join pg_namespace s on s.oid = c.relnamespace
        where s.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
          and s.nspname !~ '^pg_temp'
          and c.relkind in ('r', 'v', 'm', 'p', 'f')
          and has_table_privilege(current_user, c.oid,
              'select, insert, update, delete, truncate, references, trigger')`,
    )
    expect(tables.rows[0].n).toBe('0')
    const schemas = await conn.query<{ nspname: string }>(
      `select nspname from pg_namespace
        where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
          and nspname !~ '^pg_temp'
          and (has_schema_privilege(current_user, oid, 'usage')
               or has_schema_privilege(current_user, oid, 'create'))`,
    )
    expect(schemas.rows).toEqual([])
  })

  it('cannot call governed RPCs or forge the claims they trust', async () => {
    const conn = await sandbox()
    await conn.query(
      `select set_config('request.jwt.claims',
         '{"role":"authenticated","sub":"pipeline-owner-a"}', false)`,
    )
    await expect(
      conn.query(
        `select api.has_capability('0e010000-0000-4000-8000-0000000005b1'::uuid, 'x')`,
      ),
    ).rejects.toThrow(/permission denied for schema api/)
    await expect(conn.query('select * from internal."user"')).rejects.toThrow(
      /permission denied for schema internal/,
    )
  })

  it('cannot create objects, read server files or run programs', async () => {
    const conn = await sandbox()
    for (const payload of [
      'create table public.sandbox_escape (x int)',
      'create schema sandbox_escape',
      `select pg_read_file('/etc/passwd')`,
      `select pg_ls_dir('/')`,
      `copy (select 1) to program 'true'`,
      `create function pg_temp.f() returns int language c as 'x'`,
      `alter system set max_connections = 5`,
    ]) {
      await expect(conn.query(payload), payload).rejects.toThrow(
        /permission denied|must be superuser|no schema has been selected|not allowed/,
      )
    }
  })

  it('cannot lift the caps an administrator set on the role', async () => {
    const conn = await sandbox()
    await expect(conn.query(`set temp_file_limit = '100GB'`)).rejects.toThrow(
      /permission denied/,
    )
    const limit = await conn.query<{ temp_file_limit: string }>(
      'show temp_file_limit',
    )
    expect(limit.rows[0].temp_file_limit).toBe('1GB')
  })

  it('stops a statement at its timeout', async () => {
    const conn = await sandbox()
    const session = new SandboxSession(async () => conn)
    await expect(session.run('select pg_sleep(10)', 1)).rejects.toThrow(
      /statement timeout/,
    )
  })

  it('copies tables by value with exact types and discards them on close', async () => {
    await admin.query(`create temp table sb_source (
      id bigint, amount numeric, label text, flag boolean, at timestamptz, d date)`)
    await admin.query(
      `insert into pg_temp.sb_source values
        (9007199254740993, 1.10, 'a', true, '2026-01-02 03:04:05+00', '2026-01-02'),
        (null, null, null, null, null, null)`,
    )
    const conn = await connectSandbox()
    let ended = false
    const session = new SandboxSession(async () => ({
      ...conn,
      end: async () => {
        ended = true
        await conn.end()
      },
    }))
    await session.copyTable(admin, 'sb_source')
    expect(session.has('sb_source')).toBe(true)
    const { rows } = await session.run<{
      id: string
      amount: string
      label: string | null
    }>('select id, amount, label from sb_source order by id nulls last', 5)
    expect(rows[0]).toEqual({
      id: '9007199254740993',
      amount: '1.10',
      label: 'a',
    })
    expect(rows[1]).toEqual({ id: null, amount: null, label: null })
    await session.close()
    expect(ended).toBe(true)
    expect(session.has('sb_source')).toBe(false)
  })
})

describe('sandbox availability', () => {
  it('reports a missing sandbox login as unavailable rather than falling back', async () => {
    const session = new SandboxSession(async () => {
      throw new SandboxUnavailableError('not configured')
    })
    await expect(session.run('select 1', 5)).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    )
  })
})
