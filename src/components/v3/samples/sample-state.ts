import type { SampleEvent, SampleRecord } from '#/lib/samples'

import { formatHoldDate } from './sample-hold-meter'

/**
 * LAB-02 step 3 — the truthfully-derived hold / quarantine / consumed /
 * disposal state of a sample, and the role gate for the actions the design
 * places on the sample detail.
 *
 * This module is presentation-only. PostgreSQL `api.has_capability` and the
 * `api.release_sample` / `api.quarantine_sample` / `api.dispose_sample` RPCs
 * remain the authoritative gate; the role sets below mirror the accepted SQL
 * mapping (drizzle/0282_left_micromacro.sql) so the UI does not offer an
 * action the server will refuse. Every banner field is read from stored data;
 * nothing is fabricated when a value is missing.
 */

export type SampleStateKind =
  'quarantined' | 'hold_exceeded' | 'expired' | 'consumed' | 'disposed'

export interface SampleStateBanner {
  kind: SampleStateKind
  tone: 'warn' | 'bad' | 'info'
  title: string
  body: string
}

/** The terminal/attention state the design boards (Sample…) distinguish. */
export function sampleStateKind(sample: {
  status: string
}): SampleStateKind | null {
  switch (sample.status) {
    case 'quarantined':
      return 'quarantined'
    case 'hold_exceeded':
      return 'hold_exceeded'
    case 'expired':
      return 'expired'
    case 'consumed':
      return 'consumed'
    case 'disposed':
      return 'disposed'
    default:
      return null
  }
}

/**
 * Roles authorised to release a sample. Mirrors the `sample.release` case in
 * `api.has_capability` (owner/admin/steward/scientist/reviewer).
 */
const RELEASE_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'steward',
  'scientist',
  'reviewer',
])

/**
 * Roles authorised to quarantine or dispose of a sample. Mirrors the
 * `sample.quarantine` / `sample.dispose` case (owner/admin/steward/scientist).
 */
const SCIENTIFIC_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'steward',
  'scientist',
])

/**
 * Roles that may edit details, record hold limits, receive stock and archive.
 * The edit/receive/archive RPCs have no dedicated capability, so this only
 * keeps read-only roles from being offered controls the server refuses.
 */
export function canEditSample(role: string | null | undefined): boolean {
  return role ? !['viewer', 'client_viewer'].includes(role) : false
}

export function canReleaseSample(role: string | null | undefined): boolean {
  return role ? RELEASE_ROLES.has(role) : false
}

export function canQuarantineSample(role: string | null | undefined): boolean {
  return role ? SCIENTIFIC_ROLES.has(role) : false
}

export function canDisposeSample(role: string | null | undefined): boolean {
  return role ? SCIENTIFIC_ROLES.has(role) : false
}

/**
 * Whether the Withdraw action is available in the record's lifecycle state. A
 * quarantined, past-hold, expired, consumed or disposed sample cannot be
 * withdrawn through this surface; the allowed-experiment exception is
 * server-enforced against `allowedUseExperimentIds` (SB004) and is not
 * selectable here.
 */
export function canWithdrawSample(status: string): boolean {
  return ![
    'consumed',
    'disposed',
    'quarantined',
    'hold_exceeded',
    'expired',
  ].includes(status)
}

/** A sample in a terminal state (consumed or disposed) keeps no actions. */
export function isTerminalSampleStatus(status: string): boolean {
  return status === 'consumed' || status === 'disposed'
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return formatHoldDate(date)
}

const DAY_MS = 86_400_000

/**
 * Resolve the effective hold window from the typed sample fields. Prefers the
 * parsed `holdUntil` / `holdDurationDays` / `holdStartedAt` (which
 * `toSampleRecord` lifts out of `properties`) and falls back to the legacy
 * `properties.expiryDate` for older samples.
 */
function resolveHoldWindow(sample: SampleRecord): {
  expiry: Date
  totalDays: number
  condition: string | null
} | null {
  const start = new Date(sample.holdStartedAt ?? sample.createdAt)
  if (Number.isNaN(start.getTime())) return null

  let expiry: Date | null = null
  if (sample.holdUntil) expiry = new Date(sample.holdUntil)
  else if (sample.holdDurationDays != null)
    expiry = new Date(start.getTime() + sample.holdDurationDays * DAY_MS)
  else {
    const fallback = sample.properties.expiryDate
    if (typeof fallback === 'string' && fallback.trim() !== '')
      expiry = new Date(fallback)
  }
  if (!expiry || Number.isNaN(expiry.getTime())) return null

  const windowMs = expiry.getTime() - start.getTime()
  const totalDays =
    windowMs > 0 ? Math.max(1, Math.round(windowMs / DAY_MS)) : 1
  return { expiry, totalDays, condition: sample.holdCondition ?? null }
}

function allowedUseCount(sample: SampleRecord): number {
  return sample.allowedUseExperimentIds?.length ?? 0
}

function allowedUseSentence(sample: SampleRecord): string {
  const count = allowedUseCount(sample)
  if (count === 0) return 'Remaining volume can’t be withdrawn.'
  return `Remaining volume can only be used by ${count} explicitly allowed experiment${count === 1 ? '' : 's'}.`
}

function latestEvent(
  events: SampleEvent[] | undefined,
  operations: string[],
): SampleEvent | null {
  if (!events || events.length === 0) return null
  return events.find((event) => operations.includes(event.operation)) ?? null
}

export interface DescribeSampleStateOptions {
  /** The canonical event stream, newest first (as `fetchSampleEvents` returns). */
  events?: SampleEvent[]
  /** Resolve an actor id to a display name; null when unknown. */
  userName?: (userId: string) => string | null
}

/**
 * Build the design banner for a sample's attention/terminal state, or null when
 * the sample has no such state. Pure, so the exact wording and the honest
 * missing-data paths are unit tested.
 */
export function describeSampleState(
  sample: SampleRecord,
  options: DescribeSampleStateOptions = {},
): SampleStateBanner | null {
  const kind = sampleStateKind(sample)
  if (!kind) return null

  if (kind === 'quarantined') {
    const at = formatDate(sample.quarantinedAt)
    const reason = sample.quarantineReason?.trim()
    return {
      kind,
      tone: 'warn',
      title: at ? `In quarantine since ${at}.` : 'In quarantine.',
      body: `${
        reason ? `${reason} ` : 'No quarantine reason recorded. '
      }Can’t be used in experiments until released by an authorised releaser.`,
    }
  }

  if (kind === 'hold_exceeded') {
    const hold = resolveHoldWindow(sample)
    const at = hold ? formatHoldDate(hold.expiry) : formatDate(sample.holdUntil)
    const window = hold
      ? ` (${hold.totalDays} day${hold.totalDays === 1 ? '' : 's'}${
          hold.condition ? ` at ${hold.condition}` : ''
        })`
      : ''
    return {
      kind,
      tone: 'bad',
      title: at ? `Hold limit passed on ${at}${window}.` : 'Hold limit passed.',
      body: allowedUseSentence(sample),
    }
  }

  if (kind === 'expired') {
    const hold = resolveHoldWindow(sample)
    const at = hold ? formatHoldDate(hold.expiry) : formatDate(sample.holdUntil)
    return {
      kind,
      tone: 'bad',
      title: at ? `Expired on ${at}.` : 'Expired.',
      body: allowedUseSentence(sample),
    }
  }

  if (kind === 'consumed') {
    const event = latestEvent(options.events, ['consume'])
    const at = event ? formatDate(event.createdAt) : null
    const actor =
      event?.actorUserId && options.userName
        ? options.userName(event.actorUserId)
        : null
    const detail = event?.notes?.trim() || null
    return {
      kind,
      tone: 'info',
      title: at
        ? `Fully used on ${at}${actor ? ` by ${actor}` : ''}`
        : 'Fully used.',
      body: `${detail ? `${detail}. ` : ''}The record stays for lineage and audit.`,
    }
  }

  const at = formatDate(sample.disposedAt)
  const reason = sample.disposalReason?.trim()
  return {
    kind,
    tone: 'info',
    title: at ? `Disposed on ${at}.` : 'Disposed.',
    body: `${
      reason ? `${reason} ` : 'No disposal reason recorded. '
    }Remaining quantity is kept for lineage and audit.`,
  }
}

/**
 * Summarise the release-check snapshot stored by `api.release_sample`, e.g.
 * "2 of 3 passed" or "All 3 passed". Returns null when no snapshot is stored.
 */
export function describeReleaseChecks(
  checks: Record<string, unknown> | null,
): string | null {
  if (!checks) return null
  const ruleCount = Number(checks.ruleCount)
  const failedCount = Number(checks.failedCount)
  if (!Number.isFinite(ruleCount) || ruleCount <= 0) return null
  if (!Number.isFinite(failedCount) || failedCount <= 0) {
    return `All ${ruleCount} check${ruleCount === 1 ? '' : 's'} passed`
  }
  return `${ruleCount - failedCount} of ${ruleCount} passed`
}
