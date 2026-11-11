import { useEffect, useState } from 'react'

import type { RouterContext } from '#/routes/__root'
import { t } from '#/copy'
import { Shelf } from './shelf'
import { WorkspaceChrome, WorkspaceFooter } from './workspace-host-chrome'
import { WorkspaceOverlays } from './workspace-host-overlays'
import { WorkspaceStage } from './workspace-host-stage'
import { WorkspaceNavigationContext } from './workspace-navigation'
import { useWorkspaceSession } from './workspace-session'

export function WorkspaceHost({
  context,
  children,
}: {
  context: RouterContext
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Start hydrates the canonical page once. Independent page routers are CSR
  // only; they must never write a second document or hydrate Start again.
  if (!mounted) return children

  return (
    <WorkspaceSessionHost
      key={`${context.auth?.user.id}:${context.auth?.workspace?.id}`}
      context={context}
    />
  )
}

/**
 * One workspace session, rendered: the chrome above the stage, the stage of
 * panes with the shelf beside it, the status bar and the overlays that belong
 * to record links. Every listener lives in `useWorkspaceSession`; this only
 * composes what it returns.
 */
function WorkspaceSessionHost({ context }: { context: RouterContext }) {
  const session = useWorkspaceSession({ context })

  return (
    <WorkspaceNavigationContext.Provider value={session.navigation}>
      <section
        ref={session.workspaceRoot}
        className="workspace flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label={t('projects.workspaceHost.label')}
        data-bare={
          (session.phone && session.tab.panes.length === 1) || undefined
        }
      >
        <WorkspaceChrome session={session} />
        <div className="mx-body">
          <WorkspaceStage session={session} />
          {session.state.shelfOpen ? (
            <Shelf
              items={session.state.shelf}
              dropActive={session.links.dragging}
              onPromote={session.promoteShelfItem}
              onRemove={session.removeShelfItem}
              onClose={session.closeShelf}
              onDropLink={session.dropShelfLink}
            />
          ) : null}
        </div>
        <WorkspaceFooter session={session} />
        <WorkspaceOverlays session={session} />
      </section>
    </WorkspaceNavigationContext.Provider>
  )
}
