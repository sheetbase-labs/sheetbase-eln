/**
 * Submit dialog: only people with Review access on the project are offered as
 * reviewers, because a review decision is refused for anyone else.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000230a'
const PROJECT = '00000000-0000-4000-8000-00000000230c'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000230d'
const LEAD = 'prc-lead'
const REVIEWER = 'prc-reviewer'
const VIEWER = 'prc-viewer'
const OUTSIDER = 'prc-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${LEAD}', 'Lead', 'prc-lead@sheetbase.test', true),
      ('${REVIEWER}', 'Reviewer', 'prc-reviewer@sheetbase.test', true),
      ('${VIEWER}', 'Viewer', 'prc-viewer@sheetbase.test', true),
      ('${OUTSIDER}', 'Outsider', 'prc-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'prc', 'PRC')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${LEAD}', 'scientist'),
      ('${WS}', '${REVIEWER}', 'reviewer'),
      ('${WS}', '${VIEWER}', 'member'),
      ('${WS}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'prc', 'Review project', '${LEAD}'),
      ('${OTHER_PROJECT}', '${WS}', 'prx', 'Other project', '${OUTSIDER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: REVIEWER,
    canView: true,
    canEdit: true,
    canReview: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
    }),
  ])
  return client
}

describe('api.project_review_candidates', () => {
  it('lists the lead and whoever holds Review on the project, not viewers', async () => {
    const lead = await asAuthenticated(LEAD)
    const { rows } = await lead.query<{ user_id: string }>(
      `SELECT user_id FROM api.project_review_candidates($1)`,
      [PROJECT],
    )
    expect(rows.map((row) => row.user_id).sort()).toEqual(
      [LEAD, REVIEWER].sort(),
    )
  })

  it('returns nothing to someone who cannot see the project', async () => {
    const viewerOfOther = await asAuthenticated(VIEWER)
    const { rows } = await viewerOfOther.query(
      `SELECT user_id FROM api.project_review_candidates($1)`,
      [OTHER_PROJECT],
    )
    expect(rows).toEqual([])
  })
})
