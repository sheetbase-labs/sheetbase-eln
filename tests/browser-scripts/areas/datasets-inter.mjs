// Datasets area interaction suite (ported from the app-3 dataset interactions).
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/datasets')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'datasets list shows one h1',
)
const search = page.getByPlaceholder(/search datasets/i)
if (await search.count()) {
  await search.fill('zzz-no-such-dataset-zzz')
  await page.waitForTimeout(900)
  check(
    (await page.getByText(/No datasets match/i).count()) > 0,
    'dataset search with no matches shows the empty state',
  )
  await search.fill('')
  await page.waitForTimeout(800)
}

if (ids.dataset) {
  await go(page, `/datasets/${ids.dataset}/snapshots`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'dataset snapshots tab shows one h1',
  )
  await go(page, `/datasets/${ids.dataset}/rows`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'dataset rows tab shows one h1',
  )

  if (ids.versions.length >= 2) {
    await go(page, `/datasets/${ids.dataset}/compare`)
    const from = page.locator('#from')
    if (await from.count()) {
      await from.selectOption({ index: 1 })
      await page.waitForTimeout(600)
      check(
        page.url().includes('from='),
        'compare snapshot choice is kept in the URL',
      )
    }
  }
}

await done(browser, errors, 'datasets')
