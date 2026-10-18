import { cn } from '#/lib/utils'

/**
 * Stock shadcn `kbd` (`pnpm dlx shadcn@latest add kbd`, installed into a
 * scratch directory and placed here by hand; the registry item's own target is
 * `ui/kbd.tsx`, which in this repository is the deprecated kit).
 *
 * Edits to the copy: the `cn` import re-pointed at `#/lib/utils`, and the
 * palette-vocabulary classes restyled to the v3 tokens (`bg-muted` →
 * `bg-surface-muted`, `text-muted-foreground` → `text-fg-muted`). The
 * `[[data-slot=tooltip-content]_&]` classes are kept as published: no v3
 * tooltip content carries that attribute, so they are inert, and they cost
 * nothing until one does.
 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-surface-muted px-1 font-sans text-xs font-medium text-fg-muted select-none',
        "[&_svg:not([class*='size-'])]:size-3",
        '[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10',
        className,
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
