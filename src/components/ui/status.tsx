import { cn } from '#/lib/utils'

// Status: a tinted pill. The tone colours the dot, a soft wash behind it and the
// text, so a column of statuses can be read at a glance down the list.
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

// Each tone sets `--tone`; the pill derives its wash and text from it, so the
// same rule works in light and dark and for every tone.
const pillTones: Record<Tone, string> = {
  progress: '[--tone:var(--color-link)]',
  review: '[--tone:var(--color-review)]',
  ok: '[--tone:var(--color-success)]',
  warn: '[--tone:var(--color-warning)]',
  bad: '[--tone:var(--color-danger)]',
  draft: '[--tone:var(--color-neutral-dot)]',
  stored: '[--tone:var(--color-fg-muted)]',
  none: '[--tone:var(--color-neutral-dot)]',
  analysis: '[--tone:var(--color-analysis)]',
  lab: '[--tone:var(--color-lab)]',
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
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[12px] font-medium leading-5',
        'bg-[color-mix(in_oklab,var(--tone)_14%,transparent)] text-[color-mix(in_oklab,var(--tone)_45%,var(--color-fg))]',
        pillTones[tone],
        className,
      )}
    >
      <Dot tone={tone} />
      {children}
    </span>
  )
}
