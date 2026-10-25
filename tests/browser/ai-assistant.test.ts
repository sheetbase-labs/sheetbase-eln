import { config } from 'dotenv'
import { expect, test } from 'playwright/test'
import { Client } from 'pg'

import { signInAsDesignUser } from '../visual/sign-in'
import { waitForHydration } from './journeys/helpers'

config({ path: ['.env.local', '.env'] })

const USER_ID = '00000000-0000-4000-8000-000000000310'
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000300'
const DATASET_ID = '00000000-0000-4000-8000-0000000003f6'
const DATASET_TITLE = 'ddPCR titre, harvest timing'

test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})

interface SettingsRow {
  ai_enabled: boolean
  ai_provider_profile: string | null
  ai_cloud_egress_enabled: boolean
  ai_model: string
  ai_max_tokens_per_call: number
  ai_max_cost_microusd_per_call: number
}

let admin: Client | undefined
let original: SettingsRow | undefined

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, USER_ID)
  const connectionString = process.env.MIGRATION_DATABASE_URL
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL is required for AI acceptance')
  }
  admin = new Client({ connectionString })
  await admin.connect()
  const existing = await admin.query<SettingsRow>(
    `select ai_enabled, ai_provider_profile, ai_cloud_egress_enabled,
            ai_model, ai_max_tokens_per_call, ai_max_cost_microusd_per_call
       from api.workspace_settings
      where workspace_id = $1`,
    [WORKSPACE_ID],
  )
  original = existing.rows[0]
  await admin.query(
    `update api.workspace_settings
        set ai_enabled = false,
            ai_provider_profile = null,
            ai_cloud_egress_enabled = false,
            ai_model = 'sheetbase-assist-1',
            ai_max_tokens_per_call = 8000,
            ai_max_cost_microusd_per_call = 50000
      where workspace_id = $1`,
    [WORKSPACE_ID],
  )
})

test.afterEach(async () => {
  if (!admin) return
  try {
    if (original) {
      await admin.query(
        `update api.workspace_settings
            set ai_enabled = $2,
                ai_provider_profile = $3,
                ai_cloud_egress_enabled = $4,
                ai_model = $5,
                ai_max_tokens_per_call = $6,
                ai_max_cost_microusd_per_call = $7
          where workspace_id = $1`,
        [
          WORKSPACE_ID,
          original.ai_enabled,
          original.ai_provider_profile,
          original.ai_cloud_egress_enabled,
          original.ai_model,
          original.ai_max_tokens_per_call,
          original.ai_max_cost_microusd_per_call,
        ],
      )
    }
  } finally {
    await admin.end()
    admin = undefined
  }
})

test('owner enables the assistant and sees the readiness state', async ({
  page,
}) => {
  await page.goto('/settings/ai')
  await waitForHydration(page)

  await expect(
    page.getByRole('heading', { name: 'AI', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('AI is off for this workspace', { exact: false }),
  ).toBeVisible()

  await page
    .getByRole('checkbox', {
      name: /Enable the assistant for this workspace/i,
    })
    .click()
  await page.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.getByText('AI settings saved')).toBeVisible()
  await expect(page.getByText('Assistant status')).toBeVisible()
  await expect(
    page.getByText('Built-in deterministic model. No external provider', {
      exact: false,
    }),
  ).toBeVisible()

  await page.screenshot({
    path: '.amp/in/artifacts/ai-settings-enabled.png',
    fullPage: true,
  })
})

test('assistant answers with a cited dataset and does not change it', async ({
  page,
}) => {
  if (!admin) throw new Error('admin client unavailable')
  await admin.query(
    'update api.workspace_settings set ai_enabled = true where workspace_id = $1',
    [WORKSPACE_ID],
  )
  const before = await admin.query<{ revision: number }>(
    'select revision from api.datasets where id = $1',
    [DATASET_ID],
  )

  await page.goto(`/datasets/${DATASET_ID}`)
  await waitForHydration(page)
  await expect(page.getByText(DATASET_TITLE).first()).toBeVisible()
  await expect(page.getByTestId('ask-ai-button').first()).toBeVisible()
  await page.screenshot({
    path: '.amp/in/artifacts/ai-entry-points.png',
  })

  await page.getByTestId('assistant-trigger').click()
  await expect(page.getByTestId('assistant-panel')).toBeVisible()
  await page
    .getByTestId('assistant-question')
    .fill('Summarise this dataset for a reviewer.')
  await page.getByTestId('assistant-ask').click()

  const answer = page.getByTestId('assistant-answer')
  await expect(answer).toBeVisible({ timeout: 20_000 })
  await expect(answer).toContainText('AI-generated')
  await expect(answer).toContainText('Built-in deterministic model')
  await expect(page.getByTestId('assistant-source').first()).toContainText(
    DATASET_TITLE,
  )

  await page.screenshot({
    path: '.amp/in/artifacts/ai-assistant-answer.png',
    fullPage: true,
  })

  const after = await admin.query<{ revision: number }>(
    'select revision from api.datasets where id = $1',
    [DATASET_ID],
  )
  expect(after.rows[0]?.revision).toBe(before.rows[0]?.revision)
})

test('assistant reports the workspace kill switch from the page header', async ({
  page,
}) => {
  await page.goto(`/datasets/${DATASET_ID}`)
  await waitForHydration(page)
  await expect(page.getByTestId('assistant-trigger')).toBeVisible()
  await page.getByTestId('ask-ai-button').first().click()

  await expect(page.getByTestId('assistant-disabled')).toContainText(
    'AI is off for this workspace',
  )
  await expect(page.getByTestId('assistant-disabled')).toContainText(
    'Open AI settings',
  )
  await page.screenshot({
    path: '.amp/in/artifacts/ai-assistant-disabled.png',
    fullPage: true,
  })
})
