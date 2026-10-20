import { expect, test } from 'playwright/test'
import { Client } from 'pg'
import { z } from 'zod'

import type { Appearance } from '../../src/lib/user-preferences'
import { signInAsDesignUser } from '../visual/sign-in'

const userId = '00000000-0000-4000-8000-000000000310'
const workspaceId = '00000000-0000-4000-8000-000000000300'
let appearanceClient: Client | undefined
let originalAppearance: Appearance | undefined

/** One row of the Inbox read state this spec resets (RM-116). */
interface SeenItemRow {
  user_id: string
  workspace_id: string
  item_key: string
  seen_at: Date
}

let seenClient: Client | undefined
let originalSeen: SeenItemRow[] | undefined

test.use({
  baseURL: process.env.HOME_TEST_BASE_URL ?? 'http://127.0.0.1:3100',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, userId)
  const connectionString = process.env.PGRST_DB_URI
  if (
    !connectionString ||
    !['localhost', '127.0.0.1'].includes(new URL(connectionString).hostname)
  ) {
    throw new Error('Local disposable database required for Home appearance')
  }
  appearanceClient = new Client({ connectionString })
  await appearanceClient.connect()
  await appearanceClient.query('set role authenticated')
  await appearanceClient.query(
    "select set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role: 'authenticated',
        workspace_id: workspaceId,
        sub: userId,
        session_id: `parity-${userId}`,
      }),
    ],
  )
  originalAppearance = z
    .enum(['light', 'dark', 'system'])
    .parse(
      (
        await appearanceClient.query(
          "select coalesce((select appearance from api.user_preferences),'system') appearance",
        )
      ).rows[0].appearance,
    )
  // RM-116 keeps the caller's Inbox read state in `api.work_item_views`, and
  // Home states the totals of the authorities it reads: acknowledged work is
  // not outstanding work. The design database is shared and durable, so how
  // much of the seeded work an earlier run acknowledged is not this spec's to
  // inherit — reset it, and put it back afterwards.
  const adminConnectionString = process.env.MIGRATION_DATABASE_URL
  if (
    !adminConnectionString ||
    !['localhost', '127.0.0.1'].includes(
      new URL(adminConnectionString).hostname,
    )
  ) {
    throw new Error('Local disposable database required for Home totals')
  }
  seenClient = new Client({ connectionString: adminConnectionString })
  await seenClient.connect()
  originalSeen = (
    await seenClient.query<SeenItemRow>(
      `select user_id, workspace_id, item_key, seen_at
         from api.work_item_views
        where user_id = $1 and workspace_id = $2
        order by item_key`,
      [userId, workspaceId],
    )
  ).rows
  await seenClient.query(
    'delete from api.work_item_views where user_id = $1 and workspace_id = $2',
    [userId, workspaceId],
  )
  await page.clock.install({ time: new Date('2026-09-25T09:30:00+01:00') })
})

test.afterEach(async () => {
  if (!appearanceClient) return
  try {
    if (originalAppearance !== undefined) {
      await appearanceClient.query('select api.set_user_appearance($1)', [
        originalAppearance,
      ])
      const restored = z
        .enum(['light', 'dark', 'system'])
        .parse(
          (
            await appearanceClient.query(
              "select coalesce((select appearance from api.user_preferences),'system') appearance",
            )
          ).rows[0].appearance,
        )
      expect(restored).toBe(originalAppearance)
    }
  } finally {
    await appearanceClient.end()
    appearanceClient = undefined
    originalAppearance = undefined
  }
})

test.afterEach(async () => {
  if (!seenClient) return
  try {
    for (const row of originalSeen ?? []) {
      await seenClient.query(
        `insert into api.work_item_views (user_id, workspace_id, item_key, seen_at)
         values ($1, $2, $3, $4)
         on conflict do nothing`,
        [row.user_id, row.workspace_id, row.item_key, row.seen_at],
      )
    }
  } finally {
    await seenClient.end()
    seenClient = undefined
    originalSeen = undefined
  }
})

for (const theme of ['light', 'dark'] as const) {
  test(`Home ${theme} totals come from exact readable authorities`, async ({
    page,
  }, testInfo) => {
    if (!appearanceClient)
      throw new Error('Home appearance fixture unavailable')
    await appearanceClient.query('select api.set_user_appearance($1)', [theme])
    await page.addInitScript((value) => {
      document.cookie = `sb-theme=${value}; path=/`
    }, theme)
    await page.goto('/')
    const summary = page.getByRole('navigation', { name: 'Summary' })
    await expect(summary).toBeVisible({ timeout: 20000 })
    const totals = await page.evaluate(async () => {
      // The Inbox totals come from the one Inbox predicate (QA2-Inbox-1), not
      // from a state-only count of the work-item view.
      const inbox = await fetch('/api/db/rpc/inbox_needs_action_counts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }).then((response) => response.json())
      const resources = [
        'rpc/dataset_list_summary?issue_count=gt.0&archived_at=is.null',
        'records?kind=eq.experiment&status=eq.in_progress&deleted_at=is.null',
        'instrument_runs?started_at=gte.2026-09-24T23:00:00.000Z&started_at=lt.2026-09-25T23:00:00.000Z',
      ]
      const counted = await Promise.all(
        resources.map(async (resource) => {
          const response = await fetch(`/api/db/${resource}`, {
            headers: { prefer: 'count=exact', range: '0-0' },
          })
          if (!response.ok)
            throw new Error(`Count request failed: ${response.status}`)
          await response.text()
          const range = response.headers.get('content-range')
          if (!range || !/\/\d+$/.test(range))
            throw new Error('Missing exact total')
          return Number(range.split('/')[1])
        }),
      )
      return [inbox[0].reviews, ...counted, inbox[0].total]
    })
    const labels = [
      'to review',
      'datasets? with errors',
      'experiments in progress',
      'instrument runs today',
      'items',
    ]
    for (let index = 0; index < totals.length; index++) {
      await expect(summary).toContainText(
        new RegExp(`${totals[index]} ${labels[index]}`),
      )
    }
    await expect(
      page.getByRole('columnheader', { name: 'Project', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Submitted by', exact: true }),
    ).toBeVisible()
    const submissions = z.array(z.object({ revision_id: z.string() })).parse(
      await page.evaluate(async () => {
        const response = await fetch(
          '/api/db/review_submissions?state=eq.submitted&assigned_reviewer_user_ids=cs.%7B00000000-0000-4000-8000-000000000310%7D&select=revision_id&order=due_at.asc.nullslast,submitted_at.desc&limit=5',
        )
        if (!response.ok)
          throw new Error(`Submission read failed: ${response.status}`)
        return response.json()
      }),
    )
    expect(submissions.length).toBeGreaterThan(0)
    const reviewLinks = page.getByRole('button', {
      name: 'Review',
      exact: true,
    })
    await expect(reviewLinks).toHaveCount(submissions.length)
    for (let index = 0; index < submissions.length; index++) {
      await expect(reviewLinks.nth(index)).toHaveAttribute(
        'href',
        `/review/${submissions[index].revision_id}`,
      )
    }
    await expect(page.getByText('DS-0298', { exact: true })).toBeVisible()
    await expect(
      page.getByText('2 columns missing units', { exact: false }),
    ).toBeVisible()
    await page.waitForFunction(() => document.fonts.status === 'loaded')
    if (theme === 'dark')
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) })
    console.info(`Home exact totals (${theme}): ${totals.join(', ')}`)
  })
}

test('Home surfaces unavailable exact totals instead of zero or preview lengths', async ({
  page,
}, testInfo) => {
  // Home reads its totals as `Prefer: count=exact` reads of the authorities it
  // names — Datasets with errors among them — so an authority that answers
  // without an exact total must fail the page rather than becoming a total.
  const unavailable = '**/api/db/rpc/dataset_list_summary?**'
  await page.route(unavailable, async (route) => {
    if (route.request().headers().prefer !== 'count=exact')
      return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[{}]',
    })
  })
  await page.goto('/')
  // Home degrades one section at a time: the counts say they are unavailable
  // (a dash, never a zero or a preview length) and the rest of the page stays.
  const notice = page.getByText('Part of Home could not be loaded.')
  await expect(notice).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Unavailable right now: Counts.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByText('— datasets with errors')).toBeVisible()
  await expect(page.getByText('0 datasets with errors')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Continue working' }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('home-count-error.png') })
  await page.unroute(unavailable)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('navigation', { name: 'Summary' })).toBeVisible({
    timeout: 20000,
  })
  await expect(notice).toHaveCount(0)
})

test('Home material attention opens the actual lot instead of the first registry row', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Summary' })).toBeVisible({
    timeout: 20000,
  })
  const material = z.object({ record_id: z.string(), title: z.string() }).parse(
    await page.evaluate(async () => {
      const response = await fetch(
        '/api/db/my_work_items?kind=eq.material_expiring&identifier=eq.MAT-0420&select=record_id,title',
      )
      if (!response.ok)
        throw new Error(`Material authority failed: ${response.status}`)
      const rows = await response.json()
      return rows[0]
    }),
  )
  const attention = page.getByRole('link', { name: 'MAT-0420', exact: true })
  await expect(attention).toHaveAttribute(
    'href',
    `/materials?selected=${material.record_id}`,
  )
  await expect(attention.locator('..')).toContainText('lot expires in 6 days')
  await attention.click()
  await expect(page).toHaveURL(
    new RegExp(`/materials\\?selected=${material.record_id}`),
  )
  const lot = page.locator('[aria-label="Material lot"]')
  await expect(lot).toContainText('MAT-0420')
  await expect(lot).toContainText(material.title)
})

test('Home Review action reaches the submitted revision workspace', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Summary' })).toBeVisible({
    timeout: 20000,
  })
  const action = page
    .getByRole('button', { name: 'Review', exact: true })
    .first()
  const destination = await action.getAttribute('href')
  expect(destination).toMatch(/^\/review\/[\da-f-]+$/)
  await action.click()
  await expect(page).toHaveURL(new RegExp(`${destination}$`))
  await expect(
    page.getByRole('tablist', { name: 'Review workspace panels' }),
  ).toBeVisible({
    timeout: 20000,
  })
})

test('Home has an explicit empty-review state without fabricated review actions', async ({
  page,
}) => {
  await page.route('**/api/db/review_submissions?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    }),
  )
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Summary' })).toBeVisible({
    timeout: 20000,
  })
  await expect(
    page.getByText('Nothing awaiting your review', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Review', exact: true }),
  ).toHaveCount(0)
})

// Render-contract coverage only. These intercepted first-run responses are
// not a substitute for the full seeded HomeFirstRun acceptance scenario.
for (const theme of ['light', 'dark'] as const) {
  test(`Home ${theme} access labels distinguish Edit plus Review from Review only`, async ({
    page,
  }, testInfo) => {
    if (!appearanceClient)
      throw new Error('Home appearance fixture unavailable')
    await appearanceClient.query('select api.set_user_appearance($1)', [theme])
    await page.addInitScript((value) => {
      document.cookie = `sb-theme=${value}; path=/`
    }, theme)
    for (const resource of [
      'recently_viewed?**',
      'change_events?**',
      'rpc/my_onboarding_state',
    ]) {
      await page.route(`**/api/db/${resource}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'content-range': '*/0' },
          body: '[]',
        }),
      )
    }
    await page.route('**/api/db/rpc/project_members', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            user_id: '00000000-0000-4000-8000-000000000311',
            name: 'Priya S.',
            access_level: 'editor',
            workspace_role: 'member',
            is_lead: false,
            added_at: '2026-09-25T08:30:00Z',
          },
          {
            user_id: '00000000-0000-4000-8000-000000000312',
            name: 'Mei L.',
            access_level: 'editor',
            workspace_role: 'reviewer',
            is_lead: false,
            added_at: '2026-09-25T08:30:00Z',
          },
        ]),
      }),
    )
    let canEdit = true
    await page.route('**/api/db/rpc/my_project_permissions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            project_id: '00000000-0000-4000-8000-000000000320',
            can_view: true,
            can_edit: canEdit,
            can_review: true,
            can_manage: false,
            client_portal: false,
            access_level: 'editor',
          },
        ]),
      }),
    )
    for (const label of ['Reviewer', 'Review only']) {
      canEdit = label === 'Reviewer'
      await page.goto('/')
      const projects = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'Your projects', exact: true }),
      })
      await expect(projects.getByText(label, { exact: true })).toBeVisible({
        timeout: 20000,
      })
      await expect(projects.getByText('Editor', { exact: true })).toHaveCount(0)
      await expect(
        page.getByText('Workspace reviewer', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('Workspace member', { exact: true }),
      ).toBeVisible()
      await page.waitForFunction(() => document.fonts.status === 'loaded')
      if (theme === 'dark')
        await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
      await page.screenshot({
        path: testInfo.outputPath(
          `home-access-${theme}-${canEdit ? 'combined' : 'review-only'}.png`,
        ),
      })
    }
  })
}
