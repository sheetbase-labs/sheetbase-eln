// Analysis view interaction suite: the saved view rebuilds from its stored
// ChartSpec and the current source dataset.
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/analysis')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'analysis studio shows one h1',
)

if (ids.analysis) {
  await go(page, `/analysis/${ids.analysis}`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'saved analysis view shows one h1',
  )
  check(
    (await page.getByRole('link', { name: /Edit in studio/i }).count()) > 0,
    'saved analysis view links back to the studio',
  )
} else {
  console.log(
    'note no saved analysis views in this workspace — skipped view checks',
  )
}

await done(browser, errors, 'analysis')
