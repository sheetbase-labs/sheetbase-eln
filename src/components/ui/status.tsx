import { cn } from '#/lib/utils'

// Status: colour sits in the dot, the text stays in text colour (design system, Status card).
const tones = {
  progress: 'bg-link',
  review: 'bg-review',
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
  draft: 'bg-neutral-dot',
  stored: 'bg-fg-muted',
  none: 'border border-neutral-dot bg-transparent',
  analysis: 'bg-analysis',
  lab: 'bg-lab',
} as const
export type Tone = keyof typeof tones

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full',
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
