import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Notice } from '#/components/v3/ui/alert'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchGenerationHtml,
  fetchGenerations,
  fingerprint,
  reportKeys,
} from '#/lib/reports'
import type { ReportGeneration } from '#/lib/reports'
import { useUserNames } from '#/lib/user-names'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`
}

/** Every document generated from the report, newest first, each openable. */
export function GeneratedReports({
  definitionId,
  identifier,
}: {
  definitionId: string
  identifier: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useQuery({
    queryKey: reportKeys.generations(definitionId),
    queryFn: () => fetchGenerations(notebookDataClient, definitionId),
  })
  const rows = list.data ?? []
  const names = useUserNames(rows.map((r) => r.actorUserId))
  const html = useQuery({
    queryKey: ['ui-port', 'reports', 'generation-html', openId],
    enabled: openId !== null,
    queryFn: () => fetchGenerationHtml(notebookDataClient, openId ?? ''),
  })

  const download = async (row: ReportGeneration) => {
    try {
      const body = await fetchGenerationHtml(notebookDataClient, row.id)
      const url = URL.createObjectURL(new Blob([body], { type: 'text/html' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${identifier}-v${row.reportVersion}.html`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('projects.reports.generated.viewerFailed'))
    }
  }

  const columns: RegistryColumn<ReportGeneration>[] = [
    {
      id: 'when',
      header: t('projects.reports.generated.when'),
      cell: ({ row }) => formatDate(row.original.generatedAt),
    },
    {
      id: 'by',
      header: t('projects.reports.generated.by'),
      cell: ({ row }) => names.userLabel(row.original.actorUserId),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'version',
      header: t('projects.reports.generated.version'),
      cell: ({ row }) => row.original.reportVersion,
      meta: {
        ...rightAligned<ReportGeneration>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'fingerprint',
      header: t('projects.reports.generated.fingerprint'),
      cell: ({ row }) => (
        <span className="mono">{fingerprint(row.original.checksum)}</span>
      ),
    },
    {
      id: 'size',
      header: t('projects.reports.generated.size'),
      cell: ({ row }) => formatSize(row.original.sizeBytes),
      meta: {
        ...rightAligned<ReportGeneration>().meta,
        cellClassName: 'num text-right text-fg-muted',
      },
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" onClick={() => setOpenId(row.original.id)}>
            {t('projects.reports.generated.open')}
          </Button>
          <Button
            size="sm"
            icon="download"
            onClick={() => void download(row.original)}
          >
            {t('projects.reports.generated.download')}
          </Button>
        </span>
      ),
    },
  ]

  if (!list.isPending && rows.length === 0 && !list.isError) {
    return (
      <EmptyState
        icon="report"
        className="items-center py-14 text-center"
        title={t('projects.reports.generated.empty')}
        description={t('projects.reports.generated.emptyBody')}
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {list.isError ? (
        <Notice tone="bad" title={t('projects.reports.builder.loadFailed')} />
      ) : null}
      <TableBox>
        <RegistryGrid
          label={t('projects.reports.generated.label')}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          selectable={false}
          isLoading={list.isPending}
        />
      </TableBox>
      <Dialog
        open={openId !== null}
        onOpenChange={(next) => (next ? null : setOpenId(null))}
      >
        <DialogContent className="h-[min(760px,calc(100vh-48px))] w-[min(900px,calc(100vw-32px))]">
          <DialogHeader title={t('projects.reports.generated.viewerTitle')} />
          <DialogBody className="min-h-0 flex-1">
            {html.isError ? (
              <Notice
                tone="bad"
                title={t('projects.reports.generated.viewerFailed')}
              />
            ) : (
              // The stored document is shown without any script or access to the app.
              <iframe
                title={t('projects.reports.generated.viewerTitle')}
                sandbox=""
                srcDoc={html.data ?? ''}
                className="h-full min-h-[480px] w-full rounded-md border border-border bg-white"
              />
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('projects.reports.generated.close')}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
