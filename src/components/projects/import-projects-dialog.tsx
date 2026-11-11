import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { FileDrop } from '#/components/ui/file-drop'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid, gridHeight } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { t } from '#/copy'

import { createProject } from './project-data'
import { parseProjectImport } from './project-import'
import type { ProjectImportRow } from './project-import'

/**
 * Adds projects from a CSV file. Each line is made with the same call the New
 * project form makes, so an import is exactly as if the lines had been created
 * one by one (the same events, the same permissions). Lines that cannot be
 * matched are listed with the reason and skipped.
 */
export function ImportProjectsDialog({
  open,
  onOpenChange,
  clientOptions,
  memberOptions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientOptions: { id: string; label: string }[]
  memberOptions: { id: string; label: string }[]
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')

  const parsed = text
    ? parseProjectImport(text, clientOptions, memberOptions)
    : null

  const importable = parsed?.rows.filter((r) => r.input) ?? []
  const refused = (parsed?.rows.length ?? 0) - importable.length

  const run = useMutation({
    mutationFn: async () => {
      const failures: string[] = []
      let made = 0

      for (const row of importable) {
        if (!row.input) continue

        try {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- One at a time on purpose: lines are made in file order, so project numbers follow the file and a failure stops nothing else.
          await createProject(row.input)
          made += 1
        } catch (cause) {
          failures.push(
            t('projects.projectImport.failed', {
              title: row.title,
              reason: cause instanceof Error ? cause.message : '',
            }),
          )
        }
      }

      return { made, failures }
    },
    onSuccess: ({ made, failures }) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })

      if (made) toast(t('projects.projectImport.done', { count: made }))

      for (const failure of failures) toast.error(failure)

      if (!failures.length) {
        setText('')
        onOpenChange(false)
      }
    },
  })

  const columns: RegistryColumn<ProjectImportRow>[] = [
    {
      id: 'line',
      header: t('projects.projectImport.columns.line'),
      size: 72,
      accessorFn: (row) => row.line,
      meta: { cellClassName: 'num text-fg-muted' },
    },
    {
      id: 'name',
      header: t('projects.projectImport.columns.name'),
      accessorFn: (row) => row.title,
    },
    {
      id: 'client',
      header: t('projects.projectImport.columns.client'),
      accessorFn: (row) => row.input?.clientId ?? '',
      cell: ({ row }) => (row.original.input?.clientId ? '✓' : '—'),
    },
    {
      id: 'check',
      header: t('projects.projectImport.columns.check'),
      accessorFn: (row) => row.problem ?? t('projects.projectImport.ok'),
      cell: ({ row }) => (
        <span className={row.original.problem ? 'text-danger-text' : ''}>
          {row.original.problem ?? t('projects.projectImport.ok')}
        </span>
      ),
    },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)

        if (!next) setText('')
      }}
    >
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.projectImport.title')} />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body text-fg-muted">
              {t('projects.projectImport.intro')}
            </p>
            <FileDrop
              label={t('projects.projectImport.file')}
              inputLabel={t('projects.projectImport.fileLabel')}
              accept=".csv,text/csv"
              onFile={async (file) => setText(file ? await file.text() : '')}
            />
            {parsed?.missingName ? (
              <p role="alert" className="m-0 text-body text-danger-text">
                {t('projects.projectImport.missingName')}
              </p>
            ) : null}
            {parsed && !parsed.missingName ? (
              <>
                <span className="text-label text-fg-muted">
                  {t('projects.projectImport.ready', {
                    count: importable.length,
                  })}
                  {refused
                    ? ` · ${t('projects.projectImport.skipped', { count: refused })}`
                    : ''}
                </span>
                <TableBox
                  className="shrink-0"
                  style={{ height: gridHeight(parsed.rows.length, 260) }}
                >
                  <RegistryGrid
                    label={t('projects.projectImport.title')}
                    rows={parsed.rows}
                    columns={columns}
                    getRowId={(row) => String(row.line)}
                    selectable={false}
                  />
                </TableBox>
              </>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('projects.projectImport.close')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!importable.length || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending
              ? t('projects.projectImport.importing')
              : t('projects.projectImport.action', {
                  count: importable.length,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
