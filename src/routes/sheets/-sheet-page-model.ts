import { useQuery } from '@tanstack/react-query'

import type { Crumb } from '#/components/ui/breadcrumb'
import {
  notebookDataClient,
  fetchProject,
  fetchRecord,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import type { NotebookRecord } from '#/lib/notebook-data'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { t } from '#/copy'

/**
 * The sheet page's data model: the instance, the project and owning record it
 * names, the breadcrumb trail that follows from them, and whether the record
 * that owns the sheet leaves it read-only.
 */
export function useSheetPageModel({
  sheetId,
  projectIdParam,
}: {
  sheetId: string
  projectIdParam: string | undefined
}) {
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

  return {
    instance,
    instanceQuery,
    instanceProjectId,
    trail: sheetTrail({
      instance,
      instanceProjectId,
      projectTitle: projectQuery.data?.title,
      owningRecordId,
      owningRecord: owningRecordQuery.data,
    }),
    readOnly: owningRecordReadOnly(owningRecordId, owningRecordQuery.data),
  }
}

/**
 * The sheet's location: its project and the record that owns it, when it has
 * them, then the sheet itself.
 */
function sheetTrail({
  instance,
  instanceProjectId,
  projectTitle,
  owningRecordId,
  owningRecord,
}: {
  instance: SheetInstance | null
  instanceProjectId: string | null
  projectTitle: string | undefined
  owningRecordId: string | null
  owningRecord: NotebookRecord | null | undefined
}): Crumb[] {
  const trail: Crumb[] = []

  if (instanceProjectId) {
    trail.push({
      label: projectTitle ?? t('notebook.sheetPage.label'),
      link: {
        to: '/projects/$projectId',
        params: { projectId: instanceProjectId },
      },
    })
  }

  if (owningRecordId && owningRecord) {
    // An experiment has one page; any other owner keeps its notebook.
    trail.push({
      label: owningRecord.title,
      link:
        owningRecord.kind === 'experiment'
          ? { to: '/experiments/$expId', params: { expId: owningRecordId } }
          : {
              to: '/records/$recordId/notebook',
              params: { recordId: owningRecordId },
            },
    })
  }

  trail.push({
    label: instance?.displayId ?? t('notebook.sheetPage.sheetLabel'),
    mono: true,
  })

  return trail
}

/** A sheet owned by a locked or archived record is read-only. */
function owningRecordReadOnly(
  owningRecordId: string | null,
  owningRecord: NotebookRecord | null | undefined,
): boolean | undefined {
  if (!owningRecordId) return undefined

  return Boolean(
    !owningRecord || owningRecord.lockedAt || owningRecord.archivedAt,
  )
}
