/**
 * The stock shadcn `toggle-group` item, the candidate for comparison pair
 * `pressed-chips`.
 *
 * Source: the shadcn registry (`ui.shadcn.com/r/styles/new-york/toggle-group.json`
 * — `registry:ui`, one file, dependency `@radix-ui/react-toggle-group`, registry
 * dependency `toggle`). Read on 16 October 2026. From the pinned ReUI registry
 * the item does not exist: `reui.io/r/base-nova/toggle-group.json` redirects to
 * the catalogue and answers 404 `{"error":"Registry item not found","message":
 * "toggle-group is part of shadcn/ui, not a ReUI item. Install it with: npx
 * shadcn@latest add toggle-group"}`.
 *
 * The same three edits as `tabs.tsx`: the primitive import re-pointed to the
 * unified `radix-ui` package, `cn` from `#/lib/utils`, and the tokens restyled
 * (in `toggle.tsx`, where the item's classes live).
 */
import * as React from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'
import { toggleVariants } from '#/components/reui/toggle'

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: 'default',
  variant: 'default',
})

const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn('flex items-center justify-center gap-1', className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
))

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
})

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }
