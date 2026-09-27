import { PanelRight } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import { cn } from '#/lib/utils'

/**
 * The shell inspector (SHELL-01): a 300px column at desktop widths with an
 * optional 40px collapsed rail, and a right-hand drawer below the desktop
 * breakpoint.
 */
export function ShellInspector({
  label,
  collapsible,
  collapsed,
  onToggle,
  children,
}: {
  label: string
  collapsible: boolean
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <aside
      aria-label={label}
      data-slot="inspector"
      className={cn(
        'hidden shrink-0 border-l border-sidebar-border bg-background xl:block',
        collapsible && collapsed ? 'w-10' : 'w-inspector',
      )}
      data-inspector-collapsed={collapsible && collapsed ? 'true' : 'false'}
    >
      {collapsible && collapsed ? (
        <div className="flex h-full flex-col items-center pt-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show inspector"
            aria-expanded={false}
            onClick={onToggle}
          >
            <PanelRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="sticky top-topbar h-[calc(100svh-var(--topbar-height))]">
          {children}
        </div>
      )}
    </aside>
  )
}

export function ShellInspectorSheet({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-inspector border-l p-0 xl:hidden"
        showClose={false}
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>
        <div className="h-full">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
