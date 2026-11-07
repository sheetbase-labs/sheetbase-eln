/**
 * The instrument files that were converted to the Allotrope Simple Model, kept
 * with their runs, each downloadable as the vendor-neutral document.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Section } from '#/components/ui/layout'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'
import { createDataClient } from '#/lib/data-client'
import { asmFileName, deviceLabel } from '#/lib/instrument-data/asm'

const client = createDataClient()

interface DocumentWire {
  id: string
  run_id: string
  technique: string | null
  converter: string
  converter_version: string | null
  measurements: number
  device: Record<string, unknown>
  created_at: string
  instrument_runs: { name: string; run_identifier: string } | null
}

export function ConvertedDataSection({
  instrumentId,
}: {
  instrumentId: string
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const documents = useQuery({
    queryKey: ['instrument-documents', instrumentId],
    queryFn: () =>
      client.list<DocumentWire>(
        'instrument_run_documents',
        `?select=id,run_id,technique,converter,converter_version,measurements,device,created_at,instrument_runs(name,run_identifier)&instrument_id=eq.${encodeURIComponent(instrumentId)}&order=created_at.desc&limit=100`,
      ),
    staleTime: 10_000,
  })
  const rows = documents.data ?? []

  async function download(row: DocumentWire) {
    setBusy(row.id)
    try {
      const found = (
        await client.list<{ document: unknown }>(
          'instrument_run_documents',
          `?select=document&id=eq.${encodeURIComponent(row.id)}&limit=1`,
        )
      ).at(0)
      if (!found) throw new Error('missing')
      const blob = new Blob([JSON.stringify(found.document, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = asmFileName(
        row.instrument_runs?.name ?? 'instrument-data',
      )
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('quality.instrumentData.couldNotDownload'))
    } finally {
      setBusy(null)
    }
  }

  const columns = useMemo<RegistryColumn<DocumentWire>[]>(
    () => [
      {
        id: 'run',
        header: t('quality.instrumentData.columns.run'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.instrument_runs?.name ?? '—'}
          </span>
        ),
      },
      {
        id: 'device',
        header: t('quality.instrumentData.columns.device'),
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {deviceLabel(row.original.device) || '—'}
          </span>
        ),
      },
      {
        id: 'technique',
        header: t('quality.instrumentData.columns.technique'),
        size: 150,
        cell: ({ row }) => (
          <span className="text-fg-muted">{row.original.technique ?? '—'}</span>
        ),
      },
      {
        id: 'measurements',
        header: t('quality.instrumentData.columns.measurements'),
        size: 120,
        cell: ({ row }) => (
          <span className="num">{row.original.measurements}</span>
        ),
      },
      {
        id: 'converter',
        header: t('quality.instrumentData.columns.converter'),
        size: 170,
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {row.original.converter_version
              ? t('quality.instrumentData.converterVersion', {
                  converter: row.original.converter,
                  version: row.original.converter_version,
                })
              : row.original.converter}
          </span>
        ),
      },
      {
        id: 'converted',
        header: t('quality.instrumentData.columns.converted'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'download',
        header: '',
        size: 150,
        cell: ({ row }) => (
          <Button
            variant="quiet"
            size="sm"
            disabled={busy === row.original.id}
            onClick={(event) => {
              event.stopPropagation()
              void download(row.original)
            }}
          >
            {busy === row.original.id
              ? t('quality.instrumentData.downloading')
              : t('quality.instrumentData.download')}
          </Button>
        ),
      },
    ],
    [busy],
  )

  // Nothing converted and nothing wrong: stay out of the way of the page.
  if (documents.isSuccess && rows.length === 0) return null
  return (
    <Section
      className="border-t border-border pt-4"
      title={t('quality.instrumentData.title')}
      count={rows.length > 0 ? rows.length : undefined}
    >
      {documents.isError ? (
        <Notice tone="bad">
          {t('quality.instrumentData.couldNotDownload')}
        </Notice>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('quality.instrumentData.tableLabel')}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            isLoading={documents.isPending}
          />
        </TableBox>
      )}
    </Section>
  )
}
