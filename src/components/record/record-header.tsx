import { rich, t } from '#/copy'
import * as React from 'react'
import { Star } from 'lucide-react'
import { PresenceStack } from '#/components/collaboration/presence-avatars'

import { cn } from '#/lib/utils'
import { Avatar, AvatarStack } from '#/components/v3/ui/avatar'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'

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
        <span className="font-semibold uppercase tracking-[0.14em] text-fg-muted">
          {recordType}
        </span>
        {identifier ? (
          <span className="font-mono text-xs tabular-nums text-fg-muted">
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
            variant="quiet"
            size="icon"
            aria-label={
              starred
                ? t('notebook.recordHeader.ariaLabel')
                : t('notebook.recordHeader.starRecordAriaLabel')
            }
            aria-pressed={starred}
            onClick={onToggleStar}
          >
            <Star
              className={cn('size-4', starred && 'fill-current text-primary')}
            />
          </Button>
        ) : null}
        <PresenceStack />
        {actions}
        {menu ?? (
          <Button
            variant="quiet"
            size="icon"
            aria-label={t('notebook.recordHeader.moreActionsAriaLabel')}
            disabled
          >
            <Icon name="more" size={16} />
          </Button>
        )}
      </div>

      {hasMeta ? (
        <>
          <div className="border-t border-border" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
            {owner ? (
              <span className="inline-flex items-center gap-2">
                <Avatar
                  name={owner.name}
                  initials={owner.initials}
                  size="sm"
                  className="ring-2 ring-surface"
                />
                <span className="text-fg">{owner.name}</span>
              </span>
            ) : null}
            {updatedAt ? (
              <span>
                {rich('notebook.recordHeader.updated', {
                  when: <span className="text-fg">{updatedAt}</span>,
                })}
              </span>
            ) : null}
            {contributors && contributors.length > 0 ? (
              <AvatarStack
                people={contributors.map((contributor) => ({
                  id: contributor.href,
                  name: contributor.name,
                  initials: contributor.initials,
                }))}
                max={5}
              />
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

export { Badge as RecordHeaderBadge }
