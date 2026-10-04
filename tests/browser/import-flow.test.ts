/**
 * DSET-05 browser acceptance: prove the three-step import flow end to end in
 * a real browser against the seeded design Dataset DS-0320 (Bench ELISA,
 * planned plate PR-01) and a fixture plate-reader CSV.
 *
 * Steps exercised:
 * - 05.1 open /import, the three-step Stepper, upload a CSV (checksum first).
 * - 05.2/05.3 the registered parser is named, units/examples show, and a
 *   changed mapping is saved as the parser default and comes back.
 * - 05.4 the review shows server-computed outcomes; commit writes one snapshot
 *   plus one import record and the rows land in the Dataset.
 * - 05.5 the failure page offers its three recovery options.
 *
 * Runs against the auth-free development server the Playwright config reuses
 * (127.0.0.1:3100). Self-cleaning: every artifact it creates is removed.
 */
import { createHash } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

config({ path: ['.env.local', '.env'] })

const WORKSPACE = '00000000-0000-4000-8000-000000000300'
const DATASET = '00000000-0000-4000-8000-00000000038a' // DS-0320

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })

const FIXTURE_NAME = 'plate-reader-import-flow.csv'
const FIXTURE_CSV = `# Instrument: PR-01
# Exported: 2026-09-25T08:40:00Z
sample,well,dilution,capsid titre,note
SMP-2231,A1,400,5.2,first
SMP-2232,A2,400,4.8,
SMP-2233,A3,2000,3.9,
SMP-2234,A4,2000,7.1,over
SMP-2235,A5,400,5.4,
BLANK,A12,,0.05,control
`
const FAILURE_NAME = 'unrecognised-import-flow.csv'
const FAILURE_CSV = `alpha,beta
1,2
3,4
`

let admin: Client

/** Remove every artifact a run leaves on DS-0320 and its parser mapping. */
async function clean() {
  const files = await admin.query<{ storage_key: string }>(
    `SELECT storage_key FROM api.dataset_import_files WHERE dataset_id = $1`,
    [DATASET],
  )
  await admin.query('SET session_replication_role = replica')
  await admin.query(`DELETE FROM api.dataset_imports WHERE dataset_id = $1`, [
    DATASET,
  ])
  await admin.query(
    `DELETE FROM api.dataset_import_files WHERE dataset_id = $1`,
    [DATASET],
  )
  await admin.query(
    `DELETE FROM api.dataset_version_values WHERE dataset_version_id IN
       (SELECT id FROM api.dataset_versions WHERE dataset_id = $1)`,
    [DATASET],
  )
  await admin.query(
    `DELETE FROM api.dataset_version_rows WHERE dataset_version_id IN
       (SELECT id FROM api.dataset_versions WHERE dataset_id = $1)`,
    [DATASET],
  )
  await admin.query(`DELETE FROM api.dataset_versions WHERE dataset_id = $1`, [
    DATASET,
  ])
  await admin.query(
    `DELETE FROM api.dataset_row_values WHERE row_id IN
       (SELECT id FROM api.dataset_rows WHERE dataset_id = $1)`,
    [DATASET],
  )
  // Imported rows carry no planned_key; the four seeded planned rows keep it.
  await admin.query(
    `DELETE FROM api.dataset_rows WHERE dataset_id = $1 AND planned_key IS NULL`,
    [DATASET],
  )
  await admin.query(
    `UPDATE api.dataset_rows SET status = 'planned', revision = 1, updated_at = now()
      WHERE dataset_id = $1`,
    [DATASET],
  )
  await admin.query(`UPDATE api.datasets SET revision = 1 WHERE id = $1`, [
    DATASET,
  ])
  await admin.query(
    `DELETE FROM api.dataset_bulk_commits WHERE dataset_id = $1`,
    [DATASET],
  )
  await admin.query(
    `DELETE FROM api.parser_mappings
      WHERE workspace_id = $1 AND target_key = $2`,
    [WORKSPACE, `dataset:${DATASET}`],
  )
  await admin.query('RESET session_replication_role')
  for (const { storage_key: key } of files.rows) {
    rmSync(resolve(process.cwd(), '.storage/objects', key), { force: true })
  }
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
})

test.afterAll(async () => {
  await clean()
  await admin.end()
})

async function count(query: string): Promise<number> {
  const result = await admin.query<{ n: string }>(query)
  return Number(result.rows[0]?.n ?? 0)
}

/** Choose DS-0320 and upload a fixture, landing on the Map step. */
async function uploadFixture(page: Page, name: string, content: string) {
  await page.getByLabel('Import into dataset').selectOption(DATASET)
  await page
    .getByLabel('Laboratory file')
    .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })
}

test.describe('DSET-05 import flow', () => {
  test('uploads, recognises, maps, reviews and commits into DS-0320', async ({
    page,
  }) => {
    const checksum = createHash('sha256').update(FIXTURE_CSV).digest('hex')

    // --- 05.1 — /import shows the three-step stepper. ---
    await page.goto('/import')
    const stepper = page.getByRole('list', { name: 'Steps' })
    const steps = stepper.getByRole('listitem')
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step')
    await expect(steps.nth(0)).toHaveText(/Upload/)
    await expect(steps.nth(2)).toHaveText(/Review and import/)

    // --- 05.1/05.2 — upload a small plate CSV; it is stored checksum-first
    // and recognised by the registered parser. ---
    await uploadFixture(page, FIXTURE_NAME, FIXTURE_CSV)
    // 05.2 — the registered parser is recognised and named on the map step.
    const mapping = page.getByRole('table', { name: 'Column mapping' })
    await expect(mapping).toBeVisible()
    await expect(
      page.getByText(/saved as the default for Plate reader CSV/),
    ).toBeVisible()
    // 05.3 — units and examples show on the mapping step.
    await expect(mapping.getByText('×10¹⁰ vg/mL')).toBeVisible()
    await expect(mapping.getByText('5.2, 4.8, 3.9')).toBeVisible()

    // The raw file is persisted with its SHA-256 before parsing.
    const file = await admin.query<{
      checksum: string
      byte_size: string
      status: string
    }>(
      `SELECT checksum, byte_size, status FROM api.dataset_import_files
        WHERE dataset_id = $1 AND filename = $2
        ORDER BY created_at DESC LIMIT 1`,
      [DATASET, FIXTURE_NAME],
    )
    expect(file.rows[0]?.checksum).toBe(checksum)
    expect(Number(file.rows[0]?.byte_size)).toBe(Buffer.byteLength(FIXTURE_CSV))
    expect(file.rows[0]?.status).toBe('parsed')

    // --- 05.3 — a changed mapping is saved as the parser default. ---
    // Clear the `note` column (explicit "not imported") and continue; the
    // mapping is persisted with the Dataset as its target.
    await page.getByLabel('Map note').selectOption('')
    await expect(page.getByText('4 of 5 mapped')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(
      page.getByRole('table', { name: 'Rows to import' }),
    ).toBeVisible()

    const saved = await admin.query<{
      mapping: { sources: Array<{ source: string; fieldId: string | null }> }
    }>(
      `SELECT mapping FROM api.parser_mappings
        WHERE workspace_id = $1 AND target_key = $2 AND is_default = true`,
      [WORKSPACE, `dataset:${DATASET}`],
    )
    expect(
      saved.rows[0]?.mapping.sources.find((entry) => entry.source === 'note')
        ?.fieldId,
    ).toBeNull()

    // Revisit the flow: the saved default comes back on the second upload.
    await page.goto('/import')
    await uploadFixture(page, FIXTURE_NAME, FIXTURE_CSV)
    await expect(mapping).toBeVisible()
    await expect(page.getByLabel('Map note')).toHaveValue('')
    // Restore a real mapping for the commit run and save it as the default.
    await page.getByLabel('Map note').selectOption({ label: 'Note' })
    await page.getByRole('button', { name: 'Continue' }).click()

    // --- 05.4 — the review shows server-computed row outcomes. ---
    const rows = page.getByRole('table', { name: 'Rows to import' })
    await expect(rows).toBeVisible()
    await expect(
      page.getByText('Will add', { exact: true }).locator('..'),
    ).toContainText('5 rows')
    await expect(
      page.getByText('Fills planned', { exact: true }).locator('..'),
    ).toContainText('3 rows')
    await expect(
      page.getByText('Flagged', { exact: true }).locator('..'),
    ).toContainText('1 rows')
    await expect(
      page.getByText('Skipped', { exact: true }).locator('..'),
    ).toContainText('1 controls')
    await expect(rows.getByText('Fills planned row').first()).toBeVisible()
    await expect(rows.getByText('New row')).toBeVisible()
    await expect(rows.getByText('Control, not imported')).toBeVisible()
    await expect(
      rows.getByText('Value 7.1 is above the maximum 5.6'),
    ).toBeVisible()

    const versionsBefore = await count(
      `SELECT count(*) AS n FROM api.dataset_versions WHERE dataset_id = '${DATASET}'`,
    )
    const importsBefore = await count(
      `SELECT count(*) AS n FROM api.dataset_imports WHERE dataset_id = '${DATASET}'`,
    )

    await page.getByRole('button', { name: 'Import 5 rows' }).click()
    await expect(page.getByText('Imported 5 rows')).toBeVisible()

    // Exactly one snapshot plus one import receipt; the rows landed.
    expect(
      await count(
        `SELECT count(*) AS n FROM api.dataset_versions WHERE dataset_id = '${DATASET}'`,
      ),
    ).toBe(versionsBefore + 1)
    expect(
      await count(
        `SELECT count(*) AS n FROM api.dataset_imports WHERE dataset_id = '${DATASET}'`,
      ),
    ).toBe(importsBefore + 1)
    expect(
      await count(
        `SELECT count(*) AS n FROM api.dataset_rows
          WHERE dataset_id = '${DATASET}' AND status = 'recorded'`,
      ),
    ).toBe(5)
    // The control was shown as skipped and never written.
    expect(
      await count(
        `SELECT count(*) AS n FROM api.dataset_rows r
           JOIN api.dataset_row_values v ON v.row_id = r.id
          WHERE r.dataset_id = '${DATASET}' AND v.text_value = 'BLANK'`,
      ),
    ).toBe(0)
    // Four planned rows filled in place, one new row, and a persisted flag.
    expect(
      await count(
        `SELECT count(*) AS n FROM api.dataset_rows
          WHERE dataset_id = '${DATASET}' AND planned_key IS NOT NULL
            AND status = 'recorded'`,
      ),
    ).toBe(4)
    expect(
      await count(
        `SELECT count(*) AS n FROM api.dataset_value_flags
          WHERE dataset_id = '${DATASET}' AND kind = 'out_of_range'`,
      ),
    ).toBe(1)

    const importRecord = await admin.query<{
      snapshot_version_id: string
      status: string
    }>(
      `SELECT snapshot_version_id, status FROM api.dataset_imports
        WHERE dataset_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [DATASET],
    )
    expect(importRecord.rows[0]?.status).toBe('committed')
    expect(importRecord.rows[0]?.snapshot_version_id).toBeTruthy()

    // --- 05.5 — an unusable file offers the three recovery options. ---
    await page.goto('/import')
    await uploadFixture(page, FAILURE_NAME, FAILURE_CSV)
    await expect(page.getByText('Not recognised')).toBeVisible()
    await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step')
    await expect(stepper.getByText('!')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Map columns by hand for this file' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Try parser/ })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Ask an admin to update the parser' }),
    ).toBeVisible()
  })

  test('regulated imports retain the file on denial and trace every row after QA approval', async ({
    page,
  }) => {
    await clean()
    const original = (
      await admin.query(
        `SELECT id, status, approved_at, approved_by_user_id
      FROM api.parser_versions WHERE parser_id IN
      (SELECT id FROM api.parsers WHERE workspace_id = $1 AND key = 'sheetbase.plate-reader-csv') AND version = 1`,
        [WORKSPACE],
      )
    ).rows[0]
    await admin.query(
      `UPDATE api.datasets SET intended_use = 'regulated_record' WHERE id = $1`,
      [DATASET],
    )
    await admin.query(
      `UPDATE api.parser_versions SET status = 'draft', approved_at = NULL, approved_by_user_id = NULL WHERE id = $1`,
      [original.id],
    )
    try {
      await page.goto('/import')
      await uploadFixture(page, FIXTURE_NAME, FIXTURE_CSV)
      await expect(
        page.getByRole('table', { name: 'Column mapping' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByRole('table', { name: 'Rows to import' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Import 5 rows' }).click()
      await expect(
        page.getByText(/Regulated datasets require an approved parser version/),
      ).toBeVisible()
      expect(
        (
          await admin.query(
            'SELECT count(*)::int n FROM api.dataset_imports WHERE dataset_id = $1',
            [DATASET],
          )
        ).rows[0].n,
      ).toBe(0)
      expect(
        (
          await admin.query(
            `SELECT count(*)::int n FROM api.dataset_rows WHERE dataset_id = $1 AND status = 'recorded'`,
            [DATASET],
          )
        ).rows[0].n,
      ).toBe(0)
      const raw = (
        await admin.query(
          'SELECT storage_key, checksum FROM api.dataset_import_files WHERE dataset_id = $1 ORDER BY created_at DESC LIMIT 1',
          [DATASET],
        )
      ).rows[0]
      expect(raw.checksum).toBe(
        createHash('sha256').update(FIXTURE_CSV).digest('hex'),
      )
      expect(
        readFileSync(resolve('.storage/objects', raw.storage_key), 'utf8'),
      ).toBe(FIXTURE_CSV)
      await page.screenshot({
        path: '.amp/in/artifacts/dset-06-regulated-denial.png',
        fullPage: true,
      })
      const approved = await page.request.post(
        '/api/db/rpc/approve_parser_version',
        { data: { p_parser_version_id: original.id } },
      )
      expect(approved.ok()).toBe(true)
      await page.getByRole('button', { name: 'Import 5 rows' }).click()
      await expect(page.getByText('Imported 5 rows')).toBeVisible()
      const receipt = (
        await admin.query(
          'SELECT imported_row_ids, parser_provenance FROM api.dataset_imports WHERE dataset_id = $1',
          [DATASET],
        )
      ).rows[0]
      expect(receipt.imported_row_ids).toHaveLength(5)
      expect(receipt.parser_provenance).toMatchObject({
        parserVersionId: original.id,
        status: 'approved',
        version: 1,
      })
    } finally {
      await clean()
      await admin.query(
        `UPDATE api.datasets SET intended_use = 'exploratory_research' WHERE id = $1`,
        [DATASET],
      )
      await admin.query(
        'UPDATE api.parser_versions SET status = $2, approved_at = $3, approved_by_user_id = $4 WHERE id = $1',
        [
          original.id,
          original.status,
          original.approved_at,
          original.approved_by_user_id,
        ],
      )
    }
  })
})
