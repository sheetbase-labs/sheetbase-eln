import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
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
  buildSheetState,
  OfficeSheetError,
  readOfficeSheets,
  SHEET_MAX_COLUMNS,
  SHEET_MAX_ROWS,
} from '#/lib/office-sheet'
import type { MadeSheet } from '#/lib/office-sheet'
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
  const columns = useMemo(() => {
    if (!made) return []
    const byId = new Map(made.state.localFields.map((f) => [f.fieldId, f]))
    return made.state.presentation.columnOrder.flatMap((id) => {
      const field = byId.get(id)
      return field ? [field] : []
    })
  }, [made])
  const previewRows = useMemo(
    () =>
      made ? Object.values(made.state.localValues).slice(0, PREVIEW_ROWS) : [],
    [made],
  )
  const loadError = workbook.error ? workbook.error.message : null

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
            {workbook.isLoading ? (
              <p className="text-label text-fg-muted">
                {t('notebook.makeSheet.loading')}
              </p>
            ) : loadError ? (
              <Notice tone="bad">
                {t('notebook.makeSheet.loadFailed', { message: loadError })}
              </Notice>
            ) : workbook.data && workbook.data.length === 0 ? (
              <Notice>{t('notebook.makeSheet.empty')}</Notice>
            ) : workbook.data ? (
              <>
                {workbook.data.length > 1 ? (
                  <Field label={t('notebook.makeSheet.worksheet')}>
                    <Select
                      value={String(picked)}
                      onChange={(event) =>
                        setPicked(Number(event.target.value))
                      }
                    >
                      {workbook.data.map((item, index) => (
                        <option key={item.name} value={index}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                {built?.error ? (
                  <Notice tone="warn">{built.error}</Notice>
                ) : null}
                {made ? (
                  <>
                    <p className="text-label text-fg-muted">
                      {t('notebook.makeSheet.summary', {
                        rows: made.rowCount,
                        columns: made.columnCount,
                      })}
                    </p>
                    <TableBox>
                      <Table aria-label={t('notebook.makeSheet.preview')}>
                        <TableHeader>
                          <TableRow>
                            {columns.map((field) => (
                              <TableHead key={field.fieldId}>
                                {field.label}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewRows.map((row, index) => (
                            <TableRow key={index}>
                              {columns.map((field) => (
                                <TableCell key={field.fieldId}>
                                  {formatCell(row[field.fieldId])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableBox>
                    {made.formulaColumns.length > 0 ? (
                      <Notice>
                        {t('notebook.makeSheet.formulas', {
                          columns: made.formulaColumns
                            .map((c) => `${c.label} (${c.example})`)
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
                ) : null}
              </>
            ) : null}
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

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}
