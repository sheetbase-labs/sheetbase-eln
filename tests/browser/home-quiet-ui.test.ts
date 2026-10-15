/**
 * R5-HOME-01 — the calm Home at phone width.
 *
 * Render-contract coverage, not a seeded acceptance run: the `/api/db`
 * responses are intercepted so the page is in its all-clear state (the DB
 * layer's own `tests/db/home-quiet.test.ts` proves that state is reachable by a
 * real workspace). What this checks is the phone presentation — the banner,
 * the Coming up list and the inspector neither overflow 390px nor fall out of
 * the tab order.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

const userId = '00000000-0000-4000-8000-000000000310'
const PROJECT_ID = '00000000-0000-4000-8000-000000000320'
const RECORD_ID = '00000000-0000-4000-8000-00000000c001'
const DONE_RECORD_ID = '00000000-0000-4000-8000-00000000c002'
const RESOURCE_ID = '00000000-0000-4000-8000-00000000d001'

test.use({
  baseURL: process.env.HOME_TEST_BASE_URL ?? 'http://127.0.0.1:3100',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})

const projectSummary = {
  id: PROJECT_ID,
  workspace_id: '00000000-0000-4000-8000-000000000300',
  key: 'aav9-process-transfer',
  title: 'AAV9 process transfer',
  status: 'active',
  display_id: 'PRJ-0217',
  client_id: null,
  client_code: null,
  client_name: null,
  modality: 'AAV9',
  stage: 'Clarification development',
  lead_user_id: userId,
  lead_name: 'Gareth P.',
  default_reviewer_user_id: null,
  agreement_reference: null,
  started_on: '2026-08-03',
  revision: 3,
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-09-25T08:00:00.000Z',
  archived_at: null,
  record_count: 20,
  experiment_count: 14,
  last_activity_at: '2026-09-25T08:00:00.000Z',
}

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, userId)
  // The dev server pins the application clock to the design clock; pin the
  // page's clock to the same instant so the two-week window agrees.
  await page.clock.install({ time: new Date('2026-09-25T09:30:00+01:00') })
  await page.route('**/api/db/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/db/', '')
    const isCount = request.headers().prefer === 'count=exact'
    // A `count=exact` response carries `0-0/<total>` only when a row came
    // back; an empty result is `*/0` with no body. `0-0/0` claims one row
    // from an empty set, which the data client rejects as inexact.
    const json = (body: unknown, total?: number) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        ...(total === undefined
          ? {}
          : {
              headers: {
                'content-range': total ? `0-0/${total}` : '*/0',
              },
            }),
        body: JSON.stringify(total === 0 ? [] : body),
      })

    if (path.startsWith('rpc/audit_events')) {
      return json({
        formatVersion: 1,
        events: [],
        hasMore: false,
        nextCursor: null,
      })
    }
    if (path.startsWith('rpc/project_list_summary'))
      return json([projectSummary])
    if (path.startsWith('rpc/my_project_permissions')) {
      return json([
        {
          project_id: PROJECT_ID,
          can_view: true,
          can_edit: true,
          can_review: true,
          can_manage: false,
          client_portal: false,
          access_level: 'editor',
        },
      ])
    }
    if (path.startsWith('workspace_settings')) {
      return json([
        {
          site: null,
          timezone: 'Europe/London',
          date_format: 'd MMM yyyy',
          number_format: 'decimal',
          publication_approval_required: false,
          allow_offline_editing: true,
          id_prefixes: null,
          workspaces: { name: 'Process Development' },
        },
      ])
    }
    if (path.startsWith('recently_viewed')) {
      return json([
        {
          user_id: userId,
          object_kind: 'record',
          object_id: RECORD_ID,
          viewed_at: '2026-09-25T08:20:00.000Z',
        },
        {
          user_id: userId,
          object_kind: 'record',
          object_id: DONE_RECORD_ID,
          viewed_at: '2026-09-25T08:00:00.000Z',
        },
      ])
    }
    if (path.startsWith('records')) {
      if (isCount) {
        if (url.searchParams.get('status') === 'eq.approved')
          return json([{}], 9)
        if (url.searchParams.get('status') === 'eq.in_review')
          return json([{}], 2)
        return json([{}], 0)
      }
      if (url.search.includes('planned_end=')) return json([])
      if (url.search.includes('id=in.')) {
        return json([
          {
            id: RECORD_ID,
            kind: 'experiment',
            identifier: 'EXP-0145',
            title: 'Harvest clarification: 50 L confirmation run',
            status: 'draft',
            project_id: PROJECT_ID,
            archived_at: null,
            deleted_at: null,
          },
          {
            id: DONE_RECORD_ID,
            kind: 'experiment',
            identifier: 'EXP-0140',
            title: 'VCD readings, day 6',
            status: 'approved',
            project_id: PROJECT_ID,
            archived_at: null,
            deleted_at: null,
          },
        ])
      }
      return json([])
    }
    if (path.startsWith('calendar_bookings')) {
      return json([
        {
          id: '00000000-0000-4000-8000-00000000e001',
          workspace_id: '00000000-0000-4000-8000-000000000300',
          resource_id: RESOURCE_ID,
          project_id: null,
          title: 'inoculation, AMB-25-121',
          status: 'confirmed',
          all_day: false,
          starts_at: '2026-09-28T08:00:00.000Z',
          ends_at: '2026-09-28T10:00:00.000Z',
          timezone: 'Europe/London',
          location: 'Bay 2',
          color: null,
          notes: null,
          linked_experiment_record_id: null,
          linked_experiment_identifier: null,
          linked_experiment_title: null,
          metadata_version: 1,
          cancelled_at: null,
          created_at: '2026-09-20T08:00:00.000Z',
          updated_at: '2026-09-20T08:00:00.000Z',
          created_by_user_id: userId,
          updated_by_user_id: userId,
        },
      ])
    }
    if (path.startsWith('calendar_resources')) {
      return json([
        {
          id: RESOURCE_ID,
          workspace_id: '00000000-0000-4000-8000-000000000300',
          project_id: null,
          name: 'Ambr 250 bay 2',
          code: 'AMB-2',
          resource_type: 'equipment',
          location: 'Bay 2',
          capacity: 1,
          timezone: 'Europe/London',
          status: 'active',
          metadata: {},
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          created_by_user_id: null,
          updated_by_user_id: null,
        },
      ])
    }
    if (path.startsWith('instruments')) {
      return json([
        {
          id: RESOURCE_ID,
          display_id: 'INS-0008',
          name: 'Ambr 250 bay 2',
          location: 'Bay 2',
          retired_at: null,
        },
      ])
    }
    if (path.startsWith('study_tasks')) {
      return json([
        {
          id: '00000000-0000-4000-8000-00000000f001',
          project_id: PROJECT_ID,
          title: 'Clarification train selected',
          status: 'in_progress',
          due_at: '2026-09-29T00:00:00.000Z',
        },
      ])
    }
    if (isCount) return json([{}], 0)
    return json([])
  })
})

async function overflows(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluate((element) => element.scrollWidth > element.clientWidth + 1)
}

test('the calm Home at phone width does not overflow and stays in the tab order', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByText('Nothing is waiting on you')).toBeVisible({
    timeout: 20000,
  })

  // Coming up carries the booking, the milestone and the planned end.
  const comingUp = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Coming up' }) })
  await expect(comingUp).toBeVisible()
  await expect(
    comingUp.getByRole('link', { name: /Ambr 250 bay 2/ }),
  ).toBeVisible()
  await expect(
    comingUp.getByRole('link', { name: 'Clarification train selected' }),
  ).toBeVisible()

  // Nothing on the page scrolls sideways at 390px.
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(false)
  expect(await overflows(page, 'section:has(h2:text("Coming up"))')).toBe(false)
  expect(
    await page
      .locator('div')
      .filter({ hasText: 'Nothing is waiting on you' })
      .first()
      .evaluate((element) => element.scrollWidth > element.clientWidth + 1),
  ).toBe(false)

  // The Coming up links are reachable by keyboard alone.
  const focused: string[] = []
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('Tab')
    focused.push(
      await page.evaluate(() =>
        (document.activeElement?.textContent ?? '').trim().slice(0, 40),
      ),
    )
  }
  expect(focused.some((name) => name.includes('Ambr 250 bay 2'))).toBe(true)

  // The inspector is behind the "Today" trigger on a phone; it opens by
  // keyboard and its sheet does not overflow either.
  const trigger = page.getByRole('button', { name: 'Today' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(
    sheet.getByRole('button', { name: 'New experiment from a protocol' }),
  ).toBeVisible()
  await expect(sheet.getByText('Team activity')).toBeVisible()
  expect(
    await sheet.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    ),
  ).toBe(false)
})
