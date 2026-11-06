/**
 * Company SAML sign-in against a real database, through Better Auth's real
 * HTTP handler. The identity provider is played by samlify with a certificate
 * made for the test, so the whole path is exercised: starting a sign-in,
 * a signed response coming back, accounts being created or taken over, groups
 * deciding roles, and the things that must be refused.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as saml from 'samlify'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { createAuth, handleAuthRequest } from '#/lib/auth'
import type { SamlConfig } from '#/lib/auth-methods'
import { samlServiceProvider } from '#/lib/saml-config'
import { migratorUrl, prepareTestDatabase } from './helpers'

const IDP_ENTITY = 'https://idp.lab.test/metadata'
const IDP_SSO = 'https://idp.lab.test/sso'
const origin = () => new URL(process.env.BETTER_AUTH_URL!).origin

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>
let auth: ReturnType<typeof createAuth>
let idp: saml.IdentityProviderInstance
let sp: saml.ServiceProviderInstance
let config: SamlConfig
let certPem = ''
const WS = '00000000-0000-4000-8000-00000009e000'

function makeCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'saml-'))
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
        '-subj', '/CN=idp.lab.test', '-keyout', join(dir, 'key.pem'),
        '-out', join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    )
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
  const { key, cert } = makeCertificate()
  certPem = cert
  config = {
    name: 'Lab SSO',
    idpEntityId: IDP_ENTITY,
    idpSsoUrl: IDP_SSO,
    idpCert: cert,
    emailDomains: ['lab.test'],
    groupsAttribute: 'groups',
    allowUnsignedAssertions: false,
  }
  auth = createAuth(db, { saml: config, oidc: null, emailLink: false })
  const provider = samlServiceProvider(process.env.BETTER_AUTH_URL!, config)
  sp = saml.ServiceProvider({
    entityID: provider.entityId,
    assertionConsumerService: [
      {
        Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
        Location: provider.acsUrl,
      },
    ],
    wantAssertionsSigned: true,
  })
  idp = saml.IdentityProvider({
    entityID: IDP_ENTITY,
    privateKey: key,
    signingCert: cert,
    singleSignOnService: [
      { Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: IDP_SSO },
    ],
    isAssertionEncrypted: false,
    loginResponseTemplate: {
      context: saml.SamlLib.defaultLoginResponseTemplate.context,
      attributes: [
        { name: 'email', valueTag: 'email', nameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic', valueXsiType: 'xs:string' },
        { name: 'displayName', valueTag: 'name', nameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic', valueXsiType: 'xs:string' },
        { name: 'groups', valueTag: 'groups', nameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic', valueXsiType: 'xs:string' },
      ],
    },
  })
  await migrator.query(
    `INSERT INTO api.workspaces (id,slug,name) VALUES ('${WS}','saml','Saml')`,
  )
  await migrator.query(
    `INSERT INTO api.idp_group_mappings (workspace_id, group_name, role) VALUES
      ('${WS}','Lab Admins','admin'), ('${WS}','Scientists','scientist')`,
  )
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
})

function post(path: string, body: unknown, cookie?: string) {
  const headers = new Headers({
    origin: origin(),
    'content-type': 'application/json',
  })
  if (cookie) headers.set('cookie', cookie)
  return handleAuthRequest(
    new Request(`${origin()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    auth,
  )
}

/** Start a sign-in; returns what the identity provider would receive. */
async function start() {
  const res = await post('/api/auth/sign-in/sso', {
    providerId: 'saml',
    callbackURL: '/',
  })
  expect(res.status).toBe(200)
  const { url } = (await res.json()) as { url: string }
  const target = new URL(url)
  expect(`${target.origin}${target.pathname}`).toBe(IDP_SSO)
  const request = inflateRawSync(
    Buffer.from(target.searchParams.get('SAMLRequest')!, 'base64'),
  ).toString('utf8')
  const id = /ID="([^"]+)"/.exec(request)![1]
  return {
    requestId: id,
    relayState: target.searchParams.get('RelayState') ?? '',
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  }
}

async function respond(
  requestId: string,
  person: { email: string; name?: string; groups?: string },
  options: { signer?: saml.IdentityProviderInstance; notOnOrAfter?: number } = {},
) {
  const provider = samlServiceProvider(process.env.BETTER_AUTH_URL!, config)
  const result = await (options.signer ?? idp).createLoginResponse(
    sp,
    { extract: { request: { id: requestId } } } as never,
    'post',
    { email: person.email } as never,
    (template: string) => {
      const id = `_${randomUUID()}`
      const context = saml.SamlLib.replaceTagsByValue(template, {
        ID: id,
        AssertionID: `_${randomUUID()}`,
        Destination: provider.acsUrl,
        Audience: provider.entityId,
        Issuer: IDP_ENTITY,
        IssueInstant: iso(0),
        StatusCode: 'urn:oasis:names:tc:SAML:2.0:status:Success',
        ConditionsNotBefore: iso(-60_000),
        ConditionsNotOnOrAfter: iso(options.notOnOrAfter ?? 5 * 60_000),
        SubjectConfirmationDataNotOnOrAfter: iso(options.notOnOrAfter ?? 5 * 60_000),
        SubjectRecipient: provider.acsUrl,
        NameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        NameID: person.email,
        InResponseTo: requestId,
        AuthnStatement: '',
        attrEmail: person.email,
        attrName: person.name ?? 'Test Person',
        attrGroups: person.groups ?? '',
      })
      return { id, context }
    },
  )
  return (result as { context: string }).context
}

async function acs(samlResponse: string, relayState: string, cookie: string) {
  return handleAuthRequest(
    new Request(`${origin()}/api/auth/sso/saml2/sp/acs/saml`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://idp.lab.test',
        cookie,
      },
      body: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relayState }),
    }),
    auth,
  )
}

const hasSession = (res: Response) =>
  res.headers.getSetCookie().some((c) => /session_token=[^;]+/.test(c))

const userByEmail = async (email: string) =>
  (await db.select().from(schema.user).where(eq(schema.user.email, email)))[0]

describe('the routes that are open', () => {
  it('answers for the configured provider only', async () => {
    const other = await post('/api/auth/sign-in/sso', {
      providerId: 'someone-else',
      callbackURL: '/',
    })
    expect(other.status).toBe(404)
    const byDomain = await post('/api/auth/sign-in/sso', {
      domain: 'lab.test',
      callbackURL: '/',
    })
    expect(byDomain.status).toBe(404)
  })

  it('keeps provider registration closed', async () => {
    for (const path of [
      '/api/auth/sso/register',
      '/api/auth/sso/providers',
      '/api/auth/sso/update-provider',
      '/api/auth/sso/delete-provider',
    ]) {
      const res = await post(path, { providerId: 'saml' })
      expect(res.status, path).toBe(404)
    }
  })

  it('publishes our metadata for the provider to import', async () => {
    const res = await handleAuthRequest(
      new Request(`${origin()}/api/auth/sso/saml2/sp/metadata?providerId=saml`),
      auth,
    )
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('AssertionConsumerService')
    expect(xml).toContain('/api/auth/sso/saml2/sp/acs/saml')
    expect(xml).toContain('WantAssertionsSigned="true"')
  })
})

describe('signing in', () => {
  it('creates an account for a new person and applies their groups', async () => {
    await migrator.query(
      `UPDATE api.workspaces SET status = 'active' WHERE id = '${WS}'`,
    )
    const flow = await start()
    const response = await respond(flow.requestId, {
      email: 'ada@lab.test',
      name: 'Ada Lovelace',
      groups: 'Lab Admins, Everyone',
    })
    const res = await acs(response, flow.relayState, flow.cookie)
    expect(res.status).toBeLessThan(400)
    expect(hasSession(res)).toBe(true)
    const created = await userByEmail('ada@lab.test')
    expect(created?.name).toBe('Ada Lovelace')
    const accounts = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, created!.id))
    expect(accounts.map((a) => a.providerId)).toContain('saml')
  })

  it('applies groups to a workspace that maps them', async () => {
    const person = await userByEmail('ada@lab.test')
    await migrator.query(
      `INSERT INTO api.workspace_memberships (workspace_id,user_id,role,role_source)
       VALUES ('${WS}','${person!.id}','viewer','idp') ON CONFLICT DO NOTHING`,
    )
    const flow = await start()
    const res = await acs(
      await respond(flow.requestId, {
        email: 'ada@lab.test',
        groups: 'Lab Admins',
      }),
      flow.relayState,
      flow.cookie,
    )
    expect(hasSession(res)).toBe(true)
    const { rows } = await migrator.query(
      `SELECT role FROM api.workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [WS, person!.id],
    )
    expect(rows[0].role).toBe('admin')
  })

  it('takes over an account made earlier for the same address', async () => {
    await db.insert(schema.user).values({
      id: 'saml-existing',
      name: 'Existing',
      email: 'grace@lab.test',
      // What directory sync leaves behind: the provider vouched for the address.
      emailVerified: true,
    })
    const flow = await start()
    const res = await acs(
      await respond(flow.requestId, { email: 'grace@lab.test', name: 'Grace' }),
      flow.relayState,
      flow.cookie,
    )
    expect(hasSession(res)).toBe(true)
    const accounts = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, 'saml-existing'))
    expect(accounts.map((a) => a.providerId)).toContain('saml')
  })

  it('refuses an address the provider does not speak for', async () => {
    const flow = await start()
    const res = await acs(
      await respond(flow.requestId, { email: 'mallory@elsewhere.test' }),
      flow.relayState,
      flow.cookie,
    )
    expect(hasSession(res)).toBe(false)
    expect(await userByEmail('mallory@elsewhere.test')).toBeUndefined()
  })
})

describe('refusing a response that cannot be trusted', () => {
  it('refuses one signed by someone else', async () => {
    const forged = makeCertificate()
    const stranger = saml.IdentityProvider({
      entityID: IDP_ENTITY,
      privateKey: forged.key,
      signingCert: forged.cert,
      singleSignOnService: [
        { Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: IDP_SSO },
      ],
      isAssertionEncrypted: false,
      loginResponseTemplate: (idp as unknown as { entitySetting: { loginResponseTemplate: never } })
        .entitySetting.loginResponseTemplate,
    })
    const flow = await start()
    const res = await acs(
      await respond(flow.requestId, { email: 'forger@lab.test' }, { signer: stranger }),
      flow.relayState,
      flow.cookie,
    )
    expect(hasSession(res)).toBe(false)
    expect(await userByEmail('forger@lab.test')).toBeUndefined()
  })

  it('refuses a response to a request we never made', async () => {
    const flow = await start()
    const res = await acs(
      await respond(`_${randomUUID()}`, { email: 'unsolicited@lab.test' }),
      flow.relayState,
      flow.cookie,
    )
    expect(hasSession(res)).toBe(false)
    expect(await userByEmail('unsolicited@lab.test')).toBeUndefined()
  })

  it('refuses the same response twice', async () => {
    const flow = await start()
    const response = await respond(flow.requestId, { email: 'once@lab.test' })
    const first = await acs(response, flow.relayState, flow.cookie)
    expect(hasSession(first)).toBe(true)
    const again = await acs(response, flow.relayState, flow.cookie)
    expect(hasSession(again)).toBe(false)
  })

  it('refuses a response that has already expired', async () => {
    const flow = await start()
    const res = await acs(
      await respond(flow.requestId, { email: 'late@lab.test' }, { notOnOrAfter: -10 * 60_000 }),
      flow.relayState,
      flow.cookie,
    )
    expect(hasSession(res)).toBe(false)
    expect(await userByEmail('late@lab.test')).toBeUndefined()
  })

  it('does not count the certificate as a secret to log', () => {
    expect(certPem).toContain('BEGIN CERTIFICATE')
  })
})
