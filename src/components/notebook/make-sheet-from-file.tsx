import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  buildSheetState,
  OfficeSheetError,
  readOfficeSheets,
  SHEET_MAX_COLUMNS,
  SHEET_MAX_ROWS,
} from '#/lib/office-sheet'
import type { MadeSheet, OfficeSheet } from '#/lib/office-sheet'
import { sheetDescription } from '#/lib/office-sheet-create'

/** What the page needs to put the sheet in the notebook. */
export interface MakeSheetRequest {
  name: string
  description: string
  made: MadeSheet
}

const PREVIEW_ROWS = 5

async function fetchWorkbook(
  fileRecordId: string,
  fileVersion: number | null,
  mediaType: string,
) {
  const query = fileVersion === null ? '' : `?version=${fileVersion}`

  const response = await fetch(`/api/files/${fileRecordId}/download${query}`, {
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new OfficeSheetError(
      `The file could not be downloaded (${response.status}).`,
    )
  }

  return readOfficeSheets(
    new Uint8Array(await response.arrayBuffer()),
    mediaType,
  )
}

/**
 * "Make a sheet" on an Excel or LibreOffice file block: pick a worksheet, see
 * what it will become, and put it in the notebook as a sheet next to the file.
 */
export function MakeSheetFromFile({
  fileRecordId,
  fileVersion,
  fileName,
  mediaType,
  onMake,
}: {
  fileRecordId: string
  fileVersion: number | null
  fileName: string
  mediaType: string
  onMake: (request: MakeSheetRequest) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState(0)

  const workbook = useQuery({
    queryKey: ['office-workbook', fileRecordId, fileVersion],
    queryFn: () => fetchWorkbook(fileRecordId, fileVersion, mediaType),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  })

  const sheet = workbook.data?.[picked] ?? null

  const built = useMemo(() => {
    if (!sheet) return null

    try {
      return { made: buildSheetState(sheet), error: null }
    } catch (cause) {
      return {
        made: null,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }, [sheet])

  // The route's handleMakeSheet refreshes embed pickers and this project's active sheets
  // immediately after creation, even when its subsequent block insertion refuses.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const make = useMutation({
    mutationFn: async () => {
      if (!sheet || !built?.made) return
      await onMake({
        name: sheet.name,
        description: sheetDescription({
          fileName,
          fileVersion,
          worksheet: sheet.name,
          made: built.made,
          note: (file, version, name) =>
            t('notebook.makeSheet.description_note', {
              file,
              version: version || '1',
              sheet: name,
            }),
          formulasNote: (columns) =>
            t('notebook.makeSheet.description_formulas', { columns }),
        }),
        made: built.made,
      })
    },
    onSuccess: () => setOpen(false),
  })

  const made = built?.made ?? null

  return (
    <>
      <Button size="sm" icon="table" onClick={() => setOpen(true)}>
        {t('notebook.makeSheet.action')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)

          if (!next) make.reset()
        }}
      >
        <DialogContent className="w-[min(720px,calc(100vw-32px))]">
          <DialogHeader
            title={t('notebook.makeSheet.title')}
            description={t('notebook.makeSheet.description')}
          />
          <DialogBody>
            <WorkbookPreview
              workbook={workbook}
              picked={picked}
              onPick={setPicked}
              made={made}
              buildError={built?.error ?? null}
            />
            {make.error ? (
              <Notice tone="bad">
                {t('notebook.makeSheet.failed', {
                  message:
                    make.error instanceof Error
                      ? make.error.message
                      : String(make.error),
                })}
              </Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              disabled={!made || make.isPending}
              onClick={() => make.mutate()}
            >
              {make.isPending
                ? t('notebook.makeSheet.making')
                : t('notebook.makeSheet.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Loading/refusal and the worksheet selection, without owning the open draft. */
function WorkbookPreview({
  workbook,
  picked,
  onPick,
  made,
  buildError,
}: {
  workbook: UseQueryResult<OfficeSheet[]>
  picked: number
  onPick: (index: number) => void
  made: MadeSheet | null
  buildError: string | null
}) {
  if (workbook.isLoading)
    return (
      <p className="text-label text-fg-muted">
        {t('notebook.makeSheet.loading')}
      </p>
    )

  if (workbook.error)
    return (
      <Notice tone="bad">
        {t('notebook.makeSheet.loadFailed', {
          message: workbook.error.message,
        })}
      </Notice>
    )

  if (!workbook.data) return null

  if (workbook.data.length === 0)
    return <Notice>{t('notebook.makeSheet.empty')}</Notice>

  return (
    <>
      {workbook.data.length > 1 ? (
        <Field label={t('notebook.makeSheet.worksheet')}>
          <Select
            value={String(picked)}
            onChange={(event) => onPick(Number(event.target.value))}
          >
            {workbook.data.map((item, index) => (
              <option key={item.name} value={index}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {buildError ? <Notice tone="warn">{buildError}</Notice> : null}
      {made ? <MadeSheetPreview made={made} /> : null}
    </>
  )
}

function MadeSheetPreview({ made }: { made: MadeSheet }) {
  const byId = new Map(
    made.state.localFields.map((field) => [field.fieldId, field]),
  )

  const columns = made.state.presentation.columnOrder.flatMap((id) => {
    const field = byId.get(id)

    return field ? [field] : []
  })

  const previewRows = Object.entries(made.state.localValues).slice(
    0,
    PREVIEW_ROWS,
  )

  const gridColumns: RegistryColumn<(typeof previewRows)[number]>[] =
    columns.map((field) => ({
      id: field.fieldId,
      header: field.label,
      accessorFn: ([, row]) =>
        formatCell(previewCell.parse(row[field.fieldId])),
    }))

  return (
    <>
      <p className="text-label text-fg-muted">
        {t('notebook.makeSheet.summary', {
          rows: made.rowCount,
          columns: made.columnCount,
        })}
      </p>
      <TableBox>
        <RegistryGrid
          label={t('notebook.makeSheet.preview')}
          rows={previewRows}
          columns={gridColumns}
          getRowId={([rowId]) => rowId}
          selectable={false}
        />
      </TableBox>
      {made.formulaColumns.length > 0 ? (
        <Notice>
          {t('notebook.makeSheet.formulas', {
            columns: made.formulaColumns
              .map((column) => `${column.label} (${column.example})`)
              .join(', '),
          })}
        </Notice>
      ) : null}
      {made.skippedRows > 0 || made.skippedColumns > 0 ? (
        <Notice tone="warn">
          {t('notebook.makeSheet.cut', {
            rows: SHEET_MAX_ROWS.toLocaleString(),
            columns: SHEET_MAX_COLUMNS,
          })}
        </Notice>
      ) : null}
    </>
  )
}

const previewCell = z.union([z.string(), z.number(), z.boolean()]).nullish()

function formatCell(value: z.output<typeof previewCell>): string {
  if (value === null || value === undefined) return ''

  if (value === true) return 'TRUE'

  if (value === false) return 'FALSE'

  return String(value)
}
