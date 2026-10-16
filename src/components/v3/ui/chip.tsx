import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * Chip: the pill family, one rendering for the three jobs the app gave it —
 *
 * - `remove`: a filter value with an x beside it, under a list toolbar;
 * - `toggle`: a pressed filter or search scope (`aria-pressed`);
 * - `nav`: a section in a phone-only nav (`aria-current="page"`), rendered as
 *   a router Link through `render` or as a button for in-page state.
 *
 * The selected state is one token pair everywhere (`border-selection-border`
 * on `bg-selection`). ReUI's Toggle Group and Button Group are a different job
 * — a group of controls, not a chip — and are not used for this (ADR-0055
 * decision 4; the scan's row 8).
 */
const chipVariants = cva(
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-border text-fg no-underline hover:no-underline [&_svg]:text-fg-muted',
  {
    variants: {
      variant: {
        remove: 'h-6 gap-1 rounded-md bg-surface pl-2 pr-0.5 text-label',
        toggle:
          'h-7 cursor-pointer gap-1.5 bg-surface px-2.5 text-label hover:bg-surface-hover max-md:h-9',
        nav: 'gap-1.5 hover:bg-surface-hover hover:text-fg',
      },
      size: { sm: '', md: '' },
      selected: {
        true: 'border-selection-border bg-selection font-medium hover:bg-selection',
        false: '',
      },
    },
    compoundVariants: [
      // The two phone nav rails: settings is 32px, the client portal 36px.
      { variant: 'nav', size: 'sm', class: 'h-8 px-3 text-label max-md:h-9' },
      {
        variant: 'nav',
        size: 'md',
        class: 'h-9 cursor-pointer px-3.5 text-body',
      },
    ],
    defaultVariants: { variant: 'toggle', size: 'sm' },
  },
)

type ChipProps = Omit<VariantProps<typeof chipVariants>, 'selected'> & {
  /** `toggle`: the pressed state, which is `aria-pressed` and the selection. */
  pressed?: boolean
  /** `nav`: the section this chip is, which is `aria-current="page"` and the selection. */
  current?: boolean
  icon?: IconName
  /** A count after the label (a filter's matches). */
  count?: number
  /** `remove`: the x button's accessible name, e.g. "Remove filter: stage is Discovery". */
  removeLabel?: string
  onRemove?: () => void
  className?: string
  /** Render as a router Link or as a button for in-page state. */
  render?: React.ReactElement
  children?: React.ReactNode
}

export function Chip({
  variant = 'toggle',
  size,
  icon,
  count,
  pressed,
  current,
  removeLabel,
  onRemove,
  className,
  render,
  children,
  ...props
}: ChipProps & Omit<React.ComponentProps<'button'>, keyof ChipProps>) {
  const selected = variant === 'toggle' ? Boolean(pressed) : Boolean(current)
  return useRender({
    render,
    defaultTagName: variant === 'remove' ? 'span' : 'button',
    props: {
      'data-slot': 'chip',
      className: cn(chipVariants({ variant, size, selected }), className),
      ...(variant === 'remove'
        ? null
        : variant === 'toggle'
          ? { type: 'button', 'aria-pressed': Boolean(pressed) }
          : { 'aria-current': current ? 'page' : undefined }),
      ...props,
      children: (
        <>
          {icon ? <Icon name={icon} size={12} /> : null}
          {children}
          {count != null ? (
            <span className="num font-normal text-fg-muted">{count}</span>
          ) : null}
          {variant === 'remove' ? (
            <button
              type="button"
              aria-label={removeLabel}
              onClick={onRemove}
              className="inline-flex size-[18px] cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <Icon name="x" size={10} />
            </button>
          ) : null}
        </>
      ),
    },
  })
}
