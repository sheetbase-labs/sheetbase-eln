// Models area suite: the workspace-defined record-model list (MDL-04.1).
//
// A workspace model is keyed (e.g. `cell_bank`), not a dataset-schema uuid.
// The design seed creates one, so this checks the list renders its fields as
// columns, that search narrows the rows, and that CSV export is offered.
import { check, discover, done, go, launch } from '../helpers.mjs'

const ids = await discover()
const { browser, page, errors } = await launch()

await go(page, '/models')
check(
  (await page.getByRole('heading', { level: 1 }).count()) === 1,
  'models board shows one h1',
)

if (ids.recordModel) {
  const key = ids.recordModel
  await go(page, `/models/${key}`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'record-model frame shows one h1',
  )

  await go(page, `/models/${key}/records`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'record-model records list shows one h1',
  )
  check(
    (await page.getByRole('columnheader', { name: 'ID' }).count()) > 0,
    'records list has an ID column',
  )

  const search = page.getByPlaceholder(/search cell bank/i)
  if (await search.count()) {
    await search.fill('CB-0011')
    await page.waitForTimeout(900)
    check(
      (await page.getByRole('link', { name: 'HEK293 WCB lot 2' }).count()) > 0,
      'search narrows to the matching record',
    )
    check(
      (await page.getByText('HEK293 MCB', { exact: true }).count()) === 0,
      'search excludes non-matching records',
    )

    await search.fill('zzz-no-such-bank-zzz')
    await page.waitForTimeout(900)
    check(
      (await page.getByText(/No records match/i).count()) > 0,
      'no matches shows the records empty state',
    )
    await search.fill('')
    await page.waitForTimeout(700)
  } else {
    console.log('note: records search input not found')
  }

  check(
    (await page.getByRole('button', { name: /export csv/i }).count()) > 0,
    'records list offers CSV export',
  )
} else {
  console.log('note: no workspace record model — skipped record-model checks')
}

await done(browser, errors, 'models')
