import { expect, test } from 'playwright/test'
import { signInAsDesignUser } from '../visual/sign-in'
import { z } from 'zod'

// Exercise route transitions and the real table/dialog components without
// creating persistent records. Database summary/RLS semantics have DB tests.
test('new project opens first-use guidance and can return to Projects', async ({
  page,
}) => {
  const project = {
    id: '68000000-0000-4000-8000-000000000099',
    workspace_id: '00000000-0000-4000-8000-000000000002',
    key: 'workflow-project',
    title: 'Workflow project',
    status: 'active',
    created_at: '2026-09-07T10:00:00Z',
    updated_at: '2026-09-07T10:00:00Z',
    archived_at: null,
    record_count: 0,
    experiment_count: 0,
    last_activity_at: null,
  }
  let created = false
  await page.route('**/api/db/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = []
    if (path.endsWith('/rpc/create_project')) {
      created = true
      body = project
    } else if (path.endsWith('/rpc/project_list_summary'))
      body = created ? [project] : []
    else if (path.endsWith('/projects')) body = [project]
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByRole('textbox', { name: 'Project title' }).fill(project.title)
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`))
  await page
    .getByRole('button', { name: 'Create your first experiment', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Create experiment' }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Experiment title' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .getByRole('link', { name: 'Projects', exact: true })
    .click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Workflow project workflow-project/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Status', exact: true }).hover()
  expect(
    await page
      .getByRole('button', { name: 'Status', exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)')
  await page.getByRole('button', { name: 'Columns', exact: true }).click()
  await page
    .getByRole('menuitemcheckbox', { name: 'Created', exact: true })
    .click()
  await expect(
    page.getByRole('columnheader', { name: 'Created', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390)
  expect(
    await page
      .getByRole('searchbox', { name: 'Filter projects' })
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThan(300)
})

test.describe('native project activity', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })

  test('shows current readable identities for the actual latest record events', async ({
    page,
  }) => {
    await signInAsDesignUser(page, '00000000-0000-4000-8000-000000000310')
    await page.goto('/projects')
    const expected = z
      .array(z.object({ identifier: z.string(), title: z.string() }))
      .parse(
        await page.evaluate(async () => {
          const project = '00000000-0000-4000-8000-000000000320'
          const events = await fetch(
            `/api/db/change_events?project_id=eq.${project}&order=sequence.desc&limit=3`,
          )
          if (!events.ok) throw new Error('Native event read failed')
          const rows: Array<{ entity_type: string; entity_uuid: string }> =
            await events.json()
          const records = []
          for (const row of rows.filter(
            (event) => event.entity_type === 'record',
          )) {
            const response = await fetch(
              `/api/db/records?id=eq.${row.entity_uuid}&project_id=eq.${project}&select=identifier,title`,
            )
            if (!response.ok) throw new Error('Native record read failed')
            records.push(...(await response.json()))
          }
          return records
        }),
      )
    expect(expected.length).toBeGreaterThan(0)
    await page
      .getByRole('button', { name: 'Show details for AAV9 process transfer' })
      .click()
    for (const record of expected) {
      await expect(
        page.getByTitle('Current record identity').filter({
          hasText: `${record.identifier} · ${record.title}`,
        }),
      ).toBeVisible()
    }
    await page.screenshot({
      path: '.amp/in/artifacts/proj01-integrated-activity.png',
    })
  })
})
