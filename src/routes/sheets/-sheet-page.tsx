import { t } from '#/copy'
import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { getRouteApi } from '@tanstack/react-router'

import { PageHeader } from '#/components/ui/layout'
import { CollaborationRoom } from '#/components/collaboration/collaboration-room'
import { safeBuildRoomId } from '#/components/collaboration/collaboration-room-id'
import { useCollaborationEnabled } from '#/lib/collaboration/collaboration-enabled'
import { ColumnPromotionsPanel } from '#/components/sheets/column-promotions-panel'
import { CanonicalSheetWorkspace } from '#/components/sheet/canonical-sheet-workspace'
import { useRecentViewTracking } from '#/lib/recents'

import { SheetPageHeader } from './-sheet-page-header'
import { useSheetPageModel } from './-sheet-page-model'

/** UI port (roadmap-4/ui-app3): the working sheet renders inside app-3's shell
 * with its own header, replacing the legacy useShell wrapper. The canonical
 * sheet engine is unchanged. */
const Route = getRouteApi('/sheets/$sheetId')

export function ComposedSheetRoute() {
  const { sheetId } = Route.useParams()
  const { projectId: projectIdParam, commentId, paste } = Route.useSearch()
  const { context } = Route.useRouteContext()

  // FIND-01: this page counts as a "view" for the Recent surface.
  useRecentViewTracking('sheet', sheetId)

  const { instance, instanceQuery, instanceProjectId, trail, readOnly } =
    useSheetPageModel({ sheetId, projectIdParam })

  // COLLAB-01: presence awareness for the canonical Sheet Instance. The room
  // carries presence only — thread anchoring on sheet rows waits for a
  // canonical per-row identity (queued follow-up task).
  const collaborationEnabled = useCollaborationEnabled()

  const collaborationRoomId = collaborationEnabled
    ? safeBuildRoomId(context.workspace?.id, 'sheet', sheetId)
    : null

  if (!instanceQuery.isPending && !instance) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader
          trail={trail}
          title={
            instanceQuery.isError
              ? t('notebook.sheetPage.sheetUnavailable')
              : t('notebook.sheetPage.sheetNotFound')
          }
        />
        <RecordUnavailable
          query={instanceQuery}
          what={t('settings.uiKit.recordUnavailable.sheet')}
          back={{
            to: '/projects',
            label: t('settings.uiKit.recordUnavailable.backToProjects'),
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SheetPageHeader trail={trail} instance={instance} sheetId={sheetId} />
      <div className="px-4 empty:hidden">
        <ColumnPromotionsPanel
          instanceId={sheetId}
          role={context.workspace?.role}
          user={{ id: context.user.id, name: context.user.name }}
        />
      </div>
      {/* One bordered card, as in a notebook, as tall as its rows; the grid
          scrolls only once the page runs out of room. */}
      <div className="mx-4 mt-3 mb-4 flex min-h-0 min-w-0 flex-initial overflow-hidden rounded-lg border border-border-strong bg-surface [--sheet-grid-max-h:none] max-md:mx-2">
        <CollaborationRoom roomId={collaborationRoomId}>
          <CanonicalSheetWorkspace
            instanceId={sheetId}
            projectId={instanceProjectId}
            readOnly={readOnly}
            commentId={commentId}
            openPasteOnLoad={paste}
          />
        </CollaborationRoom>
      </div>
    </div>
  )
}
