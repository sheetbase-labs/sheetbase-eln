import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

import { statusLabel, statusVocabularies } from './status-vocabularies'
import type {
  StatusDomain,
  StatusTone,
  StatusVocabulary,
} from './status-vocabularies'

/**
 * StatusBadge — a scientific status that communicates by text, ring shape
 * AND colour, never colour alone (DESIGN.md / UI-005). It draws the same
 * ring as every list, so a record reads one way wherever it appears.
 *
 * Status vocabularies are defined per domain (experiment, review, sample,
 * dataset) rather than assuming every record shares one state machine. A
 * caller either passes a known `domain` or a custom `vocabulary`. An
 * unknown status falls back to a neutral pill with the raw text so the UI
 * never silently hides a state the vocabulary does not know.
 */

export type {
  StatusDefinition,
  StatusDomain,
  StatusTone,
  StatusVocabulary,
} from './status-vocabularies'

/**
 * The ring a status draws, the same one lists and record headers use (empty =
 * not started, half = under way, three-quarters = in review, full = done,
 * dashed = needs attention). The vocabulary's icon already says which of those
 * a state is; its tone settles anything a custom vocabulary adds.
 */
const ringForIcon: Partial<Record<IconName, Tone>> = {
  clock: 'draft',
  calendar: 'draft',
  play: 'progress',
  search: 'review',
  check: 'ok',
  x: 'bad',
  warn: 'warn',
  arrowLeft: 'warn',
  pause: 'warn',
  archive: 'stored',
  lock: 'stored',
}

const ringForTone: Record<StatusTone, Tone> = {
  neutral: 'draft',
  info: 'progress',
  success: 'ok',
  warning: 'warn',
  danger: 'bad',
  violet: 'review',
}

export interface StatusBadgeProps {
  /** Status key within the vocabulary, e.g. "in-progress". */
  status: string
  /** Built-in domain vocabulary. */
  domain?: StatusDomain
  /** Custom domain vocabulary. Overrides `domain`. */
  vocabulary?: StatusVocabulary
  size?: 'sm' | 'md'
  className?: string
}

export function StatusBadge({
  status,
  domain,
  vocabulary,
  size = 'sm',
  className,
}: StatusBadgeProps) {
  const vocab: StatusVocabulary | undefined =
    vocabulary ?? (domain ? statusVocabularies[domain] : undefined)

  // Normalise: databases may store `in_progress` (underscore) while the
  // vocabulary keys use `in-progress` (hyphen). Try both.
  const normalised = status.replace(/_/g, '-')
  const def = vocab?.[status] ?? vocab?.[normalised]
  const label = vocab ? statusLabel(vocab, status) : status
  const tone = def ? (ringForIcon[def.icon] ?? ringForTone[def.tone]) : 'none'

  return (
    <Status
      tone={tone}
      data-status={status}
      className={cn(size === 'sm' ? 'text-xs' : 'text-body', className)}
    >
      {label}
    </Status>
  )
}
