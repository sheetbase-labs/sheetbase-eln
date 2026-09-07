import * as React from 'react'
import {
  FileImage,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  Link2,
  Plus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge } from '#/components/ui'
import { cn } from '#/lib/utils'

/**
 * Reusable inspector sections — the building blocks that fill an Inspector
 * tab. Each is a small, typed, presentational component.
 *
 * Inspector metadata is compact and flat: sections are divided rather than
 * carded, while statuses and linked records retain their semantic treatment.
 */

/** Owns the standard 16px cadence between inspector sections. */
export function InspectorSectionStack({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('space-y-4', className)}>{children}</div>
}

/** A labelled section inside an inspector tab. */
export function InspectorSection({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'border-t border-border pt-4 first:border-t-0 first:pt-0',
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Linked-record row. UI-005 hardens this into the full RecordLink. */
export interface LinkedRecordItem {
  id: string
  type: string
  title: string
  meta?: string
  href?: string
  icon?: LucideIcon
}

export function LinkedRecordList({ items }: { items: LinkedRecordItem[] }) {
  if (items.length === 0) return <EmptyHint>No linked records</EmptyHint>
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon ?? Link2
        const body = (
          <>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {item.title}
              </span>
              {item.meta ? (
                <span className="block truncate text-[0.65rem] text-muted-foreground">
                  {item.type} · {item.meta}
                </span>
              ) : (
                <span className="block truncate text-[0.65rem] text-muted-foreground">
                  {item.type}
                </span>
              )}
            </span>
          </>
        )
        return (
          <li key={item.id}>
            {item.href ? (
              <a
                href={item.href}
                className="flex items-center gap-2 rounded-md border border-border/80 bg-surface px-2 py-1.5 no-underline transition-colors hover:border-border hover:bg-muted/50"
              >
                {body}
              </a>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-border/80 bg-surface px-2 py-1.5">
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** File row. */
export interface FileItem {
  id: string
  name: string
  meta?: string
  /** File size string (e.g. "12.6 MB"), shown right-aligned. */
  size?: string
  /** MIME type or extension, used to pick the file-type icon. */
  mediaType?: string
  href?: string
}

/** Pick a file-type icon + accent colour from the media type. */
function fileTypeIcon(mediaType?: string): {
  icon: LucideIcon
  className: string
} {
  const mt = (mediaType ?? '').toLowerCase()
  if (
    mt.includes('spreadsheet') ||
    mt.includes('excel') ||
    mt.includes('csv') ||
    mt.endsWith('.xlsx') ||
    mt.endsWith('.csv') ||
    mt.endsWith('.tsv')
  ) {
    return { icon: FileSpreadsheet, className: 'text-success' }
  }
  if (mt.includes('pdf') || mt.endsWith('.pdf')) {
    return { icon: FileText, className: 'text-destructive' }
  }
  if (
    mt.includes('image') ||
    mt.endsWith('.png') ||
    mt.endsWith('.jpg') ||
    mt.endsWith('.jpeg') ||
    mt.endsWith('.gif') ||
    mt.endsWith('.webp') ||
    mt.endsWith('.svg')
  ) {
    return { icon: FileImage, className: 'text-info' }
  }
  if (mt.includes('text') || mt.endsWith('.txt') || mt.endsWith('.md')) {
    return { icon: FileText, className: 'text-muted-foreground' }
  }
  return { icon: FileIcon, className: 'text-muted-foreground' }
}

export function FileList({ items }: { items: FileItem[] }) {
  if (items.length === 0) return <EmptyHint>No attached files</EmptyHint>
  return (
    <ul className="space-y-0.5">
      {items.map((f) => {
        const { icon: Icon, className: iconCls } = fileTypeIcon(
          f.mediaType ?? f.meta,
        )
        const body = (
          <>
            <Icon
              className={cn('size-3.5 shrink-0', iconCls)}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {f.name}
            </span>
            {f.size ? (
              <span className="shrink-0 text-[0.65rem] tabular-nums text-muted-foreground">
                {f.size}
              </span>
            ) : null}
          </>
        )
        return (
          <li key={f.id}>
            {f.href ? (
              <a
                href={f.href}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 no-underline hover:bg-muted/50"
              >
                {body}
              </a>
            ) : (
              <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Compliance/quality check row. */
export type CheckState = 'pass' | 'fail' | 'pending' | 'warning'

export interface CheckItem {
  id: string
  label: string
  state: CheckState
  detail?: string
}

const checkBadge: Record<
  CheckState,
  { label: string; variant: 'success' | 'danger' | 'outline' | 'warning' }
> = {
  pass: { label: 'Passed', variant: 'success' },
  fail: { label: 'Failed', variant: 'danger' },
  pending: { label: 'Pending', variant: 'outline' },
  warning: { label: 'Warning', variant: 'warning' },
}

export function CheckList({ items }: { items: CheckItem[] }) {
  if (items.length === 0) return <EmptyHint>No checks</EmptyHint>
  return (
    <ul className="space-y-0.5">
      {items.map((c) => {
        const badge = checkBadge[c.state]
        return (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-md px-1 py-1"
          >
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {c.label}
            </span>
            {c.detail ? (
              <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                {c.detail}
              </span>
            ) : null}
            <Badge
              variant={badge.variant}
              className="shrink-0 px-1.5 py-0 text-[0.65rem]"
            >
              {badge.label}
            </Badge>
            <span className="sr-only">{c.state}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Simple activity row. UI-007 hardens this into the full AuditTrail. */
export interface ActivityItem {
  id: string
  actor: { name: string; initials?: string }
  action: string
  target?: string
  at: string
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <EmptyHint>No activity yet</EmptyHint>
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2.5">
          <span
            title={a.actor.name}
            aria-label={a.actor.name}
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
          >
            {(a.actor.initials ?? a.actor.name.slice(0, 2)).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs leading-5 text-foreground">
              <span className="font-medium">{a.actor.name}</span>{' '}
              <span className="text-muted-foreground">{a.action}</span>
              {a.target ? (
                <>
                  {' '}
                  <span className="font-medium">{a.target}</span>
                </>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">{a.at}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Comment row. */
export interface CommentItem {
  id: string
  author: { name: string; initials?: string }
  body: string
  at: string
}

export function CommentList({ items }: { items: CommentItem[] }) {
  if (items.length === 0) return <EmptyHint>No comments</EmptyHint>
  return (
    <ul className="space-y-3">
      {items.map((c) => (
        <li key={c.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span
                title={c.author.name}
                aria-label={c.author.name}
                className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
              >
                {(c.author.initials ?? c.author.name.slice(0, 2)).toUpperCase()}
              </span>
              <span className="text-xs font-medium">{c.author.name}</span>
            </span>
            <span className="text-xs text-muted-foreground">{c.at}</span>
          </div>
          <p className="break-words text-xs leading-5 text-foreground">
            {c.body}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-xs text-muted-foreground">{children}</p>
}

// ---------------------------------------------------------------------------
// Rich inspector components — modelled on the concept mockup's dense,
// visually rich property panel. These supplement the basic Property/File/
// Check rows with the compact visual elements the mockup uses: avatar
// stacks, coloured tag pills, count-annotated link buttons.
// ---------------------------------------------------------------------------

/** Contributor avatar stack — overlapping initial circles with +N overflow. */
export function ContributorAvatars({
  contributors,
  max = 4,
  size = 'sm',
}: {
  contributors: { id: string; name: string; initials?: string }[]
  max?: number
  size?: 'sm' | 'md'
}) {
  const visible = contributors.slice(0, max)
  const overflow = contributors.length - visible.length
  const dim = size === 'sm' ? 'size-5 text-[0.6rem]' : 'size-6 text-xs'

  if (contributors.length === 0) return null

  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {visible.map((c) => (
          <span
            key={c.id}
            title={c.name}
            aria-label={c.name}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full border border-background bg-primary/15 font-semibold text-primary',
              dim,
            )}
          >
            {(c.initials ?? c.name.slice(0, 2)).toUpperCase()}
          </span>
        ))}
      </div>
      {overflow > 0 ? (
        <span
          className={cn(
            'ml-1.5 flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground',
            dim,
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}

/** Coloured tag pills with optional add button. */
export function TagPills({
  tags,
  onAdd,
}: {
  tags: string[]
  onAdd?: () => void
}) {
  if (tags.length === 0 && !onAdd) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag} variant="violet" className="px-2 py-0 text-[0.65rem]">
          {tag}
        </Badge>
      ))}
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Add tag"
        >
          <Plus className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

/** Compact "Link to" count buttons — e.g. Samples (2), Protocol (1). */
export interface LinkToItem {
  label: string
  count: number
  icon?: LucideIcon
  onClick?: () => void
}

export function LinkToPills({ items }: { items: LinkToItem[] }) {
  if (items.length === 0) return <EmptyHint>No linked records</EmptyHint>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => {
        const Icon = item.icon ?? Link2
        return (
          <button
            key={i}
            type="button"
            onClick={item.onClick}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-input hover:bg-muted/50"
          >
            <Icon className="size-3 text-muted-foreground" aria-hidden="true" />
            {item.label}
            {item.count > 0 ? (
              <span className="tabular-nums text-muted-foreground">
                ({item.count})
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** "Add property" link — the mockup's blue action at the bottom of properties. */
export function AddPropertyLink({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
    >
      <Plus className="size-3" />
      Add property
    </button>
  )
}
