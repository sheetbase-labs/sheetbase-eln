import type { CSSProperties } from 'react'

import { layoutGeometry } from '#/lib/pane-geometry'
import type { Divider, DropEdge, Geometry, Rect } from '#/lib/pane-geometry'
import { listPaneIds, neighbourOf } from '#/lib/pane-tree'
import {
  editingPaneFor,
  linkOf,
  makeDriver,
  paneOf,
  resizeDivider,
} from '#/lib/workspace-actions'
import { paneKind, paneMode } from '#/lib/workspace-state'
import type {
  PaneMode,
  WorkspacePane,
  WorkspaceTab,
} from '#/lib/workspace-state'
import { canNativeShare } from '#/lib/pwa/share'
import { t } from '#/copy'

import { PaneHeader } from './pane-header'
import { PanePage } from './pane-page'
import { followedSelectionFor } from './workspace-host-model'
import { WorkspaceDropOverlay } from './workspace-host-overlays'
import type { WorkspaceSession } from './workspace-session'

/**
 * The stage: every workspace tab's panes laid out at their fractions, the
 * dividers a split puts between them, and the drop target a dragged record
 * link paints. A hidden tab keeps its panes mounted so their pages survive a
 * switch.
 */
export function WorkspaceStage({ session }: { session: WorkspaceSession }) {
  return (
    <div className="mx-stage" ref={session.stage}>
      {session.state.tabs.map((tab) => (
        <WorkspaceTabPanel key={tab.id} session={session} tab={tab} />
      ))}
    </div>
  )
}

function WorkspaceTabPanel({
  session,
  tab,
}: {
  session: WorkspaceSession
  tab: WorkspaceTab
}) {
  const isActiveTab = tab.id === session.state.activeTabId
  const geometry = layoutGeometry(tab.tree)
  const order = listPaneIds(tab.tree)

  return (
    <div
      className="mx-tabpanel"
      role="tabpanel"
      aria-label={tab.name}
      hidden={!isActiveTab}
    >
      {tab.panes.map((pane) => (
        <WorkspacePane
          key={pane.id}
          session={session}
          tab={tab}
          pane={pane}
          number={order.indexOf(pane.id) + 1}
          rect={geometry.panes.get(pane.id)}
        />
      ))}
      {session.solo ? null : (
        <WorkspaceDividers session={session} geometry={geometry} />
      )}
    </div>
  )
}

/** One pane: where it sits, what it calls itself, and what a drag does to it. */
function WorkspacePane({
  session,
  tab,
  pane,
  number,
  rect,
}: {
  session: WorkspaceSession
  tab: WorkspaceTab
  pane: WorkspacePane
  number: number
  rect?: Rect
}) {
  const focused = pane.id === tab.activeId
  const primary = pane.id === tab.primaryId

  const mode = paneMode(
    pane.href,
    primary,
    session.canCreate,
    session.frozenAt[pane.id]?.href === pane.href
      ? session.frozenAt[pane.id]?.why
      : false,
    session.missingAt[pane.id] === pane.href,
  )

  const readOnly = mode.kind === 'read-only' || mode.kind === 'signed'
  const hiddenBySolo = session.solo && !focused

  const style: CSSProperties = rect
    ? {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      }
    : {}

  return (
    <div
      className="mx-pane workspace-page"
      style={style}
      hidden={hiddenBySolo}
      data-workspace-pane={pane.id}
      data-workspace-focused={focused || undefined}
      data-workspace-maximized={(session.solo && focused) || undefined}
      data-pane-readonly={readOnly || undefined}
      data-pane-primary={primary || undefined}
      onPointerDownCapture={() => session.focus(pane.id)}
      onFocusCapture={() => session.focus(pane.id)}
      onDragOver={(event) => session.overPane(pane.id, primary, event)}
      onDragLeave={(event) => session.leavePane(pane.id, event)}
      onDrop={(event) =>
        session.dropOnPane(pane.id, dropEdgeFor(session, pane.id), event)
      }
    >
      <WorkspacePaneHeader
        session={session}
        tab={tab}
        pane={pane}
        number={number}
        focused={focused}
        primary={primary}
        mode={mode}
      />
      <WorkspacePaneBody
        session={session}
        tab={tab}
        pane={pane}
        focused={focused}
        primary={primary}
        readOnly={readOnly}
      />
      {session.links.dragging && rect ? (
        <WorkspaceDropOverlay edge={overlayEdgeFor(session, pane.id)} />
      ) : null}
    </div>
  )
}

/** The pane's own header, wired to the session's actions. */
function WorkspacePaneHeader({
  session,
  tab,
  pane,
  number,
  focused,
  primary,
  mode,
}: {
  session: WorkspaceSession
  tab: WorkspaceTab
  pane: WorkspacePane
  number: number
  focused: boolean
  primary: boolean
  mode: PaneMode
}) {
  const link = linkOf(tab, pane.id)

  return (
    <PaneHeader
      pane={pane}
      number={number}
      focused={focused}
      primary={primary}
      mode={mode}
      kind={paneKind(pane.href)}
      link={
        link
          ? {
              letter: link.letter,
              role: link.driverId === pane.id ? 'drives' : 'follows',
            }
          : undefined
      }
      crumbs={session.crumbs[pane.id]}
      dataAccess={session.dataAccess}
      onCrumb={(target) => session.navigatePane(pane.id, target)}
      newer={session.newer[pane.id]}
      onShelf={session.shelfHrefs.has(pane.href)}
      maximized={session.solo && focused && !session.narrow}
      canClose={tab.panes.length > 1 || session.state.tabs.length > 1}
      canLink={!!neighbourOf(tab.tree, pane.id)}
      onFocus={() => session.focus(pane.id)}
      onBack={() => session.stepTrail(pane.id, 'back')}
      onForward={() => session.stepTrail(pane.id, 'forward')}
      onPin={() => session.pinPane(pane.id)}
      onMakePrimary={() => session.promotePane(pane.id)}
      onMaximize={() => session.toggleMaximise(pane.id)}
      onClose={() => void session.closePane(pane.id)}
      onSplit={(direction) => session.splitFocused(direction, pane.id)}
      onToggleLink={() => session.togglePaneLink(pane.id)}
      onMakeDriver={() =>
        session.apply((previous) => makeDriver(previous, pane.id))
      }
      onCompareNewer={() => session.comparePaneNewer(pane)}
      trailTarget={paneOf(tab, tab.primaryId)?.identifier}
      onSaveTrail={() => void session.saveTrail(pane.id)}
      onShare={canNativeShare() ? () => session.sharePane(pane) : undefined}
      onCopyLink={() => session.copyPaneLink(pane)}
    />
  )
}

/** The pane's page: a second copy of the application's router for its address. */
function WorkspacePaneBody({
  session,
  tab,
  pane,
  focused,
  primary,
  readOnly,
}: {
  session: WorkspaceSession
  tab: WorkspaceTab
  pane: WorkspacePane
  focused: boolean
  primary: boolean
  readOnly: boolean
}) {
  return (
    <div className="mx-pb">
      <div className="workspace-page-content">
        <PanePage
          id={pane.id}
          href={pane.href}
          active={tab.id === session.state.activeTabId && focused}
          context={session.context}
          readOnly={readOnly}
          onMakePrimary={() => session.promotePane(pane.id)}
          editingPane={
            readOnly && !primary ? editingPaneFor(tab, pane) : undefined
          }
          followedSelection={followedSelectionFor(
            tab,
            pane.id,
            session.selected,
          )}
          onSelect={(rowId) => session.selectRow(pane.id, rowId)}
          onFrozen={(frozen) =>
            session.reportFrozen(pane.id, pane.href, frozen)
          }
          onMissing={(missing) =>
            session.reportMissing(pane.id, pane.href, missing)
          }
          onNewer={(revision) => session.reportNewer(pane.id, revision)}
          onReady={(handle) => session.readyPane(pane.id, handle)}
          onLocationChange={(next) => session.locationChanged(pane.id, next)}
        />
      </div>
    </div>
  )
}

/** The side of a pane a dropped record link opens beside. */
function dropEdgeFor(
  session: WorkspaceSession,
  paneId: string,
): DropEdge | 'center' {
  return session.dropTarget?.paneId === paneId
    ? session.dropTarget.edge
    : 'right'
}

/** The side the drop target paints, while a record link is over a pane. */
function overlayEdgeFor(
  session: WorkspaceSession,
  paneId: string,
): DropEdge | 'center' | null {
  return session.dropTarget?.paneId === paneId ? session.dropTarget.edge : null
}

function WorkspaceDividers({
  session,
  geometry,
}: {
  session: WorkspaceSession
  geometry: Geometry
}) {
  return (
    <>
      {geometry.dividers.map((divider) => (
        <WorkspaceDivider
          key={`${divider.splitId}-${divider.index}`}
          session={session}
          divider={divider}
        />
      ))}
    </>
  )
}

/** Drag with the pointer, or arrow keys when focused. */
function WorkspaceDivider({
  session,
  divider,
}: {
  session: WorkspaceSession
  divider: Divider
}) {
  const vertical = divider.direction === 'row'

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t('projects.workspaceHost.resize')}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={`mx-div ${vertical ? 'is-row' : 'is-column'}`}
      style={
        vertical
          ? {
              left: `${divider.rect.x * 100}%`,
              top: `${divider.rect.y * 100}%`,
              height: `${divider.rect.h * 100}%`,
            }
          : {
              left: `${divider.rect.x * 100}%`,
              top: `${divider.rect.y * 100}%`,
              width: `${divider.rect.w * 100}%`,
            }
      }
      onPointerDown={(event) =>
        session.startDrag(event, divider.splitId, divider.index)
      }
      onKeyDown={(event) => {
        const forward = vertical ? 'ArrowRight' : 'ArrowDown'

        const back = vertical ? 'ArrowLeft' : 'ArrowUp'

        if (event.key !== forward && event.key !== back) return
        event.preventDefault()
        const step = event.shiftKey ? 0.1 : 0.02

        session.apply((previous) =>
          resizeDivider(
            previous,
            divider.splitId,
            divider.index,
            event.key === forward ? step : -step,
          ),
        )
      }}
    >
      <span className="mx-grab" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}
