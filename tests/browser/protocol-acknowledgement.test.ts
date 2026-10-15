/**
 * LAB-07 — read-and-acknowledge training against the design fixture.
 *
 * The design seed carried no `api.protocol_versions` row, so the Training tab
 * had nothing to acknowledge and the acknowledgement flow was untestable. The
 * seed now freezes the first design protocol's document as v1 and puts it in
 * review, which is the lifecycle state that invites acknowledgement. This spec
 * drives the real flow — a member reads and acknowledges the frozen version —
 * and proves the record it wrote: the acting person, the exact version and the
 * time, both on screen and in the table, and that it survives a reload.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

const PRIYA = '00000000-0000-4000-8000-000000000311'
const PROTOCOL_IDENTIFIER = 'PRT-006'

let admin: Client
let protocolId: string
let versionId: string
let versionNumber: number

test.beforeAll(async () => {
  const connectionString = process.env.MIGRATION_DATABASE_URL
  if (!connectionString) throw new Error('MIGRATION_DATABASE_URL is required')
  admin = new Client({ connectionString })
  await admin.connect()

  const protocol = await admin.query<{ id: string }>(
    `select id from api.records where identifier = $1 and kind = 'protocol_template'`,
    [PROTOCOL_IDENTIFIER],
  )
  if (!protocol.rows[0]) {
    throw new Error(
      `${PROTOCOL_IDENTIFIER} is missing: run \`pnpm db:seed:design\` before the browser suite`,
    )
  }
  protocolId = protocol.rows[0].id

  const version = await admin.query<{
    id: string
    version: number
    status: string
  }>(
    `select id, version, status from api.protocol_versions
      where protocol_record_id = $1 order by version desc limit 1`,
    [protocolId],
  )
  // The seed's frozen version is what makes this flow reachable at all; a
  // missing one is a fixture failure, not a test that may pass vacuously.
  expect(version.rows[0]?.status).toBe('in_review')
  versionId = version.rows[0].id
  versionNumber = version.rows[0].version

  // The acknowledgement must be this run's own write, so the row it would
  // upsert onto is cleared first. `acknowledge_protocol_version` never
  // overwrites a recorded acknowledgement, so a leftover row from an earlier
  // run would otherwise make the assertions below prove nothing.
  await admin.query(
    `delete from api.protocol_acknowledgements
      where protocol_version_id = $1 and user_id = $2`,
    [versionId, PRIYA],
  )
})

test.afterAll(async () => {
  await admin?.end()
})

test('a member acknowledges the frozen version and the record survives a reload', async ({
  page,
}) => {
  await signInAsDesignUser(page, PRIYA)
  await page.goto(`/protocols/${protocolId}?section=training`)

  const training = page.locator('section').filter({
    has: page.getByRole('heading', { name: `Training on v${versionNumber}` }),
  })
  const acknowledgeButton = training.getByRole('button', {
    name: 'Read and acknowledge',
  })
  await expect(acknowledgeButton).toBeEnabled()
  const priya = training.getByRole('row', { name: /Priya S\./ })
  await expect(priya).toContainText('Required')

  await acknowledgeButton.click()

  // On screen: the control states the recorded state, and the row names the
  // person and the acknowledgement date.
  await expect(
    training.getByRole('button', { name: 'Acknowledged' }),
  ).toBeDisabled()
  await expect(priya).toContainText('Acknowledged')

  // In the table: exactly one row, stamped with the acting user and the exact
  // frozen version. The database session is UTC, which is what the wire carries
  // and what the row renders, so the recorded date is comparable as UTC.
  const rows = await admin.query<{
    protocol_version_id: string
    user_id: string
    acknowledged_at: Date
  }>(
    `select protocol_version_id, user_id, acknowledged_at
       from api.protocol_acknowledgements where protocol_version_id = $1`,
    [versionId],
  )
  expect(rows.rows).toHaveLength(1)
  expect(rows.rows[0].user_id).toBe(PRIYA)
  expect(rows.rows[0].protocol_version_id).toBe(versionId)
  expect(rows.rows[0].acknowledged_at).toBeInstanceOf(Date)
  const recordedDate = rows.rows[0].acknowledged_at.toISOString().slice(0, 10)
  await expect(priya).toContainText(recordedDate)

  await page.reload()
  await expect(
    training.getByRole('button', { name: 'Acknowledged' }),
  ).toBeDisabled()
  await expect(priya).toContainText(recordedDate)
})
