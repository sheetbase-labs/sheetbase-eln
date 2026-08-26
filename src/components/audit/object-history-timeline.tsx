import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Database,
  FileText,
  FileWarning,
  FolderTree,
  GitCommit,
  History,
  KeyRound,
  LayoutTemplate,
  Link2,
  Lock,
  MessageSquare,
  PenLine,
  Sheet,
  Table2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge, Button, Skeleton } from '#/components/ui'
import {
  auditLinkFor,
  describeAuditEvent,
  groupAuditEvents,
} from '#/lib/audit-history'
import type { AuditEventWire, FieldChange } from '#/lib/audit-history'
import { formatNotebookDateTime, formatRelativeTime } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

/**
 * ObjectHistoryTimeline — GOV-03 reusable history surface for any object
 * class backed by authoritative `api.change_events` rows. Events render as
 * semantic phrases (who / when / what / before → after) with deep links to
 * canonical surfaces; a per-event raw view exposes the exact payload for
 * technical inspection without making raw JSON the primary UX.
 *
 * The component is purely presentational: pages arrive from
 * `fetchAuditEvents` (workspace-isolated, permission-aware RPC), and the
 * caller owns pagination state.
 */

export interface ObjectHistoryTimelineProps {
  events: AuditEventWire[]
  loading?: boolean
  error?: string | null
  hasMore?: boolean
  onLoadMore?: () => void
  loadingMore?: boolean
  maxHeight?: string
  className?: string
}

const OPERATION_ICONS: Partial<Record<string, LucideIcon>> = {
  create: GitCommit,
  update: History,
  move: ArrowRightLeft,
  delete: FileWarning,
  archive: Archive,
  restore: ArchiveRestore,
  link: Link2,
  unlink: Link2,
  quarantine: FileWarning,
  lock: Lock,
  amend: GitCommit,
  revoke: KeyRound,
}

const ENTITY_ICONS: Partial<Record<string, LucideIcon>> = {
  record: FileText,
  file: FileText,
  folder: FolderTree,
  dataset: Database,
  dataset_version: Database,
  sheet_instance: Sheet,
  sheet_definition: LayoutTemplate,
  sheet_definition_version: LayoutTemplate,
  notebook_template: LayoutTemplate,
  notebook_template_version: LayoutTemplate,
  review_submission: Table2,
  review_decision: Table2,
  signature: PenLine,
  api_credential: KeyRound,
  comment: MessageSquare,
}

function iconFor(event: AuditEventWire): LucideIcon {
  return (
    OPERATION_ICONS[event.operation] ?? ENTITY_ICONS[event.entityType] ?? History
  )
}

function actorLabel(event: AuditEventWire): string {
  if (event.actorCredentialId) return 'API credential'
  if (event.actorName) return event.actorName
  if (event.actorUserId) return event.actorUserId.slice(0, 8)
  return 'System'
}

function ChangeChip({ change }: { change: FieldChange }) {
  return (
    <div className='flex flex-wrap items-center gap-1 text-xs'>
      <span className='text-muted-foreground'>{change.label}:</span>
      {change.kind === 'changed' ? (
        <>
          <span className='rounded bg-muted px-1 py-px font-mono text-muted-foreground line-through decoration-border'>
            {change.from}
          </span>
          <span aria-hidden>→</span>
          <span className='rounded bg-primary/10 px-1 py-px font-mono text-foreground'>
            {change.to}
          </span>
        </>
      ) : change.kind === 'added' ? (
        <>
          <span className='sr-only'>set to </span>
          <span className='rounded bg-primary/10 px-1 py-px font-mono text-foreground'>
            {change.to}
          </span>
        </>
      ) : (
        <>
          <span className='rounded bg-destructive/10 px-1 py-px font-mono text-destructive line-through decoration-destructive/40'>
            {change.from}
          </span>
          <span className='text-muted-foreground'>(removed)</span>
        </>
      )}
    </div>
  )
}

function RawPayload({ event }: { event: AuditEventWire }) {
  return (
    <details className='pt-1'>
      <summary className='cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground'>
        Raw event
      </summary>
      <pre className='mt-1 overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-snug text-muted-foreground'>
        {JSON.stringify(
          {
            sequence: event.sequence,
            entityType: event.entityType,
            operation: event.operation,
            actorUserId: event.actorUserId,
            payload: event.payload,
          },
          null,
          2,
        )}
      </pre>
    </details>
  )
}

function GroupRow({ group }: { group: { primary: AuditEventWire; related: AuditEventWire[] } }) {
  const described = describeAuditEvent(group.primary)
  const Icon = iconFor(group.primary)
  const link = auditLinkFor(group.primary)
  const correlated =
    group.related.length > 0 && group.primary.entityType === 'api_credential'

  return (
    <li className='relative flex gap-3 pb-4 last:pb-0'>
      <span
        aria-hidden='true'
        className='absolute left-4 top-9 h-[calc(100%-1.5rem)] w-px bg-border last:hidden'
      />
      <span className='relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground'>
        <Icon className='size-3.5' aria-hidden='true' />
      </span>
      <div className='min-w-0 flex-1 pt-0.5'>
        <p className='flex flex-wrap items-center gap-x-1.5 text-sm'>
          <span className='font-medium'>{actorLabel(group.primary)}</span>
          <span className='text-muted-foreground'>{described.action}</span>
          <span className='truncate font-medium'>{described.subject}</span>
          {correlated ? (
            <Badge variant='outline' className='h-4 px-1 text-[10px]'>
              rotation
            </Badge>
          ) : null}
        </p>
        <p className='text-xs text-muted-foreground'>
          <time dateTime={group.primary.createdAt}>
            {formatRelativeTime(group.primary.createdAt)}
          </time>{' '}
          · {formatNotebookDateTime(group.primary.createdAt)}
        </p>
        {described.changes.length > 0 || group.related.length > 0 ? (
          <div className='mt-1 space-y-1'>
            {described.changes.map((change) => (
              <ChangeChip key={change.label} change={change} />
            ))}
            {group.related.map((related) => {
              const relatedDescribed = describeAuditEvent(related)
              return (
                <div
                  key={related.id}
                  className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'
                >
                  <span aria-hidden>↳</span>
                  {relatedDescribed.action}{' '}
                  {relatedDescribed.subject}
                </div>
              )
            })}
          </div>
        ) : null}
        <div className='mt-0.5 flex flex-wrap items-center gap-3'>
          {link ? (
            <a
              href={link.href}
              className='inline-flex items-center gap-1 text-xs font-medium text-primary no-underline hover:underline'
            >
              {link.label}
            </a>
          ) : null}
          <RawPayload event={group.primary} />
        </div>
      </div>
    </li>
  )
}

export function ObjectHistoryTimeline({
  events,
  loading = false,
  error = null,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  maxHeight = '32rem',
  className,
}: ObjectHistoryTimelineProps) {
  const [showRawOnly] = useState(false)
  void showRawOnly

  if (loading) {
    return (
      <div className={cn('space-y-3', className)} aria-busy='true' aria-live='polite'>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className='flex gap-3'>
            <Skeleton className='size-8 shrink-0 rounded-full' />
            <div className='flex-1 space-y-1.5 pt-1'>
              <Skeleton className='h-3.5 w-2/3' />
              <Skeleton className='h-3 w-1/3' />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p role='alert' className='rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
        {error}
      </p>
    )
  }

  const groups = groupAuditEvents(events)

  if (groups.length === 0) {
    return (
      <p className='rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground'>
        No recorded activity for this object yet.
      </p>
    )
  }

  return (
    <div className={className}>
      <ol className='overflow-y-auto pr-1' style={{ maxHeight }} aria-label='Object history'>
        {groups.map((group) => (
          <GroupRow key={group.primary.id} group={group} />
        ))}
      </ol>
      {hasMore && onLoadMore ? (
        <div className='pt-3'>
          <Button variant='outline' size='sm' onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
