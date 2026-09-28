import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input, Field } from '#/components/v3/ui/input'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import { datasetListQueryKeys } from '#/components/v3/datasets/datasets-data'
import { cn } from '#/lib/utils'
import { notebookDataClient } from '#/lib/notebook-data'
import { useDatasetVersions } from '../$datasetId'

interface RowValuePayload {
  datasetVersionId: string
  datasetId: string
  schemaVersionId: string
  totalCount: number
  offset: number
  limit: number
  rows: { rowId: string; revision: number; values: Record<string, unknown> }[]
}

interface FieldWire {
  field_id: string
  label: string
  logical_type: string
  unit: unknown
  display_order: number
}

interface FlagWire {
  id: string
  row_id: string
  field_id: string
  kind: string
  reason: string
}

/** UI port (roadmap-4/ui-app3): the dataset Rows grid, wired to
 * query_dataset_version_rows + schema fields, with flags for marking values out
 * of range. Row numbers are page positions: the model stores no row number. */
export const Route = createFileRoute('/datasets/$datasetId/rows')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; flagged?: boolean; row?: string; snapshot?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    flagged: search.flagged === true || search.flagged === 'true' || undefined,
    row: typeof search.row === 'string' ? search.row : undefined,
    snapshot: typeof search.snapshot === 'string' ? search.snapshot : undefined,
  }),
  component: Rows,
})

function Rows() {
  const { datasetId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const versions = useDatasetVersions(datasetId)
  const version =
    (versions.data ?? []).find((v) => v.id === search.snapshot) ??
    versions.data?.at(0)

  const rowsQuery = useQuery({
    queryKey: ['ui-port', 'dataset-rows', version?.id],
    queryFn: () =>
      notebookDataClient.rpc<RowValuePayload>('query_dataset_version_rows', {
        p_dataset_version_id: version!.id,
        p_limit: 100,
        p_offset: 0,
      }),
    enabled: Boolean(version),
  })
  const payload = rowsQuery.data

  const fieldsQuery = useQuery({
    queryKey: ['ui-port', 'dataset-fields', payload?.schemaVersionId],
    queryFn: () =>
      notebookDataClient.list<FieldWire>(
        'dataset_schema_version_fields',
        `?schema_version_id=eq.${payload!.schemaVersionId}&order=display_order.asc&select=field_id,label,logical_type,unit,display_order`,
      ),
    enabled: Boolean(payload?.schemaVersionId),
  })

  const flagsQuery = useQuery({
    queryKey: ['ui-port', 'dataset-flags', datasetId],
    queryFn: () =>
      notebookDataClient.list<FlagWire>(
        'dataset_value_flags',
        `?dataset_id=eq.${datasetId}&cleared_at=is.null&select=id,row_id,field_id,kind,reason`,
      ),
  })
  const fields = fieldsQuery.data ?? []
  const flags = flagsQuery.data ?? []
  const flagIndex = useMemo(() => {
    const map = new Map<string, FlagWire>()
    for (const f of flags) map.set(`${f.row_id}:${f.field_id}`, f)
    return map
  }, [flags])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogRow, setDialogRow] = useState<{
    rowId: string
    fieldId: string
    label: string
  } | null>(null)

  const flag = useMutation({
    mutationFn: (input: { rowId: string; fieldId: string; reason: string }) =>
      notebookDataClient.rpc('flag_dataset_value', {
        p_dataset_id: datasetId,
        p_row_id: input.rowId,
        p_field_id: input.fieldId,
        p_kind: 'out_of_range',
        p_reason: input.reason,
        p_comment: null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'dataset-flags', datasetId],
      })
      void queryClient.invalidateQueries({
        queryKey: datasetListQueryKeys.page,
      })
      toast('Value marked out of range')
      setDialogOpen(false)
    },
  })

  const q = (search.q ?? '').trim().toLowerCase()
  const rows = payload?.rows ?? []
  const visible = rows.filter((r) => {
    if (search.flagged && !flags.some((f) => f.row_id === r.rowId)) return false
    if (!q) return true
    return Object.values(r.values).some((v) =>
      String(v).toLowerCase().includes(q),
    )
  })
  const selected = visible.find((r) => r.rowId === search.row) ?? visible.at(0)

  if (!version) {
    return (
      <div className="px-6 py-4">
        <EmptyState
          icon="table"
          title="No snapshot to read rows from"
          body="Snapshot the dataset to freeze its rows as evidence; the grid reads a snapshot."
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 md:px-6">
          <label className="block w-full sm:w-[220px]">
            <span className="sr-only">Search rows</span>
            <Input
              type="search"
              placeholder="Search rows"
              defaultValue={search.q}
              className="h-[26px] text-label max-md:h-10"
              onChange={(e) =>
                void navigate({
                  to: '/datasets/$datasetId/rows',
                  params: { datasetId },
                  search: (s) => ({ ...s, q: e.target.value || undefined }),
                  replace: true,
                })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-label max-md:min-h-10 sm:ml-2">
            <Checkbox
              checked={!!search.flagged}
              onCheckedChange={(v) =>
                void navigate({
                  to: '/datasets/$datasetId/rows',
                  params: { datasetId },
                  search: (s) => ({ ...s, flagged: v ? true : undefined }),
                  replace: true,
                })
              }
            />
            Only flagged rows ({flags.length})
          </label>
          <span className="flex-1" />
          <Muted className="max-lg:hidden">
            Snapshot {version.label} · read-only; values change only by import
          </Muted>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 md:px-6">
          {visible.length ? (
            <TableBox className="mt-3">
              <Table className="min-w-max">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    {fields.map((f) => (
                      <TableHead
                        key={f.field_id}
                        align={f.logical_type === 'text' ? undefined : 'right'}
                      >
                        {f.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r, i) => {
                    const flagged = flags.some((f) => f.row_id === r.rowId)
                    return (
                      <TableRow
                        key={r.rowId}
                        selected={r.rowId === selected?.rowId}
                        className="cursor-pointer"
                        onClick={() =>
                          void navigate({
                            to: '/datasets/$datasetId/rows',
                            params: { datasetId },
                            search: (s) => ({ ...s, row: r.rowId }),
                            replace: true,
                          })
                        }
                      >
                        <TableCell className="num text-fg-muted">
                          {i + 1}
                          {flagged ? (
                            <span className="ml-1 text-danger">•</span>
                          ) : null}
                        </TableCell>
                        {fields.map((f) => {
                          const value = r.values[f.field_id]
                          const cellFlag = flagIndex.get(
                            `${r.rowId}:${f.field_id}`,
                          )
                          return (
                            <TableCell
                              key={f.field_id}
                              align={
                                f.logical_type === 'text' ? undefined : 'right'
                              }
                              className={cn(cellFlag && 'text-danger-text')}
                            >
                              {value == null ? '—' : String(value)}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <EmptyState
              icon="search"
              title="No rows match"
              body="Search looks at the values shown; the flagged filter keeps rows with any out-of-range value."
            />
          )}
          <div className="num py-2 text-label text-fg-muted">
            {visible.length} of {payload?.totalCount ?? 0} rows
            {selected ? ` · row ${visible.indexOf(selected) + 1} selected` : ''}
          </div>
        </div>
      </div>

      {selected ? (
        <Inspector aria-label="Row details" className="w-[320px]">
          <InspectorSection title={`Row ${visible.indexOf(selected) + 1}`}>
            <Muted className="mb-2">
              Row numbers are page positions; the model stores no row number.
            </Muted>
            <DescriptionList
              labelWidth={120}
              items={fields.map((f) => {
                const value = selected.values[f.field_id]
                const cellFlag = flagIndex.get(
                  `${selected.rowId}:${f.field_id}`,
                )
                return [
                  f.label,
                  <span className={cn(cellFlag && 'text-danger-text')}>
                    {value == null ? '—' : String(value)}
                    {cellFlag ? ` · ${cellFlag.reason}` : ''}
                  </span>,
                ]
              })}
            />
          </InspectorSection>
          {fields.length ? (
            <InspectorSection title="Actions">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setDialogRow({
                    rowId: selected.rowId,
                    fieldId: fields[0].field_id,
                    label: fields[0].label,
                  })
                  setDialogOpen(true)
                }}
              >
                Mark a value out of range…
              </Button>
            </InspectorSection>
          ) : null}
        </Inspector>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogHeader
            title="Mark out of range"
            description={
              dialogRow ? `${dialogRow.label} · ${version.label}` : undefined
            }
          />
          <DialogBody>
            <Field label="Column">
              <select
                className="h-[30px] w-full rounded-md border border-border bg-surface px-2 text-body text-fg"
                value={dialogRow?.fieldId ?? ''}
                onChange={(e) => {
                  const f = fields.find((x) => x.field_id === e.target.value)
                  if (f && dialogRow)
                    setDialogRow({
                      ...dialogRow,
                      fieldId: f.field_id,
                      label: f.label,
                    })
                }}
              >
                {fields.map((f) => (
                  <option key={f.field_id} value={f.field_id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <FlagReason
              busy={flag.isPending}
              onSubmit={(reason) => {
                if (!dialogRow) return
                flag.mutate({
                  rowId: dialogRow.rowId,
                  fieldId: dialogRow.fieldId,
                  reason,
                })
              }}
            />
            <Notice tone="warn" icon={false}>
              The flag leaves the value as recorded and excludes it from
              analyses, charts and pipeline inputs by default.
            </Notice>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              type="submit"
              form="flag-reason-form"
              variant="primary"
              disabled={flag.isPending}
            >
              Mark out of range
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FlagReason({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <form
      id="flag-reason-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (reason.trim()) onSubmit(reason.trim())
      }}
    >
      <Field label="Reason" required>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}
