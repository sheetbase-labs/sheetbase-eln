/**
 * REV-03 acceptance against the real app and PostgREST, without route mocks.
 * Session rows and native Better Auth credentials are fixture preparation,
 * not OAuth/IdP or product credential-enrolment acceptance. Independent
 * verification, consent, password proof, practice and signing use real HTTP.
 * Run with auth-free mode disabled and a freshly migrated local database.
 *
 * Journeys walked here: REV-05 (approve, then sign, so the record locks),
 * REV-06 (witness), REV-07 (a first-time signer is verified and certified
 * before signing), REV-09 (signatures and audit trail of a locked record) and
 * REV-10 (amend with a stated reason).
 */
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'
import { z } from 'zod'

import * as schema from '#/db/schema'
import { signInAsDesignUser } from '../visual/sign-in'
import { open, pickRecord, waitForHydration } from './journeys/helpers'

config({ path: ['.env.local', '.env'] })
const workspace = randomUUID()
const project = randomUUID()
const record = randomUUID()
const controlledRecord = randomUUID()
// REV-03 refusals need their own submissions: one whose checks never ran, one
// whose assigned reviewer is also its submitter, and one that is eligible but
// is signed with no password step-up at all.
const uncheckedRecord = randomUUID()
const selfReviewRecord = randomUUID()
const noPasswordRecord = randomUUID()
const signer = `rev03-signer-${workspace}`
const verifier = `rev03-verifier-${workspace}`
const author = `rev03-author-${workspace}`
// REV-03: the witness who can actually read the draft experiment. A draft
// experiment is readable only by its creator and by workspace owners, so the
// success path needs an owner with explicit project View; the workspace admin
// (verifier) is the person the request must refuse.
const witness = `rev03-witness-${workspace}`
const signerName = 'Signing Fixture Reviewer'
const witnessName = 'Signing Fixture Witness'
const verifierName = 'Verification Fixture Admin'
const signerEmail = `${signer}@sheetbase.test`
const password = 'rev03-browser-fixture-password'
let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let submission: { id: string; revisionId: string; digest: string }
let uncheckedSubmission: { id: string; revisionId: string; digest: string }
let selfReviewSubmission: { id: string; revisionId: string; digest: string }
let noPasswordSubmission: { id: string; revisionId: string; digest: string }

test.use({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  launchOptions: process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
})

test.beforeAll(async () => {
  const url = z.string().url().parse(process.env.MIGRATION_DATABASE_URL)
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Local disposable database required')
  admin = new Client({ connectionString: url })
  await admin.connect()
  database = drizzle(url, { schema })
  await admin.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
    ($1,$2,$3,true),($4,$5,$6,true),($7,'Fixture Author',$8,true),($9,$10,$11,true)`,
    [
      signer,
      signerName,
      signerEmail,
      verifier,
      verifierName,
      `${verifier}@sheetbase.test`,
      author,
      `${author}@sheetbase.test`,
      witness,
      witnessName,
      `${witness}@sheetbase.test`,
    ],
  )
  for (const user of [signer, verifier, author, witness])
    await admin.query(
      `insert into internal.session(id,token,"userId","expiresAt") values($1,$1,$2,now()+interval '12 hours')`,
      [`parity-${user}`, user],
    )
  await admin.query(
    'insert into api.workspaces(id,slug,name) values($1,$2,$3)',
    [workspace, `rev03-${workspace}`, 'REV-03 HTTP acceptance'],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'admin'),($1,$4,'member'),($1,$5,'owner')`,
    [workspace, signer, verifier, author, witness],
  )
  await admin.query(
    'insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,$3,$4,$5)',
    [project, workspace, `REV03-${workspace}`, 'Signing acceptance', signer],
  )
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment','EXP-REV03-BROWSER','Password signing acceptance','draft',$4)`,
    [record, workspace, project, author],
  )
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment','EXP-REV02-AUTHOR','Atomic author submission acceptance','draft',$4)`,
    [controlledRecord, workspace, project, author],
  )
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment','EXP-REV03-UNCHECKED','Checks-not-passed refusal','draft',$4)`,
    [uncheckedRecord, workspace, project, author],
  )
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment','EXP-REV03-SELF','Self-review refusal','draft',$4)`,
    [selfReviewRecord, workspace, project, signer],
  )
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment','EXP-REV03-NOPASS','Missing-password refusal','draft',$4)`,
    [noPasswordRecord, workspace, project, author],
  )
  const secret = z.string().min(32).parse(process.env.BETTER_AUTH_SECRET)
  const { createAuth } = await import('#/lib/auth')
  for (const user of [signer, author, verifier, witness]) {
    const token = `parity-${user}`
    const signature = createHmac('sha256', secret)
      .update(token)
      .digest('base64')
    await createAuth(database).api.setPassword({
      headers: new Headers({
        cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
      }),
      body: { newPassword: password },
    })
  }
  const actor = new Client({ connectionString: process.env.PGRST_DB_URI })
  await actor.connect()
  try {
    await actor.query('set role authenticated')
    const claims = async (user: string) =>
      actor.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          role: 'authenticated',
          workspace_id: workspace,
          sub: user,
          session_id: `parity-${user}`,
        }),
      ])
    await claims(signer)
    await actor.query(
      'select api.set_project_access_rule($1,$2,null,true,true,false,false,false)',
      [project, author],
    )
    await claims(author)
    const preview = await actor.query(
      "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
      [record],
    )
    const submitted = await actor.query(
      `select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) as result`,
      [record, preview.rows[0].digest, [signer], `rev03-browser-${record}`],
    )
    const result = z
      .object({
        revision: z.object({ id: z.uuid(), integrityDigest: z.string() }),
        submission: z.object({ id: z.uuid() }),
      })
      .parse(submitted.rows[0].result)
    submission = {
      id: result.submission.id,
      revisionId: result.revision.id,
      digest: result.revision.integrityDigest,
    }
    await claims(signer)
    await actor.query(
      "select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)",
      [submission.revisionId, `rev03-checks-${record}`],
    )
    // Checks-not-passed refusal: a submission with no check run at all.
    await claims(author)
    const uncheckedPreview = await actor.query(
      "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
      [uncheckedRecord],
    )
    uncheckedSubmission = parseSubmission(
      (
        await actor.query(
          `select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) as result`,
          [
            uncheckedRecord,
            uncheckedPreview.rows[0].digest,
            [signer],
            `rev03-unchecked-${uncheckedRecord}`,
          ],
        )
      ).rows[0].result,
    )
    // Self-review refusal: the submitter is also the assigned reviewer.
    await claims(signer)
    const selfPreview = await actor.query(
      "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
      [selfReviewRecord],
    )
    selfReviewSubmission = parseSubmission(
      (
        await actor.query(
          `select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) as result`,
          [
            selfReviewRecord,
            selfPreview.rows[0].digest,
            [signer],
            `rev03-selfreview-${selfReviewRecord}`,
          ],
        )
      ).rows[0].result,
    )
    // Missing-password refusal: eligible (checks pass, assigned reviewer) but
    // signed with no step-up token.
    await claims(author)
    const noPasswordPreview = await actor.query(
      "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
      [noPasswordRecord],
    )
    noPasswordSubmission = parseSubmission(
      (
        await actor.query(
          `select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) as result`,
          [
            noPasswordRecord,
            noPasswordPreview.rows[0].digest,
            [signer],
            `rev03-nopassword-${noPasswordRecord}`,
          ],
        )
      ).rows[0].result,
    )
    await claims(signer)
    await actor.query(
      "select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)",
      [
        noPasswordSubmission.revisionId,
        `rev03-nopassword-checks-${noPasswordRecord}`,
      ],
    )
  } finally {
    await actor.end()
  }
})

test.afterAll(async () => {
  if (admin) {
    await admin.query('delete from api.signatures where workspace_id=$1', [
      workspace,
    ])
    await admin.query(
      'delete from api.signature_witness_requests where workspace_id=$1',
      [workspace],
    )
    await admin.query(
      'delete from api.review_decisions where workspace_id=$1',
      [workspace],
    )
    await admin.query(
      'delete from api.review_submissions where workspace_id=$1',
      [workspace],
    )
    await admin.query(
      'delete from api.review_check_results where workspace_id=$1',
      [workspace],
    )
    await admin.query(
      'update api.records set locked_at=null,locked_by_revision_id=null where workspace_id=$1',
      [workspace],
    )
    await admin.query('delete from api.revisions where workspace_id=$1', [
      workspace,
    ])
    // The isolated provisioner owns this database and drops it after the run.
    // The workspace and its users cannot be deleted from here: both cascade
    // into `api.change_events`, whose append-only trigger refuses any mutation
    // (SB121, `refuse_change_event_mutation`). That is the audit chain's
    // design — a signature/submission suite cannot un-write its own evidence —
    // so cleanup is the provisioner's DROP DATABASE, not a row delete.
    await admin.end()
  }
  await database?.$client.end()
})

// Use the browser's actual cookie/Origin handling, including Secure cookies on
// loopback HTTP. APIRequestContext does not reproduce Chromium's local trust.
function post(page: Page, path: string, data: object) {
  return page.evaluate(
    async ({ path, data }) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body: unknown = await response.json()
      return { status: response.status, body }
    },
    { path, data },
  )
}

/** The revision/submission identities every `submit_record_revision` returns. */
function parseSubmission(result: unknown) {
  const parsed = z
    .object({
      revision: z.object({ id: z.uuid(), integrityDigest: z.string() }),
      submission: z.object({ id: z.uuid() }),
    })
    .parse(result)
  return {
    id: parsed.submission.id,
    revisionId: parsed.revision.id,
    digest: parsed.revision.integrityDigest,
  }
}

test.setTimeout(90_000)

test('independent certification, practice, password focus and exact-digest signing use real HTTP', async ({
  page,
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Browser base URL required')
  // The sign-out assertions below name the `parity-<signer>` session the
  // beforeAll inserted, so this sign-in keeps that id instead of minting one.
  await signInAsDesignUser(page, signer, { sessionId: `parity-${signer}` })
  const initialCertifications = page.waitForResponse(
    (response) =>
      response.url().endsWith('/rpc/workspace_signature_certifications') &&
      response.request().method() === 'POST',
  )
  await page.goto('/settings/my-signature')
  expect((await initialCertifications).status()).toBe(200)
  await expect(
    page.getByRole('button', { name: 'Certify signature' }),
  ).toBeDisabled()
  const provider = await post(page, '/api/signatures/step-up', {
    purpose: 'provider-step-up',
    workspaceId: workspace,
  })
  expect(provider.status).toBe(400)
  await page
    .getByRole('button', { name: 'Request identity verification', exact: true })
    .click()
  await expect(
    page.getByText('Awaiting independent admin verification.'),
  ).toBeVisible()
  const self = await post(page, '/api/db/rpc/verify_signature_identity', {
    p_user_id: signer,
    p_email: signerEmail,
  })
  expect(self.status).toBe(403)
  const adminContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  })
  try {
    const adminPage = await adminContext.newPage()
    await signInAsDesignUser(adminPage, verifier)
    const adminCertifications = adminPage.waitForResponse(
      (response) =>
        response.url().endsWith('/rpc/workspace_signature_certifications') &&
        response.request().method() === 'POST',
    )
    await adminPage.goto('/settings/signatures')
    expect((await adminCertifications).status()).toBe(200)
    await adminPage.getByText(`Verify ${signerName} independently`).click()
    await adminPage.getByLabel('Independently verified email').fill(signerEmail)
    await expect(
      adminPage.getByRole('button', { name: 'Confirm verified identity' }),
    ).toBeDisabled()
    await adminPage
      .getByRole('checkbox', { name: /I have independently confirmed/ })
      .check()
    const verified = adminPage.waitForResponse(
      (r) =>
        r.url().endsWith('/rpc/verify_signature_identity') &&
        r.request().method() === 'POST',
    )
    await adminPage
      .getByRole('button', { name: 'Confirm verified identity' })
      .click()
    expect((await verified).status()).toBe(200)
  } finally {
    await adminContext.close()
  }
  await page.reload()
  await expect(
    page.getByText(/Verified by Verification Fixture Admin/),
  ).toBeVisible()
  await page
    .getByRole('checkbox', { name: 'I have read and agree to this statement' })
    .check()
  await expect(
    page.getByRole('button', { name: 'Certify signature' }),
  ).toBeDisabled()
  await page.getByLabel(/Enter your signing password to certify/).fill(password)
  const certified = page.waitForResponse(
    (r) =>
      r.url().endsWith('/rpc/certify_signature') &&
      r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Certify signature' }).click()
  expect((await certified).status()).toBe(200)
  await expect(
    page.getByRole('button', { name: 'Try a practice signature' }),
  ).toBeVisible()
  await page.getByLabel(/Signing password/).fill(password)
  const practice = page.waitForResponse(
    (r) =>
      r.url().endsWith('/rpc/practice_signature') &&
      r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Try a practice signature' }).click()
  expect((await practice).status()).toBe(200)
  expect(
    (
      await admin.query(
        'select count(*)::int as n from api.signatures where workspace_id=$1',
        [workspace],
      )
    ).rows[0].n,
  ).toBe(0)
  await page.goto(`/review/${submission.revisionId}`)
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign revision', exact: true }).click()
  await expect(page.getByLabel('Signing password')).toBeFocused()
  await expect(
    page.getByRole('option', { name: 'Reviewed', exact: true }),
  ).toBeAttached()
  await expect(
    page.getByRole('option', { name: 'Reviewed and approved', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('option', { name: 'Witnessed', exact: true }),
  ).toHaveCount(0)
  await page.getByLabel('Signing password').fill(password)
  await page.getByLabel(/Type your name/).fill(signerName)
  const reviewed = page.waitForResponse((r) =>
    r.url().endsWith('/rpc/sign_revision'),
  )
  await page.getByRole('button', { name: 'Sign', exact: true }).click()
  expect((await reviewed).status()).toBe(200)
  await expect(page.getByRole('alertdialog')).toBeHidden()
  expect(
    (
      await admin.query('select locked_at from api.records where id=$1', [
        record,
      ])
    ).rows[0].locked_at,
  ).toBeNull()
  expect(
    (
      await admin.query(
        'select state from api.review_submissions where id=$1',
        [submission.id],
      )
    ).rows[0].state,
  ).toBe('submitted')
  await page.keyboard.press('ControlOrMeta+Shift+Enter')
  await expect(page.getByRole('alertdialog')).toContainText(
    'Approve this review?',
  )
  const approved = page.waitForResponse(
    (r) =>
      r.url().endsWith('/rpc/approve_review') &&
      r.request().method() === 'POST',
  )
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Approve', exact: true })
    .click()
  expect((await approved).status()).toBe(200)
  await expect(page.getByLabel('Signing password')).toBeFocused()
  const sessionOnly = await post(page, '/api/db/rpc/sign_revision', {
    p_submission_id: submission.id,
    p_signature_meaning: 'reviewed-and-approved',
    p_confirmation_phrase: signerName,
    p_expected_revision_digest: submission.digest,
  })
  expect(sessionOnly.status).toBe(422)
  expect(sessionOnly.body).toMatchObject({
    error: { message: 'fresh password token required' },
  })
  await page.getByRole('button', { name: 'Sign later', exact: true }).click()
  await expect(page.getByLabel('Signing password')).toBeHidden()
  await page.reload()
  await page
    .getByRole('button', { name: 'Sign revision', exact: true })
    .waitFor()
  await page.keyboard.press('ControlOrMeta+Shift+Enter')
  await expect(page.getByLabel('Signing password')).toBeFocused()
  await expect(page.getByText(submission.digest, { exact: true })).toBeVisible()
  await expect(
    page.getByText(submission.revisionId, { exact: true }),
  ).toBeVisible()
  await mkdir('.amp/in/artifacts', { recursive: true })
  for (const layout of [
    { name: 'wide', width: 1280, height: 900 },
    { name: 'narrow', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height })
    await expect(page.getByLabel('Signing password')).toBeVisible()
    expect(
      await page
        .getByText(submission.digest, { exact: true })
        .locator('..')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    for (const control of [
      page.getByLabel('Signing password'),
      page.getByLabel('Signature meaning'),
      page.getByLabel('Type your name to confirm'),
    ]) {
      const inset = await control.evaluate((element) => {
        // The signing dialog is a `dialog`; the decision dialogs are
        // `alertdialog` (ConfirmDialogContent sets that role).
        const dialog = element.closest('[role="dialog"]')
        if (!dialog)
          throw new Error('Signing control must be inside the dialog')
        const popup = dialog.getBoundingClientRect()
        const control = element.getBoundingClientRect()
        return Math.min(control.left - popup.left, popup.right - control.right)
      })
      expect(inset).toBeGreaterThanOrEqual(16)
    }
    await page.screenshot({
      path: `.amp/in/artifacts/rev03-password-${layout.name}.png`,
    })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByLabel('Signing password').fill(password)
  await page.getByLabel(/Type your name/).fill(signerName)
  const signed = page.waitForResponse(
    (r) =>
      r.url().endsWith('/rpc/sign_revision') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Sign', exact: true }).click()
  expect((await signed).status()).toBe(200)
  const evidence = await admin.query(
    'select * from api.signatures where submission_id=$1',
    [submission.id],
  )
  expect(evidence.rows).toHaveLength(2)
  expect(
    evidence.rows.find(
      (row) => row.signature_meaning === 'reviewed-and-approved',
    ),
  ).toMatchObject({
    signer_user_id: signer,
    signer_name: signerName,
    signature_meaning: 'reviewed-and-approved',
    auth_method: 'password',
    revision_integrity_digest: submission.digest,
    confirmation_phrase: signerName,
  })
  const grants = await admin.query(
    'select purpose,signature_meaning,consumed_at from internal.signature_grants where user_id=$1 order by created_at',
    [signer],
  )
  expect(grants.rows.map((r) => r.purpose)).toEqual([
    'certify',
    'practice',
    'sign',
    'sign',
  ])
  expect(
    grants.rows
      .filter((r) => r.purpose === 'sign')
      .map((r) => r.signature_meaning),
  ).toEqual(['reviewed', 'reviewed-and-approved'])
  expect(grants.rows.every((r) => r.consumed_at !== null)).toBe(true)
  await page.screenshot({ path: '.amp/in/artifacts/rev03-http-signed.png' })

  // REV-03 refusals, driven through the same same-origin RPC boundary the
  // signing dialog posts to. Each must state its reason.
  // 1. No password step-up at all: the token is required.
  const noPassword = await post(page, '/api/db/rpc/sign_revision', {
    p_submission_id: noPasswordSubmission.id,
    p_signature_meaning: 'reviewed',
    p_confirmation_phrase: signerName,
    p_expected_revision_digest: noPasswordSubmission.digest,
  })
  expect(noPassword.status).toBe(422)
  expect(noPassword.body).toMatchObject({
    error: {
      category: 'missing_link',
      message: 'fresh password token required',
    },
  })
  // 2. Checks have not passed for this digest (no check run exists).
  const unchecked = await post(page, '/api/db/rpc/sign_revision', {
    p_submission_id: uncheckedSubmission.id,
    p_signature_meaning: 'reviewed',
    p_confirmation_phrase: signerName,
    p_expected_revision_digest: uncheckedSubmission.digest,
  })
  expect(unchecked.status).toBe(400)
  expect(unchecked.body).toMatchObject({
    error: {
      category: 'validation_error',
      message: 'required checks have not passed for this digest',
    },
  })
  // 3. A second signature on a revision this signer already signed.
  const duplicate = await post(page, '/api/db/rpc/sign_revision', {
    p_submission_id: submission.id,
    p_signature_meaning: 'reviewed-and-approved',
    p_confirmation_phrase: signerName,
    p_expected_revision_digest: submission.digest,
  })
  expect(duplicate.status).toBe(400)
  expect(duplicate.body).toMatchObject({
    error: {
      category: 'validation_error',
      message: 'signer has already recorded this meaning',
    },
  })
  // 4. A reviewer signing their own submission.
  const selfReview = await post(page, '/api/db/rpc/sign_revision', {
    p_submission_id: selfReviewSubmission.id,
    p_signature_meaning: 'reviewed',
    p_confirmation_phrase: signerName,
    p_expected_revision_digest: selfReviewSubmission.digest,
  })
  expect(selfReview.status).toBe(403)
  expect(selfReview.body).toMatchObject({
    error: {
      category: 'permission_denied',
      message: 'only an assigned nonauthor reviewer may sign',
    },
  })
  // No refusal may have written a signature row.
  expect(
    (
      await admin.query(
        'select count(*)::int as n from api.signatures where submission_id = any($1::uuid[])',
        [
          [
            noPasswordSubmission.id,
            uncheckedSubmission.id,
            selfReviewSubmission.id,
          ],
        ],
      )
    ).rows[0].n,
  ).toBe(0)
  for (let failure = 0; failure < 3; failure++) {
    const response = await post(page, '/api/signatures/step-up', {
      workspaceId: workspace,
      purpose: 'practice',
      password: 'incorrect-fixture-password',
    })
    expect(response.status).toBe(failure === 2 ? 423 : 401)
  }
  const locked = await post(page, '/api/signatures/step-up', {
    workspaceId: workspace,
    purpose: 'practice',
    password,
  })
  expect(locked.status).toBe(423)
  const attempts = await admin.query(
    'select failures,extract(epoch from locked_until-clock_timestamp()) as remaining from internal.signature_password_attempts where user_id=$1',
    [signer],
  )
  expect(attempts.rows[0].failures).toBe(3)
  expect(Number(attempts.rows[0].remaining)).toBeGreaterThan(880)
  expect(Number(attempts.rows[0].remaining)).toBeLessThanOrEqual(900)
  const audits = await admin.query(
    "select count(*)::int as n from internal.signature_authentication_events where user_id=$1 and event='password-lockout-started'",
    [signer],
  )
  expect(audits.rows[0].n).toBe(1)
  await page.goto('/settings/my-signature')
  await page.getByLabel(/Signing password/).fill(password)
  await page.getByRole('button', { name: 'Try a practice signature' }).click()
  await expect(page.getByRole('alert')).toContainText('15 minutes')
  await page.screenshot({ path: '.amp/in/artifacts/rev03-lockout.png' })

  await admin.query(
    `insert into internal.session(id,token,"userId","expiresAt") values($1,$1,$2,now()+interval '1 hour')`,
    [`other-browser-${signer}`, signer],
  )
  await page.getByRole('button', { name: `Account: ${signerName}` }).click()
  await page.context().setOffline(true)
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  // EXP-05.5: being offline is no longer a reason to refuse sign-out — only an
  // editor holding unsaved work is. Offline, the sign-out cannot be confirmed,
  // so the shell says that and the session is not ended; the unsaved-edits
  // guard must not fire, because nothing here holds unsaved work.
  const offlineAlert = page
    .getByRole('menu', { name: `Account: ${signerName}` })
    .getByRole('alert')
  await expect(offlineAlert).toContainText('Sign out couldn’t be confirmed')
  await expect(offlineAlert).not.toContainText('Save your pending edits')
  expect(
    (
      await admin.query('select id from internal.session where id=$1', [
        `parity-${signer}`,
      ])
    ).rows,
  ).toHaveLength(1)
  await page.context().setOffline(false)
  const signedOut = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/sign-out') &&
      response.request().method() === 'POST',
  )
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  expect((await signedOut).status()).toBe(200)
  await expect(page).toHaveURL(/\/sign-in\?state=signed-out$/)
  await expect(
    page.getByRole('heading', { name: 'You’re signed out' }),
  ).toBeVisible()
  await expect(
    page.getByText(
      /You signed out of this browser\. Signing out ends your session on this browser only\./,
    ),
  ).toBeVisible()
  await expect(page.getByText(/30 minutes|inactivity/)).toHaveCount(0)
  expect(
    (
      await admin.query('select id from internal.session where id=$1', [
        `parity-${signer}`,
      ])
    ).rows,
  ).toEqual([])
  expect(
    (
      await admin.query('select id from internal.session where id=$1', [
        `other-browser-${signer}`,
      ])
    ).rows,
  ).toHaveLength(1)
  expect(
    await page.evaluate(async () =>
      (await fetch('/api/auth/get-session')).json(),
    ),
  ).toBeNull()
  await page.screenshot({
    path: '.amp/in/artifacts/rev03-native-signed-out-wide.png',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: '.amp/in/artifacts/rev03-native-signed-out-narrow.png',
  })
})

test('controlled author submission certifies and signs atomically through the real notebook UI', async ({
  page,
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Browser base URL required')
  await signInAsDesignUser(page, author)
  const hydrated = page.waitForResponse((r) =>
    r.url().endsWith('/rpc/workspace_signature_certifications'),
  )
  await page.goto('/settings/my-signature')
  expect((await hydrated).status()).toBe(200)
  await page
    .getByRole('button', { name: 'Request identity verification', exact: true })
    .click()
  await expect(
    page.getByText('Awaiting independent admin verification.'),
  ).toBeVisible()
  const verifierContext = await browser.newContext({ baseURL })
  try {
    const verifierPage = await verifierContext.newPage()
    await signInAsDesignUser(verifierPage, verifier)
    await verifierPage.goto('/settings/my-signature')
    const verified = await post(
      verifierPage,
      '/api/db/rpc/verify_signature_identity',
      {
        p_user_id: author,
        p_email: `${author}@sheetbase.test`,
      },
    )
    expect(verified.status).toBe(200)
  } finally {
    await verifierContext.close()
  }
  const verifiedAuthor = page.waitForResponse(
    (response) =>
      response.url().endsWith('/rpc/workspace_signature_certifications') &&
      response.request().method() === 'POST',
  )
  await page.reload()
  const authorCertifications = await verifiedAuthor
  expect(authorCertifications.status()).toBe(200)
  expect(await authorCertifications.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user_id: author,
        identity_verified_by: verifier,
        verified_email: `${author}@sheetbase.test`,
      }),
    ]),
  )
  await expect(
    page.getByText(/Verified by Verification Fixture Admin/),
  ).toBeVisible()
  await page
    .getByRole('checkbox', { name: 'I have read and agree to this statement' })
    .check()
  await page.getByLabel(/Enter your signing password to certify/).fill(password)
  const certified = page.waitForResponse((r) =>
    r.url().endsWith('/rpc/certify_signature'),
  )
  await page.getByRole('button', { name: 'Certify signature' }).click()
  expect((await certified).status()).toBe(200)
  await open(page, `/experiments/${controlledRecord}/notebook`)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Submit for review' })
  await expect(
    dialog.getByRole('option', { name: /controlled-scientific-review/ }),
  ).toBeAttached()
  await dialog
    .getByLabel('Review workflow')
    .selectOption('controlled-scientific-review/1')
  await expect(
    dialog.getByText('Authored signature', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Check snapshot' }).click()
  await expect(dialog.getByText(/Integrity check:/)).toBeVisible()
  // A reviewer is chosen, not assumed: the author is no longer preselected.
  await dialog.getByLabel(new RegExp(signerName)).check()
  await expect(
    dialog.getByRole('button', { name: 'Submit', exact: true }),
  ).toBeDisabled()
  await dialog.getByLabel('Author signing password').fill(password)
  await dialog
    .getByLabel('Author signature confirmation')
    .fill('Fixture Author')
  await mkdir('.amp/in/artifacts', { recursive: true })
  await page.screenshot({
    path: '.amp/in/artifacts/rev02-author-submission-wide.png',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog
    .getByLabel('Author signature confirmation')
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: '.amp/in/artifacts/rev02-author-submission-narrow.png',
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  const issued = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/signatures/step-up') &&
      r.request().postDataJSON().purpose === 'author-submit',
  )
  const submitted = page.waitForResponse((r) =>
    r.url().endsWith('/rpc/submit_record_revision'),
  )
  await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
  expect((await issued).status()).toBe(200)
  const response = await submitted
  expect(response.status()).toBe(200)
  const result = z
    .object({
      revision: z.object({ id: z.uuid(), integrityDigest: z.string() }),
      submission: z.object({ id: z.uuid() }),
    })
    .parse(await response.json())
  await expect(page).toHaveURL(new RegExp(`/review/${result.revision.id}$`))
  const evidence = await admin.query(
    'select * from api.signatures where submission_id=$1',
    [result.submission.id],
  )
  expect(evidence.rows).toHaveLength(1)
  expect(evidence.rows[0]).toMatchObject({
    signer_user_id: author,
    signer_name: 'Fixture Author',
    signature_meaning: 'authored',
    auth_method: 'password',
    revision_integrity_digest: result.revision.integrityDigest,
  })
  const grants = await admin.query(
    "select signature_meaning,consumed_at,submission_arguments from internal.signature_grants where user_id=$1 and purpose='author-submit'",
    [author],
  )
  expect(grants.rows).toHaveLength(1)
  expect(grants.rows[0].signature_meaning).toBe('authored')
  expect(grants.rows[0].consumed_at).not.toBeNull()
  expect(grants.rows[0].submission_arguments).toMatchObject({
    recordId: controlledRecord,
    revisionDigest: result.revision.integrityDigest,
    workflowDefinitionKey: 'controlled-scientific-review',
    workflowDefinitionVersion: 1,
    confirmed: true,
    dueAt: null,
  })
  expect(
    (
      await admin.query('select locked_at from api.records where id=$1', [
        controlledRecord,
      ])
    ).rows[0].locked_at,
  ).toBeNull()
  await expect(
    page.getByRole('option', { name: `${verifier} · admin`, exact: true }),
  ).toHaveCount(0)
  // Certification authority alone is not record-read authority. Give both the
  // owner witness and this administrator View only, through the real project
  // owner: View is necessary for both, and the draft-experiment privacy rule is
  // what still separates them.
  const ownerContext = await browser.newContext({ baseURL })
  try {
    const ownerPage = await ownerContext.newPage()
    await signInAsDesignUser(ownerPage, signer)
    await ownerPage.goto('/')
    for (const [userId, expected] of [
      [witness, 200],
      [verifier, 200],
    ] as const) {
      const access = await post(
        ownerPage,
        '/api/db/rpc/set_project_access_rule',
        {
          p_project_id: project,
          p_user_id: userId,
          p_group_id: null,
          p_can_view: true,
          p_can_edit: false,
          p_can_review: false,
          p_client_portal: false,
          p_can_manage: false,
        },
      )
      expect(access.status, JSON.stringify(access.body)).toBe(expected)
    }
  } finally {
    await ownerContext.close()
  }
  // Read the body as the response arrives: the page can navigate on after it,
  // and a body read later is then gone.
  let candidatesBody: Promise<unknown> = Promise.resolve(null)
  const witnessCandidates = page.waitForResponse((response) => {
    if (!response.url().endsWith('/rpc/signature_witness_candidates'))
      return false
    candidatesBody = response.json()
    return true
  })
  await page.reload()
  const candidatesResponse = await witnessCandidates
  expect(candidatesResponse.status()).toBe(200)
  const candidates = z
    .array(
      z.object({
        user_id: z.string(),
        name: z.string(),
        workspace_role: z.string().nullable(),
        can_read_record: z.boolean(),
      }),
    )
    .parse(await candidatesBody)
  // REV-03: the server answers the record-read question per candidate. The
  // administrator holds View but not record-read authority, because a draft
  // experiment stays private to its author and to workspace owners.
  expect(candidates.find((member) => member.user_id === verifier)).toEqual({
    user_id: verifier,
    name: verifierName,
    workspace_role: 'admin',
    can_read_record: false,
  })
  expect(candidates.find((member) => member.user_id === witness)).toEqual({
    user_id: witness,
    name: witnessName,
    workspace_role: 'owner',
    can_read_record: true,
  })
  const witnessRequestCalls: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc/request_signature_witness'))
      witnessRequestCalls.push(request.url())
  })
  const picker = page.getByLabel('Request a witness for this frozen revision')
  await pickRecord(page, picker, { id: verifier })
  // The picker states the refusal, with the reason, before any call is made.
  await expect(
    page.getByRole('alert').filter({ hasText: 'cannot read this record' }),
  ).toContainText(
    `${verifierName} can’t read this record, so they can’t witness it.`,
  )
  await expect(
    page.getByRole('button', { name: 'Request witness', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'Request witness', exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click())
  expect(witnessRequestCalls).toEqual([])
  // The same request is refused by the server, with the same reason, and
  // writes nothing: no request row, no work item, no notification.
  const refused = await post(page, '/api/db/rpc/request_signature_witness', {
    p_submission_id: result.submission.id,
    p_witness_user_id: verifier,
    p_expected_revision_digest: result.revision.integrityDigest,
    p_due_at: null,
  })
  expect(refused.status).toBe(403)
  expect(refused.body).toMatchObject({
    error: {
      category: 'permission_denied',
      message: 'witness cannot read this record',
    },
  })
  expect(
    (
      await admin.query(
        'select id from api.signature_witness_requests where submission_id=$1 and witness_user_id=$2',
        [result.submission.id, verifier],
      )
    ).rows,
  ).toEqual([])
  expect(
    (
      await admin.query(
        `select id from internal.notifications where workspace_id=$1 and user_id=$2 and event_type='signature_requested'`,
        [workspace, verifier],
      )
    ).rows,
  ).toEqual([])
  await pickRecord(page, picker, { id: witness })
  const requested = page.waitForResponse((r) =>
    r.url().endsWith('/rpc/request_signature_witness'),
  )
  await page
    .getByRole('button', { name: 'Request witness', exact: true })
    .click()
  expect((await requested).status()).toBe(200)
  expect(witnessRequestCalls).toHaveLength(2)
  // The witness who can read the record is notified and the refusal above
  // refused before any of that: the work arrives for one, never for the other.
  expect(
    (
      await admin.query(
        `select id from internal.notifications where workspace_id=$1 and user_id=$2 and event_type='signature_requested'`,
        [workspace, witness],
      )
    ).rows,
  ).toHaveLength(1)
  const witnessContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  })
  const reviewerContext = await browser.newContext({ baseURL })
  try {
    const witnessPage = await witnessContext.newPage()
    await signInAsDesignUser(witnessPage, witness)
    const witnessHydrated = witnessPage.waitForResponse((r) =>
      r.url().endsWith('/rpc/workspace_signature_certifications'),
    )
    await witnessPage.goto('/settings/my-signature')
    expect((await witnessHydrated).status()).toBe(200)
    await witnessPage
      .getByRole('button', {
        name: 'Request identity verification',
        exact: true,
      })
      .click()
    await expect(
      witnessPage.getByText('Awaiting independent admin verification.'),
    ).toBeVisible()
    const reviewerPage = await reviewerContext.newPage()
    await signInAsDesignUser(reviewerPage, signer)
    await reviewerPage.goto(`/review/${result.revision.id}`)
    expect(
      (
        await post(reviewerPage, '/api/db/rpc/verify_signature_identity', {
          p_user_id: witness,
          p_email: `${witness}@sheetbase.test`,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await post(reviewerPage, '/api/db/rpc/run_revision_checks', {
          p_revision_id: result.revision.id,
          p_check_definition_key: 'default-scientific-checks',
          p_check_definition_version: 1,
          p_confirmed: true,
          p_idempotency_key: `witness-checks-${controlledRecord}`,
        })
      ).status,
    ).toBe(200)
    const verifiedWitness = witnessPage.waitForResponse(
      (response) =>
        response.url().endsWith('/rpc/workspace_signature_certifications') &&
        response.request().method() === 'POST',
    )
    await witnessPage.reload()
    await waitForHydration(witnessPage)
    const witnessCertifications = await verifiedWitness
    expect(witnessCertifications.status()).toBe(200)
    expect(await witnessCertifications.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: witness,
          identity_verified_by: signer,
          verified_email: `${witness}@sheetbase.test`,
        }),
      ]),
    )
    await expect(
      witnessPage.getByText(/Verified by Signing Fixture Reviewer/),
    ).toBeVisible()
    await witnessPage
      .getByRole('checkbox', {
        name: 'I have read and agree to this statement',
      })
      .check()
    await witnessPage
      .getByLabel(/Enter your signing password to certify/)
      .fill(password)
    const witnessCertified = witnessPage.waitForResponse((r) =>
      r.url().endsWith('/rpc/certify_signature'),
    )
    await witnessPage.getByRole('button', { name: 'Certify signature' }).click()
    expect((await witnessCertified).status()).toBe(200)
    await witnessPage.goto('/inbox')
    await witnessPage.getByRole('button', { name: /^Reviews 1$/ }).click()
    // QA3-lists-inbox-2: `later` follows the default, which opens the bucket
    // when it holds every row the tab would render — so this spec expands it
    // only when the app has left it collapsed (its expander is only rendered
    // then, and the strip offers Collapse while it is open).
    const laterBucket = witnessPage.getByRole('button', {
      name: /^Later · 1 items$/,
    })
    if (await laterBucket.isVisible()) await laterBucket.click()
    const witnessRow = witnessPage.getByRole('button', {
      name: /Atomic author submission acceptance/,
    })
    await expect(witnessRow).toContainText('Witness requested')
    await witnessRow.click()
    await expect(witnessRow).toHaveAttribute('aria-pressed', 'true')
    const measurements = []
    for (const width of [1280, 390]) {
      await witnessPage.setViewportSize({ width, height: 900 })
      const rowBounds = await witnessRow.evaluate((row) => {
        const label = row.querySelector('[data-slot="status"]')
        const title = label?.nextElementSibling
        if (!label || !title) throw new Error('Witness label/title required')
        const textRange = document.createRange()
        textRange.selectNodeContents(label)
        return {
          labelRight: textRange.getBoundingClientRect().right,
          titleLeft: title.getBoundingClientRect().left,
        }
      })
      expect(rowBounds.labelRight).toBeLessThanOrEqual(rowBounds.titleLeft)
      const toolbarBounds = await witnessPage
        .getByRole('toolbar', { name: 'Filter by type' })
        .evaluate((toolbar) => {
          const rect = toolbar.getBoundingClientRect()
          return {
            left: rect.left,
            right: rect.right,
            children: Array.from(toolbar.children)
              .filter((child) => child.getClientRects().length > 0)
              .map((child) => {
                const bounds = child.getBoundingClientRect()
                return {
                  text: child.textContent,
                  left: bounds.left,
                  right: bounds.right,
                }
              }),
          }
        })
      for (const child of toolbarBounds.children) {
        expect(child.left).toBeGreaterThanOrEqual(toolbarBounds.left)
        expect(child.right).toBeLessThanOrEqual(toolbarBounds.right)
      }
      if (width === 1280)
        await expect(witnessPage.getByText(/Sorted by due date/)).toBeVisible()
      measurements.push({ width, rowBounds, toolbarBounds })
      await witnessPage.screenshot({
        path: `.amp/in/artifacts/rev02-inbox-witness-selected-${width}.png`,
      })
    }
    await writeFile(
      '.amp/in/artifacts/rev02-inbox-layout-bounds.json',
      JSON.stringify(measurements, null, 2),
    )
    await witnessPage.setViewportSize({ width: 1280, height: 900 })
    await witnessRow.focus()
    await witnessPage.keyboard.press('Enter')
    await expect(witnessPage).toHaveURL(
      `${baseURL}/review/${result.revision.id}?signatureMeaning=witnessed`,
    )
    const work = await witnessPage.evaluate(async () =>
      (await fetch('/api/db/my_work_items')).json(),
    )
    expect(work).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'witness_requested',
          record_id: controlledRecord,
          revision_id: result.revision.id,
          source_type: 'signature_witness_request',
        }),
      ]),
    )
    await witnessPage
      .getByRole('button', { name: 'Sign revision', exact: true })
      .click()
    await expect(witnessPage.getByLabel('Signing password')).toBeFocused()
    await expect(witnessPage.getByLabel('Signature meaning')).toHaveValue(
      'witnessed',
    )
    await expect(
      witnessPage.getByLabel('Signature meaning').getByRole('option'),
    ).toHaveCount(1)
    await witnessPage.getByLabel('Signing password').fill(password)
    await witnessPage.getByLabel(/Type your name/).fill(witnessName)
    await witnessPage.screenshot({
      path: '.amp/in/artifacts/rev02-witness-requested.png',
    })
    const witnessed = witnessPage.waitForResponse((r) =>
      r.url().endsWith('/rpc/sign_revision'),
    )
    await witnessPage.getByRole('button', { name: 'Sign', exact: true }).click()
    expect((await witnessed).status()).toBe(200)
    const completedWork = await witnessPage.evaluate(async () =>
      (await fetch('/api/db/my_work_items')).json(),
    )
    expect(completedWork).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'witness_requested',
          revision_id: result.revision.id,
        }),
      ]),
    )
    const witnessEvidence = await admin.query(
      "select * from api.signatures where submission_id=$1 and signature_meaning='witnessed'",
      [result.submission.id],
    )
    expect(witnessEvidence.rows).toHaveLength(1)
    expect(witnessEvidence.rows[0]).toMatchObject({
      signer_user_id: witness,
      signer_name: witnessName,
      signature_meaning: 'witnessed',
      auth_method: 'password',
      revision_integrity_digest: result.revision.integrityDigest,
    })
    const completedInbox = witnessPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        '/api/db/rpc/inbox_work_items_page',
    )
    await witnessPage.goto('/inbox')
    expect((await completedInbox).status()).toBe(200)
    await expect(
      witnessPage.getByRole('button', { name: /^Reviews 0$/ }),
    ).toBeVisible()
    await expect(
      witnessPage.getByRole('button', {
        name: /Atomic author submission acceptance/,
      }),
    ).toHaveCount(0)
    await expect(witnessPage.getByText('Witness requested')).toHaveCount(0)
    expect(
      (
        await admin.query('select locked_at from api.records where id=$1', [
          controlledRecord,
        ])
      ).rows[0].locked_at,
    ).toBeNull()
    await admin.query('update internal."user" set name=$2 where id=$1', [
      author,
      'Renamed current author profile',
    ])
    await page.goto(`/records/${controlledRecord}/notebook`)
    await page.getByRole('link', { name: /^Signatures/ }).click()
    // SignaturesTable renders one `Table` labelled "Signatures" for the whole
    // record's evidence; the older 'Immutable signatures' label is gone, and the
    // name cell holds the recorded signer name alone.
    const table = page.getByRole('table', { name: 'Signatures' })
    await expect(
      table.getByRole('cell', { name: 'Fixture Author', exact: true }),
    ).toBeVisible()
    await expect(
      table.getByRole('cell', { name: 'Signing Fixture Witness', exact: true }),
    ).toBeVisible()
    await expect(table).not.toContainText('Renamed current author profile')
    await expect(
      table.getByRole('cell', { name: 'Authored', exact: true }),
    ).toBeVisible()
    await expect(
      table.getByRole('cell', { name: 'Witnessed', exact: true }),
    ).toBeVisible()
    await expect(
      table.getByText(evidence.rows[0].id, { exact: true }),
    ).toBeVisible()
    await expect(
      table.getByText(witnessEvidence.rows[0].id, { exact: true }),
    ).toBeVisible()
    // The table states what the evidence binds to by naming the frozen version
    // rather than printing the digest per row; the digest each signature
    // carries is asserted from api.signatures above, and the panel that shows
    // it is the review page.
    await expect(
      page
        .getByRole('region', { name: 'Signatures' })
        .getByText(
          'Each signature was made with a password re-entry and is bound to version 1 of this record.',
          { exact: true },
        ),
    ).toBeVisible()
    await expect(table.locator('time')).toHaveCount(2)
    await page.screenshot({
      path: '.amp/in/artifacts/rev02-immutable-signatures-wide.png',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await table.evaluate(
        (element) =>
          element.parentElement!.scrollWidth >
          element.parentElement!.clientWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: '.amp/in/artifacts/rev02-immutable-signatures-narrow.png',
    })
    const horizontalOffset = await table.locator('..').evaluate((element) => {
      element.scrollTo({ left: element.scrollWidth })
      return element.scrollLeft
    })
    expect(horizontalOffset).toBeGreaterThan(0)
    await page.screenshot({
      path: '.amp/in/artifacts/rev02-immutable-signatures-narrow-digest.png',
    })
  } finally {
    await reviewerContext.close()
    await witnessContext.close()
  }
})

test('REV-09 and REV-10 a signed notebook shows its signatures and audit trail, and is amended only with a stated reason', async ({
  page,
}) => {
  test.setTimeout(90_000)
  // The first test signed `record` with the approving meaning, which locks it.
  expect(
    (
      await admin.query('select locked_at from api.records where id=$1', [
        record,
      ])
    ).rows[0].locked_at,
  ).not.toBeNull()

  // REV-09: QA reads the signatures and the audit trail of the locked record.
  await signInAsDesignUser(page, signer)
  await page.goto(`/experiments/${record}/signatures`)
  const table = page.getByRole('table', { name: 'Signatures' })
  await expect(
    table.getByRole('cell', { name: signerName, exact: true }).first(),
  ).toBeVisible()
  await page.goto(`/settings/audit?record=${record}`)
  await expect(page.getByText('EXP-REV03-BROWSER').first()).toBeVisible()

  // REV-10: the author reopens it. A reason is required.
  await signInAsDesignUser(page, author)
  await page.goto(`/experiments/${record}/notebook`)
  await expect(page.getByText(/Scientific evidence is frozen/)).toBeVisible()
  await page.getByRole('button', { name: 'Amend', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Amend notebook' })
  await expect(
    dialog.getByRole('button', { name: 'Confirm amendment' }),
  ).toBeDisabled()
  await dialog
    .getByLabel('Reason for the amendment')
    .fill('Correct the plate layout noted in review.')
  await dialog.getByRole('button', { name: 'Confirm amendment' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/Scientific evidence is frozen/)).toHaveCount(0)
  expect(
    (
      await admin.query('select locked_at from api.records where id=$1', [
        record,
      ])
    ).rows[0].locked_at,
  ).toBeNull()
})
