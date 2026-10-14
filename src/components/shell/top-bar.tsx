import { PanelRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { ConnectionStatus, useLiveStatus } from '#/components/live'
import { cn } from '#/lib/utils'

import { NotificationsBell } from '../collaboration/notifications-bell'

/**
 * The global New menu (SHELL-01.5). Items whose route does not exist yet
 * (Import data, Scan a label) are hidden until their task lands, per the
 * delivery rule that a control which does nothing is not shipped.
 */
function NewMenu({
  open,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const items: ReadonlyArray<{ to: string; label: string }> = [
    { to: '/templates', label: 'Experiment' },
    { to: '/samples', label: 'Sample' },
    { to: '/projects', label: 'Project' },
  ]
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button variant="primary" size="md" className="max-sm:hidden" />
        }
      >
        <Icon name="plus" className="size-4" /> New
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuLinkItem key={item.to} render={<Link to={item.to} />}>
            {item.label}
          </DropdownMenuLinkItem>
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
  newMenuOpen,
  onNewMenuOpenChange,
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
  newMenuOpen?: boolean
  onNewMenuOpenChange?: (open: boolean) => void
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
          variant="quiet"
          onClick={onOpenPalette}
          className="hidden w-[28rem] max-w-full gap-2 border-input bg-card text-left text-muted-foreground hover:bg-accent sm:flex"
          aria-label="Search experiments, samples, datasets"
        >
          <Icon name="search" className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">
            Search experiments, samples, datasets
          </span>
          <Kbd>⌘K</Kbd>
        </Button>
        <Button
          variant="quiet"
          size="icon"
          className="sm:hidden"
          aria-label="Search"
          onClick={onOpenPalette}
        >
          <Icon name="search" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <ConnectionStatus
          status={liveStatus.status}
          lastAppliedSeq={liveStatus.lastAppliedSeq}
        />
        <NewMenu open={newMenuOpen} onOpenChange={onNewMenuOpenChange} />
        <NotificationsBell />

        {primaryAction}

        {hasInspector ? (
          <Button
            variant="secondary"
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
          <Tooltip
            content={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
          >
            <Button
              variant="quiet"
              size="icon"
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
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
