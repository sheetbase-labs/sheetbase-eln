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

  // MDL-02.1 — the model Rules and Usage tabs.
  await go(page, `/models/${key}/rules`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'rules tab shows one h1',
  )
  check(
    (await page.getByRole('button', { name: /add rule/i }).count()) > 0,
    'rules tab offers to add a rule',
  )
  await go(page, `/models/${key}/relations`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'relations tab shows one h1',
  )
  check(
    (await page.getByRole('button', { name: /add relation/i }).count()) > 0,
    'relations tab offers to add a relation',
  )
  await go(page, `/models/${key}/usage`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'usage tab shows one h1',
  )
  check(
    (await page.getByText(/used by/i).count()) > 0,
    'usage tab has a Used by section',
  )

  // MDL-04.2 — the generated new-record form.
  await go(page, `/models/${key}/records/new`)
  check(
    (await page.getByRole('heading', { level: 1 }).count()) === 1,
    'new-record form shows one h1',
  )
  check(
    (await page.getByText(/on save/i).count()) > 0,
    'new-record form previews the ID',
  )
  const passage = page.getByLabel('Passage')
  if (await passage.count()) {
    await passage.fill('34')
    await page.waitForTimeout(500)
    check(
      (await page.getByText(/passage 30 or lower/i).count()) > 0,
      'the model rule shows inline on the form',
    )
    await passage.fill('')
  }

  // MDL-04.3 — the record page.
  if (ids.recordModelRecord) {
    await go(page, `/models/${key}/records/${ids.recordModelRecord}`)
    check(
      (await page.getByRole('heading', { level: 1 }).count()) === 1,
      'record page shows one h1',
    )
    for (const section of ['Details', 'Used by', 'History']) {
      check(
        (await page.getByRole('heading', { name: section }).count()) > 0,
        `record page has a ${section} section`,
      )
    }
  } else {
    console.log('note: no record of the workspace model — skipped detail checks')
  }
} else {
  console.log('note: no workspace record model — skipped record-model checks')
}

await done(browser, errors, 'models')
