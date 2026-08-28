/**
 * PLAT-03 — database security invariants. The PLAT-03 audit (docs/security.md)
 * found the PostgreSQL posture strong; these tests keep it that way by
 * asserting the invariants continuously instead of only during review:
 *
 *   1. every `api`-schema table has row-level security enabled, except the
 *      `workspace_change_seq` counter, which carries no workspace data and is
 *      granted only to `migrator`;
 *   2. no table in `api` is readable or writable by PUBLIC or `anon`;
 *   3. every SECURITY DEFINER function in `api` pins an empty search_path
 *      (prevents search_path hijacking inside definer execution);
 *   4. every `api` function has an explicit ACL — a NULL ACL would mean the
 *      PostgreSQL default, which grants EXECUTE to PUBLIC;
 *   5. the capability mask is not caller-controlled for api_client (H1:
 *      covered behaviourally in core-h1-capability-mask.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

type ThenArg<T> = T extends PromiseLike<infer U> ? U : never

describe('PLAT-03 database security invariants', () => {
  let migrator: ThenArg<ReturnType<typeof prepareTestDatabase>>['migrator']

  beforeAll(async () => {
    const context = await prepareTestDatabase()
    migrator = context.migrator
  })

  afterAll(async () => {
    await migrator.end()
  })

  it('enables RLS on every api table except the migrator-only counter', async () => {
    const { rows } = await migrator.query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'api' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    )
    expect(rows.map((r) => r.relname)).toEqual(['workspace_change_seq'])
  })

  it('grants the change counter to migrator only', async () => {
    const { rows } = await migrator.query(
      `SELECT DISTINCT grantee
         FROM information_schema.role_table_grants
        WHERE table_schema = 'api' AND table_name = 'workspace_change_seq'`,
    )
    expect(rows.map((r) => r.grantee).sort()).toEqual(['migrator'])
  })

  it('grants no api table privileges to PUBLIC or anon', async () => {
    const { rows } = await migrator.query(
      `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'api'
          AND grantee IN ('PUBLIC', 'anon')
        LIMIT 5`,
    )
    expect(rows).toEqual([])
  })

  it('pins an empty search_path on every SECURITY DEFINER function in api', async () => {
    // The invariant is the *empty* search_path (`SET search_path = ''`,
    // stored as {"search_path=\"\""}), not merely that some search_path is
    // configured — a definer function with `search_path = public` would
    // re-introduce search-path hijacking.
    const { rows } = await migrator.query(
      `SELECT p.proname, p.proconfig::text AS config
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'api'
          AND p.prosecdef
          AND p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
        LIMIT 10`,
    )
    expect(rows).toEqual([])
  })

  it('leaves no api function on the default PUBLIC EXECUTE ACL', async () => {
    const { rows } = await migrator.query(
      `SELECT p.proname
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'api' AND p.proacl IS NULL
        LIMIT 10`,
    )
    expect(rows).toEqual([])
  })
})
