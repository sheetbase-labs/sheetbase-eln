import { cn } from '#/lib/utils'

/**
 * Dot (DSYS-03/04): the design's status dot on the nine tones. Pair with a
 * text label; never carry meaning by colour alone.
 */
const DOT_TONE = {
  neutral: 'bg-neutral-dot',
  muted: 'bg-border-strong',
  accent: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  review: 'bg-review',
  analysis: 'bg-analysis',
} as const

export type DotTone = keyof typeof DOT_TONE

export interface DotProps {
  tone?: DotTone
  /** Accessible name when the dot carries meaning on its own. */
  label?: string
  className?: string
}

export function Dot({ tone = 'neutral', label, className }: DotProps) {
  return (
    <span
      data-slot="dot"
      data-tone={tone}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={cn(
        'inline-block size-1.5 rounded-full',
        DOT_TONE[tone],
        className,
      )}
    />
  )
}
