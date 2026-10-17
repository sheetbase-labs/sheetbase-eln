import * as React from 'react'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Row, RowList } from '#/components/v3/ui/row'
import { Icon } from '#/components/v3/icons'
import { FileType, getFileType } from '#/components/reui/file-type'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * Reusable inspector sections — the building blocks that fill an Inspector
 * tab. Each is a small, typed, presentational component.
 *
 * Inspector metadata is compact and flat: sections are divided rather than
 * carded, while statuses and linked records retain their semantic treatment.
 * Every list here is a `RowList` of v3 `Row`s (JH-1), so a file row, a check
 * row and the entity rows beside them share one chrome.
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
        <h3 className="text-xs font-semibold text-fg">{title}</h3>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
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


/**
 * Resolve a row's type: the file name first, because a stored MIME type of
 * `application/octet-stream` says nothing about a name that ends `.xlsx`; the
 * media type only decides for names with no type in them.
 */
function fileTypeFor(file: FileItem): string {
  const fromName = getFileType(file.name)
  if (fromName !== 'empty') return fromName
  return getFileType(file.mediaType ?? file.meta ?? '')
}

export function FileList({ items }: { items: FileItem[] }) {
  return (
    <RowList
      className="gap-0.5"
      empty={<EmptyHint>No attached files</EmptyHint>}
    >
      {items.map((f) => {
        return (
          <Row
            key={f.id}
            href={f.href}
            leading={
              <FileType
                type={fileTypeFor(f)}
                size="mini"
                className="shrink-0"
              />
            }
            title={f.name}
            trailing={
              f.size ? (
                <span className="text-[0.65rem] tabular-nums text-fg-muted">
                  {f.size}
                </span>
              ) : null
            }
          />
        )
      })}
    </RowList>
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
  { label: string; variant: 'add' | 'del' | 'kind' | 'chg' }
> = {
  pass: { label: 'Passed', variant: 'add' },
  fail: { label: 'Failed', variant: 'del' },
  pending: { label: 'Pending', variant: 'kind' },
  warning: { label: 'Warning', variant: 'chg' },
}

export function CheckList({ items }: { items: CheckItem[] }) {
  return (
    <RowList className="gap-0.5" empty={<EmptyHint>No checks</EmptyHint>}>
      {items.map((c) => {
        const badge = checkBadge[c.state]
        return (
          <Row
            key={c.id}
            title={c.label}
            trailing={
              <>
                {c.detail ? (
                  <span className="text-[0.65rem] text-fg-muted">
                    {c.detail}
                  </span>
                ) : null}
                <Badge
                  variant={badge.variant}
                  className="px-1.5 py-0 text-[0.65rem]"
                >
                  {badge.label}
                </Badge>
                <span className="sr-only">{c.state}</span>
              </>
            }
          />
        )
      })}
    </RowList>
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
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-text"
          >
            {(a.actor.initials ?? a.actor.name.slice(0, 2)).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs leading-5 text-fg">
              <span className="font-medium">{a.actor.name}</span>{' '}
              <span className="text-fg-muted">{a.action}</span>
              {a.target ? (
                <>
                  {' '}
                  <span className="font-medium">{a.target}</span>
                </>
              ) : null}
            </p>
            <p className="text-xs text-fg-muted">{a.at}</p>
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
                className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-text"
              >
                {(c.author.initials ?? c.author.name.slice(0, 2)).toUpperCase()}
              </span>
              <span className="text-xs font-medium">{c.author.name}</span>
            </span>
            <span className="text-xs text-fg-muted">{c.at}</span>
          </div>
          <p className="break-words text-xs leading-5 text-fg">{c.body}</p>
        </li>
      ))}
    </ul>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-xs text-fg-muted">{children}</p>
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
              'flex shrink-0 items-center justify-center rounded-full border border-background bg-primary/15 font-semibold text-primary-text',
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
            'ml-1.5 flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-medium text-fg-muted',
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
        <Badge key={tag} variant="kind" className="px-2 py-0 text-[0.65rem]">
          {tag}
        </Badge>
      ))}
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex size-4 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
          aria-label="Add tag"
        >
          <Icon name="plus" size={12} />
        </button>
      ) : null}
    </div>
  )
}

/** Compact "Link to" count buttons — e.g. Samples (2), Protocol (1). */
export interface LinkToItem {
  label: string
  count: number
  icon?: IconName
  onClick?: () => void
}

export function LinkToPills({ items }: { items: LinkToItem[] }) {
  if (items.length === 0) return <EmptyHint>No linked records</EmptyHint>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => {
        const iconName = item.icon ?? 'link'
        return (
          <Button
            key={i}
            type="button"
            size="sm"
            variant="secondary"
            onClick={item.onClick}
          >
            <Icon
              name={iconName}
              size={12}
              className="text-fg-muted"
              aria-hidden="true"
            />
            {item.label}
            {item.count > 0 ? (
              <span className="tabular-nums text-fg-muted">({item.count})</span>
            ) : null}
          </Button>
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
      className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline"
    >
      <Icon name="plus" size={12} />
      Add property
    </button>
  )
}
