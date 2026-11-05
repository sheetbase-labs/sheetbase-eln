import { cn } from '#/lib/utils'

/**
 * The one working indicator.
 *
 * Six product sites hand-rolled `animate-spin`, over four different glyphs: a
 * clock to mean "saving", a movement glyph to mean "retrying", `Loader2` to mean
 * "connecting", and a refresh arrow for both "reconnecting" and "retrying". The
 * same state therefore read differently on adjacent surfaces, the size and
 * colour varied with each host's own class, and nothing owned the reduced-motion
 * decision. This component owns the glyph, the animation and the label; the
 * neighbouring text owns the meaning ("Saving…", "Connecting…", "Upgrading…").
 *
 * Naming, because it is the whole accessibility story:
 *
 * - **Beside a visible label** — the common case, and every migrated site — pass
 *   no `label`. The indicator is `aria-hidden`, and the text node beside it is
 *   what a screen reader reads. This is what the hand-rolled sites did, so the
 *   migration changes no announcement.
 * - **Standing alone** — a spinner with no text beside it — pass `label`. It
 *   becomes a polite live region naming the work, which is the only thing an
 *   assistive-technology user has to go on.
 * - **A region that is busy** — put `aria-busy` on the container that is
 *   loading, not here; the story shows the pattern. A spinner is a visual
 *   restatement of `aria-busy`, never a substitute for it.
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
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      data-slot="spinner"
      className={cn(
        'shrink-0 animate-spin motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      <circle cx="8" cy="8" r="6.25" className="text-fg-faint" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" />
    </svg>
  )
}
