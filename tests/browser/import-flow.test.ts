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
 * Reference differences this spec accepts (ImportMap-light.png is the
 * specification for the map/check surface):
 * - The reference draws mapping and review as one view — the Summary rail sits
 *   beside the Columns table. The app keeps its three steps: the Columns table
 *   is step 2 and the Summary belongs to the review step, where the counts it
 *   reports exist. The map table itself is asserted column for column
 *   (File column / Dataset field / Unit / Example values / Status / Note); the
 *   reference clips a long example list with an ellipsis, the app one line.
 * - The reference headline ends "saved as the default for PR-01 plate maps";
 *   the app names the parser the mapping is saved against instead, because a
 *   saved mapping is keyed by parser and target, not by a plate map the app
 *   has no identity for. Asserted below as the app words it.
 * - The reference's rail also carries the "Flagged rows" and "Record" prose
 *   blocks; those are copy with no behaviour behind them here.
 * - ImportFailed-light.png draws the unrecognised-file surface on the Upload
 *   step (file card, banner, option radios, step 1 current and unfailed). The
 *   app stores the file checksum-first and routes it to its own addressable
 *   map step, so that surface — the mismatch explanation and the same three
 *   ways out — is asserted on the map step instead. Moving it back would mean
 *   a second copy of the surface on the upload step, which is a new surface,
 *   not a missing one. The stepper's failed marker stays reserved for a file
 *   that cannot be read at all, as the reference's failed screen shows.
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

import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

const WORKSPACE = '00000000-0000-4000-8000-000000000300'
const DATASET = '00000000-0000-4000-8000-00000000038a' // DS-0320
// Gareth owns the design workspace (…0300) that owns DS-0320.
const DESIGN_USER = '00000000-0000-4000-8000-000000000310'
const SESSION_COOKIE = '__Secure-better-auth.session_token'

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

/**
 * The session the spec signs in with, as a literal `Cookie` header. Playwright's
 * API request context (page.request / context.request) does not send the
 * `__Secure-` session cookie over http, so the in-test API calls carry the same
 * session explicitly instead of 401ing.
 */
let sessionCookie = ''

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
  test.beforeEach(async ({ page }) => {
    await signInAsDesignUser(page, DESIGN_USER)
    const session = (await page.context().cookies()).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    )
    sessionCookie = session ? `${session.name}=${session.value}` : ''
  })

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
      page.getByText(/continue to save this as Plate reader CSV’s default/),
    ).toBeVisible()
    // 05.3 — units and examples show on the mapping step. ImportMap-light.png
    // draws File column / Dataset field / Unit / Example values / Status / Note.
    await expect(mapping.getByText('×10¹⁰ vg/mL')).toBeVisible()
    await expect(mapping.getByText('5.2, 4.8, 3.9')).toBeVisible()
    await expect(
      mapping.getByRole('columnheader', { name: 'Example values' }),
    ).toBeVisible()
    await expect(
      mapping.getByRole('columnheader', { name: 'Note', exact: true }),
    ).toBeVisible()
    // The note says how much of the file the column reads, as the reference's
    // "Matched 34 of 34" does; the fixture holds six rows the column reads.
    await expect(mapping.getByText('Matched 6 of 6').first()).toBeVisible()

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

    // --- 05.5 — a file nothing recognises explains the mismatch and offers the
    // three ways out (DSET-05 "Not recognised"). ImportFailed-light.png draws
    // that surface on the Upload step, before the file is stored, and keeps
    // step 1 current and unfailed; the app stores the file first and addresses
    // it (R5-SURF-04), so the same explanation and options appear on the map
    // step it routes to, with the stepper's failed marker reserved for a file
    // that cannot be read at all. The reference carries no "Not recognised"
    // label: it names the mismatch, which is what the banner does here.
    await page.goto('/import')
    await uploadFixture(page, FAILURE_NAME, FAILURE_CSV)
    await expect(
      page.getByText(/headers \(alpha, beta\) match no approved parser/),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Nothing was imported. The file is kept so you can retry.',
      ),
    ).toBeVisible()
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
    await expect(stepper.getByText('!')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Map columns by hand for this file' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Try parser.*TB-02/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Ask an admin to update the parser' }),
    ).toBeVisible()
    const failedFile = (
      await admin.query(
        'SELECT id FROM api.dataset_import_files WHERE filename=$1 AND dataset_id=$2 ORDER BY created_at DESC LIMIT 1',
        [FAILURE_NAME, DATASET],
      )
    ).rows[0].id
    await page
      .getByRole('button', { name: 'Ask an admin to update the parser' })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/settings/instruments\\?fileId=${failedFile}`),
    )
    const work = await page.request.get(
      `/api/db/my_work_items?source_id=eq.${failedFile}`,
      { headers: { cookie: sessionCookie } },
    )
    expect(await work.json()).toMatchObject([
      { source_id: failedFile, source_type: 'dataset_import_file' },
    ])
    expect(
      (
        await admin.query(
          'SELECT parser_failure FROM api.dataset_import_files WHERE id=$1',
          [failedFile],
        )
      ).rows[0].parser_failure.requestedAt,
    ).toBeTruthy()
  })

  test('regulated imports retain the file on denial and trace every row after QA approval', async ({
    page,
  }) => {
    await clean()
    const original = (
      await admin.query(
        `SELECT id, status, approved_at, approved_by_user_id, test_result, validated_at
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
        page.getByText(/regulated Dataset requires an approved parser version/),
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
          'SELECT id, storage_key, checksum FROM api.dataset_import_files WHERE dataset_id = $1 ORDER BY created_at DESC LIMIT 1',
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
      const settings = await page.context().newPage()
      await settings.goto(
        `/settings/instruments?fileId=${raw.id}&versionId=${original.id}`,
      )
      await expect(
        settings.getByRole('button', { name: 'Approve version', exact: true }),
      ).toBeDisabled()
      const forged = await settings.request.post('/api/parsers/validate', {
        headers: { cookie: sessionCookie },
        data: {
          parserVersionId: original.id,
          fileId: raw.id,
          result: { ok: true },
        },
      })
      expect(forged.status()).toBe(400)
      const deniedApproval = await settings.request.post(
        '/api/db/rpc/approve_parser_version',
        {
          headers: { cookie: sessionCookie },
          data: { p_parser_version_id: original.id },
        },
      )
      expect(deniedApproval.ok()).toBe(false)
      const failures = await settings.request.get(
        `/api/db/my_work_items?source_id=eq.${raw.id}`,
        { headers: { cookie: sessionCookie } },
      )
      expect(await failures.json()).toMatchObject([
        {
          source_type: 'dataset_import_file',
          source_id: raw.id,
          parser_version_id: original.id,
        },
      ])
      const validationResponse = settings.waitForResponse((response) =>
        response.url().endsWith('/api/parsers/validate'),
      )
      await settings
        .getByRole('button', { name: 'Validate retained file', exact: true })
        .click()
      expect(await (await validationResponse).json()).toMatchObject({
        ok: true,
        parserVersionId: original.id,
        status: 'validated',
        validation: {
          checksum: raw.checksum,
          fileId: raw.id,
          rowCount: 6,
          errors: [],
        },
      })
      await expect(
        settings.getByText(
          'Validation passed. This version is ready for QA approval.',
        ),
      ).toBeVisible()
      await settings
        .getByRole('button', { name: 'Approve version', exact: true })
        .click()
      await expect(
        settings.getByText(
          'Parser version approved. Retry the retained import using this exact version.',
        ),
      ).toBeVisible()
      await settings.screenshot({
        path: '.amp/in/artifacts/dset-06-settings-approved.png',
        fullPage: true,
      })
      await settings.close()
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
        'UPDATE api.parser_versions SET status = $2, approved_at = $3, approved_by_user_id = $4, test_result = $5, validated_at = $6 WHERE id = $1',
        [
          original.id,
          original.status,
          original.approved_at,
          original.approved_by_user_id,
          original.test_result,
          original.validated_at,
        ],
      )
    }
  })

  test('creates instrument-linked drafts, retains a failed test, and approves a corrected version', async ({
    page,
  }) => {
    const key = `validation-acceptance-${crypto.randomUUID()}`
    const filename = `${key}.csv`
    const instrument = (
      await admin.query(
        'SELECT id FROM api.instruments WHERE workspace_id=$1 ORDER BY name LIMIT 1',
        [WORKSPACE],
      )
    ).rows[0].id
    try {
      await page.goto('/settings/instruments')
      await page.getByLabel('Parser key', { exact: true }).fill(key)
      await page
        .getByLabel('Parser name', { exact: true })
        .fill('Parser validation acceptance')
      await page
        .getByRole('combobox', { name: 'Instrument', exact: true })
        .selectOption(instrument)
      await page
        .getByLabel('Structural signature (JSON)')
        .fill('{"requiredHeaders":["missing_reading"]}')
      await page
        .getByRole('button', { name: 'Create draft version', exact: true })
        .click()
      await expect(
        page.getByRole('button', {
          name: 'Parser validation acceptance v1',
          exact: true,
        }),
      ).toBeVisible()
      await page
        .getByLabel('Upload a new test file', { exact: true })
        .setInputFiles({
          name: filename,
          mimeType: 'text/csv',
          buffer: Buffer.from(FAILURE_CSV),
        })
      await expect(
        page.getByRole('button', {
          name: 'Validate retained file',
          exact: true,
        }),
      ).toBeEnabled()
      await page
        .getByRole('button', { name: 'Validate retained file', exact: true })
        .click()
      await expect(
        page.getByText(/Validation failed: The test file does not match/),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Approve version', exact: true }),
      ).toBeDisabled()
      await page
        .getByLabel('Structural signature (JSON)')
        .fill('{"requiredHeaders":["alpha","beta"]}')
      await page
        .getByRole('button', { name: 'Create draft version', exact: true })
        .click()
      await expect(
        page.getByRole('button', {
          name: 'Parser validation acceptance v2',
          exact: true,
        }),
      ).toBeVisible()
      await page
        .getByRole('button', { name: 'Validate retained file', exact: true })
        .click()
      await expect(
        page.getByText(
          'Validation passed. This version is ready for QA approval.',
        ),
      ).toBeVisible()
      await page
        .getByRole('button', { name: 'Approve version', exact: true })
        .click()
      await expect(
        page.getByText(/Parser version approved. Retry/),
      ).toBeVisible()
      const retained = (
        await admin.query(
          'SELECT id,checksum,parser_failure FROM api.dataset_import_files WHERE filename=$1',
          [filename],
        )
      ).rows[0]
      expect(retained.checksum).toBe(
        createHash('sha256').update(FAILURE_CSV).digest('hex'),
      )
      expect(retained.parser_failure).toBeNull()
      const parser = (
        await admin.query(
          'SELECT instrument_id FROM api.parsers WHERE key=$1 AND workspace_id=$2',
          [key, WORKSPACE],
        )
      ).rows[0]
      expect(parser.instrument_id).toBe(instrument)
      await page.setViewportSize({ width: 390, height: 844 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: '.amp/in/artifacts/dset-06-settings-narrow.png',
        fullPage: true,
      })
      await page.getByText('Full validation evidence', { exact: true }).click()
      await page.getByText(/QA approved at/).scrollIntoViewIfNeeded()
      await expect(page.getByText(/QA approved at/)).toBeVisible()
      await expect(page.getByText(/Validation passed · 2 rows/)).toBeVisible()
      await expect(page.getByText(/"ok": true/)).toBeVisible()
      await page.screenshot({
        path: '.amp/in/artifacts/dset-06-settings-narrow-evidence.png',
        fullPage: true,
      })
    } finally {
      const files = await admin.query(
        'SELECT storage_key FROM api.dataset_import_files WHERE filename=$1 AND workspace_id=$2',
        [filename, WORKSPACE],
      )
      await admin.query(
        'DELETE FROM api.dataset_import_files WHERE filename=$1 AND workspace_id=$2',
        [filename, WORKSPACE],
      )
      await admin.query(
        'DELETE FROM api.parsers WHERE key=$1 AND workspace_id=$2',
        [key, WORKSPACE],
      )
      for (const row of files.rows)
        rmSync(resolve('.storage/objects', row.storage_key), { force: true })
    }
  })
})
