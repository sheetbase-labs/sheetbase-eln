import { Icon } from '#/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { SavedLayout } from '#/lib/workspace-state'
import { t } from '#/copy'

/**
 * The saved-layouts menu: the caller's layouts, the ones shared with the team,
 * and the share, unshare and delete actions for the layout the active tab was
 * opened from.
 */
export function WorkspaceLayoutMenu({
  layouts,
  teamLayouts,
  layoutId,
  layoutName,
  onOpenLayout,
  onShareLayout,
  onRemoveTeamLayout,
  onDeleteLayout,
}: {
  layouts: SavedLayout[]
  /** Layouts every member of the workspace can open. */
  teamLayouts: SavedLayout[]
  /** The layout the active tab was opened from, if any. */
  layoutId?: string
  /** The active tab's name, used in the action labels. */
  layoutName: string
  onOpenLayout: (id: string) => void
  onShareLayout: () => void
  onRemoveTeamLayout: (id: string) => void
  onDeleteLayout: (id: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="mx-ib"
        aria-label={t('projects.workspaceBar.workspaces')}
        title={t('projects.workspaceBar.myLayouts')}
      >
        <Icon name="chevronDown" size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('projects.workspaceBar.myLayouts')}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {layouts.length === 0 ? (
          <div className="px-2 py-1.5 text-label text-fg-muted">
            {t('projects.workspaceBar.noLayouts')}
          </div>
        ) : (
          layouts.map((layout) => (
            <DropdownMenuItem
              key={layout.id}
              onClick={() => onOpenLayout(layout.id)}
              hint={t('projects.workspaceBar.paneCount', {
                count: layout.panes.length,
              })}
            >
              {layout.name}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('projects.workspaceBar.teamLayouts')}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {teamLayouts.length === 0 ? (
          <div className="px-2 py-1.5 text-label text-fg-muted">
            {t('projects.workspaceBar.noTeamLayouts')}
          </div>
        ) : (
          teamLayouts.map((layout) => (
            <DropdownMenuItem
              key={layout.id}
              onClick={() => onOpenLayout(layout.id)}
              hint={t('projects.workspaceBar.paneCount', {
                count: layout.panes.length,
              })}
            >
              {layout.name}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onShareLayout}>
          {t('projects.workspaceBar.share', { name: layoutName })}
        </DropdownMenuItem>
        {layoutId && teamLayouts.some((layout) => layout.id === layoutId) ? (
          <DropdownMenuItem danger onClick={() => onRemoveTeamLayout(layoutId)}>
            {t('projects.workspaceBar.unshare', { name: layoutName })}
          </DropdownMenuItem>
        ) : null}
        {layoutId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onClick={() => onDeleteLayout(layoutId)}>
              {t('projects.workspaceBar.deleteLayout', {
                name: layoutName,
              })}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
