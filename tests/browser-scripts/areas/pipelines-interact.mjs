// Pipelines interaction suite (ported from sheetbase-app-3 tests/areas/pipelines-interact.mjs).
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/pipelines')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'pipelines list shows one h1',
)
const search = page.getByPlaceholder(/search pipelines/i)
if (await search.count()) {
  await search.fill('zzz-no-such-pipeline-zzz')
  await page.waitForTimeout(900)
  check(
    (await page.getByText(/No pipelines match/i).count()) > 0,
    'pipeline search with no matches shows the empty state',
  )
  await search.fill('')
  await page.waitForTimeout(800)
}

if (ids.pipeline) {
  for (const [tab, path] of [
    ['overview', `/pipelines/${ids.pipeline}`],
    ['runs', `/pipelines/${ids.pipeline}/runs`],
    ['triggers', `/pipelines/${ids.pipeline}/triggers`],
  ]) {
    await go(page, path)
    check(
      (await page.getByRole('heading', { level: 1 }).count()) === 1,
      `pipeline ${tab} shows one h1`,
    )
  }
}

await done(browser, errors, 'pipelines')
