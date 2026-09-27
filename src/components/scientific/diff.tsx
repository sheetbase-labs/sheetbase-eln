import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

/**
 * Diff marker (DSYS-04): a before/after pair that stays legible without
 * colour, using `<del>` for the old value and `<ins>` for the new.
 */
export interface DiffProps {
  before?: ReactNode
  after?: ReactNode
  className?: string
}

export function Diff({ before, after, className }: DiffProps) {
  return (
    <span data-slot="diff" className={cn('whitespace-nowrap', className)}>
      {before != null ? (
        <del className="text-danger-text decoration-danger-text">{before}</del>
      ) : null}
      {before != null && after != null ? ' ' : null}
      {after != null ? (
        <ins className="text-success-text no-underline">{after}</ins>
      ) : null}
    </span>
  )
}
