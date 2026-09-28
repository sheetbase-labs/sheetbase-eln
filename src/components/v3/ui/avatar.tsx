import { cn } from '#/lib/utils'

const tones = {
  accent: 'bg-selection',
  review: 'bg-review-wash',
  ok: 'bg-success-wash',
  warn: 'bg-warning-wash',
} as const
export function Avatar({
  initials,
  name,
  tone = 'accent',
  size = 'md',
  className,
}: {
  initials: string
  name?: string
  tone?: keyof typeof tones
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-fg',
        size === 'sm' ? 'size-[22px] text-[10px]' : 'size-7 text-[11px]',
        tones[tone],
        className,
      )}
    >
      {initials}
    </span>
  )
}
