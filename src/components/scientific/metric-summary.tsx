import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

/** Inline summary for overview strips where counts support the work below. */
export function MetricSummary({
  label,
  value,
  valueDescription,
  hint,
  hintClassName,
  detail,
}: {
  label: string
  value: ReactNode
  valueDescription?: string
  hint?: string
  hintClassName?: string
  detail?: string
}) {
  return (
    <div className="grid h-full grid-cols-[3ch_minmax(0,1fr)] content-start items-baseline gap-x-2 gap-y-1 px-2 py-1 text-sm leading-5">
      <div
        className="text-right font-semibold tabular-nums text-foreground"
        title={valueDescription}
      >
        {value}
      </div>
      <p className="min-w-0 font-medium text-foreground">{label}</p>
      {hint ? (
        <p
          className={cn(
            'col-start-2 text-xs leading-4 text-muted-foreground',
            hintClassName,
          )}
        >
          {hint}
        </p>
      ) : null}
      {detail ? (
        <p className="col-start-2 text-xs leading-4 text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  )
}
