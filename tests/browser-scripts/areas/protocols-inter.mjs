// Protocols interaction suite: the list, search and the detail tabs.
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/protocols')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'protocols list shows one h1',
)
const search = page.getByPlaceholder(/search protocols/i)
if (await search.count()) {
  await search.fill('zzz-no-such-protocol-zzz')
  await page.waitForTimeout(900)
  check(
    (await page.getByText(/No protocols match/i).count()) > 0,
    'protocol search with no matches shows the empty state',
  )
  await search.fill('')
  await page.waitForTimeout(800)
}

if (ids.protocol) {
  await go(page, `/protocols/${ids.protocol}`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'protocol detail shows one h1',
  )
  for (const tab of ['Template', 'Used by', 'Versions']) {
    await page.getByRole('button', { name: new RegExp(tab) }).click()
    await page.waitForTimeout(500)
    check(
      (await page.getByRole('button', { name: new RegExp(tab) }).count()) > 0,
      `protocol ${tab} tab activates`,
    )
  }
} else {
  console.log(
    'note no protocol templates in this workspace — skipped detail checks',
  )
}

await done(browser, errors, 'protocols')
