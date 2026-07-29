import * as React from 'react'
import {
  CheckCircle2,
  Circle,
  Clock,
  Paperclip,
  Link2,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

/**
 * Reusable inspector sections — the building blocks that fill an Inspector
 * tab. Each is a small, typed, presentational component. UI-005 hardens
 * PropertyList/RecordLink/StatusBadge and UI-007 hardens AuditTrail and
 * ApprovalStepper; the contracts here stay stable so those tickets improve
 * rather than replace them.
 *
 * Long identifiers, units, tags and user-provided text are truncated with
 * `min-w-0 truncate` so the inspector stays usable at narrow widths.
 */

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
    <section className={cn('border-t border-border pt-2 pb-1 first:border-t-0 first:pt-0', className)}>
      <h3 className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {action ? <div className="float-right">{action}</div> : null}
      <div className="clear-both">{children}</div>
    </section>
  )
}

/** Key/value property list (UI-004 contract; UI-005 hardens status within). */
export function PropertyList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <dl className={cn('space-y-1 text-xs', className)}>{children}</dl>
}

export function Property({
  label,
  children,
  mono,
}: {
  label: string
  children: React.ReactNode
  /** Render the value in the mono/scientific font (identifiers, numbers). */
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right font-medium text-foreground',
          mono && 'font-mono tabular-nums',
        )}
      >
        {children}
      </dd>
    </div>
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
  href?: string
}

export function FileList({ items }: { items: FileItem[] }) {
  if (items.length === 0) return <EmptyHint>No attached files</EmptyHint>
  return (
    <ul className="space-y-1">
      {items.map((f) => {
        const Icon = Paperclip
        const body = (
          <>
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {f.name}
              </span>
              {f.meta ? (
                <span className="block truncate text-[0.65rem] text-muted-foreground">
                  {f.meta}
                </span>
              ) : null}
            </span>
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

/** Compliance/quality check row. UI-007 hardens the approval workflow. */
export type CheckState = 'pass' | 'fail' | 'pending' | 'warning'

export interface CheckItem {
  id: string
  label: string
  state: CheckState
  detail?: string
}

const checkIcon: Record<CheckState, { icon: LucideIcon; className: string }> = {
  pass: {
    icon: CheckCircle2,
    className: 'text-success',
  },
  fail: { icon: XCircle, className: 'text-destructive' },
  pending: { icon: Clock, className: 'text-muted-foreground' },
  warning: { icon: Circle, className: 'text-warning-foreground' },
}

export function CheckList({ items }: { items: CheckItem[] }) {
  if (items.length === 0) return <EmptyHint>No checks</EmptyHint>
  return (
    <ul className="space-y-0.5">
      {items.map((c) => {
        const { icon: Icon, className } = checkIcon[c.state]
        return (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-md px-1 py-1"
          >
            <Icon
              className={cn('size-3.5 shrink-0', className)}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {c.label}
            </span>
            {c.detail ? (
              <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                {c.detail}
              </span>
            ) : null}
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
  return (
    <p className="py-1 text-xs text-muted-foreground">
      {children}
    </p>
  )
}
