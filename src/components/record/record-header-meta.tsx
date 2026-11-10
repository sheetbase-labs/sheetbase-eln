import * as React from 'react'

import { rich } from '#/copy'
import { Avatar, AvatarStack } from '#/components/ui/avatar'

export interface RecordHeaderContributor {
  name: string
  initials?: string
  href?: string
}

/**
 * The third line of a record header: who owns the record, when it last changed,
 * who contributes to it and how it is tagged. It is separated from the title by
 * a rule, and renders nothing at all when the record provides none of them, so
 * a bare record has a two-line header rather than an empty third.
 */
export function RecordHeaderMeta({
  owner,
  updatedAt,
  contributors,
  tags,
}: {
  owner?: { name: string; initials?: string }
  updatedAt?: React.ReactNode
  contributors?: RecordHeaderContributor[]
  tags?: React.ReactNode
}) {
  const hasMeta = Boolean(owner || updatedAt || contributors?.length || tags)

  if (!hasMeta) return null

  return (
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
  )
}
