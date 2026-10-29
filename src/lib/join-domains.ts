/**
 * Joining a workspace through an email domain. An admin lists the lab's
 * domains; anyone who signs in with a verified address on one is added to that
 * workspace. The database holds every rule (`api.set_join_domains`,
 * `api.my_join_offer`); these wrappers only shape the calls and the messages.
 */
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'

/** The roles a domain can add people as. */
export const JOIN_ROLES = [
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const
export type JoinRole = (typeof JOIN_ROLES)[number]

export interface JoinDomainRow {
  domain: string
  role: JoinRole
}

export interface JoinOffer {
  workspace_id: string
  workspace_name: string
  domain: string
  role: JoinRole
}

/**
 * Public mail domains, mirrored from `internal.public_email_domain` so the
 * settings card never offers one. The database is what refuses them.
 */
const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'qq.com',
  '163.com',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'users.noreply.github.com',
])

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase())
}

export const joinDomainKeys = {
  list: (workspaceId: string) => ['join-domains', workspaceId] as const,
  offer: ['join-offer'] as const,
}

/** `dana@Acme-Bio.com` → `acme-bio.com`; empty when there is no domain. */
export function emailDomainOf(email: string | null | undefined): string {
  const at = (email ?? '').lastIndexOf('@')
  return at < 0
    ? ''
    : (email ?? '')
        .slice(at + 1)
        .trim()
        .toLowerCase()
}

/** What someone typed into the domain box: `@Acme-Bio.com` → `acme-bio.com`. */
export function normaliseDomainInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^.*@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

const DOMAIN_SHAPE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export function isDomainShaped(domain: string): boolean {
  return DOMAIN_SHAPE.test(domain)
}

export async function fetchJoinDomains(
  client: DataClient,
): Promise<JoinDomainRow[]> {
  return client.list<JoinDomainRow>(
    'workspace_join_domains',
    '?select=domain,role&order=domain.asc',
  )
}

export async function setJoinDomains(
  client: DataClient,
  input: { workspaceId: string; domains: string[]; role: JoinRole },
): Promise<void> {
  await client.rpc('set_join_domains', {
    p_workspace_id: input.workspaceId,
    p_domains: input.domains,
    p_role: input.role,
  })
}

export async function fetchJoinOffer(
  client: DataClient,
): Promise<JoinOffer | null> {
  const rows = await client.rpc<JoinOffer[] | JoinOffer | null>(
    'my_join_offer',
    {},
  )
  if (!rows) return null
  return Array.isArray(rows) ? (rows[0] ?? null) : rows
}

/** Joins the workspace the person's email domain opens and returns its id. */
export async function joinMyDomainWorkspace(
  client: DataClient,
): Promise<string> {
  return client.rpc<string>('join_my_domain_workspace', {})
}

export function describeJoinDomainError(error: unknown): string {
  if (!(error instanceof DataClientError)) {
    return t('settings.joinDomains.errorGeneric')
  }
  switch (error.code) {
    case 'SB210':
      return t('settings.joinDomains.errorPublic')
    case 'SB211':
      return t('settings.joinDomains.errorTaken')
    case 'SB212':
      return t('settings.joinDomains.errorNotYours')
    case 'SB213':
      return t('settings.joinDomains.errorNothingToJoin')
    case '42501':
      return t('settings.joinDomains.errorNotAllowed')
    default:
      return t('settings.joinDomains.errorGeneric')
  }
}
