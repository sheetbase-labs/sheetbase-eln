import { BRAND_MARK_SPOKES } from '#/components/ui/brand-mark-spokes'
import { cn } from '#/lib/utils'

/**
 * The mark's chase index reaches CSS as `--i`. csstype has no key for custom
 * properties, so the index is declared on this style contract instead of being
 * asserted where it is set.
 */
type SpokeStyle = React.CSSProperties & { '--i': number }

/**
 * The one working indicator: the Sheetbase mark, with a bright spoke chasing
 * clockwise round the ring.
 *
 * The mark repeats every 30°, so turning it whole reads as a shimmer rather
 * than movement at text size. Fading its twelve spokes in turn reads as
 * "working" at every size, from 12px beside a label to a page loader. With
 * reduced motion asked for, the chase stops and the mark fades gently in
 * place instead (`.brand-spinner` in `styles.css`).
 *
 * This component owns the glyph, the animation and the label; the neighbouring
 * text owns the meaning ("Saving…", "Connecting…", "Upgrading…").
 *
 * Naming, because it is the whole accessibility story:
 *
 * - **Beside a visible label** — the common case — pass no `label`. The
 *   indicator is `aria-hidden`, and the text node beside it is what a screen
 *   reader reads.
 * - **Standing alone** — a spinner with no text beside it — pass `label`. It
 *   becomes a polite live region naming the work, which is the only thing an
 *   assistive-technology user has to go on.
 * - **A region that is busy** — put `aria-busy` on the container that is
 *   loading, not here; the story shows the pattern. A spinner is a visual
 *   restatement of `aria-busy`, never a substitute for it.
 *
 * Sizes: 12–14 beside text and in buttons, 16–24 for a block, 32–48 for a
 * page or panel that has nothing else to show yet.
 */
export function Spinner({
  label,
  size = 12,
  className,
  ...props
}: {
  /** Accessible name, for a spinner with no visible text beside it. */
  label?: string
  /** Rendered size in px. 12 suits text and buttons; 16 a standalone block. */
  size?: number
} & Omit<React.ComponentProps<'svg'>, 'name'>) {
  return (
    <svg
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      width={size}
      height={size}
      viewBox="0 0 2000 2000"
      fill="currentColor"
      data-slot="spinner"
      className={cn('brand-spinner shrink-0', className)}
      {...props}
    >
      {BRAND_MARK_SPOKES.map((d, i) => {
        const style: SpokeStyle = { '--i': i }

        return <path key={i} d={d} style={style} />
      })}
    </svg>
  )
}
