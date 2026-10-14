import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="group"
      className={cn(
        'group/input-group relative flex h-9 min-w-0 w-full items-center rounded-md border border-input shadow-xs outline-none has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50',
        className,
      )}
      {...props}
    />
  )
}

function InputGroupAddon({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva('shadow-none', {
  variants: { size: { xs: 'h-6 px-2', 'icon-xs': 'size-6 p-0' } },
  defaultVariants: { size: 'xs' },
})

function InputGroupButton({
  className,
  size,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type="button"
      variant="quiet"
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  )
}

function InputGroupText(props: React.ComponentProps<'span'>) {
  return <span {...props} />
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
}
