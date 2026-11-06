/**
 * People and continuity events (migration 0094): the change feed carries
 * passkey changes to every workspace the person belongs to, and the webhook
 * catalogue accepts the new event names.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS1 = '00000000-0000-4000-8000-00000000e941'
const WS2 = '00000000-0000-4000-8000-00000000e942'
const USER = 'people-events-user'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified")
     VALUES ($1,'Passkey Person','people-events@test.invalid',true)`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'people-events-1','One'), ($2,'people-events-2','Two')`,
    [WS1, WS2],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$3,'scientist'), ($2,$3,'viewer')`,
    [WS1, WS2, USER],
  )
})

afterAll(async () => {
  await migrator?.end()
})

describe('passkey events', () => {
  it('announces an added and a removed passkey in each workspace', async () => {
    const added = await migrator.query(
      `SELECT internal.record_passkey_event($1,'added','pk-1','Work laptop') AS n`,
      [USER],
    )
    expect(added.rows[0].n).toBe(2)
    await migrator.query(
      `SELECT internal.record_passkey_event($1,'removed','pk-1','Work laptop')`,
      [USER],
    )
    const events = await migrator.query(
      `SELECT workspace_id, operation, payload->>'action' AS action,
              payload->>'name' AS name
         FROM api.change_events
        WHERE entity_type = 'member_passkey' AND workspace_id IN ($1,$2)
        ORDER BY workspace_id, sequence`,
      [WS1, WS2],
    )
    expect(events.rows).toHaveLength(4)
    expect(events.rows[0]).toMatchObject({
      operation: 'create',
      action: 'passkey-added',
      name: 'Work laptop',
    })
    expect(events.rows[1]).toMatchObject({
      operation: 'delete',
      action: 'passkey-removed',
    })
  })

  it('refuses an unknown action', async () => {
    await expect(
      migrator.query(
        `SELECT internal.record_passkey_event($1,'stolen','pk-1',NULL)`,
        [USER],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('accepts the new webhook event names', async () => {
    const names = await migrator.query(
      `SELECT name FROM internal.webhook_event_names
        WHERE name IN ('member.absence_set','member.passkey_added',
                       'workspace.group_role.mapped','member.work_handed_over')`,
    )
    expect(names.rows).toHaveLength(4)
  })
})
