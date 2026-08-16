import { useQuery } from '@tanstack/react-query'

import { ComposedSheetWorkspace } from '#/components/sheet/composed-sheet-workspace'
import { ScientificSheetBlock } from '#/components/sheet/scientific-sheet-block'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import {
  fetchSheetInstanceNotebookEmbeddings,
  notebookTemplateDataClient,
} from '#/lib/notebook-template-data'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'
import { sheetBlockInstanceId } from '#/lib/sheet-block'

export function NotebookSheetBlock({
  block,
  record,
  readOnly,
}: {
  block: NotebookBlock
  record: NotebookRecord
  readOnly?: boolean
}) {
  const instanceId = sheetBlockInstanceId(block.payload)
  if (!instanceId) {
    return <ScientificSheetBlock block={block} readOnly={readOnly} />
  }
  return (
    <NotebookInstanceSheetEmbed
      instanceId={instanceId}
      projectId={record.projectId}
    />
  )
}

function NotebookInstanceSheetEmbed({
  instanceId,
  projectId,
}: {
  instanceId: string
  projectId: string | null
}) {
  const instance = useQuery({
    queryKey: ['sheet-instance', instanceId],
    queryFn: () => fetchSheetInstance(instanceId, sheetInstanceDataClient),
  })
  const embeddings = useQuery({
    queryKey: ['sheet-instance-embeddings', instanceId],
    queryFn: () =>
      fetchSheetInstanceNotebookEmbeddings(
        instanceId,
        notebookTemplateDataClient,
      ),
  })

  if (instance.isLoading) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        Loading Sheet Instance…
      </p>
    )
  }
  if (instance.error || instance.data === null) {
    return (
      <p className="p-3 text-sm text-destructive" role="alert">
        Sheet Instance is unavailable or you do not have permission to view it.
      </p>
    )
  }
  if (!projectId) {
    return (
      <p className="p-3 text-sm" role="alert">
        This Notebook has no project, so the composed Sheet cannot create or
        link Records here.
      </p>
    )
  }

  return (
    <div className="flex min-h-[24rem] flex-col gap-2">
      {embeddings.data && embeddings.data.count > 1 ? (
        <p className="text-xs text-amber-800 dark:text-amber-200" role="status">
          Shared live Sheet. Editing here changes the same Instance in{' '}
          {embeddings.data.count} Notebook placements
          {embeddings.data.embeddings.length
            ? ` (${embeddings.data.embeddings
                .map((item) => item.identifier)
                .join(', ')})`
            : ''}
          .
        </p>
      ) : null}
      {instance.data.lifecycle === 'archived' ? (
        <p className="text-xs text-muted-foreground" role="status">
          This Sheet Instance is archived. Existing references remain
          readable.
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <ComposedSheetWorkspace instanceId={instanceId} projectId={projectId} />
      </div>
    </div>
  )
}
