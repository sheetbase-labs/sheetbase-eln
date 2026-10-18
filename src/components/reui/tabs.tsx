/**
 * The stock shadcn `tabs` item, the candidate for comparison pair `tab-family`.
 *
 * Source: the shadcn registry (`ui.shadcn.com/r/styles/new-york/tabs.json`,
 * where it is `registry:ui`, one file, dependency `@radix-ui/react-tabs`).
 * Read on 16 October 2026. The same item asked for from the pinned ReUI
 * registry is **not a ReUI item**: `reui.io/r/base-nova/tabs.json` redirects to
 * the catalogue and answers 404 `{"error":"Registry item not found","message":
 * "tabs is part of shadcn/ui, not a ReUI item. Install it with: npx
 * shadcn@latest add tabs"}`.
 *
 * Three edits, and nothing else, so the comparison measures the item rather
 * than a rewrite (ADR-0055 decision 2 permits both kinds of fix in this
 * directory):
 *
 * 1. `@radix-ui/react-tabs` → `radix-ui`, the unified Radix package this
 *    repository already depends on. As published the item needs a dependency
 *    the repository does not have; the primitives are the same ones.
 * 2. `cn` from `#/lib/utils`, the helper that teaches tailwind-merge the
 *    Sheetbase type scale.
 * 3. Restyled to Sheetbase tokens: `bg-muted` → `bg-surface-muted`,
 *    `text-muted-foreground` → `text-fg-muted`, `ring-offset-background` and
 *    `ring-ring` → the kit's `outline-focus` ring. An adoption would restyle
 *    anyway, so the comparison columns hold the tokens constant on both sides.
 */
import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-lg bg-surface-muted p-1 text-fg-muted',
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-label font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
