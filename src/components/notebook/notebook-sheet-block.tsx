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
import type { FrozenSheetEvidence } from '#/lib/sheet-evidence'
import { sheetBlockInstanceId } from '#/lib/sheet-block'

export function NotebookSheetBlock({
  block,
  record,
  readOnly,
  frozenEvidence,
}: {
  block: NotebookBlock
  record: NotebookRecord
  readOnly?: boolean
  frozenEvidence?: FrozenSheetEvidence
}) {
  const instanceId = sheetBlockInstanceId(block.payload)
  if (!instanceId) {
    return <ScientificSheetBlock block={block} readOnly={readOnly} />
  }
  if (frozenEvidence) {
    return <FrozenSheetEvidencePanel evidence={frozenEvidence} />
  }
  return (
    <NotebookInstanceSheetEmbed
      instanceId={instanceId}
      projectId={record.projectId}
    />
  )
}

function FrozenSheetEvidencePanel({
  evidence,
}: {
  evidence: FrozenSheetEvidence
}) {
  const localValues = evidence.instanceState.localValues
  return (
    <div className="space-y-2 p-3" role="region" aria-label="Frozen Sheet evidence">
      <p className="text-xs font-medium" role="status">
        Frozen submitted Sheet evidence. This view is reconstructed from the
        revision snapshot, not the live Sheet Instance.
      </p>
      <dl className="grid gap-1 text-xs text-muted-foreground">
        <div>
          <dt className="inline font-medium text-foreground">Instance</dt>{' '}
          <dd className="inline font-mono">{evidence.instanceId}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">
            Definition version
          </dt>{' '}
          <dd className="inline font-mono">
            {evidence.sourceDefinitionVersionId ?? 'ad hoc'}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">
            Instance revision
          </dt>{' '}
          <dd className="inline">{evidence.instanceRevision}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">
            Dataset bindings
          </dt>{' '}
          <dd className="inline">
            {evidence.datasetBindings.length
              ? evidence.datasetBindings
                  .map((binding) => String(binding.datasetVersionId ?? binding.datasetId ?? ''))
                  .join(', ')
              : 'none'}
          </dd>
        </div>
      </dl>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
        {JSON.stringify(localValues ?? {}, null, 2)}
      </pre>
    </div>
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
  if (instance.error || !instance.data) {
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
