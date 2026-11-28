import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { open, signIn, withAdminDb } from './journeys/helpers'

/**
 * Open every page the app has, as a person would, and fail when any of them
 * throws, logs a console error, fails a data request, lands on the error
 * screen or never finishes loading. The sibling `navigation-smoothness` test
 * clicks links; this one reaches the pages nothing links to from a list.
 */
test.setTimeout(90_000)

const STATIC_ROUTES = [
  '/search',
  '/saved-searches',
  '/scan',
  '/stocktake',
  '/models',
  '/promotions',
  '/import',
  '/help',
  '/help/records',
  '/help/shortcuts',
  '/pipelines/agents',
  '/pipelines/parameter-sets',
  '/experiments/new',
  '/analysis/new',
  '/sheets/new',
  '/readings/new',
  '/settings',
  '/settings/account/ai-preferences',
  '/settings/account/api',
  '/settings/account/away',
  '/settings/account/notifications',
  '/settings/account/profile',
  '/settings/account/signature',
  '/settings/account/watchers',
  '/settings/lab/instruments',
  '/settings/lab/labels',
  '/settings/lab/release',
  '/settings/lab/reports',
  '/settings/lab/retention',
  '/settings/lab/sidebar',
  '/settings/lab/storage',
  '/settings/lab/workflows',
  '/settings/workspace/access',
  '/settings/workspace/ai',
  '/settings/workspace/audit',
  '/settings/workspace/backups',
  '/settings/workspace/clients',
  '/settings/workspace/diagnostics',
  '/settings/workspace/integrations',
  '/settings/workspace/open-data',
  '/settings/workspace/plugins',
  '/settings/workspace/roles',
  '/settings/workspace/signatures',
  '/settings/workspace/usage',
  '/settings/workspace/validation',
]

/** Pages that take an id: the first seeded row of each kind. */
const DETAIL_ROUTES: { sql: string; paths: string[] }[] = [
  {
    sql: `select id from api.records where kind = 'experiment' and deleted_at is null order by created_at limit 1`,
    paths: [
      '/experiments/{id}',
      '/experiments/{id}/data',
      '/experiments/{id}/data/datasets',
      '/experiments/{id}/data/files',
      '/experiments/{id}/data/links',
      '/experiments/{id}/data/plates',
      '/experiments/{id}/data/results',
      '/experiments/{id}/data/worklists',
      '/experiments/{id}/history',
      '/experiments/{id}/notebook',
      '/experiments/{id}/review',
      '/experiments/{id}/review/history',
      '/experiments/{id}/review/revisions',
      '/experiments/{id}/review/signatures',
      '/experiments/{id}/review/submissions',
      '/experiments/{id}/samples',
      '/experiments/{id}/series',
      '/experiments/{id}/summary',
      '/records/{id}/notebook',
    ],
  },
  {
    sql: `select id from api.records where kind = 'sample' and deleted_at is null order by created_at limit 1`,
    paths: [
      '/samples/{id}',
      '/samples/{id}/history',
      '/samples/{id}/lineage',
      '/samples/{id}/measurements',
      '/samples/{id}/sequences',
      '/samples/{id}/usage',
    ],
  },
  {
    sql: `select id from api.records where kind = 'material' limit 1`,
    paths: ['/materials/{id}'],
  },
  {
    sql: `select id from api.records where kind = 'protocol_template' limit 1`,
    paths: ['/protocols/{id}'],
  },
  {
    sql: `select id from api.records where kind = 'report' limit 1`,
    paths: ['/reports/{id}'],
  },
  {
    sql: `select id from api.datasets order by created_at limit 1`,
    paths: [
      '/datasets/{id}',
      '/datasets/{id}/rows',
      '/datasets/{id}/snapshots',
      '/datasets/{id}/compare',
    ],
  },
  {
    sql: `select id from api.instruments limit 1`,
    paths: ['/instruments/{id}'],
  },
  {
    sql: `select id from api.projects order by created_at limit 1`,
    paths: [
      '/projects/{id}',
      '/projects/{id}/datasets',
      '/projects/{id}/experiments',
      '/projects/{id}/files',
      '/projects/{id}/milestones',
      '/projects/{id}/samples',
      '/projects/{id}/settings',
    ],
  },
  {
    sql: `select id from api.record_models order by key limit 1`,
    paths: [
      '/models/{id}',
      '/models/{id}/contract',
      '/models/{id}/datasets',
      '/models/{id}/edit',
      '/models/{id}/fields',
      '/models/{id}/records',
      '/models/{id}/relations',
      '/models/{id}/results',
      '/models/{id}/rules',
      '/models/{id}/usage',
      '/models/{id}/versions',
    ],
  },
  {
    sql: `select id from api.pipeline_definitions limit 1`,
    paths: [
      '/pipelines/{id}',
      '/pipelines/{id}/activity',
      '/pipelines/{id}/starts',
      '/pipelines/{id}/steps',
      '/pipelines/{id}/triggers',
    ],
  },
  {
    sql: `select id from api.notebook_templates limit 1`,
    paths: [
      '/templates/{id}',
      '/templates/{id}/in-use',
      '/templates/{id}/versions',
    ],
  },
]

/** Requests and messages that are the test environment, not the app. */
const IGNORED = [
  /favicon/,
  /\.map(\?|$)/,
  /\/api\/auth\/passkey\//,
  /\/api\/auth\/get-session/,
  /service-worker|sw\.js/,
]

/**
 * The dev server tells every open page about any request that failed on it,
 * so a request another worker's page dropped mid-flight (its connection
 * aborted or reset as that page moved on) arrives here as a console error.
 */
const DEV_SERVER_NOISE =
  /^\[vite\] Internal Server Error\s+(aborted|read ECONNRESET)\b/

function watch(page: Page) {
  const problems: string[] = []

  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !DEV_SERVER_NOISE.test(message.text()))
      problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  page.on('response', (response) => {
    const url = response.url()

    if (response.status() >= 400 && !IGNORED.some((rx) => rx.test(url)))
      problems.push(
        `${response.status()} ${response.request().method()} ${new URL(url).pathname}`,
      )
  })

  return problems
}

async function expectHealthy(page: Page, path: string) {
  const problems = watch(page)

  await open(page, path)
  // Give data a fair time to arrive, then insist nothing is still loading.
  await expect(page.getByText(/^Loading…?$/).first()).toBeHidden({
    timeout: 15_000,
  })
  await expect(
    page.getByText(/something went wrong|unexpected error/i).first(),
    'the error screen',
  ).toBeHidden()
  expect(problems, `errors while opening ${path}`).toEqual([])
}

for (const path of STATIC_ROUTES) {
  test(`opens ${path}`, async ({ page }) => {
    await signIn(page)
    await expectHealthy(page, path)
  })
}

for (const group of DETAIL_ROUTES) {
  for (const path of group.paths) {
    test(`opens ${path}`, async ({ page }) => {
      const id = await withAdminDb(async (client) => {
        const result = await client.query<{ id: string }>(group.sql)

        return result.rows[0]?.id
      })

      test.skip(!id, 'no seeded row of this kind')
      await signIn(page)
      await expectHealthy(page, path.replace('{id}', id ?? ''))
    })
  }
}
