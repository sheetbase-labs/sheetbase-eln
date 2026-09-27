import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

/**
 * Diff change marker (DSYS-04): a small `add` / `chg` / `del` tag on a
 * changed row or value, using the design's washes and text tokens.
 */
export type TagKind = 'add' | 'chg' | 'del'

const TAG_TONE: Record<TagKind, string> = {
  add: 'bg-success-wash text-success-text',
  chg: 'bg-warning-wash text-warning-text',
  del: 'bg-danger-wash text-danger-text',
}

const TAG_LABEL: Record<TagKind, string> = {
  add: 'Added',
  chg: 'Changed',
  del: 'Removed',
}

export interface TagProps {
  kind: TagKind
  children?: ReactNode
  className?: string
}

export function Tag({ kind, children, className }: TagProps) {
  return (
    <span
      data-slot="tag"
      data-kind={kind}
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-px text-[11px] font-medium',
        TAG_TONE[kind],
        className,
      )}
    >
      {children ?? TAG_LABEL[kind]}
    </span>
  )
}
