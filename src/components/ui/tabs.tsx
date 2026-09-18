import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

/**
 * Tabs variants follow the V2ALT foundations: `line` (underline) is the
 * default for page-level and inspector tabs; `boxed` is the segmented
 * control reserved for compact view switchers (Graph | Timeline | Table).
 */
type TabsVariant = 'line' | 'boxed'

const TabsVariantContext = React.createContext<TabsVariant>('line')

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('', className)}
      {...props}
    />
  )
}

interface TabsListProps extends React.ComponentProps<
  typeof TabsPrimitive.List
> {
  variant?: TabsVariant
}

function TabsList({ className, variant = 'line', ...props }: TabsListProps) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          variant === 'line'
            ? 'flex w-full items-center gap-5 border-b border-border text-muted-foreground'
            : 'inline-flex h-9 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        variant === 'line'
          ? '-mb-px rounded-none border-b-2 border-transparent px-1 py-2 text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-label data-[state=active]:text-primary'
          : 'rounded-sm px-3 py-1 transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'mt-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, type TabsListProps }
