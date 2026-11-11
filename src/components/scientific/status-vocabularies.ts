/**
 * The status vocabularies a StatusBadge draws on: what each domain's status
 * keys read as, their tone and their icon, plus the one label rule. They live
 * outside the component module so a Fast Refresh of the badge keeps its state.
 */
import { t } from '#/copy'
import type { IconName } from '#/components/icons'

export type StatusTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet'

export interface StatusDefinition {
  label: string
  tone: StatusTone
  icon: IconName
}

export type StatusVocabulary = Record<string, StatusDefinition>

export const experimentStatusVocabulary = {
  draft: {
    label: t('notebook.statusBadge.label'),
    tone: 'neutral',
    icon: 'clock',
  },
  planned: {
    label: t('notebook.statusBadge.plannedLabel'),
    tone: 'info',
    icon: 'calendar',
  },
  'in-progress': {
    label: t('notebook.statusBadge.inProgressLabel'),
    tone: 'success',
    icon: 'play',
  },
  review: {
    label: t('notebook.statusBadge.inReviewLabel'),
    tone: 'violet',
    icon: 'search',
  },
  // The stored statuses (`in_review`, `returned`, `on_hold`) as well as the
  // short forms above, so a record in review reads "In review", not its key.
  'in-review': {
    label: t('notebook.statusBadge.inReviewLabel'),
    tone: 'violet',
    icon: 'search',
  },
  returned: {
    label: t('notebook.statusBadge.returnedLabel'),
    tone: 'warning',
    icon: 'arrowLeft',
  },
  'on-hold': {
    label: t('notebook.statusBadge.onHoldLabel'),
    tone: 'info',
    icon: 'pause',
  },
  approved: {
    label: t('notebook.statusBadge.approvedLabel'),
    tone: 'success',
    icon: 'check',
  },
  completed: {
    label: t('notebook.statusBadge.completedLabel'),
    tone: 'success',
    icon: 'check',
  },
  locked: {
    label: t('notebook.statusBadge.lockedLabel'),
    tone: 'neutral',
    icon: 'lock',
  },
  failed: { label: t('common.states.failed'), tone: 'danger', icon: 'x' },
  paused: {
    label: t('notebook.statusBadge.pausedLabel'),
    tone: 'info',
    icon: 'pause',
  },
  archived: {
    label: t('notebook.statusBadge.archivedLabel'),
    tone: 'neutral',
    icon: 'archive',
  },
} satisfies Record<string, StatusDefinition>

export const reviewStatusVocabulary = {
  pending: {
    label: t('notebook.statusBadge.pendingLabel'),
    tone: 'neutral',
    icon: 'clock',
  },
  active: {
    label: t('notebook.statusBadge.activeLabel'),
    tone: 'info',
    icon: 'play',
  },
  approved: {
    label: t('notebook.statusBadge.approvedLabel'),
    tone: 'success',
    icon: 'check',
  },
  rejected: {
    label: t('notebook.statusBadge.rejectedLabel'),
    tone: 'danger',
    icon: 'x',
  },
  returned: {
    label: t('notebook.statusBadge.returnedLabel'),
    tone: 'warning',
    icon: 'arrowLeft',
  },
} satisfies Record<string, StatusDefinition>

export const sampleStatusVocabulary = {
  available: {
    label: t('notebook.statusBadge.availableLabel'),
    tone: 'success',
    icon: 'check',
  },
  reserved: {
    label: t('notebook.statusBadge.reservedLabel'),
    tone: 'info',
    icon: 'lock',
  },
  consumed: {
    label: t('notebook.statusBadge.consumedLabel'),
    tone: 'neutral',
    icon: 'archive',
  },
  expired: {
    label: t('notebook.statusBadge.expiredLabel'),
    tone: 'danger',
    icon: 'x',
  },
  quarantined: {
    label: t('notebook.statusBadge.quarantinedLabel'),
    tone: 'warning',
    icon: 'warn',
  },
  frozen: {
    label: t('notebook.statusBadge.frozenLabel'),
    tone: 'info',
    icon: 'archive',
  },
  hold_exceeded: {
    label: t('notebook.statusBadge.holdExceededLabel'),
    tone: 'danger',
    icon: 'warn',
  },
  disposed: {
    label: t('notebook.statusBadge.disposedLabel'),
    tone: 'neutral',
    icon: 'archive',
  },
} satisfies Record<string, StatusDefinition>

/**
 * Material lifecycle vocabulary (SCI-001). Materials share the sample
 * availability/quarantine states and add a low-stock inventory state that is
 * not a lifecycle transition target but is rendered when present.
 */
export const materialStatusVocabulary = {
  available: {
    label: t('notebook.statusBadge.availableLabel'),
    tone: 'success',
    icon: 'check',
  },
  reserved: {
    label: t('notebook.statusBadge.reservedLabel'),
    tone: 'info',
    icon: 'lock',
  },
  consumed: {
    label: t('notebook.statusBadge.consumedLabel'),
    tone: 'neutral',
    icon: 'archive',
  },
  expired: {
    label: t('notebook.statusBadge.expiredLabel'),
    tone: 'danger',
    icon: 'x',
  },
  quarantined: {
    label: t('notebook.statusBadge.quarantinedLabel'),
    tone: 'warning',
    icon: 'warn',
  },
  low_stock: {
    label: t('notebook.statusBadge.lowStockLabel'),
    tone: 'warning',
    icon: 'warn',
  },
} satisfies Record<string, StatusDefinition>

/**
 * Protocol template lifecycle vocabulary (SCI-001). Protocols are notebook-
 * backed records (kind `protocol_template`); their status drives the
 * template registry and the protocol picker.
 */
export const protocolStatusVocabulary = {
  draft: {
    label: t('notebook.statusBadge.label'),
    tone: 'neutral',
    icon: 'clock',
  },
  active: {
    label: t('notebook.statusBadge.activeLabel'),
    tone: 'success',
    icon: 'check',
  },
  under_review: {
    label: t('notebook.statusBadge.underReviewLabel'),
    tone: 'violet',
    icon: 'search',
  },
} satisfies Record<string, StatusDefinition>

/**
 * Notebook template lifecycle vocabulary (SCI-006). Notebook templates use
 * draft → validated, with archived handled by the record's archived_at.
 */
export const notebookTemplateStatusVocabulary = {
  draft: {
    label: t('notebook.statusBadge.label'),
    tone: 'neutral',
    icon: 'clock',
  },
  validated: {
    label: t('notebook.statusBadge.validatedLabel'),
    tone: 'success',
    icon: 'check',
  },
} satisfies Record<string, StatusDefinition>

export const datasetStatusVocabulary = {
  draft: {
    label: t('notebook.statusBadge.label'),
    tone: 'neutral',
    icon: 'clock',
  },
  valid: {
    label: t('notebook.statusBadge.validLabel'),
    tone: 'success',
    icon: 'check',
  },
  deprecated: {
    label: t('notebook.statusBadge.deprecatedLabel'),
    tone: 'warning',
    icon: 'archive',
  },
  retracted: {
    label: t('notebook.statusBadge.retractedLabel'),
    tone: 'danger',
    icon: 'x',
  },
} satisfies Record<string, StatusDefinition>

/**
 * Project lifecycle vocabulary. Projects are workspace-level containers; their
 * status is a coarse active/archived state rather than a fine experiment
 * state machine. Used by the projects dashboard table and project header.
 */
export const projectStatusVocabulary = {
  active: {
    label: t('notebook.statusBadge.activeLabel'),
    tone: 'success',
    icon: 'check',
  },
  draft: {
    label: t('notebook.statusBadge.label'),
    tone: 'neutral',
    icon: 'clock',
  },
  archived: {
    label: t('notebook.statusBadge.archivedLabel'),
    tone: 'neutral',
    icon: 'archive',
  },
} satisfies Record<string, StatusDefinition>

/** The domains a badge can name; each has its own vocabulary. */
export const STATUS_DOMAINS = [
  'experiment',
  'review',
  'sample',
  'dataset',
  'material',
  'protocol',
  'notebook_template',
  'project',
] as const

export type StatusDomain = (typeof STATUS_DOMAINS)[number]

export const statusVocabularies: Readonly<
  Record<StatusDomain, StatusVocabulary>
> = {
  experiment: experimentStatusVocabulary,
  review: reviewStatusVocabulary,
  sample: sampleStatusVocabulary,
  dataset: datasetStatusVocabulary,
  material: materialStatusVocabulary,
  protocol: protocolStatusVocabulary,
  notebook_template: notebookTemplateStatusVocabulary,
  project: projectStatusVocabulary,
}

/**
 * The label for a status key in a vocabulary. Badge keys are hyphenated while
 * stored statuses are underscored, so both spellings are tried; a status the
 * vocabulary does not know renders as itself rather than as a blank.
 */
export function statusLabel(
  vocabulary: StatusVocabulary,
  status: string,
): string {
  const hyphenated = status.replace(/_/g, '-')

  if (Object.hasOwn(vocabulary, status)) return vocabulary[status].label

  if (Object.hasOwn(vocabulary, hyphenated)) return vocabulary[hyphenated].label
  // A status the vocabulary does not know still reads as words, not as a key.
  const words = status.replace(/[_-]+/g, ' ').trim()

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : status
}
