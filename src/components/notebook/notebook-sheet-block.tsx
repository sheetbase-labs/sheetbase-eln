import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ZodError } from 'zod'

import { CanonicalSheetWorkspace } from '#/components/sheet/canonical-sheet-workspace'
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { frozenSheetGridFromEvidence } from '#/lib/frozen-sheet-grid'
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
  frozenEvidence,
}: {
  block: NotebookBlock
  record: NotebookRecord
  readOnly?: boolean
  frozenEvidence?: FrozenSheetEvidence
}) {
  const instanceId = sheetBlockInstanceId(block.payload)
  if (!instanceId) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        This block has no Sheet Instance.
      </p>
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
  const grid = frozenSheetGridFromEvidence(evidence)
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

  if (instance.isPending) {
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
  const sharedCount = embeddings.data?.count ?? 0
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
        {sharedCount > 1 ? (
          <SharedNotebooksBadge others={others} total={sharedCount} />
        ) : null}
        {instance.data.lifecycle === 'archived' ? (
          <Badge variant="outline" className="text-xs">
            Archived
          </Badge>
        ) : null}
        {/* NAV-02: the Notebook → Sheet link. The full-page Sheet keeps the
        canonical ?projectId context so it opens with the same write
        affordances as the embed. */}
        <Link
          className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          to="/sheets/$instanceId"
          params={{ instanceId }}
          search={{ projectId: projectId ?? undefined }}
        >
          Open full sheet
        </Link>
      </div>
      {!projectId ? (
        <p className="px-1 text-xs text-muted-foreground" role="status">
          This Notebook has no project, so Records cannot be created or linked
          here. The Sheet remains readable.
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <CanonicalSheetWorkspace
          instanceId={instanceId}
          projectId={projectId}
          readOnly={!projectId || instance.data.lifecycle !== 'active'}
        />
      </div>
    </div>
  )
}

function SharedNotebooksBadge({
  others,
  total,
}: {
  others: Array<{ identifier: string; title: string; recordId: string }>
  total: number
}) {
  const extra = Math.max(0, total - 1)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex"
          aria-label={`Shared with ${extra} other Notebook${extra === 1 ? '' : 's'}`}
        >
          <Badge variant="info" className="cursor-pointer text-xs">
            Shared · {extra} other Notebook{extra === 1 ? '' : 's'}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <p className="border-b px-3 py-2 text-xs font-medium">Also used in</p>
        <ul className="max-h-64 overflow-y-auto py-1">
          {others.map((item) => (
            <li key={item.recordId} className="px-3 py-1.5 text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                {item.identifier}
              </span>
              <span className="mt-0.5 block truncate">{item.title}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
