import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultHookStore } from './record-hooks.server'

const execute = vi.hoisted(() => vi.fn())

vi.mock('#/db/client.server', () => ({ db: { execute } }))

describe('the hook store', () => {
  beforeEach(() => execute.mockReset().mockResolvedValue([]))

  it('sends the roles of a sign-off step as one list, not a row of values', async () => {
    await defaultHookStore().raiseFlag({
      recordId: '00000000-0000-4000-8000-000000000001',
      hook: { extensionKey: 'lab-rules', extensionName: 'Lab rules' },
      key: 'second-reviewer',
      kind: 'sign_off',
      title: 'A second reviewer has looked at this',
      message: '',
      roles: ['reviewer', 'admin', 'owner'],
      approvals: 1,
      independent: true,
      actorUserId: 'user-1',
    } as never)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    // A JS array spread into a query becomes `($1, $2, $3)`, which Postgres
    // will not cast to text[]; the roles travel as one JSON value instead.
    expect(query.sql).not.toMatch(/\(\$\d+, \$\d+(, \$\d+)*\)::text\[\]/)
    expect(query.params).toContain(
      JSON.stringify(['reviewer', 'admin', 'owner']),
    )
  })
})
