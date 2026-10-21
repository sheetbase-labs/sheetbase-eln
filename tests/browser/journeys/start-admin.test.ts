/**
 * Journeys START-01 to ADMIN-22: getting started, projects and workspace
 * administration, walked in a real browser. Each test is one journey and
 * states the outcome a person should reach without hunting for it: the next
 * step offered where they are, a new thing opened once created, the people who
 * need to act told, and nothing that the database allows hidden by the screen.
 *
 * Run with the Playwright browser project against the dev server (see
 * playwright.config.ts). Journeys that need a person other than the seeded
 * owner create their own accounts and workspaces, so they do not depend on, or
 * change, what the other journeys read.
 */
import { expect, test } from 'playwright/test'

import {
  action,
  createExperiment,
  createProject,
  createUser,
  createWorkspace,
  open,
  signIn,
  signInAs,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from './helpers'

test.setTimeout(60_000)
test.use({ viewport: { width: 1280, height: 900 } })

/** The seeded design project the owner leads (AAV9 process transfer). */
const DESIGN_PROJECT = '00000000-0000-4000-8000-000000000320'

test.describe('as the seeded workspace admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('ADMIN-01 an invitation can carry a project and its link can be copied again', async ({
    page,
  }) => {
    await open(page, '/settings/members')
    await page.getByRole('button', { name: /invite people/i }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel(/email/i)
      .fill(`${uniqueName('invitee').replace(/ /g, '-')}@sheetbase.test`)
    // The invitation names the projects the person joins, so the lead is not
    // asked to add them separately afterwards.
    const projects = dialog.getByRole('group', { name: 'Add to projects' })
    await expect(projects).toBeVisible()
    await projects.getByRole('checkbox').first().check()
    await dialog.getByRole('button', { name: /create invitation/i }).click()
    await expect(
      page.getByRole('dialog').getByLabel('Invitation link'),
    ).toHaveValue(/accept-invitation\?token=/)
    await page.getByRole('button', { name: /^(done|close)$/i }).click()
    // A pending invitation can be given a new link without revoking it.
    await page
      .getByRole('button', { name: /copy new link/i })
      .first()
      .click()
    await expect(
      page.getByRole('dialog').getByLabel('Invitation link'),
    ).toHaveValue(/accept-invitation\?token=/)
  })

  test('ADMIN-02 a project can be set up for a new client, and creating it opens it', async ({
    page,
  }) => {
    await open(page, '/projects?new=true')
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel(/^title|^name/i)
      .first()
      .fill(uniqueName('Client project'))
    // The client list offers creating one; a CDMO's first client has to exist.
    await dialog.getByLabel(/^Client/).selectOption({ label: 'New client…' })
    await dialog.getByLabel('New client name').fill(uniqueName('Client'))
    await dialog.getByRole('button', { name: /^create/i }).click()
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/)
  })

  test('ADMIN-03 the person who created a project can add its team and change its settings', async ({
    page,
  }) => {
    const path = await createProject(page, uniqueName('Team project'))
    await open(page, `${path}/members`)
    await expect(action(page, /add people/i)).toBeVisible()
    await open(page, `${path}/settings`)
    await expect(page.getByRole('textbox', { name: /^name/i })).toBeEditable()
    await expect(page.getByText(/the lead is the lead/i)).toHaveCount(0)
  })

  test('ADMIN-04 a folder lists experiments that open, and can be renamed and deleted', async ({
    page,
  }) => {
    const path = await createProject(page, uniqueName('Folder project'))
    await createExperiment(page, path, uniqueName('Filed run'))
    await open(page, `${path}/folders`)
    // Rows are links to the thing they list.
    await page
      .getByRole('link', { name: /Filed run/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}/)
    await page.goBack()
    await waitForHydration(page)
    await page
      .getByRole('button', { name: /new folder/i })
      .first()
      .click()
    const folder = uniqueName('Gels')
    await page.getByRole('dialog').getByLabel(/^Name/).fill(folder)
    await page.getByRole('button', { name: 'Add folder' }).click()
    await expect(
      page.getByRole('heading', { name: folder, exact: true }),
    ).toBeVisible()
    // A folder made by mistake can be renamed and removed.
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    const renamed = uniqueName('Blots')
    await page.getByRole('dialog').getByLabel(/^Name/).fill(renamed)
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Rename' })
      .click()
    await expect(
      page.getByRole('heading', { name: renamed, exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Delete folder' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete folder' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Unfiled', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: new RegExp(renamed) }),
    ).toHaveCount(0)
  })

  test('ADMIN-05 an experiment started in the wrong project can be moved', async ({
    page,
  }) => {
    const from = await createProject(page, uniqueName('Wrong project'))
    const toTitle = uniqueName('Right project')
    await createProject(page, toTitle)
    const experimentId = await createExperiment(
      page,
      from,
      uniqueName('Misfiled'),
    )
    await open(page, `/experiments/${experimentId}/overview`)
    await page.getByRole('button', { name: 'More experiment actions' }).click()
    await page
      .getByRole('menuitem', { name: 'Move to another project' })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').selectOption({ label: toTitle })
    await dialog.getByRole('button', { name: 'Move', exact: true }).click()
    await expect(
      page.getByRole('link', { name: toTitle }).first(),
    ).toBeVisible()
  })

  test('ADMIN-06 from a new experiment the project is one click away, and the project lists it as a link', async ({
    page,
  }) => {
    const path = await createProject(page, uniqueName('Round trip'))
    const title = uniqueName('Back and forth')
    await createExperiment(page, path, title)
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: /Round trip/ })
      .click()
    await expect(page).toHaveURL(path)
    for (const url of [path, `${path}/experiments`]) {
      await open(page, url)
      await expect(
        page.getByRole('link', { name: new RegExp(title) }).first(),
      ).toBeVisible()
    }
  })

  test('ADMIN-07 a lead sees review progress and activity on the project, and the peek filters by project', async ({
    page,
  }) => {
    await open(page, `/projects/${DESIGN_PROJECT}`)
    await expect(page.getByText(/experiments approved/).first()).toBeVisible()
    await expect(page.getByText(/awaiting review/i).first()).toBeVisible()
    await expect(page.getByText('Recent activity').first()).toBeVisible()
    await open(page, `/experiments?project=${DESIGN_PROJECT}&older=true`)
    await expect(page.getByText(/AAV9 process transfer/).first()).toBeVisible()
    // Only this project's experiments are listed, and the filter can be cleared.
    await expect(
      page.getByRole('button', { name: 'Clear the project filter' }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('table', { name: 'Experiments' })
        .getByRole('link', { name: 'AAV9 process transfer' })
        .first(),
    ).toBeVisible()
  })

  test('ADMIN-08 a milestone condition links a record from a project picker', async ({
    page,
  }) => {
    const path = await createProject(page, uniqueName('Evidence project'))
    await createExperiment(page, path, uniqueName('Evidence run'))
    await open(page, `${path}/milestones`)
    await page
      .getByRole('button', { name: /^Add (a )?milestone/ })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Name/).fill('Release package')
    await dialog.getByLabel(/^Due date/).fill('2026-12-01')
    await dialog.getByRole('button', { name: 'Add milestone' }).click()
    const milestone = page.getByRole('button', { name: /Release package/ })
    await milestone.first().click()
    await page.getByLabel('New condition').fill('Run approved')
    await page.getByRole('button', { name: 'Add condition' }).click()
    await page.getByRole('button', { name: 'Link record' }).click()
    const picker = page.getByLabel(/Evidence record for Run approved/)
    await expect(picker).toBeVisible()
    await picker.selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(
      page.getByRole('link', { name: /^EXP-/ }).first(),
    ).toBeVisible()
  })

  test('ADMIN-09 archive copy names the place a project is restored from', async ({
    page,
  }) => {
    const path = await createProject(page, uniqueName('Finished project'))
    await open(page, `${path}/settings`)
    await page.getByRole('button', { name: /^archive/i }).click()
    await expect(
      page
        .getByRole('dialog')
        .getByText(/settings tab|restore/i)
        .first(),
    ).toBeVisible()
    await expect(
      page.getByRole('dialog').getByText(/archived tab/i),
    ).toHaveCount(0)
  })

  test('ADMIN-11 the QA group a new project gives read access to can be set', async ({
    page,
  }) => {
    await open(page, '/settings/access')
    await expect(
      page.getByRole('combobox', { name: /qa (view )?group/i }),
    ).toBeVisible()
  })

  test('ADMIN-14 a project can be pinned to the sidebar from its page', async ({
    page,
  }) => {
    const title = uniqueName('Pinned project')
    const path = await createProject(page, title)
    await page
      .getByRole('button', { name: /pin|favourite/i })
      .first()
      .click()
    await expect(
      page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: title }),
    ).toBeVisible()
    expect(path).toMatch(/projects/)
  })

  test('ADMIN-15 a new API token comes with the two calls that use it', async ({
    page,
  }) => {
    await open(page, '/settings/api')
    await expect(page.getByText(/\/api\/token/).first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Copy example request' }),
    ).toBeVisible()
    await page.getByLabel(/^Name/).first().fill(uniqueName('Walk token'))
    await page.getByRole('checkbox', { name: 'projects:read' }).first().click()
    await page.getByRole('button', { name: 'Create token' }).click()
    await expect(page.getByText(/I have stored it/)).toBeVisible()
  })

  test('ADMIN-16 registering a connector opens it to finish setting up', async ({
    page,
  }) => {
    await open(page, '/settings/integrations')
    await page.getByRole('button', { name: /register connector/i }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/name/i).first().fill(uniqueName('Walk connector'))
    await dialog
      .getByRole('button', { name: /^(register|create|save)/i })
      .click()
    await expect(page).toHaveURL(/\/settings\/integrations\/[0-9a-f-]{36}/)
  })

  test('ADMIN-17 the audit log names its records and projects and filters to one record', async ({
    page,
  }) => {
    await open(page, '/settings/audit')
    const row = page.getByRole('row').nth(1)
    await expect(row.getByRole('link').first()).toBeVisible()
    // Identifiers and names, not the first characters of a UUID.
    await expect(page.getByRole('link', { name: /^[0-9a-f]{8}$/ })).toHaveCount(
      0,
    )
    await page
      .getByRole('link', { name: /^[A-Z]{2,5}-\d+/ })
      .first()
      .click()
    await expect(page).toHaveURL(/record=/)
    await expect(
      page.getByRole('button', { name: 'Clear the record filter' }),
    ).toBeVisible()
  })

  // Known gap: no personal time zone exists yet; dates render in UTC.
  test.fixme('ADMIN-19 the profile holds a personal time zone', async ({
    page,
  }) => {
    await open(page, '/settings/profile')
    await expect(page.getByLabel(/time ?zone/i)).toBeVisible()
  })

  test('ADMIN-21 signing out leaves the sign-in page with the state named', async ({
    page,
  }) => {
    await open(page, '/')
    await page.getByRole('button', { name: /^account/i }).click()
    await page.getByRole('menuitem', { name: /sign out/i }).click()
    await expect(page).toHaveURL(/sign-in/)
  })
})

test('START-01 a founder with an empty workspace is offered a project and a colleague', async ({
  page,
}) => {
  const founder = await createUser('Founder Fran')
  await createWorkspace(founder, 'Fran Labs')
  await signInAs(page, founder)
  await open(page, '/')
  await expect(page.getByRole('heading', { name: 'Get set up' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Invite a colleague' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/projects\?new=true/)
  await expect(page.getByRole('dialog', { name: /new project/i })).toBeVisible()
  await page.goBack()
  // A founder is not told to wait for someone else to add them.
  await expect(page.getByText(/once someone adds you/i)).toHaveCount(0)
})

test('START-02 an invited colleague joins, lands in the workspace named, and finds the project they were invited to', async ({
  page,
  browser,
}) => {
  const admin = await createUser('Admin Ada')
  await createWorkspace(admin, 'Ada Biologics')
  await signInAs(page, admin)
  const projectName = uniqueName('Invited project')
  const joinerEmail = `joiner.${Date.now().toString(36)}@sheetbase.test`
  await createProject(page, projectName)
  await open(page, '/settings/members')
  await page.getByRole('button', { name: /invite people/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/email/i).fill(joinerEmail)
  await dialog
    .getByRole('group', { name: 'Add to projects' })
    .getByRole('checkbox')
    .first()
    .check()
  await dialog.getByRole('button', { name: /create invitation/i }).click()
  const link = await page
    .getByRole('dialog')
    .getByLabel('Invitation link')
    .inputValue()
  // Signing up gives every account a workspace of its own first.
  const joiner = await createUser('Joiner Jo')
  await createWorkspace(joiner, 'Jo Personal')
  await withAdminDb((db) =>
    db.query(`update internal."user" set email = $2 where id = $1`, [
      joiner.id,
      joinerEmail,
    ]),
  )
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1280, height: 900 },
  })
  const joinerPage = await context.newPage()
  await signInAs(joinerPage, joiner)
  const target = new URL(link)
  await joinerPage.goto(target.pathname + target.search)
  await waitForHydration(joinerPage)
  await joinerPage.getByRole('button', { name: /accept/i }).click()
  await expect(joinerPage).toHaveURL(/\/$/)
  // Home names the workspace they joined, and the project is already theirs.
  await expect(joinerPage.getByText(/Ada Biologics/).first()).toBeVisible()
  await open(joinerPage, '/projects')
  await expect(
    joinerPage.getByText(projectName).filter({ visible: true }).first(),
  ).toBeVisible()
  await context.close()
})

test('ADMIN-10 a scientist finds Electronic signatures in their own settings', async ({
  page,
}) => {
  await signInAs(page, {
    id: '00000000-0000-4000-8000-000000000311',
    name: 'Priya S.',
  })
  await open(page, '/settings/profile')
  await expect(
    page
      .getByRole('navigation', { name: /settings/i })
      .getByRole('link', { name: /electronic signatures/i }),
  ).toBeVisible()
})

test('ADMIN-12 a viewer asking for edit access shows up for the lead on the project', async ({
  page,
}) => {
  const reason = uniqueName('Need to edit')
  await withAdminDb((db) =>
    db.query(
      `insert into api.project_access_requests (workspace_id, project_id, user_id, reason)
       values ('00000000-0000-4000-8000-000000000300', $1, '00000000-0000-4000-8000-000000000313', $2)`,
      [DESIGN_PROJECT, reason],
    ),
  )
  await signIn(page)
  await open(page, `/projects/${DESIGN_PROJECT}/members`)
  await expect(page.getByText(reason)).toBeVisible()
  await page.getByRole('button', { name: 'Deny' }).first().click()
  await expect(page.getByText(reason)).toHaveCount(0)
})

test('ADMIN-18 a member opening Settings lands on their profile, not a refusal', async ({
  page,
}) => {
  await signInAs(page, {
    id: '00000000-0000-4000-8000-000000000311',
    name: 'Priya S.',
  })
  await open(page, '/')
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page).toHaveURL(/\/settings\/profile/)
})
