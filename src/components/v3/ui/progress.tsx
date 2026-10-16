import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from '#/lib/utils'

/**
 * A horizontal quantity bar — the one the app renders a value against a
 * maximum with.
 *
 * Four renderings existed before it, in three bar styles and three fill
 * vocabularies: one correct `role="progressbar"`, two `role="img"` bars whose
 * only accessible content was a prose sentence (so an assistive-technology user
 * heard "3 of 9 experiments approved" where a value was meant), and one bare
 * `{n}%` text with no bar at all. The track height, the roundedness, the
 * unfilled colour and the fill colour were spelled out at each site.
 *
 * Two shapes, one component, because they are two readings of the same bar:
 *
 * - **A single value** — `value` with `max`. Base UI's Progress owns the
 *   `progressbar` role and the value attributes, `valueText` gives the
 *   human-readable reading, and `value={null}` is honestly indeterminate.
 * - **A ledger of parts** — `segments`, e.g. a sample's used / reserved / free
 *   quantity. There is no single value to report, so it keeps the image role
 *   with the caller's sentence as its label; what it takes from here is the
 *   track chrome. Which segments exist and what each colour means stays with the
 *   domain component.
 *
 * What stays with the caller: the visible text (a caption, a percentage note),
 * the tone — the state vocabulary is the domain's, this component only names
 * the fills that exist — and the meaning of the quantity.
 */

/** Fill vocabulary. Semantics belong to the caller; these are the app's fills. */
export type ProgressTone =
  'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const FILL: Record<ProgressTone, string> = {
  neutral: 'bg-fg-muted',
  accent: 'bg-chart-1',
  success: 'bg-success',
  warning: 'bg-warning-text',
  danger: 'bg-danger-text',
}

/**
 * `sm` is the inline bar beside a figure; `md` is the stacked ledger bar, whose
 * square corners mark it as a composition rather than a single measure.
 */
const TRACK = {
  sm: 'h-1.5 rounded-full',
  md: 'h-2.5 rounded-sm',
} as const

/** One part of a stacked bar. */
export interface ProgressSegment {
  /** Width as a percentage of the whole; clamped to 0–100. */
  readonly value: number
  /** Fill class for this part, e.g. `bg-fg-muted`. */
  readonly className: string
}

type ProgressCommonProps = {
  /** Accessible name of the quantity, e.g. "Hold time used". */
  readonly label: string
  readonly size?: keyof typeof TRACK
  readonly className?: string
}

type SingleValueProps = {
  /** The current value; `null` renders an indeterminate bar. */
  readonly value: number | null
  /** The maximum `value` is measured against. */
  readonly max?: number
  readonly tone?: ProgressTone
  /**
   * The value said in words, e.g. "3 of 9 experiments approved". Read instead
   * of the bare number, which a screen reader would otherwise announce alone.
   */
  readonly valueText?: string
  readonly segments?: never
}

type SegmentedProps = {
  readonly segments: readonly ProgressSegment[]
  readonly value?: never
  readonly max?: never
  readonly tone?: never
  readonly valueText?: never
}

export type ProgressProps = ProgressCommonProps &
  (SingleValueProps | SegmentedProps)

export function Progress(props: ProgressProps) {
  const { label, size = 'sm', className } = props
  const track = cn('w-full overflow-hidden bg-skeleton', TRACK[size])
  const max = Math.max(props.max ?? 100, 1)

  if (props.segments) {
    return (
      <div
        role="img"
        aria-label={label}
        data-slot="progress"
        className={cn(track, 'flex', className)}
      >
        {props.segments.map((segment, index) => (
          <div
            key={index}
            data-slot="progress-segment"
            style={{ width: `${clampPercent(segment.value)}%` }}
            className={segment.className}
          />
        ))}
      </div>
    )
  }

  return (
    <ProgressPrimitive.Root
      value={drawable(props.value)}
      min={0}
      // A zero maximum measures nothing against nothing: clamp it so the
      // percentage stays a number (and the bar stays empty) rather than NaN.
      max={max}
      getAriaValueText={
        props.valueText ? () => props.valueText as string : undefined
      }
      aria-label={label}
      data-slot="progress"
      className={cn(track, className)}
    >
      <ProgressPrimitive.Track className="h-full w-full">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn('h-full', FILL[props.tone ?? 'neutral'])}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

/** A caller's own arithmetic can overshoot; an overshooting bar cannot. */
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * The value the bar can actually report.
 *
 * ARIA's number grammar has no exponential notation, so `1.6e-19` is not a
 * valid `aria-valuenow` and axe fails `aria-valid-attr-value` on it — found by
 * the comparison harness's high-precision fixture, against this component. A
 * bar a few hundred pixels wide cannot draw a fraction of a per-mille of its
 * range anyway, so the value is rounded to that resolution; a caller's exact
 * figure belongs in `valueText`, which this component passes through untouched.
 */
function drawable(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const rounded = Number(value.toFixed(3))
  return Object.is(rounded, -0) ? 0 : rounded
}
