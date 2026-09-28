// Projects area interaction suite (ported from sheetbase-app-3 tests/areas/projects-inter.mjs).
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/projects')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'projects list shows one h1',
)

const search = page.getByPlaceholder(/search projects/i)
if (await search.count()) {
  await search.fill('zzz-no-such-project-zzz')
  await search.press('Enter')
  await page.waitForTimeout(900)
  check(
    (await page.getByText(/No projects match/i).count()) > 0,
    'projects search with no matches shows the empty state',
  )
  await search.fill('')
  await search.press('Enter')
  await page.waitForTimeout(900)
}

if (ids.project) {
  await go(page, `/projects/${ids.project}`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'project detail shows one h1',
  )
  for (const [tab, path] of [
    ['folders', `/projects/${ids.project}/folders`],
    ['members', `/projects/${ids.project}/members`],
    ['settings', `/projects/${ids.project}/settings`],
  ]) {
    await go(page, path)
    check(
      (await page.getByRole('heading', { level: 1 }).count()) === 1,
      `project ${tab} tab shows one h1`,
    )
  }
}

await done(browser, errors, 'projects')
