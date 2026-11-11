import { listPaneIds } from '#/lib/pane-tree'
import { t } from '#/copy'

import { WorkspaceBar } from './workspace-bar'
import { WorkspaceStatus } from './workspace-status'
import type { WorkspaceSession } from './workspace-session'

/**
 * The bar above the stage: the workspace tabs, the layout actions, the shelf
 * count, and — on a narrow screen — the chips that pick which pane shows. The
 * address error sits under it, outside the bar, so it is never hidden.
 */
export function WorkspaceChrome({ session }: { session: WorkspaceSession }) {
  return (
    <>
      {session.showChrome ? (
        <WorkspaceBar
          tabs={session.state.tabs}
          activeTabId={session.state.activeTabId}
          preset={session.currentPreset}
          maximized={session.maximized}
          shelfOpen={session.state.shelfOpen}
          shelfCount={session.state.shelf.length}
          layouts={session.layouts}
          teamLayouts={session.teamLayouts}
          onShareLayout={session.shareLayout}
          onRemoveTeamLayout={session.removeTeamLayout}
          onSwitch={session.switchWorkspaceTab}
          onClose={(id) => void session.closeWorkspaceTab(id)}
          onNew={session.makeNewTab}
          onRename={session.renameWorkspaceTab}
          onPreset={session.choosePreset}
          onShelf={session.toggleShelf}
          onSave={session.saveLayout}
          onOpenLayout={session.openLayout}
          onDeleteLayout={session.deleteLayout}
          paneChips={<PaneChips session={session} />}
        />
      ) : null}
      {session.error ? (
        <p role="alert" className="px-3 py-1 text-danger-text">
          {session.error}
        </p>
      ) : null}
    </>
  )
}

/** Narrow screens show one pane at a time; a chip picks which. */
function PaneChips({ session }: { session: WorkspaceSession }) {
  const { tab } = session

  if (!session.narrow || tab.panes.length < 2) return null

  return (
    <div
      className="flex items-center gap-1 px-2"
      role="group"
      aria-label={t('projects.workspaceHost.panes')}
    >
      {listPaneIds(tab.tree).map((id, index) => (
        <button
          key={id}
          type="button"
          className="mx-num"
          aria-pressed={id === tab.activeId}
          aria-label={t('projects.workspaceHost.showPane', {
            number: index + 1,
          })}
          onClick={() => session.focus(id)}
          style={
            id === tab.activeId
              ? {
                  background: 'var(--mx-accent)',
                  borderColor: 'var(--mx-accent)',
                  color: 'var(--mx-on-accent)',
                }
              : undefined
          }
        >
          {index + 1}
        </button>
      ))}
    </div>
  )
}

/**
 * The status bar under the stage: the layout's name and save state, which link
 * group the focused pane is in, and the shortcuts that pane offers. It says
 * nothing a single pane can use, so it follows the bar's own gate.
 */
export function WorkspaceFooter({ session }: { session: WorkspaceSession }) {
  const { focusedLink, driver, tab } = session

  if (!session.showChrome) return null

  return (
    <WorkspaceStatus
      layoutName={tab.name}
      saved={!tab.dirty && !!tab.layoutId}
      link={
        focusedLink && driver
          ? {
              letter: focusedLink.letter,
              driverLabel: driver.identifier ?? driver.title,
              followers: focusedLink.followerIds.length,
            }
          : undefined
      }
      hints={session.hints}
    />
  )
}
