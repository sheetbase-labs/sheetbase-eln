import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '#/components/ui/card'
import { cn } from '#/lib/utils'

export type MetricCardHintTone =
  'default' | 'warning' | 'danger' | 'info' | 'success'

export interface MetricCardProps {
  label: string
  value: string | number
  hint?: string
  hintTone?: MetricCardHintTone
  icon?: LucideIcon
  sparkline?: ReactNode
  className?: string
}

const hintToneClasses: Record<MetricCardHintTone, string> = {
  default: 'text-muted-foreground',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  success: 'text-success',
}

/** A compact summary card for dashboard and registry metric grids. */
export function MetricCard({
  label,
  value,
  hint,
  hintTone = 'default',
  icon: Icon,
  sparkline,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-xs font-medium text-muted-foreground">
            {label}
          </p>
          {Icon ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex min-w-0 items-end justify-between gap-3">
          <p className="font-display text-2xl font-bold leading-none tabular-nums">
            {value}
          </p>
          {sparkline ? <div className="min-w-0 shrink">{sparkline}</div> : null}
        </div>
        {hint ? (
          <p className={cn('mt-1 text-xs', hintToneClasses[hintTone])}>
            {hint}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
