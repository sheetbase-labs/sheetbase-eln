// Inventory interaction suite: samples detail tabs and the materials registry
// tabs (ported from sheetbase-app-3 tests/areas/inventory-interact.mjs).
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/samples')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'samples list shows one h1',
)
const search = page.getByPlaceholder(/search samples/i)
if (await search.count()) {
  await search.fill('zzz-no-such-sample-zzz')
  await page.waitForTimeout(900)
  check(
    (await page.getByText(/No samples match/i).count()) > 0,
    'sample search with no matches shows the empty state',
  )
  await search.fill('')
  await page.waitForTimeout(800)
}

if (ids.sample) {
  for (const [tab, path] of [
    ['detail', `/samples/${ids.sample}`],
    ['usage', `/samples/${ids.sample}/usage`],
    ['history', `/samples/${ids.sample}/history`],
    ['lineage', `/samples/${ids.sample}/lineage`],
    ['measurements', `/samples/${ids.sample}/measurements`],
  ]) {
    await go(page, path)
    check(
      (await page.getByRole('heading', { level: 1 }).count()) === 1,
      `sample ${tab} shows one h1`,
    )
  }
  await go(page, `/samples/${ids.sample}/lineage`)
  check(
    (await page.getByRole('heading', { name: 'Lineage' }).count()) > 0,
    'sample lineage tab renders the lineage section',
  )
}

await go(page, '/materials')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'materials list shows one h1',
)
const expiring = page.getByRole('link', { name: /Expiring/i })
if (await expiring.count()) {
  await expiring.first().click()
  await page.waitForTimeout(900)
  check(page.url().includes('tab='), 'materials tab choice is kept in the URL')
}

await done(browser, errors, 'inventory')
