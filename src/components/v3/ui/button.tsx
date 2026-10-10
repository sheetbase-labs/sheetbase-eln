import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Sheetbase button: 28px, border before shadow, one decisive blue for the primary action.
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium no-underline transition-colors hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:border-border disabled:bg-surface-disabled disabled:text-fg-faint aria-disabled:cursor-default aria-disabled:border-border aria-disabled:bg-surface-disabled aria-disabled:text-fg-faint aria-expanded:border-border-strong aria-expanded:bg-surface-hover',
  {
    variants: {
      variant: {
        secondary:
          'border-border bg-surface text-fg hover:bg-surface-hover hover:text-fg',
        primary:
          'border-primary bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground aria-expanded:bg-primary-hover',
        quiet:
          'border-transparent bg-transparent text-fg hover:bg-surface-hover hover:text-fg',
        danger:
          'border-border bg-surface text-danger-text hover:bg-danger-wash hover:text-danger-text',
        'danger-fill':
          'border-danger-text bg-danger-text text-on-accent hover:bg-danger hover:text-on-accent',
      },
      size: {
        sm: 'h-6 px-2 text-label max-md:h-8 max-md:px-2.5',
        md: 'h-7 px-2.5 text-body max-md:h-10 max-md:px-3.5',
        lg: 'h-11 rounded-lg px-4 text-[15px]',
        icon: 'size-7 px-0 max-md:size-10',
        'icon-lg': 'size-11 px-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { icon?: IconName }

export function Button({
  className,
  variant,
  size,
  icon,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </ButtonPrimitive>
  )
}
