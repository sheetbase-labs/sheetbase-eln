/**
 * REV-03 acceptance against the real app and PostgREST, without route mocks.
 * Session rows and native Better Auth credentials are fixture preparation,
 * not OAuth/IdP or product credential-enrolment acceptance. Independent
 * verification, consent, password proof, practice and signing use real HTTP.
 * Run with auth-free mode disabled and a freshly migrated local database.
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

config({ path: ['.env.local', '.env'] })
const workspace = randomUUID()
const project = randomUUID()
const record = randomUUID()
const controlledRecord = randomUUID()
const signer = `rev03-signer-${workspace}`
const verifier = `rev03-verifier-${workspace}`
const author = `rev03-author-${workspace}`
const signerName = 'Signing Fixture Reviewer'
const signerEmail = `${signer}@sheetbase.test`
const password = 'rev03-browser-fixture-password'
let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let submission: { id: string; revisionId: string; digest: string }

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
    ($1,$2,$3,true),($4,'Verification Fixture Admin',$5,true),($6,'Fixture Author',$7,true)`,
    [
      signer,
      signerName,
      signerEmail,
      verifier,
      `${verifier}@sheetbase.test`,
      author,
      `${author}@sheetbase.test`,
    ],
  )
  for (const user of [signer, verifier, author])
    await admin.query(
      `insert into internal.session(id,token,"userId","expiresAt") values($1,$1,$2,now()+interval '12 hours')`,
      [`parity-${user}`, user],
    )
  await admin.query(
    'insert into api.workspaces(id,slug,name) values($1,$2,$3)',
    [workspace, `rev03-${workspace}`, 'REV-03 HTTP acceptance'],
  )
  await admin.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'admin'),($1,$4,'member')`,
    [workspace, signer, verifier, author],
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
  const secret = z.string().min(32).parse(process.env.BETTER_AUTH_SECRET)
  const { createAuth } = await import('#/lib/auth')
  for (const user of [signer, author, verifier]) {
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
    await admin.query('delete from api.workspaces where id=$1', [workspace])
    await admin.query('delete from internal."user" where id=any($1::text[])', [
      [signer, verifier, author],
    ])
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

test('independent certification, practice, password focus and exact-digest signing use real HTTP', async ({
  page,
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Browser base URL required')
  await signInAsDesignUser(page, signer)
  const initialCertifications = page.waitForResponse(
    (response) =>
      response.url().endsWith('/rpc/workspace_signature_certifications') &&
      response.request().method() === 'POST',
  )
  await page.goto('/settings/signatures')
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
    page.getByText('Awaiting independent administrator verification.'),
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
  await page.keyboard.press('Control+Shift+Enter')
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
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('Signing password')).toBeHidden()
  await page.reload()
  await page
    .getByRole('button', { name: 'Sign revision', exact: true })
    .waitFor()
  await page.keyboard.press('Control+Shift+Enter')
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
    for (const selector of [
      '#revision-signing-password',
      '#signature-meaning',
      '#signature-confirmation',
    ]) {
      const inset = await page.locator(selector).evaluate((element) => {
        const dialog = element.closest('[role="alertdialog"]')
        if (!dialog)
          throw new Error('Signing control must be inside the alertdialog')
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
  await page.goto('/settings/signatures')
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
  await expect(
    page.getByRole('alert').filter({ hasText: 'Save your pending edits' }),
  ).toBeVisible()
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
      'You signed out of this browser. Saved changes remain in your workspace.',
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
  await page.goto('/settings/signatures')
  expect((await hydrated).status()).toBe(200)
  await page
    .getByRole('button', { name: 'Request identity verification', exact: true })
    .click()
  await expect(
    page.getByText('Awaiting independent administrator verification.'),
  ).toBeVisible()
  const verifierContext = await browser.newContext({ baseURL })
  try {
    const verifierPage = await verifierContext.newPage()
    await signInAsDesignUser(verifierPage, verifier)
    await verifierPage.goto('/settings/signatures')
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
  await page.goto(`/records/${controlledRecord}/notebook`)
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
  // Certification authority alone is not record-read authority. Give this
  // explicitly selected witness View only, through the real project owner.
  const ownerContext = await browser.newContext({ baseURL })
  try {
    const ownerPage = await ownerContext.newPage()
    await signInAsDesignUser(ownerPage, signer)
    await ownerPage.goto('/')
    const access = await post(
      ownerPage,
      '/api/db/rpc/set_project_access_rule',
      {
        p_project_id: project,
        p_user_id: verifier,
        p_group_id: null,
        p_can_view: true,
        p_can_edit: false,
        p_can_review: false,
        p_client_portal: false,
        p_can_manage: false,
      },
    )
    expect(access.status, JSON.stringify(access.body)).toBe(200)
  } finally {
    await ownerContext.close()
  }
  const readableWitnesses = page.waitForResponse((response) =>
    response.url().endsWith('/rpc/project_members'),
  )
  await page.reload()
  const membersResponse = await readableWitnesses
  expect(membersResponse.status()).toBe(200)
  const members = z
    .array(
      z.object({
        user_id: z.string(),
        can_view: z.boolean(),
        can_edit: z.boolean(),
        can_review: z.boolean(),
        client_portal: z.boolean(),
        can_manage: z.boolean(),
      }),
    )
    .parse(await membersResponse.json())
  expect(members.find((member) => member.user_id === verifier)).toEqual({
    user_id: verifier,
    can_view: true,
    can_edit: false,
    can_review: false,
    client_portal: false,
    can_manage: false,
  })
  await page
    .getByLabel('Request a witness for this frozen revision')
    .selectOption(verifier)
  const requested = page.waitForResponse((r) =>
    r.url().endsWith('/rpc/request_signature_witness'),
  )
  await page
    .getByRole('button', { name: 'Request witness', exact: true })
    .click()
  expect((await requested).status()).toBe(200)
  const witnessContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  })
  const reviewerContext = await browser.newContext({ baseURL })
  try {
    const witnessPage = await witnessContext.newPage()
    await signInAsDesignUser(witnessPage, verifier)
    const witnessHydrated = witnessPage.waitForResponse((r) =>
      r.url().endsWith('/rpc/workspace_signature_certifications'),
    )
    await witnessPage.goto('/settings/signatures')
    expect((await witnessHydrated).status()).toBe(200)
    await witnessPage
      .getByRole('button', {
        name: 'Request identity verification',
        exact: true,
      })
      .click()
    await expect(
      witnessPage.getByText('Awaiting independent administrator verification.'),
    ).toBeVisible()
    const reviewerPage = await reviewerContext.newPage()
    await signInAsDesignUser(reviewerPage, signer)
    await reviewerPage.goto(`/review/${result.revision.id}`)
    expect(
      (
        await post(reviewerPage, '/api/db/rpc/verify_signature_identity', {
          p_user_id: verifier,
          p_email: `${verifier}@sheetbase.test`,
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
    await witnessPage.reload()
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
    await witnessPage.getByRole('button', { name: /^Later · 1 items$/ }).click()
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
    await witnessPage
      .getByLabel(/Type your name/)
      .fill('Verification Fixture Admin')
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
      signer_user_id: verifier,
      signer_name: 'Verification Fixture Admin',
      signature_meaning: 'witnessed',
      auth_method: 'password',
      revision_integrity_digest: result.revision.integrityDigest,
    })
    const completedInbox = witnessPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/db/my_work_items',
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
    await page.getByRole('button', { name: /^Signatures/ }).click()
    const table = page.getByRole('table', { name: 'Immutable signatures' })
    await expect(
      table.getByRole('cell', { name: /^Fixture Author / }),
    ).toBeVisible()
    await expect(
      table.getByRole('cell', { name: /^Verification Fixture Admin / }),
    ).toBeVisible()
    await expect(table).not.toContainText('Renamed current author profile')
    await expect(table.getByRole('cell', { name: /^Authored / })).toBeVisible()
    await expect(table.getByRole('cell', { name: /^Witnessed / })).toBeVisible()
    await expect(
      table.getByText(evidence.rows[0].id, { exact: true }),
    ).toBeVisible()
    await expect(
      table.getByText(witnessEvidence.rows[0].id, { exact: true }),
    ).toBeVisible()
    await expect(
      table.getByText(result.revision.integrityDigest, { exact: true }),
    ).toHaveCount(2)
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
