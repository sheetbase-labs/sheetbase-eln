import { describe, expect, it } from 'vitest'

import {
  mayCreateByEmailLink,
  parseAllowedDomains,
  readAuthMethods,
  readOidcConfig,
} from '#/lib/auth-methods'

const oidcEnv = {
  OIDC_ISSUER_URL: 'https://login.example.com/realms/lab/',
  OIDC_CLIENT_ID: 'sheetbase',
  OIDC_CLIENT_SECRET: 'secret',
}

describe('readAuthMethods', () => {
  it('offers nothing until a method is fully configured', () => {
    expect(readAuthMethods({})).toEqual({
      github: false,
      oidc: null,
      emailLink: false,
    })
    expect(
      readAuthMethods({ OIDC_CLIENT_ID: 'x', GITHUB_CLIENT_ID: 'y' }),
    ).toEqual({ github: false, oidc: null, emailLink: false })
  })

  it('names the company provider and trims the issuer', () => {
    expect(
      readAuthMethods({ ...oidcEnv, OIDC_PROVIDER_NAME: 'Acme SSO' }).oidc,
    ).toEqual({ name: 'Acme SSO' })
    expect(readOidcConfig(oidcEnv)?.issuerUrl).toBe(
      'https://login.example.com/realms/lab',
    )
    expect(readOidcConfig(oidcEnv)?.name).toBe('Company SSO')
  })

  it('shows email sign-in only when mail can actually be sent', () => {
    expect(readAuthMethods({ EMAIL_LOGIN_ENABLED: 'true' }).emailLink).toBe(
      false,
    )
    expect(
      readAuthMethods({
        EMAIL_LOGIN_ENABLED: 'true',
        SMTP_HOST: 'smtp.example.com',
      }).emailLink,
    ).toBe(true)
    expect(readAuthMethods({ SMTP_HOST: 'smtp.example.com' }).emailLink).toBe(
      false,
    )
  })
})

describe('email sign-up domains', () => {
  it('parses a comma-separated list', () => {
    expect(parseAllowedDomains(' Example.com, @lab.test ,,')).toEqual([
      'example.com',
      'lab.test',
    ])
    expect(parseAllowedDomains(undefined)).toEqual([])
  })

  it('lets only listed domains create accounts', () => {
    const domains = ['example.com']
    expect(mayCreateByEmailLink('a@Example.com', domains)).toBe(true)
    expect(mayCreateByEmailLink('a@evil.example.com', domains)).toBe(false)
    expect(mayCreateByEmailLink('a@example.com.evil.test', domains)).toBe(false)
    expect(mayCreateByEmailLink('no-at-sign', domains)).toBe(false)
    expect(mayCreateByEmailLink('a@example.com', [])).toBe(false)
  })
})
