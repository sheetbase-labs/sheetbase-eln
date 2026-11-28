/**
 * An experiment opens in a pane without looping. Every state an experiment
 * can be in (an empty draft, a new one with parts, in review, approved,
 * archived) is opened every way a person opens one (as the page, beside the
 * list, beside the agent, below itself, and through a record peek) and each
 * must render its notebook, with no render loop and no pane error.
 *
 * It exists because a notebook that reported its unsaved-work state after
 * every render, to an owner that passed a new callback every render, crashed
 * the pane with React error 185 whenever it opened as a second pane.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { FIXTURE_USER_ID, FIXTURE_WORKSPACE_ID } from '#/db/seed/identities'
import { signInAsDesignUser } from '../visual/sign-in'
import { ensureOwnUser } from './own-user'

config({ path: ['.env.local', '.env'] })

test.setTimeout(120_000)
test.describe.configure({ mode: 'parallel' })

const PROJECT = '69000000-0000-4000-8000-000000000001'

interface State {
  name: string
  id: string
  identifier: string
  status: string
  archived: boolean
  parts: boolean
  plate: boolean
  /** Shown in the default experiments list, so it can be peeked from there. */
  listed: boolean
}

const STATES: State[] = [
  {
    name: 'empty draft',
    id: '69000000-0000-4000-8000-000000000011',
    identifier: 'EXP-9901',
    status: 'draft',
    archived: false,
    parts: false,
    plate: false,
    listed: true,
  },
  {
    name: 'new with parts and a plate',
    id: '69000000-0000-4000-8000-000000000012',
    identifier: 'EXP-9902',
    status: 'draft',
    archived: false,
    parts: true,
    plate: true,
    listed: true,
  },
  {
    name: 'in review',
    id: '69000000-0000-4000-8000-000000000013',
    identifier: 'EXP-9903',
    status: 'in_review',
    archived: false,
    parts: true,
    plate: false,
    listed: true,
  },
  {
    name: 'approved',
    id: '69000000-0000-4000-8000-000000000014',
    identifier: 'EXP-9904',
    status: 'approved',
    archived: false,
    parts: true,
    plate: false,
    listed: false,
  },
  {
    name: 'archived',
    id: '69000000-0000-4000-8000-000000000015',
    identifier: 'EXP-9905',
    status: 'draft',
    archived: true,
    parts: false,
    plate: false,
    listed: false,
  },
]

let admin: Client
/** This spec's own owner of the fixture workspace (see own-user.ts). */
const OWNER = '7e570000-0000-4000-8000-000000000001'

async function clean() {
  const ids = STATES.map((state) => state.id)
  await admin.query('DELETE FROM api.plate_runs WHERE record_id = ANY($1)', [
    ids,
  ])
  await admin.query(
    'DELETE FROM api.experiment_parts WHERE record_id = ANY($1)',
    [ids],
  )
  await admin.query('DELETE FROM api.records WHERE id = ANY($1)', [ids])
  await admin.query('DELETE FROM api.projects WHERE id=$1', [PROJECT])
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await ensureOwnUser(admin, {
    id: OWNER,
    name: 'Pane render owner',
    workspaceId: FIXTURE_WORKSPACE_ID,
  })
  // The tests only open these experiments, so they run side by side and share
  // one set of rows: the first worker in makes them, under a lock, and no
  // worker removes them while another may still be reading them.
  await admin.query('SELECT pg_advisory_lock(735700001)')
  try {
    const present = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM api.records WHERE id = ANY($1)',
      [STATES.map((state) => state.id)],
    )
    if (present.rows[0].n !== STATES.length) await createExperiments()
  } finally {
    await admin.query('SELECT pg_advisory_unlock(735700001)')
  }
})

async function createExperiments() {
  await clean()
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'PANE01','Pane render',$3)`,
    [PROJECT, FIXTURE_WORKSPACE_ID, OWNER],
  )

  for (const [index, state] of STATES.entries()) {
    await admin.query(
      `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,archived_at,created_by_user_id)
       VALUES ($1,$2,$3,'experiment',$4,$5,$6,$7,$8)`,
      [
        state.id,
        FIXTURE_WORKSPACE_ID,
        PROJECT,
        state.identifier,
        `Pane render ${state.name}`,
        state.status,
        state.archived ? new Date() : null,
        FIXTURE_USER_ID,
      ],
    )

    if (state.parts) {
      for (let part = 1; part <= 5; part += 1) {
        await admin.query(
          `INSERT INTO api.experiment_parts(workspace_id,record_id,position,title,day_offset,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            FIXTURE_WORKSPACE_ID,
            state.id,
            part,
            `Milestone ${part}`,
            part - 1,
            FIXTURE_USER_ID,
          ],
        )
      }
    }

    if (state.plate) {
      await admin.query(
        `INSERT INTO api.plate_runs(workspace_id,number,name,record_id,format,rows,cols,created_by)
         VALUES ($1,$2,'Plate layout',$3,'96_well',8,12,$4)`,
        [FIXTURE_WORKSPACE_ID, 9900 + index, state.id, FIXTURE_USER_ID],
      )
    }
  }
}

test.afterAll(async () => {
  await admin.end()
})

/** Everything that means a page crashed or kept rendering without end. */
function watchForCrashes(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    const text = message.text()

    if (/Maximum update depth|Too many re-renders/.test(text))
      problems.push(`render loop: ${text.slice(0, 120)}`)
  })

  return problems
}

async function openBeside(page: Page, href: string) {
  // The workspace listens for the request once its first pane is on screen.
  await page.locator('[data-workspace-pane]').first().waitFor()
  await page.waitForTimeout(1000)
  await page.evaluate((target) => {
    window.dispatchEvent(
      new CustomEvent('sheetbase:workspace-open-beside', {
        detail: { href: target },
      }),
    )
  }, href)
}

async function expectRendered(page: Page, problems: string[], state: State) {
  // The experiment's section links are on screen in every state of every pane.
  await expect(
    page.getByRole('link', { name: 'Notebook', exact: true }).first(),
  ).toBeVisible({ timeout: 60_000 })
  // Give a loop time to show itself: it fails within a second or two.
  await page.waitForTimeout(3000)
  await expect(page.locator('[data-pane-failed]')).toHaveCount(0)
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
  expect(problems, state.name).toEqual([])
}

test.beforeAll(async ({ browser }) => {
  // Compile the sign-in and experiment routes once, outside the timed tests.
  test.setTimeout(180_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await signInAsDesignUser(page, OWNER)
  await page.goto(`/experiments/${STATES[0]?.id}/notebook`)
  await page
    .getByRole('link', { name: 'Notebook', exact: true })
    .first()
    .waitFor({ timeout: 150_000 })
  await context.close()
})

for (const state of STATES) {
  const href = `/experiments/${state.id}/notebook`

  test.describe(state.name, () => {
    test.beforeEach(async ({ page }) => {
      await signInAsDesignUser(page, OWNER)
    })

    test('as the page itself', async ({ page }) => {
      const problems = watchForCrashes(page)
      await page.goto(href)
      await expectRendered(page, problems, state)
    })

    test('beside the experiments list', async ({ page }) => {
      const problems = watchForCrashes(page)
      await page.goto('/experiments')
      await page.waitForTimeout(2000)
      await openBeside(page, href)
      await expect(page.locator('[data-workspace-pane]')).toHaveCount(2, {
        timeout: 15_000,
      })
      await expectRendered(page, problems, state)
    })

    test('beside the agent', async ({ page }) => {
      const problems = watchForCrashes(page)
      await page.goto('/agent')
      await page.waitForTimeout(2000)
      await openBeside(page, href)
      await expect(page.locator('[data-workspace-pane]')).toHaveCount(2, {
        timeout: 15_000,
      })
      await expectRendered(page, problems, state)
    })

    test('below itself, so it is open twice', async ({ page }) => {
      const problems = watchForCrashes(page)
      await page.goto(href)
      await expect(
        page.getByRole('link', { name: 'Notebook', exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 })
      await page.evaluate((target) => {
        window.dispatchEvent(
          new CustomEvent('sheetbase:workspace-open-beside', {
            detail: { href: target, below: true },
          }),
        )
      }, href)
      await expect(page.locator('[data-workspace-pane]')).toHaveCount(2, {
        timeout: 15_000,
      })
      await expectRendered(page, problems, state)
    })

    test('from a record peek', async ({ page }) => {
      test.skip(!state.listed, 'not in the default experiments list')
      const problems = watchForCrashes(page)
      await page.goto('/experiments')
      const link = page.locator(`a[href*="${state.id}"]:visible`).first()
      await link.hover()
      await page.keyboard.press('Space')
      // The peek's own button; the hovered row shows an Open beside of its own.
      await page.getByRole('button', { name: /Open beside Alt/ }).click()
      await expect(page.locator('[data-workspace-pane]')).toHaveCount(2, {
        timeout: 15_000,
      })
      await expectRendered(page, problems, state)
    })
  })
}
