import { useQuery } from '@tanstack/react-query'
import { ZodError } from 'zod'

import { ComposedSheetWorkspace } from '#/components/sheet/composed-sheet-workspace'
import { ScientificSheetBlock } from '#/components/sheet/scientific-sheet-block'
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { frozenSheetGridFromState } from '#/lib/frozen-sheet-grid'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import {
  fetchSheetInstanceNotebookEmbeddings,
  notebookTemplateDataClient,
} from '#/lib/notebook-template-data'
import { sheetBlockInstanceId } from '#/lib/sheet-block'
import {
  fetchSheetDefinition,
  fetchSheetDefinitionVersion,
  sheetDefinitionDataClient,
} from '#/lib/sheet-definition-data'
import type { FrozenSheetEvidence } from '#/lib/sheet-evidence'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'

export function NotebookSheetBlock({
  block,
  record,
  readOnly,
  frozenEvidence,
  onConvertLegacy,
}: {
  block: NotebookBlock
  record: NotebookRecord
  readOnly?: boolean
  frozenEvidence?: FrozenSheetEvidence
  onConvertLegacy?: () => void
}) {
  const instanceId = sheetBlockInstanceId(block.payload)
  if (!instanceId) {
    return (
      <div className="flex min-h-[12rem] flex-col">
        {onConvertLegacy && !readOnly ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              This Sheet still uses the older table format. Convert it to a
              Sheet Instance to share it across Notebooks.
            </p>
            <Button type="button" size="sm" onClick={onConvertLegacy}>
              Convert to Sheet Instance
            </Button>
          </div>
        ) : null}
        <ScientificSheetBlock block={block} readOnly={readOnly} />
      </div>
    )
  }
  if (frozenEvidence) {
    return <FrozenSheetEvidencePanel evidence={frozenEvidence} />
  }
  return (
    <NotebookInstanceSheetEmbed
      instanceId={instanceId}
      projectId={record.projectId}
      recordId={record.id}
    />
  )
}

export function FrozenSheetEvidencePanel({
  evidence,
}: {
  evidence: FrozenSheetEvidence
}) {
  const grid = frozenSheetGridFromState(evidence.instanceState)
  const origin =
    evidence.sourceDefinitionVersionId === null
      ? 'Ad hoc Sheet'
      : 'Sheet Definition'
  const bindingCount = evidence.datasetBindings.length

  return (
    <div
      className="space-y-3 p-3"
      role="region"
      aria-label="Frozen Sheet evidence"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium" role="status">
          Frozen submitted Sheet evidence
        </p>
        <Badge variant="success" className="text-xs">
          Read-only
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Reconstructed from the approved revision, not the live Sheet. {origin}
        {bindingCount > 0
          ? ` · ${bindingCount} Dataset binding${bindingCount === 1 ? '' : 's'}`
          : ''}
        {evidence.instanceRevision > 0
          ? ` · revision ${evidence.instanceRevision}`
          : ''}
        .
      </p>
      {grid.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No local columns were frozen with this Sheet.
        </p>
      ) : (
        <Table aria-label="Frozen Sheet" containerClassName="rounded-md border">
          <TableHeader>
            <TableRow>
              {grid.columns.map((column) => (
                <TableHead key={column.id}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grid.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={grid.columns.length}
                  className="text-muted-foreground"
                >
                  No local rows were frozen with this Sheet.
                </TableCell>
              </TableRow>
            ) : (
              grid.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={grid.columns[cellIndex]?.id ?? cellIndex}>
                      {cell || '—'}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
      <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-foreground">
          Technical detail
        </summary>
        <dl className="mt-2 grid gap-1 text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">Instance</dt>{' '}
            <dd className="inline font-mono">{evidence.instanceId}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">
              Definition version
            </dt>{' '}
            <dd className="inline font-mono">
              {evidence.sourceDefinitionVersionId ?? 'none'}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

export function sheetInstanceEmbedErrorMessage(
  error: unknown,
  missing: boolean,
): string {
  if (
    error instanceof DataClientError &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'You do not have permission to view this Sheet.'
  }
  if (
    error instanceof ZodError ||
    (error instanceof Error && error.name === 'ZodError')
  ) {
    return 'This Sheet could not be displayed because its stored data is not in the expected format.'
  }
  if (
    (error instanceof DataClientError && error.status === 404) ||
    (!error && missing)
  ) {
    return 'This Sheet Instance could not be found.'
  }
  return 'This Sheet could not be loaded. Try again, or contact support if it keeps happening.'
}

function NotebookInstanceSheetEmbed({
  instanceId,
  projectId,
  recordId,
}: {
  instanceId: string
  projectId: string | null
  recordId: string
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
  const definitionVersionId = instance.data?.sourceDefinitionVersionId ?? null
  const definitionVersion = useQuery({
    queryKey: ['sheet-definition-version', definitionVersionId],
    enabled: Boolean(definitionVersionId),
    queryFn: () =>
      fetchSheetDefinitionVersion(
        definitionVersionId!,
        sheetDefinitionDataClient,
      ),
  })
  const definitionId = definitionVersion.data?.definitionId ?? null
  const definition = useQuery({
    queryKey: ['sheet-definition', definitionId],
    enabled: Boolean(definitionId),
    queryFn: () =>
      fetchSheetDefinition(definitionId!, sheetDefinitionDataClient),
  })

  if (instance.isLoading) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        Loading Sheet…
      </p>
    )
  }
  if (instance.error || !instance.data) {
    return (
      <p className="p-3 text-sm text-destructive" role="alert">
        {sheetInstanceEmbedErrorMessage(instance.error, !instance.data)}
      </p>
    )
  }

  const others =
    embeddings.data?.embeddings.filter((item) => item.recordId !== recordId) ??
    []
  const isShared = (embeddings.data?.count ?? 0) > 1
  const definitionLabel = instance.data.sourceDefinitionVersionId
    ? definition.data
      ? `${definition.data.name} · version ${definitionVersion.data?.version ?? ''}`
      : 'Sheet Definition'
    : 'Ad hoc Sheet'

  return (
    <div className="flex min-h-[24rem] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
        <h3 className="text-sm font-medium text-foreground">
          {instance.data.name}
        </h3>
        <span className="text-xs text-muted-foreground">{definitionLabel}</span>
        {isShared ? (
          <Badge variant="info" className="text-xs">
            Shared
            {others.length
              ? ` · also in ${others.map((item) => item.identifier).join(', ')}`
              : ''}
          </Badge>
        ) : null}
        {instance.data.lifecycle === 'archived' ? (
          <Badge variant="outline" className="text-xs">
            Archived
          </Badge>
        ) : null}
      </div>
      {!projectId ? (
        <p className="px-1 text-xs text-muted-foreground" role="status">
          This Notebook has no project, so Records cannot be created or linked
          here. The Sheet remains readable.
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <ComposedSheetWorkspace
          instanceId={instanceId}
          projectId={projectId}
          readOnly={!projectId}
        />
      </div>
    </div>
  )
}
