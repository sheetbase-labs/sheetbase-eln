import { Badge } from '#/components/ui/badge'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

import { statusLabel, statusVocabularies } from './status-vocabularies'
import type {
  StatusDomain,
  StatusTone,
  StatusVocabulary,
} from './status-vocabularies'

/**
 * StatusBadge — a scientific status pill that communicates by text, icon
 * shape AND colour, never colour alone (DESIGN.md / UI-005).
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

const toneToVariant: Record<
  StatusTone,
  React.ComponentProps<typeof Badge>['variant']
> = {
  neutral: 'kind',
  info: 'kind',
  success: 'add',
  warning: 'chg',
  danger: 'del',
  violet: 'kind',
}

const fallbackIcon: IconName = 'flask'

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
  const iconName = def?.icon ?? fallbackIcon
  const variant = def ? toneToVariant[def.tone] : 'kind'

  return (
    <Badge
      variant={variant}
      data-status={status}
      className={cn(size === 'sm' && 'text-xs', className)}
    >
      <Icon name={iconName} size={size === 'sm' ? 12 : 14} aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  )
}
