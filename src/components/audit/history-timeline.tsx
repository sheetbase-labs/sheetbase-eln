import type { ReactNode } from 'react'
import {
  ArchiveRestore,
  ArrowRightLeft,
  CheckCircle2,
  FileCheck2,
  FileWarning,
  FolderTree,
  GitCommit,
  History,
  Undo2,
  UserCheck,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import { Notice } from '#/components/v3/ui/alert'
import { Skeleton } from '#/components/v3/ui/skeleton'
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '#/components/reui/timeline'
import type { AuditLink, FieldChange } from '#/lib/audit-history'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/**
 * HistoryTimeline — the one history surface behind every audit and history
 * panel (ADR-0055, B5). It removes the duplication the three panels carried
 * between them — three loading skeletons, two byte-identical dashed empty
 * states, four icon maps, two row layouts, a second relative-time formatter and
 * two continuation controls — and it is built on the ReUI `timeline` item
 * (`src/components/reui/timeline.tsx`, registry `@reui/timeline`).
 *
 * The three panels keep their own data mapping — typed audit events, wire
 * change events with correlation grouping, and the record-timeline RPC — and
 * hand this component a list of `HistoryEntry`. Everything they used to
 * duplicate lives here once: the row layout, the before→after `ChangeChip`, the
 * `Raw event` disclosure, the loading, empty and error states, the
 * continuation control and the "showing N of M" summary.
 *
 * The list is a real `<ol>` of `<li>` rows (`render={<ol />}` / `render={<li />}`)
 * and the rows carry no step semantics — the recurrence is history, not
 * progress, so `value={0}` leaves every indicator uncompleted.
 */

// ---------------------------------------------------------------------------
// Icon vocabulary. One module owns how an audit event is illustrated: the
// operation it records, the entity it happened to, a review decision, or the
// event kind an `AuditTrail` carries.
// ---------------------------------------------------------------------------

export const AUDIT_OPERATION_ICONS: Partial<
  Record<string, IconName | LucideIcon>
> = {
  create: GitCommit,
  update: History,
  move: ArrowRightLeft,
  delete: FileWarning,
  archive: 'archive',
  restore: ArchiveRestore,
  link: 'link',
  unlink: 'link',
  quarantine: FileWarning,
  resolve: History,
  reopen: History,
  lock: 'lock',
  amend: GitCommit,
  revoke: 'key',
}

export const AUDIT_ENTITY_ICONS: Partial<
  Record<string, IconName | LucideIcon>
> = {
  record: 'protocol',
  file: 'protocol',
  folder: FolderTree,
  dataset: 'database',
  dataset_version: 'database',
  sheet_instance: 'table',
  sheet_definition: 'template',
  sheet_definition_version: 'template',
  notebook_template: 'template',
  notebook_template_version: 'template',
  review_submission: 'table',
  review_decision: 'table',
  signature: 'edit',
  api_credential: 'key',
  comment: 'comment',
}

export const AUDIT_DECISION_ICONS: Partial<
  Record<string, IconName | LucideIcon>
> = {
  approve: CheckCircle2,
  reject: XCircle,
  request_changes: Undo2,
  withdraw: Undo2,
}

/** Defaults for the typed events `AuditTrail` renders. */
export const AUDIT_TYPE_ICONS: Partial<Record<string, IconName | LucideIcon>> =
  {
    created: 'flask',
    uploaded: 'upload',
    'review-requested': FileCheck2,
    'review-started': UserCheck,
  }

// ---------------------------------------------------------------------------
// The row model.
// ---------------------------------------------------------------------------

/** One event as a row: what every caller of this surface maps its data onto. */
export interface HistoryEntry {
  readonly id: string
  readonly icon: IconName | LucideIcon
  /** The row's main line: what happened, and to what. */
  readonly title: ReactNode
  /** A short tag beside the title, e.g. "rotation". */
  readonly badge?: ReactNode
  /** Time label, rendered in the row's `<time>`. */
  readonly time: string
  /** The exact instant behind the label, when the event has one. */
  readonly dateTime?: string
  /** Who did it; shown before the time. */
  readonly actor?: string
  /** What it acted on; shown after the time. */
  readonly detail?: string
  /** Before → after facts, rendered as `ChangeChip`s. */
  readonly changes?: readonly FieldChange[]
  /** Events collapsed into this row. */
  readonly related?: readonly { readonly id: string; readonly text: string }[]
  /** A deep link to the canonical surface, when one exists. */
  readonly link?: AuditLink | null
  /** The event's own facts, behind the "Raw event" disclosure. */
  readonly raw?: unknown
  /** A complete sentence for screen readers. */
  readonly sentence?: string
}

/** The continuation control: shown when the caller has more pages. */
export interface HistoryLoadMore {
  onClick: () => void
  /** Idle label; "Load more" when omitted. */
  label?: string
  busy?: boolean
}

/** The retry a failed load offers, when the surface can retry at all. */
export interface HistoryRetry {
  onClick: () => void
  label?: string
  busyLabel?: string
  busy?: boolean
}

export interface HistoryTimelineProps {
  entries: readonly HistoryEntry[]
  /** Accessible name of the list, e.g. "Audit trail". */
  ariaLabel: string
  /** Shown in place of the list when there are no entries. */
  emptyMessage: string
  /** Why the list is empty, shown under the message. */
  emptyDescription?: ReactNode
  loading?: boolean
  /**
   * A load or permission failure. It is its own state — the surface never
   * renders an empty list where a permission was refused.
   */
  error?: ReactNode
  retry?: HistoryRetry
  loadMore?: HistoryLoadMore
  /** Summary line under the list, e.g. "Showing 3 of 84 events". */
  footer?: ReactNode
  /** Max height before the list scrolls; keeps inspectors usable. */
  maxHeight?: string
  className?: string
}

// ---------------------------------------------------------------------------
// Row parts.
// ---------------------------------------------------------------------------

function RowIcon({ icon }: { icon: IconName | LucideIcon }) {
  if (typeof icon === 'string') {
    return <Icon name={icon} className="size-3.5" aria-hidden="true" />
  }
  const IconComponent = icon
  return <IconComponent className="size-3.5" aria-hidden="true" />
}

/** One before → after fact: struck-through previous value, then the new one. */
function ChangeChip({ change }: { change: FieldChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-fg-muted">{change.label}:</span>
      {change.kind === 'changed' ? (
        <>
          <span className="rounded bg-surface-muted px-1 py-px font-mono text-fg-muted line-through decoration-border">
            {change.from}
          </span>
          <span aria-hidden>→</span>
          <span className="rounded bg-primary/10 px-1 py-px font-mono text-fg">
            {change.to}
          </span>
        </>
      ) : change.kind === 'added' ? (
        <>
          <span className="sr-only">{t('projects.historyTimeline.setTo')}</span>
          <span className="rounded bg-primary/10 px-1 py-px font-mono text-fg">
            {change.to}
          </span>
        </>
      ) : (
        <>
          <span className="rounded bg-destructive/10 px-1 py-px font-mono text-danger-text line-through decoration-destructive/40">
            {change.from}
          </span>
          <span className="text-fg-muted">
            {t('projects.historyTimeline.removed')}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * The event's exact facts, folded away. A real `<details>`/`<summary>` pair, so
 * it opens by keyboard and pointer alike.
 */
function RawPayload({ value }: { value: unknown }) {
  return (
    <Collapsible className="pt-1">
      <CollapsibleTrigger className="text-xs text-fg-muted hover:text-fg">
        {t('projects.historyTimeline.rawEvent')}
      </CollapsibleTrigger>
      <CollapsiblePanel
        role="group"
        aria-label={t('projects.historyTimeline.rawEventPayload')}
      >
        <pre className="mt-1 overflow-x-auto rounded-md border bg-surface-muted/40 p-2 font-mono text-[11px] leading-snug text-fg-muted">
          {JSON.stringify(value, null, 2)}
        </pre>
      </CollapsiblePanel>
    </Collapsible>
  )
}

function HistoryRow({ entry, step }: { entry: HistoryEntry; step: number }) {
  const hasDetail = Boolean(entry.changes?.length || entry.related?.length)
  const hasFooter = entry.link != null || entry.raw !== undefined
  return (
    <TimelineItem step={step} render={<li />} className="ps-3">
      <TimelineIndicator>
        <RowIcon icon={entry.icon} />
      </TimelineIndicator>
      <TimelineSeparator />
      <TimelineHeader>
        <TimelineTitle
          render={<p />}
          className="flex flex-wrap items-center gap-x-1.5"
        >
          {entry.title}
          {entry.badge}
        </TimelineTitle>
        <p className="truncate text-xs text-fg-muted">
          {entry.actor ? `${entry.actor} · ` : null}
          {entry.dateTime ? (
            <time dateTime={entry.dateTime}>{entry.time}</time>
          ) : (
            entry.time
          )}
          {entry.detail ? ` · ${entry.detail}` : null}
        </p>
      </TimelineHeader>
      {hasDetail ? (
        <TimelineContent className="mt-1 space-y-1 text-xs">
          {entry.changes?.map((change) => (
            <ChangeChip key={change.label} change={change} />
          ))}
          {entry.related?.map((related) => (
            <div
              key={related.id}
              className="flex flex-wrap items-center gap-1 text-xs text-fg-muted"
            >
              <span aria-hidden>↳</span>
              {related.text}
            </div>
          ))}
        </TimelineContent>
      ) : null}
      {hasFooter ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-3">
          {entry.link ? (
            <a
              href={entry.link.href}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary-text no-underline hover:underline"
            >
              {entry.link.label}
            </a>
          ) : null}
          {entry.raw !== undefined ? <RawPayload value={entry.raw} /> : null}
        </div>
      ) : null}
      {entry.sentence ? (
        <span className="sr-only">{entry.sentence}</span>
      ) : null}
    </TimelineItem>
  )
}

// ---------------------------------------------------------------------------
// States.
// ---------------------------------------------------------------------------

/** Loading: four rows that keep the list's shape while it arrives. */
function HistoryTimelineSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('space-y-3', className)}
      aria-busy="true"
      aria-live="polite"
      data-slot="history-timeline"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5 pt-1">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The surface.
// ---------------------------------------------------------------------------

export function HistoryTimeline({
  entries,
  ariaLabel,
  emptyMessage,
  emptyDescription,
  loading = false,
  error = null,
  retry,
  loadMore,
  footer,
  maxHeight = '24rem',
  className,
}: HistoryTimelineProps) {
  if (loading) return <HistoryTimelineSkeleton className={className} />

  if (error) {
    return (
      <div className={className} data-slot="history-timeline">
        <Notice
          tone="bad"
          title={error}
          action={
            retry ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={retry.onClick}
                disabled={retry.busy}
              >
                {retry.busy
                  ? (retry.busyLabel ?? t('common.states.retrying'))
                  : (retry.label ?? t('common.actions.tryAgain'))}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className={className} data-slot="history-timeline">
        <EmptyState
          icon="clock"
          className="py-2"
          title={emptyMessage}
          description={emptyDescription}
        />
      </div>
    )
  }

  return (
    <div className={className} data-slot="history-timeline">
      {/* A capped list scrolls, and axe requires a scrollable region to be
          reachable from the keyboard when its rows hold no controls of their
          own (the record-history panel's do not). The ring is the focus
          indicator that comes with being a tab stop. */}
      <Timeline
        render={<ol />}
        value={0}
        aria-label={ariaLabel}
        tabIndex={0}
        className="m-0 list-none overflow-y-auto p-0 pr-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={{ maxHeight }}
      >
        {entries.map((entry, index) => (
          <HistoryRow key={entry.id} entry={entry} step={index + 1} />
        ))}
      </Timeline>
      {loadMore ? (
        <div className="pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={loadMore.onClick}
            disabled={loadMore.busy}
          >
            {loadMore.busy
              ? t('common.states.loading')
              : (loadMore.label ?? t('projects.historyTimeline.loadMore'))}
          </Button>
        </div>
      ) : null}
      {footer !== undefined ? (
        <p className="pt-2 text-xs text-fg-muted">{footer}</p>
      ) : null}
    </div>
  )
}
