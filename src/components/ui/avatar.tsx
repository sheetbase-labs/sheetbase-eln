import { cn } from '#/lib/utils'

const tones = {
  accent: 'bg-selection',
  review: 'bg-review-wash',
  ok: 'bg-success-wash',
  warn: 'bg-warning-wash',
} as const
export type AvatarTone = keyof typeof tones

/** The size scale. A stack's `+N` chip is drawn on the same one. */
const sizes = {
  sm: 'size-[22px] text-[10px]',
  md: 'size-7 text-[11px]',
} as const
export type AvatarSize = keyof typeof sizes

/**
 * The one initials rule in the app: the first letter of the first two words,
 * uppercased — `Gareth Price` → `GP`, `Cher` → `C`. It lives here so every
 * avatar derives initials the same way and one person cannot read as `GA` on
 * one surface and `GP` on the next.
 */
export function initialsFromName(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
  return initials || '?'
}

/** One person in an avatar stack. */
export interface AvatarPerson {
  /** Stable key; the position is the fallback. */
  id?: string
  name: string
  /** Overrides the name-derived initials. */
  initials?: string
  tone?: AvatarTone
}

export function Avatar({
  initials,
  name,
  tone = 'accent',
  size = 'md',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  /** Shown as given; when absent, derived from `name`. */
  initials?: string
  name?: string
  tone?: AvatarTone
  size?: AvatarSize
}) {
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-fg',
        sizes[size],
        tones[tone],
        className,
      )}
      {...props}
    >
      {initials ?? (name ? initialsFromName(name) : '?')}
    </span>
  )
}

/**
 * Overlapping avatars with a `+N` overflow chip. The stack owns the overlap,
 * the surface ring that separates the circles and the chip, so the three
 * surfaces that show a group of people draw it the same way; `label` names the
 * group for assistive tech (`"4 here"`).
 */
export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
  label,
  className,
}: {
  people: readonly AvatarPerson[]
  /** How many avatars to show before collapsing into `+N`. */
  max?: number
  size?: AvatarSize
  label?: string
  className?: string
}) {
  const visible = people.slice(0, Math.max(0, max))
  const overflow = people.length - visible.length
  if (people.length === 0) return null
  return (
    <span
      role={label ? 'group' : undefined}
      aria-label={label}
      title={label}
      className={cn('inline-flex items-center -space-x-1.5', className)}
    >
      {visible.map((person, index) => (
        <Avatar
          key={person.id ?? `${person.name}-${index}`}
          name={person.name}
          initials={person.initials}
          tone={person.tone}
          size={size}
          className="ring-2 ring-surface"
        />
      ))}
      {overflow > 0 ? (
        <span
          aria-hidden="true"
          title={`${overflow} more`}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-medium ring-2 ring-surface',
            sizes[size],
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  )
}
