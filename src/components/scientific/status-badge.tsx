import {
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock,
  Eye,
  FlaskConical,
  Lock,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  Snowflake,
  XCircle,
  Undo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge } from '#/components/ui'
import { cn } from '#/lib/utils'

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

export type StatusTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet'

export interface StatusDefinition {
  label: string
  tone: StatusTone
  icon: LucideIcon
}

export type StatusVocabulary = Record<string, StatusDefinition>

export const experimentStatusVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  planned: { label: 'Planned', tone: 'info', icon: CalendarClock },
  'in-progress': { label: 'In progress', tone: 'info', icon: PlayCircle },
  review: { label: 'In review', tone: 'violet', icon: Eye },
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  locked: { label: 'Locked', tone: 'neutral', icon: Lock },
  failed: { label: 'Failed', tone: 'danger', icon: XCircle },
  paused: { label: 'Paused', tone: 'warning', icon: PauseCircle },
  archived: { label: 'Archived', tone: 'neutral', icon: Archive },
}

export const reviewStatusVocabulary: StatusVocabulary = {
  pending: { label: 'Pending', tone: 'neutral', icon: Clock },
  active: { label: 'Active', tone: 'info', icon: PlayCircle },
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  rejected: { label: 'Rejected', tone: 'danger', icon: XCircle },
  returned: { label: 'Returned', tone: 'warning', icon: Undo2 },
}

export const sampleStatusVocabulary: StatusVocabulary = {
  available: { label: 'Available', tone: 'success', icon: CheckCircle2 },
  reserved: { label: 'Reserved', tone: 'info', icon: Lock },
  consumed: { label: 'Consumed', tone: 'neutral', icon: Archive },
  expired: { label: 'Expired', tone: 'danger', icon: XCircle },
  quarantined: { label: 'Quarantined', tone: 'warning', icon: ShieldAlert },
  frozen: { label: 'Frozen', tone: 'info', icon: Snowflake },
}

/**
 * Reagent lifecycle vocabulary (SCI-001). Reagents share the sample
 * availability/quarantine states and add a low-stock inventory state that is
 * not a lifecycle transition target but is rendered when present.
 */
export const reagentStatusVocabulary: StatusVocabulary = {
  available: { label: 'Available', tone: 'success', icon: CheckCircle2 },
  reserved: { label: 'Reserved', tone: 'info', icon: Lock },
  consumed: { label: 'Consumed', tone: 'neutral', icon: Archive },
  expired: { label: 'Expired', tone: 'danger', icon: XCircle },
  quarantined: { label: 'Quarantined', tone: 'warning', icon: ShieldAlert },
  low_stock: { label: 'Low stock', tone: 'warning', icon: ShieldAlert },
}

/**
 * Protocol template lifecycle vocabulary (SCI-001). Protocols are notebook-
 * backed records (kind `protocol_template`); their status drives the
 * template registry and the protocol picker.
 */
export const protocolStatusVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  active: { label: 'Active', tone: 'success', icon: CheckCircle2 },
  under_review: { label: 'Under review', tone: 'violet', icon: Eye },
}

/**
 * Notebook template lifecycle vocabulary (SCI-006). Notebook templates use
 * draft → validated, with archived handled by the record's archived_at.
 */
export const notebookTemplateStatusVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  validated: { label: 'Validated', tone: 'success', icon: CheckCircle2 },
}

export const datasetStatusVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  valid: { label: 'Valid', tone: 'success', icon: CheckCircle2 },
  deprecated: { label: 'Deprecated', tone: 'warning', icon: Archive },
  retracted: { label: 'Retracted', tone: 'danger', icon: Ban },
}

export const statusVocabularies = {
  experiment: experimentStatusVocabulary,
  review: reviewStatusVocabulary,
  sample: sampleStatusVocabulary,
  dataset: datasetStatusVocabulary,
  reagent: reagentStatusVocabulary,
  protocol: protocolStatusVocabulary,
  notebook_template: notebookTemplateStatusVocabulary,
} as const

export type StatusDomain = keyof typeof statusVocabularies

const toneToVariant: Record<
  StatusTone,
  React.ComponentProps<typeof Badge>['variant']
> = {
  neutral: 'outline',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  violet: 'violet',
}

const fallbackIcon = FlaskConical

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
  const vocab = vocabulary ?? (domain ? statusVocabularies[domain] : undefined)
  const def = vocab?.[status]
  const label = def?.label ?? status
  const Icon = def?.icon ?? fallbackIcon
  const variant = def ? toneToVariant[def.tone] : 'outline'

  return (
    <Badge
      variant={variant}
      data-status={status}
      className={cn(size === 'sm' && 'text-[10px]', className)}
    >
      <Icon
        className={cn(size === 'sm' ? 'size-3' : 'size-3.5')}
        aria-hidden="true"
      />
      <span>{label}</span>
      {/* The visible label is the accessible name; add an sr-only tone hint
          so screen readers also get the status key for robustness. */}
      <span className="sr-only">
        {def ? `status: ${def.tone}` : 'status: unknown'}
      </span>
    </Badge>
  )
}
