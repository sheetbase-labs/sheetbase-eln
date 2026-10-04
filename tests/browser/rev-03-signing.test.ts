/**
 * REV-03 acceptance against the real app and PostgREST, without route mocks.
 * Session rows and native Better Auth credentials are fixture preparation,
 * not OAuth/IdP or product credential-enrolment acceptance. Independent
 * verification, consent, password proof, practice and signing use real HTTP.
 * Run with auth-free mode disabled and a freshly migrated local database.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
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
    'insert into api.projects(id,workspace_id,key,title) values($1,$2,$3,$4)',
    [project, workspace, `REV03-${workspace}`, 'Signing acceptance'],
  )
  await admin.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) values($1,$2,$3,'experiment','EXP-REV03-BROWSER','Password signing acceptance','draft',$4)`,
    [record, workspace, project, author],
  )
  const secret = z.string().min(32).parse(process.env.BETTER_AUTH_SECRET)
  const token = `parity-${signer}`
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  const { createAuth } = await import('#/lib/auth')
  await createAuth(database).api.setPassword({
    headers: new Headers({
      cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
    }),
    body: { newPassword: password },
  })
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
  expect(evidence.rows).toHaveLength(1)
  expect(evidence.rows[0]).toMatchObject({
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
  ])
  expect(grants.rows.find((r) => r.purpose === 'sign').signature_meaning).toBe(
    'reviewed-and-approved',
  )
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
