/**
 * Which sign-in methods an environment offers, read from configuration alone
 * so the sign-in screen, the auth server and the tests agree on one answer.
 */
export interface OidcConfig {
  issuerUrl: string
  clientId: string
  clientSecret: string
  name: string
  /** The claim that lists the person's groups; `groups` when not named. */
  groupsClaim?: string
  /** Scopes to ask for besides openid, email and profile (some providers need `groups`). */
  extraScopes?: string[]
}

/**
 * Company single sign-on over SAML 2.0. Configured from the environment like
 * OIDC: one identity provider per installation. Everyone who signs in this way
 * must have an address in `emailDomains`; those are the domains the provider is
 * trusted to speak for, which is also what lets a SAML sign-in take over an
 * account that already exists for that address.
 */
export interface SamlConfig {
  name: string
  /** The provider's metadata XML, or else its entity id, sign-in URL and certificate. */
  idpMetadata?: string
  idpEntityId?: string
  idpSsoUrl?: string
  idpCert?: string
  emailDomains: string[]
  /** Our entity id; the metadata address by default. */
  spEntityId?: string
  emailAttribute?: string
  nameAttribute?: string
  /** The attribute that lists the person's groups. */
  groupsAttribute?: string
  /** Accept assertions the provider did not sign as a whole (default: refuse). */
  allowUnsignedAssertions: boolean
}

export interface AuthMethods {
  github: boolean
  oidc: { name: string } | null
  saml: { name: string } | null
  emailLink: boolean
}

export interface AuthMethodEnv {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  OIDC_ISSUER_URL?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  OIDC_PROVIDER_NAME?: string
  OIDC_GROUPS_CLAIM?: string
  OIDC_EXTRA_SCOPES?: string
  SAML_PROVIDER_NAME?: string
  SAML_IDP_METADATA?: string
  SAML_IDP_ENTITY_ID?: string
  SAML_IDP_SSO_URL?: string
  SAML_IDP_CERT?: string
  SAML_EMAIL_DOMAINS?: string
  SAML_SP_ENTITY_ID?: string
  SAML_EMAIL_ATTRIBUTE?: string
  SAML_NAME_ATTRIBUTE?: string
  SAML_GROUPS_ATTRIBUTE?: string
  SAML_ALLOW_UNSIGNED_ASSERTIONS?: string
  EMAIL_LOGIN_ENABLED?: string
  SMTP_HOST?: string
}

export const OIDC_PROVIDER_ID = 'oidc'
export const SAML_PROVIDER_ID = 'saml'

/** A certificate pasted into an environment variable often loses its line breaks. */
export function normalisePem(value: string): string {
  const trimmed = value.trim().replace(/\\n/g, '\n')

  if (trimmed.includes('-----BEGIN')) return trimmed

  return `-----BEGIN CERTIFICATE-----\n${trimmed.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`
}

export function readSamlConfig(env: AuthMethodEnv): SamlConfig | null {
  const metadata = env.SAML_IDP_METADATA?.trim()
  const ssoUrl = env.SAML_IDP_SSO_URL?.trim()
  const cert = env.SAML_IDP_CERT?.trim()
  const entityId = env.SAML_IDP_ENTITY_ID?.trim()
  const manual = Boolean(ssoUrl && cert && entityId)

  if (!metadata && !manual) return null
  const emailDomains = parseAllowedDomains(env.SAML_EMAIL_DOMAINS)

  // Without a domain nobody could be matched to this provider, and a sign-in
  // could not be trusted to take over an existing account.
  if (emailDomains.length === 0) return null

  return {
    name: env.SAML_PROVIDER_NAME || 'Company SSO',
    idpMetadata: metadata || undefined,
    idpEntityId: entityId || undefined,
    idpSsoUrl: ssoUrl || undefined,
    idpCert: cert ? normalisePem(cert) : undefined,
    emailDomains,
    spEntityId: env.SAML_SP_ENTITY_ID?.trim() || undefined,
    emailAttribute: env.SAML_EMAIL_ATTRIBUTE?.trim() || undefined,
    nameAttribute: env.SAML_NAME_ATTRIBUTE?.trim() || undefined,
    groupsAttribute: env.SAML_GROUPS_ATTRIBUTE?.trim() || undefined,
    allowUnsignedAssertions: env.SAML_ALLOW_UNSIGNED_ASSERTIONS === 'true',
  }
}

export function readOidcConfig(env: AuthMethodEnv): OidcConfig | null {
  if (!env.OIDC_ISSUER_URL || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
    return null
  }

  return {
    issuerUrl: env.OIDC_ISSUER_URL.replace(/\/+$/, ''),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    name: env.OIDC_PROVIDER_NAME || 'Company SSO',
    groupsClaim: env.OIDC_GROUPS_CLAIM || undefined,
    extraScopes: (env.OIDC_EXTRA_SCOPES ?? '').split(/[\s,]+/).filter(Boolean),
  }
}

export function readAuthMethods(env: AuthMethodEnv): AuthMethods {
  const oidc = readOidcConfig(env)
  const saml = readSamlConfig(env)

  return {
    github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    oidc: oidc ? { name: oidc.name } : null,
    saml: saml ? { name: saml.name } : null,
    // A sign-in link nobody can receive is worse than no button.
    emailLink: env.EMAIL_LOGIN_ENABLED === 'true' && Boolean(env.SMTP_HOST),
  }
}

/** Lower-cased domains from a comma-separated list; blanks are dropped. */
export function parseAllowedDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

/**
 * A new account may be created by email link only from an allowed domain.
 * Existing accounts are never gated here.
 */
export function mayCreateByEmailLink(
  email: string,
  allowedDomains: string[],
): boolean {
  const at = email.lastIndexOf('@')

  if (at < 0) return false

  return allowedDomains.includes(email.slice(at + 1).toLowerCase())
}
