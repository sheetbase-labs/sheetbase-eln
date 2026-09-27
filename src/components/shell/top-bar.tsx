import { PanelRight, Search } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { ConnectionStatus, useLiveStatus } from '#/components/live'
import { cn } from '#/lib/utils'

import { NotificationInbox } from '../collaboration/notification-inbox'

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-sans text-xs font-medium text-muted-foreground sm:flex">
      {children}
    </kbd>
  )
}

/**
 * The shell top-bar actions (SHELL-01): connection status, notifications, the
 * search/⌘K trigger, the route's primary action and the inspector controls.
 */
export function TopBarActions({
  onOpenPalette,
  primaryAction,
  hasInspector,
  inspectorLabel,
  inspectorCollapsible,
  inspectorCollapsed,
  onOpenInspector,
  onToggleInspector,
}: {
  onOpenPalette: () => void
  primaryAction?: React.ReactNode
  hasInspector: boolean
  inspectorLabel: string
  inspectorCollapsible: boolean
  inspectorCollapsed: boolean
  onOpenInspector: () => void
  onToggleInspector: () => void
}) {
  const liveStatus = useLiveStatus()
  return (
    <div className="ml-auto flex items-center gap-2">
      <ConnectionStatus
        status={liveStatus.status}
        lastAppliedSeq={liveStatus.lastAppliedSeq}
      />
      <NotificationInbox />
      <Button
        type="button"
        variant="ghost"
        onClick={onOpenPalette}
        className="hidden h-8 w-56 items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent sm:flex"
        aria-label="Search records and samples"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate">Search records, samples…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="sm:hidden"
        aria-label="Search"
        onClick={onOpenPalette}
      >
        <Search />
      </Button>

      {primaryAction}

      {hasInspector ? (
        <Button
          variant="outline"
          size="sm"
          className="xl:hidden"
          aria-label={`Open ${inspectorLabel}`}
          aria-expanded={false}
          onClick={onOpenInspector}
        >
          <PanelRight /> {inspectorLabel}
        </Button>
      ) : null}
      {hasInspector && inspectorCollapsible ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden xl:inline-flex"
              aria-label={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
              aria-expanded={!inspectorCollapsed}
              onClick={onToggleInspector}
            >
              <PanelRight
                className={cn('size-4', !inspectorCollapsed && 'text-foreground')}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
