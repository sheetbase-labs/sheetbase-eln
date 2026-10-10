import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * Button primitives, restyled to UI system v3 (DSYS-03). Values come from the
 * design's `bundle.css` (`.btn`, `.btn-p`, `.btn-q`, `.btn-danger(-fill)`,
 * `.btn-s`, `.btn-l`, `.ib`):
 *
 * - secondary is the default; primary is the one decisive action per view;
 * - sm is 24px (inside rows), md 28px, lg 44px (phone);
 * - icon-only buttons need an accessible name via `aria-label` or a child
 *   `<span className="sr-only">`;
 * - disabled keeps its label and uses the disabled surface, not reduced opacity.
 *
 * The v2 names (`default`, `outline`, `ghost`, `destructive`, `subtle`) are
 * aliases in this step; call sites are renamed and the aliases removed in a
 * follow-up.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:border-border disabled:bg-surface-disabled disabled:text-faint-foreground aria-expanded:border-border-strong aria-expanded:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary:
          'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
        quiet: 'hover:bg-accent hover:text-accent-foreground',
        danger: 'text-danger-text hover:bg-danger-wash',
        'danger-fill':
          'border-danger-text bg-danger-text text-primary-foreground hover:bg-destructive',
        link: 'text-link underline-offset-4 hover:text-link-hover hover:underline',
        // v2 aliases (removed once call sites are renamed).
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive:
          'border-danger-text bg-danger-text text-primary-foreground hover:bg-destructive',
        outline:
          'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        subtle:
          'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        sm: 'h-6 rounded-md px-2 text-caption',
        md: 'h-control rounded-md px-2.5 text-body',
        lg: 'h-11 rounded-lg px-4 text-[15px]',
        iconOnly: 'size-control p-0',
        // v2 aliases (removed once call sites are renamed).
        default: 'h-control px-2.5 text-body',
        xs: 'h-6 rounded-md px-2 text-caption',
        icon: 'size-control p-0',
        'icon-sm': 'size-control p-0',
        'icon-xs': 'size-control p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants, type ButtonProps }
