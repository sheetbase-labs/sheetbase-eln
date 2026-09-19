import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'

/**
 * Button primitives. Variants are reconciled with the historical design intent
 * in docs/knowledge/design/ui-system-v2.md and the production token set:
 * - destructive uses `text-destructive-foreground` rather than `text-white`
 *   so it tracks the token, not a literal colour;
 * - every variant has a visible focus ring (DESIGN.md requirement);
 * - icon-only buttons must provide an accessible name via `aria-label` or
 *   a child `<span className="sr-only">` (enforced by review, not the type).
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-label transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover disabled:hover:bg-primary',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/40 disabled:hover:bg-destructive',
        outline:
          'border border-input bg-surface shadow-xs hover:bg-control disabled:hover:bg-surface',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-input/50 disabled:hover:bg-secondary',
        ghost:
          'hover:bg-control hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-inherit',
        link: 'text-primary underline underline-offset-4',
        subtle:
          'bg-accent/70 text-accent-foreground hover:bg-accent disabled:hover:bg-accent/70',
      },
      size: {
        default: 'h-9 px-3.5',
        xs: 'h-7 rounded-md px-2.5 text-xs',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-5',
        icon: 'size-9',
        'icon-xs': 'size-7',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
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
