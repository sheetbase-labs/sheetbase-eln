import { t } from '#/copy'
import type { Tone } from '#/components/ui/status'

/**
 * The one way a stored status reads. A record's status is stored as a key
 * (`in_review`, `active`, `on_hold`); every list, header, peek and assistant
 * answer shows it through `statusWord`, so it reads "In review" everywhere and
 * never as the raw key. `statusTone` picks the ring that goes beside it.
 *
 * Kinds that word their lifecycle their own way (samples say "Stored", not
 * "Available") keep their own vocabulary and are asked for by `kind`.
 */

const WORDS = {
  draft: () => t('common.status.draft'),
  planned: () => t('common.status.planned'),
  scheduled: () => t('common.status.planned'),
  in_progress: () => t('common.status.inProgress'),
  running: () => t('common.status.running'),
  in_review: () => t('common.status.inReview'),
  under_review: () => t('common.status.inReview'),
  review: () => t('common.status.inReview'),
  submitted: () => t('common.status.inReview'),
  returned: () => t('common.status.returned'),
  approved: () => t('common.status.approved'),
  signed: () => t('common.status.signed'),
  locked: () => t('common.status.locked'),
  on_hold: () => t('common.status.onHold'),
  paused: () => t('common.status.onHold'),
  failed: () => t('common.status.failed'),
  complete: () => t('common.status.complete'),
  completed: () => t('common.status.complete'),
  done: () => t('common.status.complete'),
  active: () => t('common.status.active'),
  open: () => t('common.status.open'),
  closed: () => t('common.status.closed'),
  cancelled: () => t('common.status.cancelled'),
  canceled: () => t('common.status.cancelled'),
  archived: () => t('common.status.archived'),
  retired: () => t('common.status.retired'),
  published: () => t('common.status.published'),
  effective: () => t('common.status.effective'),
  superseded: () => t('common.status.superseded'),
  released: () => t('common.status.released'),
  quarantine: () => t('common.status.quarantine'),
  quarantined: () => t('common.status.quarantined'),
  available: () => t('common.status.available'),
  consumed: () => t('common.status.consumed'),
  expired: () => t('common.status.expired'),
  valid: () => t('common.status.valid'),
  invalid: () => t('common.status.invalid'),
  pending: () => t('common.status.pending'),
  rejected: () => t('common.status.rejected'),
} satisfies Record<string, () => string>

const TONES = {
  draft: 'draft',
  planned: 'draft',
  scheduled: 'draft',
  pending: 'draft',
  in_progress: 'progress',
  running: 'progress',
  active: 'progress',
  open: 'progress',
  in_review: 'review',
  under_review: 'review',
  review: 'review',
  submitted: 'review',
  returned: 'warn',
  on_hold: 'warn',
  paused: 'warn',
  quarantine: 'warn',
  quarantined: 'warn',
  expired: 'warn',
  approved: 'ok',
  signed: 'ok',
  locked: 'ok',
  complete: 'ok',
  completed: 'ok',
  done: 'ok',
  published: 'ok',
  effective: 'ok',
  released: 'ok',
  available: 'ok',
  valid: 'ok',
  closed: 'stored',
  archived: 'stored',
  retired: 'stored',
  superseded: 'stored',
  consumed: 'stored',
  cancelled: 'stored',
  canceled: 'stored',
  failed: 'bad',
  invalid: 'bad',
  rejected: 'bad',
} satisfies Record<string, Tone>

function keyOf(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * A status as words: "In review" for `in_review`, "Active" for `active`. A
 * status the app does not know still reads as a sentence-case phrase, never
 * as its stored key.
 */
export function statusWord(status: string | null | undefined): string {
  if (!status) return '—'
  const key = keyOf(status)

  if (Object.hasOwn(WORDS, key))
    // SAFETY: the own-key check establishes membership in the literal map.
    return WORDS[key as keyof typeof WORDS]()
  const words = status.replace(/[_\s-]+/g, ' ').trim()

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—'
}

/** The ring beside a status: in progress, in review, done, needs attention. */
export function statusTone(status: string | null | undefined): Tone {
  if (!status) return 'none'

  const key = keyOf(status)

  return Object.hasOwn(TONES, key)
    ? // SAFETY: the own-key check establishes membership in the literal map.
      TONES[key as keyof typeof TONES]
    : 'none'
}
