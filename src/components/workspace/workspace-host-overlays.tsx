import type { DropEdge } from '#/lib/pane-geometry'
import { t } from '#/copy'

import { PeekCard } from './peek-card'
import type { WorkspaceSession } from './workspace-session'

/**
 * The two things that float over the whole workspace: the hint that names what
 * a record link's keys do while one is hovered, and the peek card for the
 * record under the cursor. Opening the record is a separate step, so a peek
 * never changes what is on screen.
 */
export function WorkspaceOverlays({ session }: { session: WorkspaceSession }) {
  const { links, platform } = session

  return (
    <>
      {links.hint ? (
        <div
          className="mx-pill"
          role="presentation"
          style={{ left: links.hint.left, top: links.hint.top }}
        >
          <span className="mx-kbd is-inv">
            {t('projects.workspaceHost.keySpace')}
          </span>{' '}
          {t('projects.workspaceHost.peek')}
          <span className="mx-dotsep">·</span>
          <span className="mx-kbd is-inv">
            {platform === 'mac' ? '⌥' : t('projects.workspaceHost.keyAlt')}
          </span>
          {t('projects.workspaceHost.clickBeside')}
          <span className="mx-dotsep">·</span>
          <span className="mx-kbd is-inv">
            {platform === 'mac'
              ? '⌥⇧'
              : `${t('projects.workspaceHost.keyAlt')}+${t('projects.workspaceHost.keyShift')}`}
          </span>
          {t('projects.workspaceHost.clickBelow')}
        </div>
      ) : null}
      {links.peek ? (
        <PeekCard
          target={links.peek}
          pinned={session.shelfHrefs.has(links.peek.href)}
          onClose={session.closePeek}
          onOpenBeside={session.peekBeside}
          onOpenHere={session.peekHere}
          onPin={session.peekPin}
        />
      ) : null}
    </>
  )
}

/**
 * Where a dragged record link would land: one half of a pane, to open the
 * record beside it, or the primary pane's middle, which cites it in that
 * notebook instead.
 */
export function WorkspaceDropOverlay({
  edge,
}: {
  edge: DropEdge | 'center' | null
}) {
  if (!edge) return null

  if (edge === 'center')
    return (
      <div
        className="mx-drop"
        style={{ top: '30%', bottom: '30%', left: '30%', right: '30%' }}
        aria-hidden="true"
      >
        <span className="mx-drop-l">
          {t('projects.workspaceHost.citeHere')}
        </span>
      </div>
    )

  const style: React.CSSProperties =
    edge === 'left'
      ? { top: 0, bottom: 0, left: 0, width: '50%' }
      : edge === 'right'
        ? { top: 0, bottom: 0, right: 0, width: '50%' }
        : edge === 'top'
          ? { top: 0, left: 0, right: 0, height: '50%' }
          : { bottom: 0, left: 0, right: 0, height: '50%' }

  return (
    <div className="mx-drop" style={style} aria-hidden="true">
      <span className="mx-drop-l">
        {t('projects.workspaceHost.openBeside')}
      </span>
    </div>
  )
}
