import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * Sheetbase select: the **native** control, styled like `Input`.
 *
 * Native is a decision, not a shortcut. `<select>` keeps keyboard handling,
 * typeahead, `<optgroup>` grouping, disabled options, form participation and
 * the platform picker (including the OS list on mobile) without a line of
 * script; a JS listbox trades those for styling we do not need. The comparison
 * with the registry's listbox is recorded in
 * `docs/knowledge/design/component-comparison-record.md`.
 *
 * Wrap in `<Field>` (a `<label>`) or a `<label>` so it gets its name. `md` is
 * the form/field size and `sm` the compact toolbar size; both grow on narrow
 * screens the way `Button` does, so a touch target never collapses to 26px.
 * `invalid` is sugar for `aria-invalid`; the attribute itself also passes
 * through.
 */
const sizes = {
  md: {
    wrapper: 'h-[30px] max-md:h-10 text-body',
    select: 'pr-7',
    icon: 14,
  },
  sm: {
    wrapper: 'h-[26px] max-md:h-8 text-label',
    select: 'pr-6',
    icon: 12,
  },
} as const

export type SelectSize = keyof typeof sizes

export function Select({
  className,
  size = 'md',
  invalid,
  children,
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & {
  /** Control size; `className` still wins on a height you pass yourself. */
  size?: SelectSize
  invalid?: boolean
}) {
  return (
    // The wrapper carries the height and the type: `className` merges here, so
    // a caller's `h-8` or `w-[240px]` sizes the control without a second prop.
    <span className={cn('relative block', sizes[size].wrapper, className)}>
      <select
        data-slot="select"
        aria-invalid={invalid || undefined}
        className={cn(
          'h-full w-full cursor-pointer appearance-none rounded-md border border-border bg-surface pl-2 text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--danger)] disabled:cursor-default disabled:bg-surface-disabled disabled:text-fg-muted',
          sizes[size].select,
        )}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={sizes[size].icon}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted"
      />
    </span>
  )
}
