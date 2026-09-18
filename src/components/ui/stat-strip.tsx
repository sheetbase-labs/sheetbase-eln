import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

/**
 * StatStrip — the bordered "value label · value label · …" band that sits
 * under a registry/overview header (V2ALT patterns). Values are bold tabular
 * figures; labels stay muted; optional tone colours an item for attention
 * (low stock, expired, overdue).
 */
const statStripItemVariants = cva('inline-flex items-center gap-1.5 text-sm', {
  variants: {
    tone: {
      neutral: '',
      positive: 'text-success',
      warning: 'text-warning-foreground dark:text-warning',
      danger: 'text-destructive',
      violet: 'text-violet',
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
  /** Leading icon — the V2ALT stat band marks each item by object kind. */
  icon?: LucideIcon
}

interface StatStripProps extends React.HTMLAttributes<HTMLDivElement> {
  items: StatStripItem[]
  /** Right-aligned muted context (e.g. "Across all projects"). */
  meta?: React.ReactNode
  /**
   * `strip` renders the bordered inline band (V2ALT registries);
   * `cards` renders one bordered card per stat with the caps label above
   * the value and the hint as a subtitle (V2ALT overview pages such as
   * Review inbox).
   */
  variant?: 'strip' | 'cards'
}

function StatStrip({
  items,
  meta,
  variant = 'strip',
  className,
  ...props
}: StatStripProps) {
  if (variant === 'cards') {
    return (
      <div
        data-slot="stat-strip"
        className={cn(
          'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4',
          className,
        )}
        {...props}
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-border bg-card px-4 py-3"
          >
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {item.label}
            </p>
            <p
              className={cn(
                'mt-1 font-display text-title font-heading tabular-nums',
                statStripItemVariants({ tone: item.tone }),
              )}
            >
              {item.value}
            </p>
            {item.hint ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.hint}
              </p>
            ) : null}
          </div>
        ))}
        {meta ? (
          <span className="col-span-full text-xs text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </div>
    )
  }
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
            {item.icon ? (
              <item.icon
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : null}
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
