// Templates area suite: the notebook-template catalogue, detail tabs and the
// update preview, ported from sheetbase-app-3's template interactions.
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/templates')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'templates list shows one h1',
)
const search = page.getByPlaceholder(/search templates/i)
if (await search.count()) {
  await search.fill('zzz-no-such-template-zzz')
  await page.waitForTimeout(900)
  check(
    (await page.getByText(/No templates match/i).count()) > 0,
    'template search with no matches shows the empty state',
  )
  await search.fill('')
  await page.waitForTimeout(800)
}

if (ids.template) {
  await go(page, `/templates/${ids.template}`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'template detail shows one h1',
  )
  for (const tab of ['Versions', 'In use']) {
    await page.getByRole('link', { name: new RegExp(`^${tab}`) }).click()
    await page.waitForTimeout(700)
    check(
      (await page.getByRole('heading', { level: 1 }).count()) === 1,
      `template ${tab} tab shows one h1`,
    )
  }
  await go(page, `/templates/${ids.template}/update`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'template update preview shows one h1',
  )
} else {
  console.log(
    'note no notebook templates in this workspace — skipped detail checks',
  )
}

await done(browser, errors, 'templates')
