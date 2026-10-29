import { pickRecord } from './journeys/helpers'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { Client } from 'pg'
import type { AxeResults } from 'axe-core'
import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

if (process.env.PROJ_BROWSER_URL)
  test.use({ baseURL: process.env.PROJ_BROWSER_URL })

/** The design's workspace owner, whose Projects board the accepted rows. */
const DESIGN_USER = '00000000-0000-4000-8000-000000000310'

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER)
})

test('PROJ-01 typed creation and unrelated title editing retain every property', async ({
  page,
}) => {
  const title = `PROJ-01 acceptance ${randomUUID()}`
  let projectId: string | undefined
  try {
    await page.goto('/projects')
    // Playwright's own request context does not carry the session cookie —
    // Better Auth names it `__Secure-better-auth.session_token` and marks it
    // Secure, so an http:// API request arrives unauthenticated. The page's own
    // fetch runs on the signed-in session and reads the same RPC.
    const actorId: unknown = await page.evaluate(async () => {
      const response = await fetch('/api/db/rpc/current_user_id')
      if (!response.ok) throw new Error('Native actor read failed')
      return await response.json()
    })
    if (typeof actorId !== 'string' || !actorId)
      throw new Error('Authenticated app must return its current user ID')
    await page.getByRole('button', { name: 'New project', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    const lead = dialog.getByRole('button', { name: 'Lead', exact: true })
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(title)
    const clientId = await pickRecord(
      page,
      dialog.getByRole('button', { name: 'Client', exact: true }),
      /CL-017/,
    )
    if (!clientId) throw new Error('Seeded client CL-017 required')
    await dialog
      .getByRole('combobox', { name: 'Modality', exact: true })
      .selectOption('AAV5')
    await dialog
      .getByRole('combobox', { name: 'Stage', exact: true })
      .selectOption('Feasibility')
    await pickRecord(page, lead, { id: actorId })
    await pickRecord(
      page,
      dialog.getByRole('button', { name: /Default reviewer/ }),
      'Mei L.',
    )
    await dialog.getByText('Agreement and start date', { exact: true }).click()
    await dialog
      .getByRole('textbox', { name: 'Agreement reference' })
      .fill('AGR-acceptance')
    await dialog.getByLabel('Start date', { exact: true }).fill('2026-08-03')
    await page.addScriptTag({
      path: createRequire(import.meta.url).resolve('axe-core'),
    })
    const accessibility = await page.evaluate<AxeResults>(
      "axe.run('[role=dialog]')",
    )
    expect(accessibility.violations).toEqual([])
    const response = page.waitForResponse(
      (result) =>
        result.url().includes('/api/db/rpc/create_project') &&
        result.request().method() === 'POST',
    )
    await dialog
      .getByRole('button', { name: 'Create project', exact: true })
      .click()
    const createdResponse = await response
    expect(createdResponse.ok()).toBe(true)
    const created = await createdResponse.json()
    projectId = created.id
    expect(projectId).toBeTruthy()
    expect(created).toMatchObject({
      title,
      client_id: clientId,
      modality: 'AAV5',
      stage: 'Feasibility',
      lead_user_id: actorId,
      agreement_reference: 'AGR-acceptance',
      started_on: '2026-08-03',
    })
    await expect(dialog).not.toBeVisible()
    await page.goto(`/projects/${projectId}/settings`)
    await expect(
      page.getByRole('textbox', { name: 'Name', exact: true }),
    ).toHaveValue(title)
    await expect(
      page.getByRole('button', { name: 'Client', exact: true }),
    ).toContainText('CL-017')
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill(`${title} renamed`)
    const update = page.waitForResponse(
      (result) =>
        result.url().includes('/api/db/rpc/update_project_details') &&
        result.request().method() === 'POST',
    )
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    const updatedResponse = await update
    expect(updatedResponse.ok()).toBe(true)
    expect(await updatedResponse.json()).toMatchObject({
      id: projectId,
      title: `${title} renamed`,
      client_id: clientId,
      modality: 'AAV5',
      stage: 'Feasibility',
      lead_user_id: created.lead_user_id,
      default_reviewer_user_id: created.default_reviewer_user_id,
      agreement_reference: 'AGR-acceptance',
      started_on: '2026-08-03',
    })
    await page.reload()
    await expect(
      page.getByRole('combobox', { name: 'Modality', exact: true }),
    ).toHaveValue('AAV5')
    await expect(page.getByLabel('Start date', { exact: true })).toHaveValue(
      '2026-08-03',
    )
  } finally {
    if (projectId) {
      const database = new Client({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      })
      await database.connect()
      try {
        await database.query(
          'DELETE FROM api.projects WHERE id=$1 AND title LIKE $2',
          [projectId, `${title}%`],
        )
      } finally {
        await database.end()
      }
    }
  }
})

test('PROJ-01 native URL fields and archived views survive reload', async ({
  page,
}) => {
  await page.goto('/projects?fields=stage,experiments&sort=id')
  await expect(
    page.getByRole('button', {
      name: 'Quick view of AAV9 process transfer',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('columnheader', { name: 'Stage', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('columnheader', { name: 'Experiments', exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('columnheader', { name: 'Stage', exact: true }),
  ).toHaveCount(0)
  await page.goto('/projects?tab=archived')
  await expect(
    page.getByRole('button', {
      name: 'Quick view of AAV9 process transfer',
      exact: true,
    }),
  ).toHaveCount(0)
  await expect(page.locator('tbody tr')).not.toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Remove filter: status is not Archived' }),
  ).toHaveCount(0)
})
