import * as React from 'react'
import { MoreHorizontal, Star } from 'lucide-react'

import { cn } from '#/lib/utils'
import { Badge, Button, Separator } from '#/components/ui'

/**
 * Compact record header — the identity strip above a project, experiment,
 * protocol or dataset. Every field is optional so a record type only shows
 * what it actually provides (UI-004: "fields disappear cleanly").
 *
 * Layout (from the Experiment Notebook / Project Dashboard mockups):
 *   type · status … identifier
 *   Title                         ⭐  …  actions
 *   owner · updated · contributors · tags
 */

export interface RecordHeaderContributor {
  name: string
  initials?: string
  href?: string
}

export interface RecordHeaderProps {
  /** Record kind, e.g. "Project", "Experiment", "Protocol". */
  recordType: string
  title: string
  /** Stable identifier, e.g. "EXP-2025-0014". Omit to hide. */
  identifier?: string
  /** Status badge node (StatusBadge once UI-005 ships it). */
  status?: React.ReactNode
  /** Secondary state pill, e.g. "Phase 2". */
  phase?: React.ReactNode
  /** Owner name and optional initials for the avatar. */
  owner?: { name: string; initials?: string }
  /** Relative or absolute "updated" label. */
  updatedAt?: React.ReactNode
  /** Contributors rendered as a stacked avatar group. */
  contributors?: RecordHeaderContributor[]
  /** Tag badges. */
  tags?: React.ReactNode
  /** Starred state + toggle. */
  starred?: boolean
  onToggleStar?: () => void
  /** Action buttons/links rendered at the right edge. */
  actions?: React.ReactNode
  /** Overflow menu node rendered after actions. */
  menu?: React.ReactNode
  className?: string
}

function Avatar({
  name,
  initials,
  size = 'sm',
}: {
  name: string
  initials?: string
  size?: 'sm' | 'md'
}) {
  const text = (initials ?? name.slice(0, 2)).toUpperCase()
  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-2 ring-background',
        size === 'sm' ? 'size-6 text-xs' : 'size-8 text-xs',
      )}
    >
      {text}
    </span>
  )
}

export function RecordHeader({
  recordType,
  title,
  identifier,
  status,
  phase,
  owner,
  updatedAt,
  contributors,
  tags,
  starred,
  onToggleStar,
  actions,
  menu,
  className,
}: RecordHeaderProps) {
  const hasMeta = Boolean(owner || updatedAt || contributors?.length || tags)

  return (
    <header className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {recordType}
        </span>
        {identifier ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {identifier}
          </span>
        ) : null}
        {status ? <span className="ml-1">{status}</span> : null}
        {phase ? <span>{phase}</span> : null}
      </div>

      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {onToggleStar ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={starred ? 'Unstar record' : 'Star record'}
            aria-pressed={starred}
            onClick={onToggleStar}
          >
            <Star
              className={cn('size-4', starred && 'fill-current text-primary')}
            />
          </Button>
        ) : null}
        {actions}
        {menu ?? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More actions"
            disabled
          >
            <MoreHorizontal className="size-4" />
          </Button>
        )}
      </div>

      {hasMeta ? (
        <>
          <Separator />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {owner ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={owner.name} initials={owner.initials} size="sm" />
                <span className="text-foreground">{owner.name}</span>
              </span>
            ) : null}
            {updatedAt ? (
              <span>
                Updated <span className="text-foreground">{updatedAt}</span>
              </span>
            ) : null}
            {contributors && contributors.length > 0 ? (
              <span className="inline-flex -space-x-1.5">
                {contributors.slice(0, 5).map((c, i) => (
                  <Avatar
                    key={`${c.name}-${i}`}
                    name={c.name}
                    initials={c.initials}
                  />
                ))}
                {contributors.length > 5 ? (
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium ring-2 ring-background">
                    +{contributors.length - 5}
                  </span>
                ) : null}
              </span>
            ) : null}
            {tags ? (
              <span className="inline-flex flex-wrap gap-1">{tags}</span>
            ) : null}
          </div>
        </>
      ) : null}
    </header>
  )
}

export { Avatar as RecordHeaderAvatar, Badge as RecordHeaderBadge }
