import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { useShell } from '#/components/app-shell'
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
import { objectContextBreadcrumbs } from '#/lib/navigation'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'

export const Route = createFileRoute('/sheets/$instanceId')({
  validateSearch: (search: Record<string, unknown>) => ({
    projectId:
      typeof search.projectId === 'string' ? search.projectId : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: ComposedSheetRoute,
})

function ComposedSheetRoute() {
  const { instanceId } = Route.useParams()
  const { projectId: projectIdParam } = Route.useSearch()
  const { context } = Route.useRouteContext()

  // NAV-02: context-preserving navigation. The Sheet reconstructs its
  // project/owning-notebook context from stable IDs on the instance itself —
  // never from browser history or the referring page. The same query key the
  // workspace uses is shared so the context read costs no extra fetch.
  const instanceQuery = useQuery({
    queryKey: ['sheet-instance', instanceId],
    queryFn: () => fetchSheetInstance(instanceId, sheetInstanceDataClient),
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

  // Stable identity so query updates that don't change the crumbs don't
  // re-render the app shell on every route render (review finding).
  const breadcrumbs = useMemo(
    () =>
      objectContextBreadcrumbs({
        objectLabel: instance?.name ?? 'Sheet',
        project: instanceProjectId
          ? {
              id: instanceProjectId,
              title: projectQuery.data?.title ?? 'Project',
            }
          : null,
        owningRecord:
          owningRecordId && owningRecordQuery.data
            ? {
                id: owningRecordId,
                title: owningRecordQuery.data.title,
              }
            : null,
      }),
    [
      instance?.name,
      instanceProjectId,
      owningRecordId,
      projectQuery.data,
      owningRecordQuery.data,
    ],
  )

  useShell({
    fullBleed: true,
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs,
  })

  // COLLAB-01: presence awareness for the canonical Sheet Instance. The
  // room carries presence only — thread anchoring on sheet rows waits for a
  // canonical per-row identity (queued follow-up task).
  const collaborationEnabled = useCollaborationEnabled()
  const collaborationRoomId = collaborationEnabled
    ? safeBuildRoomId(context.workspace?.id, 'sheet', instanceId)
    : null

  return (
    <CollaborationRoom roomId={collaborationRoomId}>
      <CanonicalSheetWorkspace
        instanceId={instanceId}
        projectId={projectIdParam ?? null}
        readOnly={!projectIdParam}
      />
    </CollaborationRoom>
  )
}
