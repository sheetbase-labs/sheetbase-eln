import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * StatStrip — the bordered "value label · value label · …" band that sits
 * under a registry/overview header (V2ALT patterns). Values are bold tabular
 * figures; labels stay muted; optional tone colours an item for attention
 * (low stock, expired, overdue).
 */
const statStripItemVariants = cva('inline-flex items-baseline gap-1 text-sm', {
  variants: {
    tone: {
      neutral: '',
      positive: 'text-success',
      warning: 'text-warning-foreground dark:text-warning',
      danger: 'text-destructive',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface StatStripItem {
  label: string
  value: React.ReactNode
  tone?: VariantProps<typeof statStripItemVariants>['tone']
  /** Extra context shown on hover and to assistive tech. */
  hint?: string
}

interface StatStripProps extends React.HTMLAttributes<HTMLDivElement> {
  items: StatStripItem[]
  /** Right-aligned muted context (e.g. "Across all projects"). */
  meta?: React.ReactNode
}

function StatStrip({ items, meta, className, ...props }: StatStripProps) {
  return (
    <div
      data-slot="stat-strip"
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-border bg-surface px-3 py-2',
        className,
      )}
      {...props}
    >
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground/60">
              ·
            </span>
          ) : null}
          <span
            className={cn(statStripItemVariants({ tone: item.tone }))}
            title={item.hint}
          >
            <span className="font-semibold tabular-nums">{item.value}</span>
            <span
              className={cn(
                item.tone && item.tone !== 'neutral'
                  ? undefined
                  : 'text-muted-foreground',
              )}
            >
              {item.label}
            </span>
          </span>
        </React.Fragment>
      ))}
      {meta ? (
        <span className="ml-auto text-xs text-muted-foreground">{meta}</span>
      ) : null}
    </div>
  )
}

export { StatStrip, type StatStripProps }
