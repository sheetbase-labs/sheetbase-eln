import { describe, expect, it } from 'vitest'

import { buildExportPlan, selectForTable } from './plan'
import type { CatalogForeignKey, CatalogTable } from './plan'

const WS = '00000000-0000-4000-8000-000000000001'

const table = (
  schema: string,
  name: string,
  columns: string[],
): CatalogTable => ({
  schema,
  name,
  columns,
})
const fk = (
  from: string,
  columns: string[],
  to: string,
  refColumns: string[],
): CatalogForeignKey => {
  const [schema, t] = from.split('.')
  const [refSchema, refTable] = to.split('.')
  return { schema, table: t, columns, refSchema, refTable, refColumns }
}

const tables = [
  table('api', 'workspaces', ['id', 'name']),
  table('api', 'workspace_memberships', ['workspace_id', 'user_id', 'role']),
  table('api', 'records', ['id', 'workspace_id', 'title']),
  table('api', 'blocks', ['id', 'record_id', 'payload']),
  table('api', 'block_marks', ['id', 'block_id']),
  table('api', 'version_rows', ['version_id', 'row_id']),
  table('api', 'versions', ['id', 'workspace_id']),
  table('api', 'version_values', ['version_id', 'row_id', 'text_value']),
  table('api', 'model_kinds', ['key']),
  table('internal', 'api_credentials', [
    'id',
    'workspace_id',
    'secret_hash',
    'name',
  ]),
  table('internal', 'user', [
    'id',
    'name',
    'email',
    'image',
    'createdAt',
    'emailVerified',
  ]),
  table('internal', 'session', ['id', 'token', 'userId']),
]
const keys = [
  fk('api.blocks', ['record_id'], 'api.records', ['id']),
  fk('api.block_marks', ['block_id'], 'api.blocks', ['id']),
  fk('api.version_rows', ['version_id'], 'api.versions', ['id']),
  fk('api.version_values', ['version_id', 'row_id'], 'api.version_rows', [
    'version_id',
    'row_id',
  ]),
  fk('api.records', ['created_by_user_id'], 'internal.user', ['id']),
]

describe('buildExportPlan', () => {
  const plan = buildExportPlan(WS, tables, keys)
  const byName = Object.fromEntries(plan.tables.map((t) => [t.name, t]))

  it('filters a table with a workspace column by it', () => {
    expect(byName['api.records'].where).toBe(`t.workspace_id = '${WS}'`)
    expect(byName['api.workspaces'].where).toBe(`t.id = '${WS}'`)
  })

  it('reaches a child table through its parent, however deep', () => {
    expect(byName['api.blocks'].where).toContain('IN (SELECT')
    expect(byName['api.block_marks'].where).toContain('api"."blocks')
    expect(byName['api.block_marks'].where).toContain(`workspace_id = '${WS}'`)
  })

  it('follows a composite foreign key', () => {
    expect(byName['api.version_values'].where).toContain(
      '(t."version_id", t."row_id") IN (SELECT',
    )
  })

  it('does not treat a link to a person as belonging to the workspace', () => {
    expect(byName['api.model_kinds']).toBeUndefined()
    expect(plan.skipped.map((s) => s.name)).toContain('api.model_kinds')
  })

  it('keeps people to members, and only who they are', () => {
    expect(byName['internal.user'].where).toContain('workspace_memberships')
    expect(byName['internal.user'].columns).toEqual([
      'id',
      'name',
      'email',
      'image',
      'createdAt',
    ])
    expect(byName['internal.user'].droppedColumns).toEqual(['emailVerified'])
  })

  it('drops secret columns and skips sign-in tables', () => {
    expect(byName['internal.api_credentials'].columns).not.toContain(
      'secret_hash',
    )
    expect(byName['internal.api_credentials'].droppedColumns).toEqual([
      'secret_hash',
    ])
    expect(byName['internal.session']).toBeUndefined()
    expect(plan.skipped).toContainEqual({
      name: 'internal.session',
      reason: 'sign-in sessions',
    })
  })

  it('builds a select that removes dropped columns', () => {
    expect(selectForTable(byName['internal.api_credentials'])).toContain(
      "- ARRAY['secret_hash']::text[]",
    )
    expect(selectForTable(byName['api.records'])).toBe(
      `SELECT (to_jsonb(t))::text AS row FROM "api"."records" t WHERE t.workspace_id = '${WS}'`,
    )
  })

  it('refuses a workspace id that is not a UUID', () => {
    expect(() => buildExportPlan("x' OR '1'='1", tables, keys)).toThrow(
      'invalid workspace id',
    )
  })
})
