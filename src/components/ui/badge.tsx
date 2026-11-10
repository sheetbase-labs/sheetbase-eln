import type { VariantProps } from 'class-variance-authority'
import { cn } from '#/lib/utils'
import { badgeVariants } from './badge-variants'

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export const Tag = Badge
