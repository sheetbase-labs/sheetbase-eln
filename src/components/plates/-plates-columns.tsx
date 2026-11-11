/**
 * The Plates page's table columns: one set for the runs, one for the worklists.
 * Each is built once per page; the values they read are formatted by the
 * shared plate helpers.
 */
import { useMemo } from 'react'
import { z } from 'zod'

import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Status } from '#/components/ui/status'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { plateRunReference, worklistReference } from '#/lib/plate-runs'
import type { PlateRunRow, PlateWorklistRow } from '#/lib/plate-runs'

import { qcTone, qualityLabel } from './plates-shared'

/** The sections the Plates page offers. */
export const platesTabSchema = z.enum([
  'runs',
  'potency',
  'quality',
  'worklists',
])

export type PlatesTab = z.infer<typeof platesTabSchema>

export function usePlateRunColumns(): RegistryColumn<PlateRunRow>[] {
  return useMemo<RegistryColumn<PlateRunRow>[]>(
    () => [
      {
        id: 'number',
        header: t('plates.columns.number'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {plateRunReference(row.original.number)}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('plates.columns.name'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'format',
        header: t('plates.columns.format'),
        size: 110,
        cell: ({ row }) => (
          <span>{t(`plates.formats.${row.original.format}`)}</span>
        ),
      },
      {
        id: 'zprime',
        header: t('plates.columns.zPrime'),
        size: 90,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {row.original.results?.qc.zPrime?.toFixed(2) ?? ''}
          </span>
        ),
      },
      {
        id: 'hits',
        header: t('plates.columns.hits'),
        size: 130,
        cell: ({ row }) => {
          const s = row.original.results?.summary

          return (
            <span className="num text-fg-muted">
              {s
                ? t('plates.hitsOf', {
                    hits: s.hitSamples,
                    tested: s.testedSamples,
                  })
                : ''}
            </span>
          )
        },
      },
      {
        id: 'quality',
        header: t('plates.columns.quality'),
        size: 140,
        cell: ({ row }) => (
          <Status
            tone={qcTone(
              row.original.status === 'draft' ? null : row.original.qc_status,
            )}
          >
            {qualityLabel(row.original)}
          </Status>
        ),
      },
      {
        id: 'analysed',
        header: t('plates.columns.analysed'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.analysed_at
              ? formatDate(row.original.analysed_at)
              : ''}
          </span>
        ),
      },
    ],
    [],
  )
}

export function usePlateWorklistColumns(): RegistryColumn<PlateWorklistRow>[] {
  return useMemo<RegistryColumn<PlateWorklistRow>[]>(
    () => [
      {
        id: 'number',
        header: t('plates.worklists.columns.number'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {worklistReference(row.original.number)}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('plates.worklists.columns.name'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'format',
        header: t('plates.worklists.columns.format'),
        size: 200,
        cell: ({ row }) => (
          <span>{t(`plates.worklist.formats.${row.original.format}`)}</span>
        ),
      },
      {
        id: 'transfers',
        header: t('plates.worklists.columns.transfers'),
        size: 110,
        cell: ({ row }) => (
          <span className="num">{row.original.transfers.length}</span>
        ),
      },
      {
        id: 'status',
        header: t('plates.worklists.columns.status'),
        size: 120,
        cell: ({ row }) => (
          <Status
            tone={
              row.original.status === 'complete'
                ? 'ok'
                : row.original.status === 'cancelled'
                  ? 'draft'
                  : 'progress'
            }
          >
            {t(`plates.worklists.statuses.${row.original.status}`)}
          </Status>
        ),
      },
      {
        id: 'created',
        header: t('plates.worklists.columns.created'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
    ],
    [],
  )
}
