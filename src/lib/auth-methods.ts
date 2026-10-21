/**
 * Which sign-in methods an environment offers, read from configuration alone
 * so the sign-in screen, the auth server and the tests agree on one answer.
 */
export interface OidcConfig {
  issuerUrl: string
  clientId: string
  clientSecret: string
  name: string
}

export interface AuthMethods {
  github: boolean
  oidc: { name: string } | null
  emailLink: boolean
}

export interface AuthMethodEnv {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  OIDC_ISSUER_URL?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  OIDC_PROVIDER_NAME?: string
  EMAIL_LOGIN_ENABLED?: string
  SMTP_HOST?: string
}

export const OIDC_PROVIDER_ID = 'oidc'

export function readOidcConfig(env: AuthMethodEnv): OidcConfig | null {
  if (!env.OIDC_ISSUER_URL || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
    return null
  }
  return {
    issuerUrl: env.OIDC_ISSUER_URL.replace(/\/+$/, ''),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    name: env.OIDC_PROVIDER_NAME || 'Company SSO',
  }
}

export function readAuthMethods(env: AuthMethodEnv): AuthMethods {
  const oidc = readOidcConfig(env)
  return {
    github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    oidc: oidc ? { name: oidc.name } : null,
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
