import { expect, test } from 'playwright/test'

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
