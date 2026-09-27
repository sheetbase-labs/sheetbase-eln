import { PanelRight, Plus, Search } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { ConnectionStatus, useLiveStatus } from '#/components/live'
import { cn } from '#/lib/utils'

import { NotificationInbox } from '../collaboration/notification-inbox'

/**
 * The global New menu (SHELL-01.5). Items whose route does not exist yet
 * (Import data, Scan a label) are hidden until their task lands, per the
 * delivery rule that a control which does nothing is not shipped.
 */
function NewMenu() {
  const items: ReadonlyArray<{ to: string; label: string }> = [
    { to: '/templates', label: 'Experiment' },
    { to: '/samples', label: 'Sample' },
    { to: '/projects', label: 'Project' },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="md" className="max-sm:hidden">
          <Plus className="size-4" /> New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <Link to={item.to}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
  leading,
  onOpenPalette,
  primaryAction,
  hasInspector,
  inspectorLabel,
  inspectorCollapsible,
  inspectorCollapsed,
  onOpenInspector,
  onToggleInspector,
}: {
  leading?: React.ReactNode
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
    <div className="flex flex-1 items-center gap-2">
      {leading}
      <div className="flex flex-1 justify-center">
        <Button
          type="button"
          variant="ghost"
          onClick={onOpenPalette}
          className="hidden h-7 w-64 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent sm:flex"
          aria-label="Search records and samples"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">
            Search records, samples, datasets
          </span>
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
      </div>

      <div className="flex items-center gap-2">
        <ConnectionStatus
          status={liveStatus.status}
          lastAppliedSeq={liveStatus.lastAppliedSeq}
        />
        <NewMenu />
        <NotificationInbox />

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
                aria-label={
                  inspectorCollapsed ? 'Show inspector' : 'Hide inspector'
                }
                aria-expanded={!inspectorCollapsed}
                onClick={onToggleInspector}
              >
                <PanelRight
                  className={cn(
                    'size-4',
                    !inspectorCollapsed && 'text-foreground',
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
