import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

// Exercise route transitions and the real table/dialog components. Test 1 mocks
// the data layer; test 2 makes its own project and draft experiment, then
// removes the project. Database summary/RLS semantics have DB tests.
test('new project is created from the list and the list stays usable', async ({
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
  await signInAsDesignUser(page, '00000000-0000-4000-8000-000000000310')
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
  // The dialog's first field is "Name" (projects-page.tsx: `Field label="Name"`,
  // the design's NewProjectDialog, and DialogsCreate-light.png).
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill(project.title)
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click()
  // CORE-01: creating a project opens it, so the next step (add an experiment,
  // invite the team) is on screen. A successful write ends the dialog.
  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByText(`Project “${project.title}” created`),
  ).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`))
  expect(new URL(page.url()).searchParams.get('new')).toBeNull()
  // The list is still usable and shows the new project when the person goes back.
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Projects', exact: true })
    .click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: project.title, exact: true }),
  ).toBeVisible()
  // A quiet control keeps no fill at rest (variant="quiet" only fills on hover).
  expect(
    await page
      .getByRole('button', {
        name: `Quick view of ${project.title}`,
        exact: true,
      })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)')
  // The column menu is "Fields" with plain menu items (the design's Fields
  // dropdown); the old "Columns" menu and its "Created" column are gone.
  await page.getByRole('button', { name: 'Fields', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Stage', exact: true }).click()
  await expect(
    page.getByRole('columnheader', { name: 'Stage', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Stage', exact: true }).click()
  await expect(
    page.getByRole('columnheader', { name: 'Stage', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page
    // The shell's nav landmark is labelled "Main" (src/components/v3/shell/app-shell.tsx:294
    // and the design's app-shell.tsx), not "Primary".
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Projects', exact: true })
    .click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: project.title, exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  // The phone view is the md:hidden MobileList, and nothing overflows it.
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390)
  const search = page.getByRole('searchbox', { name: 'Search projects' })
  await expect(search).toBeVisible()
  // The phone row is the design's MobileList row, whose link names the project
  // together with its id, client and status (the desktop table is hidden here).
  await expect(
    page.getByRole('link', { name: new RegExp(project.title) }),
  ).toBeVisible()
  // The design's phone toolbar gives the search the flexible remainder
  // (`order-first min-w-0 flex-1`) rather than a fixed width, so it is the
  // widest control there, and every control stays inside the viewport.
  const searchBox = await search.boundingBox()
  const sortBox = await page
    .getByRole('button', { name: 'Sort', exact: true })
    .boundingBox()
  if (!searchBox || !sortBox) throw new Error('Phone toolbar did not render')
  expect(searchBox.width).toBeGreaterThan(sortBox.width)
  expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(390)
})

test.describe('native project activity', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })

  test('shows the current readable identity of the newest record event', async ({
    page,
  }) => {
    const projectTitle = `Activity project ${randomUUID()}`
    const recordTitle = `Activity proof ${randomUUID()}`
    let projectId: string | undefined
    try {
      await signInAsDesignUser(page, '00000000-0000-4000-8000-000000000310')
      await page.goto('/projects')
      // The peek renders a project's three newest change events and, for each
      // event that names a record, that record's *current* identifier and title
      // (fetchProjectActivity). The seeded projects' newest events name sheet
      // instances and datasets, so nothing there exercises the record identity:
      // the spec creates a project and a draft experiment of its own through
      // the app, and removes the project again, rather than reporting nothing
      // about the feature.
      await page.getByRole('button', { name: 'New project', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'New project' })
      await dialog
        .getByRole('textbox', { name: 'Name', exact: true })
        .fill(projectTitle)
      const creating = page.waitForResponse(
        (result) =>
          result.url().includes('/api/db/rpc/create_project') &&
          result.request().method() === 'POST',
      )
      await page
        .getByRole('button', { name: 'Create project', exact: true })
        .click()
      const project: { id: string } = await (await creating).json()
      projectId = project.id
      await expect(dialog).not.toBeVisible()
      // A blank draft — the app's own path — is one record change event, and
      // the new project's newest event.
      await page.goto(`/experiments/new?project=${projectId}`)
      // The form is server-rendered; its project select enables once the
      // client's access read lands, which is also the point at which typing
      // into it is safe. The field states its hint in the label, so the
      // textbox's name is "Title What is being tested…".
      await expect(
        page.getByRole('combobox', { name: /^Project/ }),
      ).toBeEnabled()
      const titleField = page.getByRole('textbox', { name: /^Title/ })
      await titleField.fill(recordTitle)
      await expect(titleField).toHaveValue(recordTitle)
      const writing = page.waitForResponse(
        (result) =>
          result.url().includes('/api/db/rpc/create_record_with_blocks') &&
          result.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Create draft' }).click()
      const created: { record: { id: string } } = await (await writing).json()
      const identity = await page.evaluate(async (id) => {
        const response = await fetch(
          `/api/db/records?id=eq.${id}&select=identifier,title`,
        )
        if (!response.ok) throw new Error('Native record read failed')
        return (await response.json())[0]
      }, created.record.id)
      expect(identity.title).toBe(recordTitle)
      await page.goto('/projects')
      await page
        .getByRole('button', {
          name: `Quick view of ${projectTitle}`,
          exact: true,
        })
        .click()
      await expect(
        page.getByTitle('Current record identity').filter({
          hasText: `${identity.identifier} · ${recordTitle}`,
        }),
      ).not.toHaveCount(0)
      await page.screenshot({
        path: '.amp/in/artifacts/proj01-integrated-activity.png',
      })
    } finally {
      if (projectId) {
        const database = new Client({
          connectionString: process.env.MIGRATION_DATABASE_URL,
        })
        await database.connect()
        try {
          await database.query(
            'DELETE FROM api.projects WHERE id=$1 AND title LIKE $2',
            [projectId, `${projectTitle}%`],
          )
        } finally {
          await database.end()
        }
      }
    }
  })
})
