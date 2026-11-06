import { describe, expect, it } from 'vitest'

import {
  mayCreateByEmailLink,
  parseAllowedDomains,
  readAuthMethods,
  readOidcConfig,
  readSamlConfig,
  normalisePem,
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
      saml: null,
      emailLink: false,
    })
    expect(
      readAuthMethods({ OIDC_CLIENT_ID: 'x', GITHUB_CLIENT_ID: 'y' }),
    ).toEqual({ github: false, oidc: null, saml: null, emailLink: false })
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

describe('readSamlConfig', () => {
  const manual = {
    SAML_IDP_ENTITY_ID: 'https://idp.example.com/metadata',
    SAML_IDP_SSO_URL: 'https://idp.example.com/sso',
    SAML_IDP_CERT: 'MIIB',
    SAML_EMAIL_DOMAINS: '@Lab.org, lab.test',
  }

  it('needs the provider, its certificate and the domains it speaks for', () => {
    expect(readSamlConfig({})).toBeNull()
    expect(readSamlConfig({ ...manual, SAML_IDP_CERT: undefined })).toBeNull()
    expect(
      readSamlConfig({ ...manual, SAML_EMAIL_DOMAINS: undefined }),
    ).toBeNull()
    expect(readSamlConfig(manual)).toMatchObject({
      name: 'Company SSO',
      emailDomains: ['lab.org', 'lab.test'],
      allowUnsignedAssertions: false,
    })
  })

  it('accepts the provider’s metadata instead', () => {
    expect(
      readSamlConfig({
        SAML_IDP_METADATA: '<EntityDescriptor/>',
        SAML_EMAIL_DOMAINS: 'lab.org',
        SAML_PROVIDER_NAME: 'Acme',
        SAML_GROUPS_ATTRIBUTE: 'memberOf',
      }),
    ).toMatchObject({
      idpMetadata: '<EntityDescriptor/>',
      name: 'Acme',
      groupsAttribute: 'memberOf',
    })
  })

  it('shows up as a sign-in method', () => {
    expect(
      readAuthMethods({ ...manual, SAML_PROVIDER_NAME: 'Acme' }).saml,
    ).toEqual({ name: 'Acme' })
  })

  it('wraps a bare certificate and repairs escaped line breaks', () => {
    expect(normalisePem('MIIB')).toBe(
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    )
    expect(
      normalisePem(
        '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----',
      ),
    ).toContain('\nMIIB\n')
  })
})
