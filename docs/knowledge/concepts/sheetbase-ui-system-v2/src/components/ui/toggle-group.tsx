import * as React from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { cn } from '#/lib/utils'
import { toggleVariants } from '#/components/ui/toggle'

const ToggleGroupContext = React.createContext<{variant?: 'default'|'outline'; size?: 'default'|'sm'|'lg'}>({})
function ToggleGroup({ className, variant, size, children, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {variant?:'default'|'outline'; size?:'default'|'sm'|'lg'}) { return <ToggleGroupPrimitive.Root className={cn('flex items-center justify-center gap-1', className)} {...props}><ToggleGroupContext.Provider value={{variant,size}}>{children}</ToggleGroupContext.Provider></ToggleGroupPrimitive.Root> }
function ToggleGroupItem({ className, children, variant, size, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & {variant?:'default'|'outline'; size?:'default'|'sm'|'lg'}) { const context=React.useContext(ToggleGroupContext); return <ToggleGroupPrimitive.Item className={cn(toggleVariants({variant:context.variant??variant,size:context.size??size}),className)} {...props}>{children}</ToggleGroupPrimitive.Item> }
export { ToggleGroup, ToggleGroupItem }
