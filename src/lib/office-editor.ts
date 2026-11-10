/**
 * Optional browser editor for Office files (Collabora Online over WOPI).
 *
 * Off unless OFFICE_EDITOR_URL is set. This module holds the parts that need no
 * network or database so they are unit-testable: which files the editor opens,
 * the short-lived access token a WOPI call carries, reading Collabora's
 * discovery document, and the in-process file locks WOPI asks for.
 */
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'

import { hmacKey } from './hmac-key'

/** Extensions Collabora opens for editing. Legacy .doc/.xls/.ppt are included:
 * the editor reads them and saves back in the same format. */
const EDITABLE_EXTENSIONS = [
  'docx',
  'doc',
  'odt',
  'xlsx',
  'xls',
  'ods',
  'pptx',
  'ppt',
  'odp',
] as const

export type EditableExtension = (typeof EDITABLE_EXTENSIONS)[number]

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')

  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

const editableExtensionSchema = z.enum(EDITABLE_EXTENSIONS)

/** The extension the editor would open this file with, or null. */
export function editableExtension(name: string): EditableExtension | null {
  const ext = editableExtensionSchema.safeParse(fileExtension(name))

  return ext.success ? ext.data : null
}

export interface OfficeEditorConfig {
  /** Public address of Collabora, without a trailing slash. */
  editorUrl: string
  /** Address Collabora uses to call this app's WOPI endpoints. */
  wopiHostUrl: string
}

/** The editor settings, or null when the editor is not configured. */
export function officeEditorConfig(env: {
  OFFICE_EDITOR_URL?: string
  OFFICE_EDITOR_WOPI_HOST_URL?: string
  BETTER_AUTH_URL: string
}): OfficeEditorConfig | null {
  if (!env.OFFICE_EDITOR_URL) return null

  return {
    editorUrl: env.OFFICE_EDITOR_URL.replace(/\/+$/, ''),
    wopiHostUrl: (
      env.OFFICE_EDITOR_WOPI_HOST_URL ?? env.BETTER_AUTH_URL
    ).replace(/\/+$/, ''),
  }
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

export interface WopiTokenClaims {
  fileRecordId: string
  userId: string
  userName: string
  workspaceId: string
  sessionId: string
  /** Whether this token may save. Fixed when the token is issued. */
  canWrite: boolean
  /** The record (experiment) the file was opened from. A save is refused once
   * that record is signed or archived. */
  hostRecordId?: string
}

/** Editing sessions can run long; the token only reaches one file. */
export const WOPI_TOKEN_TTL_SECONDS = 8 * 60 * 60

/**
 * The token is signed with a key derived from the server secret, so it can
 * never double as a PostgREST token: PostgREST verifies with the plain secret
 * and rejects it.
 */
function wopiSecret(secret: string): string {
  return `wopi-access\u0000${secret}`
}

export async function signWopiToken(
  secret: string,
  claims: WopiTokenClaims,
  ttlSeconds = WOPI_TOKEN_TTL_SECONDS,
): Promise<string> {
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('wopi')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(await hmacKey(wopiSecret(secret), 'sign'))
}

/** The claims a WOPI token carries, as `signWopiToken` issues them. */
const WOPI_CLAIMS = z.object({
  fileRecordId: z.string(),
  userId: z.string(),
  userName: z.string().nullish(),
  workspaceId: z.string(),
  sessionId: z.string(),
  canWrite: z.boolean().nullish(),
  hostRecordId: z.string().nullish(),
})

export async function verifyWopiToken(
  secret: string,
  token: string,
): Promise<WopiTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      await hmacKey(wopiSecret(secret), 'verify'),
      { audience: 'wopi' },
    )

    const claims = WOPI_CLAIMS.safeParse(payload)

    if (!claims.success) return null

    return {
      fileRecordId: claims.data.fileRecordId,
      userId: claims.data.userId,
      userName: claims.data.userName ?? claims.data.userId,
      workspaceId: claims.data.workspaceId,
      sessionId: claims.data.sessionId,
      canWrite: claims.data.canWrite === true,
      hostRecordId: claims.data.hostRecordId ?? undefined,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Reads the editor address for `ext` out of Collabora's discovery document.
 * Attributes are matched by name, so their order in the XML does not matter.
 */
export function editorActionUrl(
  discoveryXml: string,
  ext: string,
  action: 'edit' | 'view' = 'edit',
): string | null {
  for (const tag of discoveryXml.matchAll(/<action\b[^>]*>/g)) {
    const attrs = new Map<string, string>()

    for (const m of tag[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs.set(m[1], m[2])
    }

    if (attrs.get('ext') === ext && attrs.get('name') === action) {
      const url = attrs.get('urlsrc')

      if (url) return url.replace(/&amp;/g, '&')
    }
  }

  return null
}

let discoveryCache: { url: string; xml: string; at: number } | null = null
const DISCOVERY_TTL_MS = 10 * 60 * 1000

export async function fetchDiscovery(
  editorUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const now = Date.now()

  if (
    discoveryCache &&
    discoveryCache.url === editorUrl &&
    now - discoveryCache.at < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.xml
  }

  const res = await fetcher(`${editorUrl}/hosting/discovery`, {
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) throw new Error(`editor discovery answered ${res.status}`)
  const xml = await res.text()
  discoveryCache = { url: editorUrl, xml, at: now }

  return xml
}

/** The address the iframe form posts to: the editor's own URL plus WOPISrc. */
export function editorFormAction(urlsrc: string, wopiSrc: string): string {
  const sep = urlsrc.includes('?') ? (urlsrc.endsWith('?') ? '' : '&') : '?'

  return `${urlsrc}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

const LOCK_TTL_MS = 30 * 60 * 1000

/**
 * WOPI file locks, held in this process. Collabora takes a lock when a
 * document opens and refreshes it while people edit; a lock that is not
 * refreshed lapses after 30 minutes, so a restart only costs a re-lock.
 */
export class WopiLocks {
  private held = new Map<string, { lock: string; expires: number }>()

  constructor(private now: () => number = Date.now) {}

  current(fileId: string): string | null {
    const entry = this.held.get(fileId)

    if (!entry) return null

    if (entry.expires <= this.now()) {
      this.held.delete(fileId)

      return null
    }

    return entry.lock
  }

  /** Takes or re-takes the lock. Returns the conflicting lock, if any. */
  lock(
    fileId: string,
    lock: string,
  ): { ok: true } | { ok: false; held: string } {
    const current = this.current(fileId)

    if (current !== null && current !== lock)
      return { ok: false, held: current }
    this.held.set(fileId, { lock, expires: this.now() + LOCK_TTL_MS })

    return { ok: true }
  }

  refresh(fileId: string, lock: string) {
    const current = this.current(fileId)

    if (current !== lock) return { ok: false as const, held: current ?? '' }
    this.held.set(fileId, { lock, expires: this.now() + LOCK_TTL_MS })

    return { ok: true as const }
  }

  unlock(fileId: string, lock: string) {
    const current = this.current(fileId)

    if (current !== lock) return { ok: false as const, held: current ?? '' }
    this.held.delete(fileId)

    return { ok: true as const }
  }

  /** A save may go ahead when nothing holds the file or the caller's lock does. */
  allowsWrite(fileId: string, lock: string | null): boolean {
    const current = this.current(fileId)

    return current === null || current === lock
  }
}

export const wopiLocks = new WopiLocks()
