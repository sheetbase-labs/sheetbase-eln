import { expect, test } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '#/db/schema'
import {
  parseSheetDefinitionConfiguration,
  sheetFieldDefinitionSchema,
} from '#/lib/sheet-definition'

import {
  createExperiment,
  createProject,
  createUser,
  open,
  signIn,
  splitRight,
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

    await page
      .getByRole('button', { name: /^Insert block after/ })
      .first()
      .click()
    await page
      .getByRole('combobox', { name: /Insert block/ })
      .fill('Import data')
    await page.keyboard.press('Enter')
    const importBlock = page.getByRole('region', {
      name: 'Notebook data import',
    })
    await expect(importBlock).toBeVisible()
    await expect(page.getByLabel('Link to experiment')).toHaveValue(
      experimentId,
    )
    const datasetName = uniqueName('Plate observations')
    await page.getByRole('radio', { name: 'New dataset' }).check()
    await page
      .getByLabel('Dataset schema for the new dataset')
      .selectOption({ label: 'ELISA and turbidity v2' })
    await page.getByLabel('New dataset name').fill(datasetName)
    // Consecutive observations 1..96 in ×10¹¹ cp/mL have n=96 and mean/median=48.5.
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
    await expect(page).toHaveURL(
      new RegExp(
        `/experiments/${experimentId}/notebook(?:#block-[\\da-f-]+)?$`,
      ),
    )
    await waitForHydration(page)
    await page
      .getByLabel('Source unit for Capsid titre', { exact: true })
      .fill('×10¹¹ cp/mL')
    // The columns map themselves, so the import is offered straight away.
    await expect(
      page.getByRole('button', { name: 'Import 96 rows' }),
    ).toBeEnabled()
    // The mapping and review survive reload in the same notebook block.
    await expect(importBlock.getByText(/Saving…|Editing…/)).toHaveCount(0)
    await page.reload()
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Import 96 rows' }).click()
    await expect(
      importBlock.getByText(
        '96 imported observations · pinned Dataset snapshot',
      ),
    ).toBeVisible()
    await expect(
      importBlock.getByRole('button', { name: 'Import another file' }),
    ).toBeEnabled()
    await expect(page).toHaveURL(
      new RegExp(
        `/experiments/${experimentId}/notebook(?:#block-[\\da-f-]+)?$`,
      ),
    )
    const importedSnapshot = importBlock.getByRole('link', {
      name: 'View imported data',
    })
    const importedSnapshotHref = await importedSnapshot.getAttribute('href')
    expect(importedSnapshotHref).toMatch(/snapshot=[0-9a-f-]{36}/)
    await importedSnapshot.click()
    await expect(page.getByLabel('Dataset rows', { exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('snapshot')).toBe(
      new URL(importedSnapshotHref!, baseURL).searchParams.get('snapshot'),
    )
    const datasetId = new URL(page.url()).pathname.split('/')[2]
    expect(datasetId).toMatch(/^[0-9a-f-]{36}$/)
    const readDataset = () =>
      withAdminDb(async (db) => ({
        dataset: (
          await db.query('select * from api.datasets where id=$1', [datasetId])
        ).rows,
        rows: (
          await db.query(
            'select * from api.dataset_rows where dataset_id=$1 order by id',
            [datasetId],
          )
        ).rows,
        values: (
          await db.query(
            `select v.* from api.dataset_row_values v join api.dataset_rows r on r.id=v.row_id where r.dataset_id=$1 order by v.row_id,v.field_id,v.ordinal`,
            [datasetId],
          )
        ).rows,
      }))
    const datasetBefore = await readDataset()
    expect(datasetBefore.rows).toHaveLength(96)
    // Provision only the reusable definition. Every working value below is UI-authored.
    const fields = await withAdminDb(async (client) => {
      const db = drizzle(client, { schema })
      const [dataset] = await db
        .select()
        .from(schema.datasets)
        .where(eq(schema.datasets.id, datasetId))
      return db
        .select()
        .from(schema.datasetSchemaVersionFields)
        .where(
          eq(
            schema.datasetSchemaVersionFields.schemaVersionId,
            dataset.schemaVersionId,
          ),
        )
    })
    const parameterId = crypto.randomUUID()
    const bindingId = crypto.randomUUID()
    const columns = ['Sample', 'Capsid titre'].map((label) => {
      const field = fields.find((candidate) => candidate.label === label)
      if (!field) throw new Error(`Imported Dataset has no ${label} field`)
      const id = crypto.randomUUID()
      return {
        id,
        field: sheetFieldDefinitionSchema.strip().parse({
          ...field,
          fieldId: id,
          quantity: sheetFieldDefinitionSchema.shape.quantity
            .unwrap()
            .strip()
            .nullable()
            .parse(field.quantity),
          computation: { mode: 'stored' },
        }),
        source: { kind: 'bound', bindingId, sourceFieldId: field.fieldId },
      }
    })
    const configuration = parseSheetDefinitionConfiguration({
      formatVersion: 1,
      parameters: [
        {
          id: parameterId,
          key: 'observations',
          label: 'Observations',
          required: true,
          type: {
            kind: 'dataset',
            contract: {
              mode: 'exact',
              schemaVersionId: fields[0].schemaVersionId,
            },
          },
          constraints: {},
        },
      ],
      bindings: [{ id: bindingId, key: 'observations', parameterId }],
      rowIdentity: { kind: 'source', columnIds: [columns[0].id] },
      columns,
      joins: [],
      calculations: [],
      writeBackRules: [],
      actions: [],
      presentation: {
        columnOrder: columns.map(({ id }) => id),
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
    })
    const definitionName = uniqueName('Plate dilution definition')
    const fixtureHeaders = {
      cookie: (await page.context().cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join('; '),
    }
    const createdDefinition = await page.request.post(
      '/api/db/rpc/create_sheet_definition',
      {
        headers: fixtureHeaders,
        data: {
          p_workspace_id: '00000000-0000-4000-8000-000000000300',
          p_key: `plate_${crypto.randomUUID().replaceAll('-', '')}`,
          p_name: definitionName,
          p_description: null,
          p_configuration: configuration,
        },
      },
    )
    expect(createdDefinition.ok(), await createdDefinition.text()).toBe(true)
    const definition = await createdDefinition.json()
    const published = await page.request.post(
      '/api/db/rpc/publish_sheet_definition_version',
      {
        headers: fixtureHeaders,
        data: { p_version_id: definition.version.id, p_expected_revision: 1 },
      },
    )
    expect(published.ok(), await published.text()).toBe(true)
    await open(page, `/experiments/${experimentId}/notebook`)
    await expect(importBlock.getByText(/current Dataset/)).toBeVisible()
    await importBlock
      .getByRole('link', { name: 'Open in a Sheet', exact: true })
      .click()
    await expect(page).toHaveURL(/\/sheets\/new\?/)
    expect(new URL(page.url()).searchParams.get('dataset')).toBe(datasetId)
    expect(new URL(page.url()).searchParams.get('experiment')).toBe(
      experimentId,
    )
    await page
      .getByRole('combobox', { name: /^Sheet definition/ })
      .selectOption(definition.version.id)
    await page
      .getByLabel('Name', { exact: true })
      .fill(uniqueName('Dilution-adjusted titres'))
    await page
      .getByRole('button', { name: 'Open dataset in a new sheet' })
      .click()
    await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}/)
    const sheetPath = new URL(page.url()).pathname
    const outsider = await createUser(uniqueName('Unassigned scientist'))
    await withAdminDb((db) =>
      db.query(
        `insert into api.workspace_memberships(workspace_id,user_id,role)
       values ('00000000-0000-4000-8000-000000000300',$1,'member')`,
        [outsider.id],
      ),
    )
    const outsiderContext = await browser.newContext({ baseURL })
    try {
      await signInAs(await outsiderContext.newPage(), outsider)
      const denied = await outsiderContext.request.post(
        '/api/sheet-calculations',
        {
          headers: {
            cookie: (await outsiderContext.cookies())
              .map(({ name, value }) => `${name}=${value}`)
              .join('; '),
          },
          data: {
            instanceId: sheetPath.split('/')[2],
            expectedRevision: 1,
            retryToken: crypto.randomUUID(),
          },
        },
      )
      expect(denied.status()).toBe(403)
      expect(await denied.json()).toMatchObject({
        error: { code: 'forbidden' },
      })
    } finally {
      await outsiderContext.close()
    }
    const cell = (row: number, column: number) =>
      page.locator(
        `[role="gridcell"][aria-rowindex="${row}"][aria-colindex="${column}"]`,
      )
    await expect(cell(1, 2)).toBeVisible()
    const observedTitres = [
      Number(await cell(1, 2).innerText()),
      Number(await cell(2, 2).innerText()),
    ]
    expect(observedTitres.every(Number.isFinite)).toBe(true)
    const samples = [await cell(1, 1).innerText(), await cell(2, 1).innerText()]
    const factors = [2, 5]
    const products = observedTitres.map(
      (titre, index) => titre * factors[index],
    )
    await page.getByRole('button', { name: 'New column…' }).click()
    await page.getByLabel('New column', { exact: true }).fill('Dilution factor')
    await page
      .getByLabel('New column type', { exact: true })
      .selectOption('decimal')
    await page.getByRole('button', { name: 'Add column', exact: true }).click()
    for (const [index, factor] of factors.entries()) {
      await cell(index + 1, 3).dblclick()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(String(factor))
      await page.keyboard.press('Enter')
      await expect(cell(index + 1, 3)).toHaveText(String(factor))
    }
    // The remaining observations are undiluted. Complete every operand so
    // review checks can refuse genuinely incomplete calculations unchanged.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate(() =>
      navigator.clipboard.writeText(Array(94).fill('1').join('\n')),
    )
    await cell(3, 3).click()
    const pasted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/rpc/mutate_sheet_instance_local_state') &&
        response.ok(),
    )
    await page.keyboard.press('ControlOrMeta+V')
    await pasted
    await expect(cell(3, 3)).toHaveText('1')
    await page.getByRole('button', { name: 'New calculation…' }).click()
    await page.getByLabel('Calculation formula').fill('=B1*C1')
    await page.getByLabel('Calculation label').fill('Adjusted titre')
    await page.getByLabel('Calculation quantity').selectOption(columns[1].id)
    await page
      .getByRole('button', { name: 'Add calculation', exact: true })
      .click()
    await expect(cell(1, 4)).toBeVisible()
    expect(await readDataset()).toEqual(datasetBefore)
    const artifactDirectory = '.amp/in/artifacts/mixed-sheet-journey'
    await mkdir(artifactDirectory, { recursive: true })
    await page.screenshot({
      path: `${artifactDirectory}/edited-mixed-sheet.png`,
      fullPage: true,
    })
    for (const [index, product] of products.entries())
      await expect(cell(index + 1, 4)).toHaveText(String(product))
    await page.reload()
    await waitForHydration(page)
    for (const [index, product] of products.entries()) {
      await expect(cell(index + 1, 3)).toHaveText(String(factors[index]))
      await expect(cell(index + 1, 4)).toHaveText(String(product))
    }
    expect(await readDataset()).toEqual(datasetBefore)
    await page.screenshot({
      path: `${artifactDirectory}/live-sheet-reloaded.png`,
      fullPage: true,
    })
    await open(page, `/experiments/${experimentId}/notebook`)
    await importBlock
      .getByRole('link', { name: 'Analyse this snapshot' })
      .click()
    await expect(page).toHaveURL(/snapshot=/)
    expect(new URL(page.url()).searchParams.get('snapshot')).toBe(
      new URL(importedSnapshotHref!, baseURL).searchParams.get('snapshot'),
    )
    await splitRight(page)
    const studioPanes = page.locator('[data-workspace-pane]')
    await expect(studioPanes).toHaveCount(2)
    await studioPanes
      .nth(1)
      .getByRole('tab', { name: 'Chart builder', exact: true })
      .click()
    const legend = studioPanes.nth(1).getByRole('region', {
      name: 'Chart legend',
      exact: true,
    })
    await expect(legend.getByRole('listitem')).toHaveCount(96)
    // Many series must remain available without squeezing the plot away.
    await expect
      .poll(() =>
        studioPanes
          .nth(1)
          .locator('figure')
          .evaluate((figure) => {
            const key = figure.querySelector('[aria-label="Chart legend"]')
            const plot = figure.querySelector('svg')
            return Boolean(
              key &&
              plot &&
              key.clientHeight <= figure.clientHeight * 0.3 &&
              plot.getBoundingClientRect().height > figure.clientHeight * 0.6,
            )
          }),
      )
      .toBe(true)
    await legend.focus()
    await page.keyboard.press('End')
    await expect
      .poll(() => legend.evaluate((key) => key.scrollTop))
      .toBeGreaterThan(0)
    await studioPanes
      .nth(1)
      .getByRole('button', { name: 'Close Analysis Studio pane' })
      .click()
    await expect(studioPanes).toHaveCount(1)
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
    await expect(
      page.getByRole('button', { name: 'Update', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Cite in a notebook…' }).click()
    const citation = page.getByRole('dialog')
    const experimentOption = citation.getByRole('option', {
      name: new RegExp(experimentTitle),
    })
    // The picker searches as you type; search the title again if a slow first
    // search left the new experiment out.
    await expect(async () => {
      await citation.getByRole('combobox').fill('')
      await citation.getByRole('combobox').fill(experimentTitle)
      await expect(experimentOption).toBeVisible({ timeout: 8_000 })
    }).toPass({ timeout: 45_000 })
    await experimentOption.click()
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
    const assertFrozenSheet = async () => {
      const sheet = page.getByRole('region', {
        name: 'Frozen Sheet evidence',
        exact: true,
      })
      await expect(sheet).toBeVisible()
      for (const [index, sample] of samples.entries()) {
        const row = sheet.getByRole('row').filter({
          has: page.getByText(sample, { exact: true }),
        })
        await expect(row.getByRole('cell').nth(1)).toHaveText(
          String(observedTitres[index]),
        )
        await expect(row.getByRole('cell').nth(2)).toHaveText(
          String(factors[index]),
        )
        await expect(row.getByRole('cell').nth(3)).toHaveText(
          String(products[index]),
        )
      }
    }
    await assertFrozenSheet()

    await open(reviewerPage, '/inbox?type=reviews')
    await expect(
      reviewerPage.getByRole('region', { name: 'Workspace', exact: true }),
    ).toBeVisible()
    await reviewerPage
      .getByRole('button', { name: new RegExp(experimentTitle) })
      .click()
    // Inbox activation opens the actual submitted revision in the same pane.
    await expect(reviewerPage).toHaveURL(new RegExp(`${revisionPath}$`))
    await reviewerPage.getByRole('tab', { name: 'Checks', exact: true }).click()
    const checking = reviewerPage.waitForResponse((response) =>
      response.url().endsWith('/rpc/run_revision_checks'),
    )
    await reviewerPage.getByRole('button', { name: 'Run checks' }).click()
    const checked = await checking
    expect(checked.status(), await checked.text()).toBe(200)
    expect(await checked.json()).toMatchObject({
      blockingFailureCount: 0,
      overallStatus: 'pass',
    })
    // A wide pane shows the review inspector inline; a narrower one folds it
    // behind Details.
    const approve = reviewerPage.getByRole('button', {
      name: 'Approve',
      exact: true,
    })
    const details = reviewerPage.getByRole('button', {
      name: 'Details',
      exact: true,
    })
    await expect(approve.or(details).first()).toBeVisible()
    if (!(await approve.isVisible())) await details.click()
    await approve.click()
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
    await reviewerPage
      .getByLabel('Signature meaning')
      .selectOption('reviewed-and-approved')
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
    await expect(
      page.getByRole('status').filter({
        hasText: 'Scientific evidence is frozen',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Amend', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Insert block/ }),
    ).toHaveCount(0)
    await expect(
      frozen.getByRole('cell', { name: '48.5', exact: true }).first(),
    ).toBeVisible()
    await page.reload()
    await waitForHydration(page)
    await assertFrozenSheet()
    expect(await readDataset()).toEqual(datasetBefore)
    await page
      .getByRole('region', { name: 'Frozen Sheet evidence', exact: true })
      .screenshot({ path: `${artifactDirectory}/signed-frozen-sheet.png` })
    // A submitted notebook locks its attached live Sheet; never bypass that lock.
    await open(page, sheetPath)
    await expect(
      page.getByRole('button', { name: 'Add column', exact: true }),
    ).toHaveCount(0)
    await open(page, `/experiments/${experimentId}/notebook`)
    await assertFrozenSheet()
    await expect(
      frozen.getByRole('cell', { name: '96', exact: true }).first(),
    ).toBeVisible()
    await expect(
      frozen.getByRole('cell', { name: '48.5', exact: true }).first(),
    ).toBeVisible()
    expect(
      await frozen.evaluate((table) => {
        let opacity = 1
        for (
          let element: Element | null = table;
          element;
          element = element.parentElement
        ) {
          opacity *= Number(getComputedStyle(element).opacity)
        }
        return opacity
      }),
    ).toBe(1)
    // Alt-click keeps the analysis in view and opens its evidence beside it.
    await page
      .getByRole('link', { name: 'Open dataset', exact: true })
      .click({ modifiers: ['Alt'] })
    const evidencePanes = page.locator('[data-workspace-pane]')
    await expect(evidencePanes).toHaveCount(2)
    await expect(
      evidencePanes.nth(0).getByRole('table', {
        name: 'Descriptive statistics per group',
      }),
    ).toBeVisible()
    await expect(
      evidencePanes
        .nth(1)
        .getByRole('heading', { name: datasetName, exact: true }),
    ).toBeVisible()
    await expect(
      evidencePanes.nth(1).getByLabel('Dataset rows', { exact: true }),
    ).toBeVisible()
    const evidenceScreenshot = testInfo.outputPath('signed-plate-evidence.png')
    await page.screenshot({ path: evidenceScreenshot, fullPage: true })
    await testInfo.attach('signed-plate-evidence', {
      path: evidenceScreenshot,
      contentType: 'image/png',
    })
  } finally {
    await reviewerContext.close()
  }
})
