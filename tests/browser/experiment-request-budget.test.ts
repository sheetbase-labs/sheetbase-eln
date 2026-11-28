/**
 * Opening an experiment costs a handful of requests, not dozens.
 *
 * The page used to start about 75 separate reads (the record, its links, its
 * project, its signatures, review state …) one after another, so it settled
 * after about five seconds with parts popping in one at a time. Reads that
 * start together now travel in one batch (src/lib/read-batch.ts), so a page
 * costs one request per wave.
 *
 * The budgets sit well above what the page costs today and far below what it
 * cost before: a regression that goes back to one request per read fails here
 * long before anyone feels it. Counts are of browser requests to /api, which
 * is what the connection limit and the round trips are paid on.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'
import { z } from 'zod'

import { FIXTURE_USER_ID, FIXTURE_WORKSPACE_ID } from '#/db/seed/identities'
import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

test.setTimeout(120_000)

const PROJECT = '6a000000-0000-4000-8000-000000000001'
const EXPERIMENT = '6a000000-0000-4000-8000-000000000011'
const IDENTIFIER = 'EXP-9951'
const SECOND_EXPERIMENT = '6a000000-0000-4000-8000-000000000012'
const SECOND_IDENTIFIER = 'EXP-9952'

/** Opening from the list, inside the running app. Costs 11 today (79 before). */
const CLIENT_OPEN_BUDGET = 24

/** Reads in the first request once the app has seen the page before. */
const FIRST_REQUEST_READS = 10
/** Opening a page the app has seen before: fewer waves than the first time. */
const WARM_OPEN_BUDGET = 9
/** A fresh load of the experiment URL, shell included. */
const FRESH_LOAD_BUDGET = 40

/** Separate reads of one table for one page: duplicates mean reads are not sharing. */
const SINGLE_READS_BUDGET = 8

let admin: Client
let previousActiveWorkspace: string | null = null

async function clean() {
  await admin.query('DELETE FROM api.plate_runs WHERE record_id = $1', [
    EXPERIMENT,
  ])
  await admin.query('DELETE FROM api.experiment_parts WHERE record_id = $1', [
    EXPERIMENT,
  ])
  await admin.query('DELETE FROM api.records WHERE id = ANY($1)', [
    [EXPERIMENT, SECOND_EXPERIMENT],
  ])
  await admin.query('DELETE FROM api.projects WHERE id = $1', [PROJECT])
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()

  const prior = await admin.query<{ active_workspace_id: string | null }>(
    'SELECT active_workspace_id FROM api.user_preferences WHERE user_id=$1',
    [FIXTURE_USER_ID],
  )

  previousActiveWorkspace = prior.rows[0]?.active_workspace_id ?? null
  await admin.query(
    `INSERT INTO api.user_preferences(user_id, active_workspace_id) VALUES($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = excluded.active_workspace_id`,
    [FIXTURE_USER_ID, FIXTURE_WORKSPACE_ID],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'BUDGET','Request budget',$3)`,
    [PROJECT, FIXTURE_WORKSPACE_ID, FIXTURE_USER_ID],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     VALUES ($1,$2,$3,'experiment',$4,'Request budget experiment','draft',$5)`,
    [EXPERIMENT, FIXTURE_WORKSPACE_ID, PROJECT, IDENTIFIER, FIXTURE_USER_ID],
  )

  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     VALUES ($1,$2,$3,'experiment',$4,'Second budget experiment','draft',$5)`,
    [
      SECOND_EXPERIMENT,
      FIXTURE_WORKSPACE_ID,
      PROJECT,
      SECOND_IDENTIFIER,
      FIXTURE_USER_ID,
    ],
  )

  for (const record of [EXPERIMENT, SECOND_EXPERIMENT]) {
    for (let part = 1; part <= 5; part += 1) {
      await admin.query(
        `INSERT INTO api.experiment_parts(workspace_id,record_id,position,title,day_offset,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          FIXTURE_WORKSPACE_ID,
          record,
          part,
          `Milestone ${part}`,
          part - 1,
          FIXTURE_USER_ID,
        ],
      )
    }
  }
})

test.afterAll(async () => {
  await clean()

  if (previousActiveWorkspace) {
    await admin.query(
      'UPDATE api.user_preferences SET active_workspace_id=$2 WHERE user_id=$1',
      [FIXTURE_USER_ID, previousActiveWorkspace],
    )
  } else {
    await admin.query('DELETE FROM api.user_preferences WHERE user_id=$1', [
      FIXTURE_USER_ID,
    ])
  }

  await admin.end()
})

interface Counted {
  /** Browser requests to /api (data, batches, events) since counting began. */
  all: string[]
  /** How many reads each of those carried: a batch carries several, anything else one. */
  reads: number[]
  failed: string[]
}

function countApiRequests(page: Page): Counted {
  const counted: Counted = { all: [], reads: [], failed: [] }

  page.on('request', (request) => {
    const url = new URL(request.url())

    // The live event stream is one long-lived request, not page data.
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/events') {
      counted.all.push(`${request.method()} ${url.pathname}`)

      const batch: unknown = url.pathname.endsWith('/db-batch')
        ? request.postDataJSON()
        : null

      const sent = z.object({ reads: z.array(z.unknown()) }).safeParse(batch)

      counted.reads.push(sent.success ? sent.data.reads.length : 1)
    }
  })
  page.on('response', (response) => {
    const url = new URL(response.url())

    if (url.pathname.startsWith('/api/') && response.status() >= 400)
      counted.failed.push(`${response.status()} ${url.pathname}`)
  })

  return counted
}

/** The notebook tab is up and the page has gone quiet: nothing new for a while. */
async function settle(page: Page, counted: Counted) {
  await expect(
    page.getByRole('link', { name: 'Notebook', exact: true }).first(),
  ).toBeVisible({ timeout: 60_000 })
  let seen = -1

  for (let tries = 0; tries < 20 && seen !== counted.all.length; tries += 1) {
    seen = counted.all.length
    await page.waitForTimeout(1500)
  }
}

function summary(counted: Counted): string {
  const byRequest = new Map<string, number>()

  for (const entry of counted.all)
    byRequest.set(entry, (byRequest.get(entry) ?? 0) + 1)

  return [...byRequest.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([entry, times]) => `${times} × ${entry}`)
    .join('\n')
}

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, FIXTURE_USER_ID, { batchReads: true })
})

test('opening an experiment from the list costs a few batched requests', async ({
  page,
}) => {
  // Compile the routes and warm the shell, outside what is counted.
  await page.goto('/experiments')
  await expect(
    page.getByRole('link', { name: IDENTIFIER }).first(),
  ).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(2000)

  const counted = countApiRequests(page)
  await page
    .locator(`a[href^="/experiments/${EXPERIMENT}"]`)
    .first()
    .evaluate((link: HTMLElement) => link.click())
  await settle(page, counted)

  expect(counted.failed).toEqual([])
  expect(
    counted.all.length,
    `requests to open one experiment:\n${summary(counted)}`,
  ).toBeLessThanOrEqual(CLIENT_OPEN_BUDGET)
  expect(counted.all.some((entry) => entry.includes('/api/db-batch'))).toBe(
    true,
  )
  expect(
    counted.all.filter((entry) => entry === 'GET /api/db/record_links').length,
    summary(counted),
  ).toBeLessThanOrEqual(SINGLE_READS_BUDGET)
})

test('a fresh load of an experiment stays inside its request budget', async ({
  page,
}) => {
  // Warm the compile once so the timing of the counted load is the app's.
  await page.goto(`/experiments/${EXPERIMENT}`)
  await expect(
    page.getByRole('link', { name: 'Notebook', exact: true }).first(),
  ).toBeVisible({ timeout: 90_000 })

  const counted = countApiRequests(page)
  await page.goto(`/experiments/${EXPERIMENT}`)
  await settle(page, counted)

  expect(counted.failed).toEqual([])
  expect(
    counted.all.length,
    `requests to load one experiment:\n${summary(counted)}`,
  ).toBeLessThanOrEqual(FRESH_LOAD_BUDGET)
})

test('a second experiment starts its reads together before its page has loaded', async ({
  page,
}) => {
  // The first experiment is opened once so the app learns what the page reads.
  await page.goto('/experiments')
  await expect(
    page.getByRole('link', { name: IDENTIFIER }).first(),
  ).toBeVisible({ timeout: 90_000 })
  await page
    .locator(`a[href^="/experiments/${EXPERIMENT}"]`)
    .first()
    .evaluate((link: HTMLElement) => link.click())
  await settle(page, countApiRequests(page))
  await page.goBack()
  await expect(
    page.getByRole('link', { name: SECOND_IDENTIFIER }).first(),
  ).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)

  const counted = countApiRequests(page)
  await page
    .locator(`a[href^="/experiments/${SECOND_EXPERIMENT}"]`)
    .first()
    .evaluate((link: HTMLElement) => link.click())
  await settle(page, counted)

  expect(counted.failed).toEqual([])
  // Everything that depends only on the experiment goes out in the first
  // request, ahead of the page, not in the waves behind its code.
  expect(
    counted.reads[0],
    `reads in the first request:\n${summary(counted)}`,
  ).toBeGreaterThanOrEqual(FIRST_REQUEST_READS)
  expect(
    counted.all.length,
    `requests to open the second experiment:\n${summary(counted)}`,
  ).toBeLessThanOrEqual(WARM_OPEN_BUDGET)
})
