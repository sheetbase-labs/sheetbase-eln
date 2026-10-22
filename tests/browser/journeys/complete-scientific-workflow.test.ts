import { expect, test } from 'playwright/test'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '#/db/schema'

import {
  createExperiment,
  createProject,
  createUser,
  open,
  signIn,
  signInAs,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from './helpers'

// Identity, workspace membership and a native signing credential are fixtures.
// Scientific work, project access, certification, review and signing use the
// real application. This is not OAuth or email-enrolment acceptance.
test.use({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  actionTimeout: 15_000,
})
test.setTimeout(240_000)

test('an imported plate analysis remains reconstructable after independent review and signing', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const reviewer = await createUser(uniqueName('Workflow reviewer'))
  const password = 'workflow-fixture-password-2026'
  await withAdminDb((db) =>
    db.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role)
       values ('00000000-0000-4000-8000-000000000300',$1,'member')`,
      [reviewer.id],
    ),
  )
  const reviewerContext = await browser.newContext({ baseURL })
  try {
    const reviewerPage = await reviewerContext.newPage()
    await signInAs(reviewerPage, reviewer)
    await open(reviewerPage, '/settings/signatures')
    const cookies = await reviewerContext.cookies()
    const { createAuth } = await import('#/lib/auth')
    await withAdminDb((client) =>
      createAuth(drizzle(client, { schema })).api.setPassword({
        headers: new Headers({
          cookie: cookies
            .map(({ name, value }) => `${name}=${value}`)
            .join('; '),
        }),
        body: { newPassword: password },
      }),
    )
    await reviewerPage
      .getByRole('button', {
        name: 'Request identity verification',
        exact: true,
      })
      .click()
    await expect(
      reviewerPage.getByText(
        'Awaiting independent administrator verification.',
      ),
    ).toBeVisible()

    await signIn(page)
    await open(page, '/settings/signatures')
    await page.getByText(`Verify ${reviewer.name} independently`).click()
    await page
      .getByLabel('Independently verified email')
      .fill(`${reviewer.id}@sheetbase.test`)
    await page
      .getByRole('checkbox', { name: /I have independently confirmed/ })
      .check()
    await page
      .getByRole('button', { name: 'Confirm verified identity' })
      .click()
    await open(reviewerPage, '/settings/signatures')
    await reviewerPage
      .getByRole('checkbox', {
        name: 'I have read and agree to this statement',
      })
      .check()
    await reviewerPage
      .getByLabel(/Enter your signing password to certify/)
      .fill(password)
    await reviewerPage
      .getByRole('button', { name: 'Certify signature' })
      .click()
    await expect(
      reviewerPage.getByRole('button', { name: 'Try a practice signature' }),
    ).toBeVisible()

    const projectPath = await createProject(page, uniqueName('Plate study'))
    await open(page, `${projectPath}/members`)
    await page.getByRole('button', { name: 'Add people', exact: true }).click()
    const people = page.getByRole('dialog')
    await people.getByLabel('Person').selectOption(reviewer.id)
    await people.getByLabel('Project access').selectOption('reviewer')
    await people.getByRole('button', { name: 'Add to project' }).click()
    await expect(page.getByText('Added to project')).toBeVisible()

    const experimentTitle = uniqueName('96-well titre experiment')
    const experimentId = await createExperiment(
      page,
      projectPath,
      experimentTitle,
    )
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Start experiment' }).click()
    const starting = page.getByRole('dialog')
    if (await starting.count())
      await starting.getByRole('button', { name: /^start/i }).click()
    await expect(
      page.getByRole('button', { name: 'Put on hold' }),
    ).toBeVisible()

    await open(page, `/experiments/${experimentId}/links`)
    await page.getByRole('button', { name: 'Import data' }).click()
    await expect(page.getByLabel('Link to experiment')).toHaveValue(
      experimentId,
    )
    const datasetName = uniqueName('Plate observations')
    await page.getByRole('radio', { name: 'New dataset' }).check()
    await page
      .getByLabel('Model for the new dataset')
      .selectOption({ label: 'ELISA and turbidity v1' })
    await page.getByLabel('New dataset name').fill(datasetName)
    // Consecutive observations 1..96 have n=96 and mean/median=48.5.
    // The expectation is independent of the application's statistics code.
    const csv = [
      'Sample,Plate,Well,Dilution,Capsid titre',
      ...Array.from({ length: 96 }, (_, index) => {
        const well = `${String.fromCharCode(65 + Math.floor(index / 12))}${(index % 12) + 1}`
        return `SMP-${index + 1},P1,${well},100,${index + 1}`
      }),
    ].join('\n')
    await page.getByLabel('Laboratory file').setInputFiles({
      name: 'plate-observations.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    })
    await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Import 96 rows' }).click()
    await expect(page.getByText('This import is committed')).toBeVisible()
    await expect(page.getByText(/96 new · 96 added · 96 total/)).toBeVisible()
    await page.locator('a[href$="/snapshots"]').click()
    const datasetId = new URL(page.url()).pathname.split('/')[2]
    expect(datasetId).toMatch(/^[0-9a-f-]{36}$/)
    await page.getByRole('row').filter({ hasText: /96/ }).first().click()
    await page.getByRole('link', { name: 'Analyse this snapshot' }).click()
    await expect(page).toHaveURL(/snapshot=/)
    await page.getByRole('button', { name: 'Descriptive / ANOVA' }).click()
    await page
      .getByLabel('Measured value column')
      .selectOption({ label: 'Capsid titre' })
    await page.getByLabel('Group by column').selectOption('')
    const statistics = page.getByRole('table', {
      name: 'Descriptive statistics per group',
    })
    await expect(
      statistics.getByRole('cell', { name: '96', exact: true }).first(),
    ).toBeVisible()
    await expect(
      statistics.getByRole('cell', { name: '48.5', exact: true }).first(),
    ).toBeVisible()
    const analysisTitle = uniqueName('Plate titre summary')
    await page.getByLabel('Analysis name').fill(analysisTitle)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page
      .getByRole('listitem')
      .filter({ hasText: analysisTitle })
      .getByRole('button', { name: 'Load', exact: true })
      .click()
    await page.getByRole('button', { name: 'Cite in a notebook…' }).click()
    const citation = page.getByRole('dialog')
    await citation.getByRole('combobox').fill(experimentTitle)
    await citation
      .getByRole('option', { name: new RegExp(experimentTitle) })
      .click()
    await citation.getByRole('button', { name: 'Cite', exact: true }).click()
    await expect(page.getByText('Cited in a notebook').first()).toBeVisible()
    await open(page, `/experiments/${experimentId}/notebook`)
    const frozen = page.getByRole('table', {
      name: 'Descriptive statistics per group',
    })
    await expect(
      frozen.getByRole('cell', { name: '96', exact: true }).first(),
    ).toBeVisible()
    await expect(
      frozen.getByRole('cell', { name: '48.5', exact: true }).first(),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    const submit = page.getByRole('dialog')
    await submit
      .getByRole('checkbox', { name: new RegExp(reviewer.name) })
      .check()
    await submit.getByRole('button', { name: 'Check snapshot' }).click()
    await submit.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}/)
    const revisionPath = new URL(page.url()).pathname

    await open(reviewerPage, '/inbox?type=reviews')
    await reviewerPage
      .getByRole('button', { name: new RegExp(experimentTitle) })
      .click()
    await reviewerPage.getByRole('link', { name: 'Open', exact: true }).click()
    await expect(reviewerPage).toHaveURL(new RegExp(`${revisionPath}$`))
    await reviewerPage.getByRole('tab', { name: 'Checks', exact: true }).click()
    const checking = reviewerPage.waitForResponse((response) =>
      response.url().endsWith('/rpc/run_revision_checks'),
    )
    await reviewerPage.getByRole('button', { name: 'Run checks' }).click()
    const checked = await checking
    expect(checked.status(), await checked.text()).toBe(200)
    await reviewerPage
      .getByRole('button', { name: 'Approve', exact: true })
      .click()
    const approval = reviewerPage.getByRole('alertdialog')
    await approval
      .getByRole('textbox')
      .fill('Checked all 96 observations and the pinned summary.')
    const approving = reviewerPage.waitForResponse((response) =>
      response.url().endsWith('/rpc/approve_review'),
    )
    await approval.getByRole('button', { name: 'Approve', exact: true }).click()
    const approved = await approving
    expect(approved.status(), await approved.text()).toBe(200)
    await testInfo.attach('reviewer-approval', {
      body: await reviewerPage.locator('main').innerText(),
      contentType: 'text/plain',
    })
    await reviewerPage.getByLabel('Signing password').fill(password)
    await reviewerPage.getByLabel(/Type your name/).fill(reviewer.name)
    const signed = reviewerPage.waitForResponse((response) =>
      response.url().endsWith('/rpc/sign_revision'),
    )
    await reviewerPage
      .getByRole('button', { name: 'Sign', exact: true })
      .click()
    expect((await signed).ok()).toBe(true)

    await open(page, `/experiments/${experimentId}/notebook`)
    await expect(page.getByText(/signed.*locked/i).first()).toBeVisible()
    await expect(
      frozen.getByRole('cell', { name: '48.5', exact: true }).first(),
    ).toBeVisible()
    await page.reload()
    await waitForHydration(page)
    await expect(
      frozen.getByRole('cell', { name: '96', exact: true }).first(),
    ).toBeVisible()
    await expect(
      frozen.getByRole('cell', { name: '48.5', exact: true }).first(),
    ).toBeVisible()
    await testInfo.attach('signed-plate-evidence', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  } finally {
    await reviewerContext.close()
  }
})
