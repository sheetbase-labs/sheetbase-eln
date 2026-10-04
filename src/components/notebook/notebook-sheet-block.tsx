import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ZodError } from 'zod'

import { CanonicalSheetWorkspace } from '#/components/sheet/canonical-sheet-workspace'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
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
import { sheetCommentAnchorSchema } from '#/lib/sheet-comment-anchor'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'

export function NotebookSheetBlock({
  block,
  record,
  readOnly = false,
  frozenEvidence,
}: {
  block: NotebookBlock
  record: NotebookRecord
  readOnly?: boolean
  /** null means historical evidence was expected but is unavailable. */
  frozenEvidence?: FrozenSheetEvidence | null
}) {
  if (frozenEvidence) {
    return <FrozenSheetEvidencePanel evidence={frozenEvidence} />
  }
  if (frozenEvidence === null || record.lockedAt) {
    return (
      <p className="p-3 text-sm text-fg-muted" role="status">
        Frozen Sheet evidence is unavailable. Live values are not shown for this
        revision.
      </p>
    )
  }
  const instanceId = sheetBlockInstanceId(block.payload)
  if (!instanceId) {
    return (
      <p className="p-3 text-sm text-fg-muted" role="status">
        This block has no Sheet Instance.
      </p>
    )
  }
  return (
    <NotebookInstanceSheetEmbed
      instanceId={instanceId}
      projectId={record.projectId}
      recordId={record.id}
      readOnly={readOnly}
    />
  )
}

export function FrozenSheetEvidencePanel({
  evidence,
  onCommentTarget,
}: {
  evidence: FrozenSheetEvidence
  onCommentTarget?: (anchor: SheetCommentAnchor) => void
}) {
  const grid = frozenSheetGridFromEvidence(evidence)
  const [selection, setSelection] = useState<{
    start: { row: number; column: number }
    end: { row: number; column: number }
  } | null>(null)
  const [targetKind, setTargetKind] =
    useState<SheetCommentAnchor['targetKind']>('sheet_cell')
  const target =
    selection && grid.rowKeys
      ? sheetCommentAnchorSchema.safeParse({
          targetKind,
          target: {
            instanceId: evidence.instanceId,
            rowKeys:
              targetKind === 'sheet_range'
                ? grid.rowKeys
                    .slice(
                      Math.min(selection.start.row, selection.end.row),
                      Math.max(selection.start.row, selection.end.row) + 1,
                    )
                    .sort()
                : [grid.rowKeys[selection.end.row]],
            fieldIds:
              targetKind === 'sheet_row'
                ? []
                : targetKind === 'sheet_range'
                  ? grid.columns
                      .slice(
                        Math.min(selection.start.column, selection.end.column),
                        Math.max(selection.start.column, selection.end.column) +
                          1,
                      )
                      .map((column) => column.id)
                      .sort()
                  : [grid.columns[selection.end.column]?.id],
          },
        })
      : null
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
        <Badge variant="add" className="text-xs">
          Read-only
        </Badge>
      </div>
      <p className="text-xs text-fg-muted">
        Reconstructed from the submitted revision, not the live Sheet. {origin}
        {bindingCount > 0
          ? ` · ${bindingCount} Dataset binding${bindingCount === 1 ? '' : 's'}`
          : ''}
        {evidence.instanceRevision > 0
          ? ` · revision ${evidence.instanceRevision}`
          : ''}
        .
      </p>
      {onCommentTarget ? (
        grid.rowKeys ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-fg-muted">
              Comment target
              <select
                aria-label="Frozen comment target"
                value={targetKind}
                onChange={(event) => {
                  const kind = event.target.value
                  if (
                    kind === 'sheet_cell' ||
                    kind === 'sheet_row' ||
                    kind === 'sheet_range'
                  )
                    setTargetKind(kind)
                }}
                className="ml-2 rounded border bg-surface px-2 py-1 text-fg"
              >
                <option value="sheet_cell">Cell</option>
                <option value="sheet_row">Row</option>
                <option value="sheet_range">Range</option>
              </select>
            </label>
            <Button
              size="sm"
              disabled={!target?.success}
              onClick={() => {
                if (target?.success) onCommentTarget(target.data)
              }}
            >
              Comment on frozen selection
            </Button>
            <p className="text-xs text-fg-muted">
              Select a cell. Shift-click another cell to extend a range.
            </p>
            {target?.success ? (
              <p className="text-xs text-fg" role="status">
                Selected target: {target.data.target.rowKeys.length}{' '}
                {target.data.target.rowKeys.length === 1 ? 'row' : 'rows'}
                {targetKind === 'sheet_row'
                  ? ''
                  : ` · ${target.data.target.fieldIds.length} ${target.data.target.fieldIds.length === 1 ? 'field' : 'fields'}`}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-fg-muted" role="status">
            Cell comments are unavailable because this historical evidence has
            no stable row identities.
          </p>
        )
      ) : null}
      {grid.columns.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No local columns were frozen with this Sheet.
        </p>
      ) : (
        <TableBox className="rounded-md border">
          <Table aria-label="Frozen Sheet">
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
                    className="text-fg-muted"
                  >
                    No local rows were frozen with this Sheet.
                  </TableCell>
                </TableRow>
              ) : (
                grid.rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <TableCell key={grid.columns[cellIndex]?.id ?? cellIndex}>
                        {onCommentTarget && grid.rowKeys ? (
                          <button
                            type="button"
                            className="w-full rounded px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-selection aria-pressed:ring-1 aria-pressed:ring-primary"
                            aria-label={`Select ${grid.columns[cellIndex]?.label} row ${rowIndex + 1}`}
                            aria-pressed={
                              selection !== null &&
                              (targetKind === 'sheet_row'
                                ? rowIndex === selection.end.row
                                : targetKind === 'sheet_cell'
                                  ? rowIndex === selection.end.row &&
                                    cellIndex === selection.end.column
                                  : rowIndex >=
                                      Math.min(
                                        selection.start.row,
                                        selection.end.row,
                                      ) &&
                                    rowIndex <=
                                      Math.max(
                                        selection.start.row,
                                        selection.end.row,
                                      ) &&
                                    cellIndex >=
                                      Math.min(
                                        selection.start.column,
                                        selection.end.column,
                                      ) &&
                                    cellIndex <=
                                      Math.max(
                                        selection.start.column,
                                        selection.end.column,
                                      ))
                            }
                            onClick={(event) => {
                              const position = {
                                row: rowIndex,
                                column: cellIndex,
                              }
                              setSelection((current) => ({
                                start:
                                  event.shiftKey && current
                                    ? current.start
                                    : position,
                                end: position,
                              }))
                            }}
                          >
                            {cell || '—'}
                          </button>
                        ) : (
                          cell || '—'
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableBox>
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
  readOnly,
}: {
  instanceId: string
  projectId: string | null
  recordId: string
  readOnly: boolean
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
      <p className="p-3 text-sm text-fg-muted" role="status">
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
        <h3 className="text-sm font-medium text-fg">{instance.data.name}</h3>
        <span className="text-xs text-fg-muted">{definitionLabel}</span>
        {sharedCount > 1 ? (
          <SharedNotebooksBadge others={others} total={sharedCount} />
        ) : null}
        {instance.data.lifecycle === 'archived' ? (
          <Badge variant="kind" className="text-xs">
            Archived
          </Badge>
        ) : null}
        {/* NAV-02: the Notebook → Sheet link. The full-page Sheet keeps the
        canonical ?projectId context so it opens with the same write
        affordances as the embed. */}
        <Link
          className="ml-auto text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
          to="/sheets/$sheetId"
          params={{ sheetId: instanceId }}
          search={{ projectId: projectId ?? undefined }}
        >
          Open full sheet
        </Link>
      </div>
      {!projectId ? (
        <p className="px-1 text-xs text-fg-muted" role="status">
          This Notebook has no project, so Records cannot be created or linked
          here. The Sheet remains readable.
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <CanonicalSheetWorkspace
          instanceId={instanceId}
          projectId={projectId}
          readOnly={
            readOnly || !projectId || instance.data.lifecycle !== 'active'
          }
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
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex"
            aria-label={`Shared with ${extra} other Notebook${extra === 1 ? '' : 's'}`}
          />
        }
      >
        <Badge variant="kind" className="cursor-pointer text-xs">
          Shared · {extra} other Notebook{extra === 1 ? '' : 's'}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <p className="border-b px-3 py-2 text-xs font-medium">Also used in</p>
        <ul className="max-h-64 overflow-y-auto py-1">
          {others.map((item) => (
            <li key={item.recordId} className="px-3 py-1.5 text-sm">
              <span className="font-mono text-xs text-fg-muted">
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
