/**
 * DATA-007 browser acceptance, on the dataset surfaces the app ships today.
 *
 * This spec was written against a Dataset Explorer canvas at /datasets — a
 * `Dataset Explorer` heading, a `Select dataset` picker, Data/Schema/
 * Relationships/Lineage tabs and a named saved view. That canvas is gone:
 * /datasets is the registry (the design-reference screen `DatasetsList`, see
 * tests/visual/design-states.ts) and a dataset's record page carries Overview,
 * Data, Snapshots, Compare, Imports, Used by and History. The record page's
 * Data tab is the design's `DatasetExplorer` screen — design-states.ts renders
 * that screen from /datasets/DS-0298/rows — so the exploration intent (the
 * schema's columns, the dataset's rows, the snapshot they were frozen in, and a
 * view that survives a reload) is asserted here on the shipped surface.
 *
 * Retired with the canvas, because no route or component renders them:
 * - the `Dataset Explorer` heading, the `Select dataset` picker and the
 *   Data/Schema/Relationships/Lineage tab group. The Dataset Explorer now
 *   exists only as a data layer (src/lib/dataset-explorer-data.ts): its
 *   relationships and lineage reads have no screen, and
 *   `fetchDatasetRelationshipsFor` is called from src/lib/related-work.ts only.
 * - a Schema tab: src/components/v3/datasets/dataset-detail-tabs.ts records the
 *   ruling — column identity is already the grid headers and the Model Fields
 *   tab, so a Columns tab would be a second, thinner view of the same facts.
 * - named saved views (`Saved view name` / `Save current view`):
 *   `createDatasetSavedViewStore` survives in the data layer, localStorage
 *   backed and without a component caller. The shipped view is the URL state
 *   (?q, flagged, snapshot, row, field), and the second test asserts it
 *   survives a reload.
 *
 * The fixture is the design seed's DS-0298 — the dataset the DatasetExplorer
 * reference screen renders — and its expectations are read from the same RPCs
 * the UI reads, so nothing is hard-coded against seed content. The spec writes
 * nothing: no workspace, user or snapshot fixture, and therefore no cleanup
 * that would have to work around the append-only audit chain or the frozen
 * dataset-version guards.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

const DATASET = '00000000-0000-4000-8000-000000000380' // DS-0298
const DISPLAY_ID = 'DS-0298'
const NAME = 'Ambr 250 daily readings, AMB-25-118'
const USER = '00000000-0000-4000-8000-000000000310'
const WORKSPACE = '00000000-0000-4000-8000-000000000300'
const ROWS_PAGE_SIZE = 100

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })

interface DatasetSummaryWire {
  id: string
  display_id: string | null
  name: string
  model: string | null
  row_count: string | number
  issue_count: string | number
  out_of_range_count: string | number
  missing_unit_count: string | number
  review_state: 'locked' | 'in_review' | null
}

interface DatasetVersionWire {
  id: string
  label: string
  rowCount: number
}

interface RowWire {
  rowId: string
  values: Record<string, unknown>
}

interface RowsWire {
  schemaVersionId: string
  totalCount: number
  rows: RowWire[]
}

interface FieldWire {
  field_id: string
  label: string
}

let admin: Client
let summary: DatasetSummaryWire
let snapshot: DatasetVersionWire
let fields: FieldWire[] = []
let rows: RowWire[] = []
let totalCount = 0

/** The design's Validation column: issue wording by kind, then review state.
 * Mirrors `datasetValidation` in src/components/v3/datasets/datasets-data.ts. */
function validationLabel(row: DatasetSummaryWire): string {
  const issues = Number(row.issue_count)
  const suffix =
    row.review_state === 'locked'
      ? ' · locked'
      : row.review_state === 'in_review'
        ? ' · in review'
        : ''
  if (issues === 0) return `Valid${suffix}`
  const missingUnits = Number(row.missing_unit_count)
  if (missingUnits > 0)
    return missingUnits === 1
      ? '1 column missing a unit'
      : `${missingUnits} columns missing units`
  const outOfRange = Number(row.out_of_range_count)
  if (outOfRange > 0) return `${outOfRange} out of range`
  return `${issues} ${issues === 1 ? 'issue' : 'issues'}`
}

/** What the grid renders for a value: text, or an em dash for a null. */
function cellText(value: unknown): string {
  return value == null ? '—' : String(value)
}

/**
 * Read the dataset through the same RPCs the browser reads, as the same user,
 * so every expectation below is derived from the database that is under test.
 */
test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await admin.query('SET ROLE authenticated')
  await admin.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: USER,
      workspace_id: WORKSPACE,
    }),
  ])

  const summaries = await admin.query<DatasetSummaryWire>(
    `select * from api.dataset_list_summary()`,
  )
  const row = summaries.rows.find((candidate) => candidate.id === DATASET)
  if (!row) {
    throw new Error(
      `Design seed is missing ${DISPLAY_ID} in workspace ${WORKSPACE}. Run pnpm db:fresh --design.`,
    )
  }
  summary = row

  // The Data tab reads the newest snapshot: dataset_version_list's first row.
  const versions = await admin.query<{ result: DatasetVersionWire[] }>(
    `select api.dataset_version_list($1) result`,
    [DATASET],
  )
  const newest = versions.rows[0]?.result?.at(0)
  if (!newest) {
    throw new Error(
      `Design seed is missing a snapshot for ${DISPLAY_ID}. Run pnpm db:fresh --design.`,
    )
  }
  snapshot = newest

  const payload = await admin.query<{ result: RowsWire }>(
    `select api.query_dataset_version_rows($1,$2,0) result`,
    [snapshot.id, ROWS_PAGE_SIZE],
  )
  totalCount = payload.rows[0].result.totalCount
  rows = payload.rows[0].result.rows

  const schemaFields = await admin.query<FieldWire>(
    `select field_id, label from api.dataset_schema_version_fields
      where schema_version_id = $1 order by display_order`,
    [payload.rows[0].result.schemaVersionId],
  )
  fields = schemaFields.rows

  await admin.query('RESET ROLE')
})

test.afterAll(async () => {
  await admin.end()
})

test.describe('DATA-007 dataset surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDesignUser(page, USER)
  })

  test('the registry lists the dataset, its search narrows the list, and a row opens the record page', async ({
    page,
  }) => {
    await page.goto('/datasets')
    await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible({
      timeout: 15_000,
    })

    // The registry's own list tabs and its column contract.
    const lists = page.getByRole('navigation', { name: 'Dataset lists' })
    await expect(lists.getByRole('link', { name: /^All/ })).toBeVisible()
    await expect(lists.getByRole('link', { name: /^Mine/ })).toBeVisible()
    await expect(lists.getByRole('link', { name: /^Has issues/ })).toBeVisible()
    await expect(lists.getByRole('link', { name: /^Locked/ })).toBeVisible()

    const table = page.getByRole('table', { name: 'Datasets' })
    await expect(table.getByRole('columnheader')).toHaveText([
      'ID',
      'Name',
      'Model',
      'Experiment',
      'Rows',
      'Validation',
    ])

    // The dataset is a real row: identity, model, size, validation state.
    const row = table.getByRole('row').filter({ hasText: DISPLAY_ID })
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('cell', { name: DISPLAY_ID })).toBeVisible()
    await expect(
      row.getByRole('link', { name: NAME, exact: true }),
    ).toBeVisible()
    await expect(
      row.getByRole('cell', { name: summary.model ?? '', exact: true }),
    ).toBeVisible()
    await expect(
      row.getByRole('cell', { name: String(summary.row_count), exact: true }),
    ).toBeVisible()
    await expect(
      row.getByRole('cell', { name: validationLabel(summary), exact: true }),
    ).toBeVisible()

    // Choosing the row fills the inspector without leaving the list.
    await row.getByRole('cell', { name: DISPLAY_ID }).click()
    const inspector = page.getByLabel('Dataset summary')
    await expect(inspector).toContainText(DISPLAY_ID)
    await expect(inspector).toContainText(NAME)
    await expect(inspector).toContainText(String(summary.row_count))
    // The inspector's primary action is always "Open dataset"; an issue adds
    // its own fix actions beside it (set the unit, re-import) rather than
    // renaming it.
    await expect(
      inspector.getByRole('button', { name: 'Open dataset' }),
    ).toBeVisible()

    // Search reads ID, name and model: one match narrows the list to it.
    const allRows = await table.getByRole('row').count()
    expect(allRows).toBeGreaterThan(2)
    const search = page.getByLabel('Search datasets')
    await search.fill('Ambr 250 daily')
    await expect(table.getByRole('row')).toHaveCount(2)
    await expect(row).toBeVisible()

    // A miss is an honest empty state, not a silent empty table.
    await search.fill('no-dataset-matches-this')
    await expect(page.getByRole('status')).toContainText(
      'No datasets match “no-dataset-matches-this”',
    )
    await search.fill('')
    await expect(table.getByRole('row')).toHaveCount(allRows)

    // The row action opens the dataset's record page, whose sections are the
    // registry's promise about what a dataset contains.
    await row.getByRole('link', { name: NAME, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/datasets/${DATASET}/rows$`))
    await expect(
      page.getByRole('heading', { name: NAME, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })
    const sections = page.getByRole('navigation', { name: 'Dataset sections' })
    for (const label of [
      'Overview',
      'Data',
      'Snapshots',
      'Compare',
      'Imports',
      'Used by',
      'History',
    ]) {
      await expect(
        sections.getByRole('link', { name: new RegExp(`^${label}`) }),
      ).toBeVisible()
    }
  })

  test('the Data tab explores the snapshot: schema columns, its rows, row search, and a view that reloads', async ({
    page,
  }) => {
    await page.goto(`/datasets/${DISPLAY_ID}/rows`)
    await expect(
      page.getByRole('heading', { name: NAME, level: 1 }),
    ).toBeVisible({ timeout: 15_000 })

    // The grid reads one frozen snapshot and names it.
    await expect(
      page.getByText(`Snapshot ${snapshot.label} · read-only`),
    ).toBeVisible()

    // The schema's columns are the grid's headers, in display order.
    const grid = page
      .getByRole('table')
      .filter({ has: page.getByRole('columnheader', { name: 'Row' }) })
    await expect(grid.getByRole('columnheader')).toHaveText([
      'Row',
      ...fields.map((field) => field.label),
    ])

    // The first row carries the values the snapshot froze.
    const first = rows[0]
    const firstRowCells = grid.getByRole('row').nth(1).getByRole('cell')
    for (const [index, field] of fields.entries()) {
      await expect(firstRowCells.nth(index + 1)).toHaveText(
        cellText(first.values[field.field_id]),
      )
    }
    await expect(
      page.getByText(`Showing ${rows.length} of ${totalCount} rows`),
    ).toBeVisible()

    // Selecting a row inspects it without leaving the grid.
    const details = page.getByLabel('Row details')
    await expect(details).toContainText('Row 1')
    await expect(details).toContainText(
      cellText(first.values[fields[0].field_id]),
    )

    // Row search reads the loaded window; the count follows it exactly.
    const query = cellText(first.values[fields[0].field_id])
    const matching = rows.filter((candidate) =>
      Object.values(candidate.values).some((value) =>
        String(value).toLowerCase().includes(query.toLowerCase()),
      ),
    ).length
    expect(matching).toBeGreaterThan(0)
    await page.getByLabel('Search rows').fill(query)
    await expect(
      page.getByText(`Showing ${matching} of ${totalCount} rows`),
    ).toBeVisible()

    // The view is the URL: a reload keeps the search and the selection.
    await expect(page).toHaveURL((url) => url.searchParams.get('q') === query)
    await page.reload()
    await expect(page.getByLabel('Search rows')).toHaveValue(query)
    await expect(
      page.getByText(`Showing ${matching} of ${totalCount} rows`),
    ).toBeVisible()

    await page.getByLabel('Search rows').fill('')
    await expect(
      page.getByText(`Showing ${rows.length} of ${totalCount} rows`),
    ).toBeVisible()
    const secondRow = grid.getByRole('row').nth(2)
    await secondRow.click()
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('row') === rows[1].rowId,
    )
    await expect(page.getByLabel('Row details')).toContainText('Row 2')
  })
})
