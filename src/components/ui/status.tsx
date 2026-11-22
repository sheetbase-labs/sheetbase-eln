import { cn } from '#/lib/utils'

// Status: a Linear-style ring, shape plus colour (design system, Status card).
// Empty = draft, half = in progress, three-quarters = in review, full = done,
// dashed = needs attention. The text stays in text colour.
// Written out in full so Tailwind can see every class.
const ring = 'border-[1.6px] border-current bg-transparent'

const half =
  'border-[1.6px] border-current bg-[conic-gradient(currentColor_0_50%,transparent_0)]'

const threeQuarters =
  'border-[1.6px] border-current bg-[conic-gradient(currentColor_0_75%,transparent_0)]'

const solid = 'border-[1.6px] border-current bg-current'

const tones = {
  progress: `text-link ${half}`,
  review: `text-review ${threeQuarters}`,
  ok: `text-success ${solid}`,
  warn: `text-warning ${ring} border-dashed`,
  bad: `text-danger ${solid}`,
  draft: `text-neutral-dot ${ring}`,
  stored: `text-fg-muted ${ring}`,
  none: `text-neutral-dot ${ring}`,
  analysis: `text-analysis ${solid}`,
  lab: `text-lab ${solid}`,
} as const

export type Tone = keyof typeof tones

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-[10px] shrink-0 rounded-full',
        tones[tone],
        className,
      )}
    />
  )
}

export function Status({
  tone,
  children,
  className,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="status"
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        className,
      )}
    >
      <Dot tone={tone} />
      {children}
    </span>
  )
}
