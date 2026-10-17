import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import type { Crumb } from '#/components/v3/ui/breadcrumb'
import { PageHeader } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import {
  CollaborationRoom,
  safeBuildRoomId,
} from '#/components/collaboration/collaboration-room'
import { useCollaborationEnabled } from '#/lib/collaboration/liveblocks.config'
import { CanonicalSheetWorkspace } from '#/components/sheet/canonical-sheet-workspace'
import {
  notebookDataClient,
  fetchProject,
  fetchRecord,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { useRecentViewTracking } from '#/lib/recents'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'

/** UI port (roadmap-4/ui-app3): the working sheet renders inside app-3's shell
 * with its own header, replacing the legacy useShell wrapper. The canonical
 * sheet engine is unchanged. */
export const Route = createFileRoute('/sheets/$sheetId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    projectId: string | undefined
    commentId?: string
  } => ({
    projectId:
      typeof search.projectId === 'string' ? search.projectId : undefined,
    commentId: z.uuid().optional().catch(undefined).parse(search.commentId),
  }),
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    await resolveIdentifierParam({
      entity: 'sheet',
      ref: params.sheetId,
      href: location.href,
    })
    return { context }
  },
  component: ComposedSheetRoute,
})

/** NAV-02 Share: copies the sheet's deep link. Clipboard access can be denied
 * (no permission, insecure context), so the toast reports the actual outcome —
 * claiming "Link copied" when nothing reached the clipboard leaves the user
 * with an empty paste and no explanation. */
async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast('Link copied')
  } catch {
    toast.error('Could not copy the link. Copy it from the address bar.')
  }
}

export function ComposedSheetRoute() {
  const { sheetId } = Route.useParams()
  const { projectId: projectIdParam, commentId } = Route.useSearch()
  const { context } = Route.useRouteContext()

  // FIND-01: this page counts as a "view" for the Recent surface.
  useRecentViewTracking('sheet', sheetId)

  // NAV-02: context-preserving navigation. The Sheet reconstructs its
  // project/owning-notebook context from stable IDs on the instance itself —
  // never from browser history or the referring page. The same query key the
  // workspace uses is shared so the context read costs no extra fetch.
  const instanceQuery = useQuery({
    queryKey: ['sheet-instance', sheetId],
    queryFn: () => fetchSheetInstance(sheetId, sheetInstanceDataClient),
  })
  const instance = instanceQuery.data ?? null
  const instanceProjectId = instance?.projectId ?? projectIdParam ?? null
  const owningRecordId = instance?.notebookRecordId ?? null

  const projectQuery = useQuery({
    queryKey: notebookQueryKeys.project(instanceProjectId ?? 'none'),
    queryFn: () => fetchProject(notebookDataClient, instanceProjectId!),
    enabled: Boolean(instanceProjectId),
  })
  const owningRecordQuery = useQuery({
    queryKey: notebookQueryKeys.record(owningRecordId ?? 'none'),
    queryFn: () => fetchRecord(notebookDataClient, owningRecordId!),
    enabled: Boolean(owningRecordId),
  })

  // COLLAB-01: presence awareness for the canonical Sheet Instance. The room
  // carries presence only — thread anchoring on sheet rows waits for a
  // canonical per-row identity (queued follow-up task).
  const collaborationEnabled = useCollaborationEnabled()
  const collaborationRoomId = collaborationEnabled
    ? safeBuildRoomId(context.workspace?.id, 'sheet', sheetId)
    : null

  // The sheet's location: its project and the record that owns it, when it has
  // them, then the sheet itself.
  const trail: Crumb[] = []
  if (instanceProjectId) {
    trail.push({
      label: projectQuery.data?.title ?? 'Project',
      link: {
        to: '/projects/$projectId',
        params: { projectId: instanceProjectId },
      },
    })
  }
  if (owningRecordId && owningRecordQuery.data) {
    trail.push({
      label: owningRecordQuery.data.title,
      link: {
        to: '/records/$recordId/notebook',
        params: { recordId: owningRecordId },
      },
    })
  }
  trail.push({ label: 'Sheet', mono: true })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        trail={trail}
        title={instance?.name ?? 'Sheet'}
        meta={
          <>
            {instance?.displayId ? (
              <span className="mono">{instance.displayId}</span>
            ) : null}
            <span>{instance ? `v${instance.revision}` : 'Loading…'}</span>
            {instance?.sourceDefinitionVersionId ? (
              <span className="max-lg:hidden">From a template</span>
            ) : (
              <span className="max-lg:hidden">Ad-hoc sheet</span>
            )}
          </>
        }
        actions={
          <>
            <FavouriteToggle kind="sheet" objectId={sheetId} />
            <Button
              onClick={() => {
                void copyShareLink()
              }}
            >
              Share
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <CollaborationRoom roomId={collaborationRoomId}>
          <CanonicalSheetWorkspace
            instanceId={sheetId}
            projectId={instanceProjectId}
            commentId={commentId}
          />
        </CollaborationRoom>
      </div>
    </div>
  )
}
