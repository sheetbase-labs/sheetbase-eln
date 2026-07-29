import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { Circle } from 'lucide-react'
import { cn } from '#/lib/utils'

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      className={cn('grid gap-2', className)}
      {...props}
    />
  )
}
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'aspect-square size-4 rounded-full border border-input text-primary shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className="size-2.5 fill-current" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}
export { RadioGroup, RadioGroupItem }
