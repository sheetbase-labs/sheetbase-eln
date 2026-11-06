/**
 * The SAR table: every compound of a registry beside the measurements the lab
 * keeps for it. Shade a measurement to see the trend, compare against a
 * reference compound, or keep only the compounds that share a core.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useRecordModelFields } from '#/components/models/models-data'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import {
  fetchRegistryEntries,
  messageOf,
  registryKeys,
} from '#/lib/bio-registry'
import type { RegistryEntry, RegistryModel } from '#/lib/bio-registry'
import {
  compoundKeys,
  containsSubstructure,
  fetchStructureRows,
  fingerprintOf,
  parentSvg,
  propertiesOf,
  queryFragment,
  similarityOf,
} from '#/lib/compound-registry'
import type { DrugLikeness, StructureRow } from '#/lib/compound-registry'
import { notebookDataClient } from '#/lib/notebook-data'

import {
  MolfilePicture,
  StructureDialog,
  StructurePicture,
} from './structure-input'
import { useOcl } from './use-ocl'

const client = notebookDataClient

interface SarRow {
  entry: RegistryEntry
  structure: StructureRow
  properties: DrugLikeness | null
  similarity: number | null
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** How far along the range a value sits, 0 to 1. */
function position(value: number | null, low: number, high: number): number {
  if (value === null || high === low) return 0
  return (value - low) / (high - low)
}

export function RegistrySar({ registries }: { registries: RegistryModel[] }) {
  const ocl = useOcl()
  const [kind, setKind] = useState(registries[0]?.key ?? '')
  const [measure, setMeasure] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [scaffold, setScaffold] = useState('')
  const [drawing, setDrawing] = useState(false)

  const fields = useRecordModelFields(kind)
  const numeric = useMemo(
    () =>
      (fields.data ?? []).filter(
        (f) =>
          f.lifecycle === 'active' &&
          (f.logicalType === 'decimal' || f.logicalType === 'integer'),
      ),
    [fields.data],
  )

  const entries = useQuery({
    queryKey: registryKeys.entries([kind]),
    queryFn: () => fetchRegistryEntries(client, [kind]),
    enabled: kind !== '',
    staleTime: 10_000,
  })
  const structures = useQuery({
    queryKey: compoundKeys.structures(kind),
    queryFn: () => fetchStructureRows(client, kind),
    enabled: kind !== '',
    staleTime: 10_000,
  })

  const joined = useMemo<SarRow[]>(() => {
    if (!ocl) return []
    const byId = new Map((entries.data ?? []).map((e) => [e.id, e] as const))
    return (structures.data ?? []).flatMap((s) => {
      const entry = byId.get(s.record_id)
      if (!entry || entry.archived_at) return []
      return [
        {
          entry,
          structure: s,
          properties: propertiesOf(ocl, s.parent_code),
          similarity: null,
        },
      ]
    })
  }, [ocl, entries.data, structures.data])

  const rows = useMemo<SarRow[]>(() => {
    if (!ocl) return []
    let list = joined
    const fragment = scaffold ? queryFragment(ocl, scaffold) : null
    if (fragment) {
      list = list.filter((r) =>
        containsSubstructure(ocl, fragment, r.structure.parent_code),
      )
    }
    const reference = joined.find((r) => r.entry.id === referenceId)
    if (reference) {
      const refPrint = fingerprintOf(
        ocl,
        ocl.Molecule.fromIDCode(reference.structure.parent_code),
      )
      list = list.map((r) => ({
        ...r,
        similarity: similarityOf(
          ocl,
          refPrint,
          fingerprintOf(ocl, ocl.Molecule.fromIDCode(r.structure.parent_code)),
        ),
      }))
    }
    return list
  }, [ocl, joined, scaffold, referenceId])

  const range = useMemo(() => {
    if (!measure) return null
    const values = rows
      .map((r) => numberOf(r.entry.custom_fields?.[measure]))
      .filter((v): v is number => v !== null)
    if (values.length === 0) return null
    return { low: Math.min(...values), high: Math.max(...values) }
  }, [rows, measure])

  const columns = useMemo<RegistryColumn<SarRow>[]>(() => {
    const base: RegistryColumn<SarRow>[] = [
      {
        id: 'structure',
        header: t('registry.chemistry.sar.columns.structure'),
        size: 180,
        enableSorting: false,
        cell: ({ row }) => (
          <StructurePicture
            svg={
              ocl
                ? parentSvg(ocl, row.original.structure.parent_code, 64)
                : null
            }
            label={row.original.entry.identifier}
            height={64}
          />
        ),
      },
      {
        id: 'number',
        header: t('registry.chemistry.sar.columns.number'),
        accessorFn: (r) => r.entry.identifier,
        size: 100,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {row.original.entry.identifier}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('registry.chemistry.sar.columns.name'),
        accessorFn: (r) => r.entry.title,
        size: 200,
        cell: ({ row }) => (
          <Link
            to="/models/$modelId/records/$recordId"
            params={{
              modelId: row.original.entry.kind,
              recordId: row.original.entry.id,
            }}
            className="truncate font-medium text-fg hover:underline"
          >
            {row.original.entry.title}
          </Link>
        ),
      },
    ]
    const measures: RegistryColumn<SarRow>[] = numeric.map((field) => ({
      id: `field:${field.fieldName}`,
      header: field.label,
      accessorFn: (r) => numberOf(r.entry.custom_fields?.[field.fieldName]),
      size: 120,
      meta: { headerClassName: 'text-right' },
      cell: ({ row }) => {
        const value = numberOf(
          row.original.entry.custom_fields?.[field.fieldName],
        )
        const shaded = field.fieldName === measure && range && value !== null
        return (
          <div
            className="num -mx-2.5 flex h-full items-center justify-end px-2.5"
            style={
              shaded
                ? {
                    backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(
                      position(value, range.low, range.high) * 55 + 6,
                    )}%, transparent)`,
                  }
                : undefined
            }
          >
            {value === null ? '' : String(value)}
          </div>
        )
      },
    }))
    const properties: RegistryColumn<SarRow>[] = [
      {
        id: 'mass',
        header: t('registry.chemistry.sar.columns.mass'),
        accessorFn: (r) => Number(r.structure.mass ?? 0),
        size: 90,
        meta: { headerClassName: 'text-right' },
        cell: ({ row }) => (
          <div className="num text-right">
            {Number(row.original.structure.mass ?? 0).toFixed(1)}
          </div>
        ),
      },
      {
        id: 'logP',
        header: t('registry.chemistry.sar.columns.logP'),
        accessorFn: (r) => r.properties?.logP ?? null,
        size: 80,
        meta: { headerClassName: 'text-right' },
        cell: ({ row }) => (
          <div className="num text-right">
            {row.original.properties?.logP ?? ''}
          </div>
        ),
      },
      {
        id: 'hbd',
        header: t('registry.chemistry.sar.columns.hbd'),
        accessorFn: (r) => r.properties?.hbd ?? null,
        size: 120,
        meta: { headerClassName: 'text-right' },
        cell: ({ row }) => (
          <div className="num text-right">
            {row.original.properties?.hbd ?? ''}
          </div>
        ),
      },
      {
        id: 'hba',
        header: t('registry.chemistry.sar.columns.hba'),
        accessorFn: (r) => r.properties?.hba ?? null,
        size: 130,
        meta: { headerClassName: 'text-right' },
        cell: ({ row }) => (
          <div className="num text-right">
            {row.original.properties?.hba ?? ''}
          </div>
        ),
      },
      {
        id: 'tpsa',
        header: t('registry.chemistry.sar.columns.tpsa'),
        accessorFn: (r) => r.properties?.tpsa ?? null,
        size: 110,
        meta: { headerClassName: 'text-right' },
        cell: ({ row }) => (
          <div className="num text-right">
            {row.original.properties?.tpsa ?? ''}
          </div>
        ),
      },
    ]
    const like: RegistryColumn<SarRow>[] = referenceId
      ? [
          {
            id: 'similarity',
            header: t('registry.chemistry.sar.columns.similarity'),
            accessorFn: (r) => r.similarity,
            size: 130,
            meta: { headerClassName: 'text-right' },
            cell: ({ row }) => (
              <div className="num text-right">
                {row.original.similarity === null
                  ? ''
                  : `${Math.round(row.original.similarity * 100)}%`}
              </div>
            ),
          },
        ]
      : []
    return [...base, ...measures, ...like, ...properties]
  }, [ocl, numeric, measure, range, referenceId])

  const loading = entries.isPending || structures.isPending || !ocl
  const error = entries.error ?? structures.error

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-4 border-b border-border px-6 py-3">
        {registries.length > 1 ? (
          <label className="flex flex-col gap-1 text-label text-fg-muted">
            {t('registry.chemistry.sar.registry')}
            <Select
              size="sm"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                setMeasure('')
                setReferenceId('')
                setScaffold('')
              }}
            >
              {registries.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-label text-fg-muted">
          {t('registry.chemistry.sar.measure')}
          <Select
            size="sm"
            value={measure}
            onChange={(e) => setMeasure(e.target.value)}
          >
            <option value="">{t('registry.chemistry.sar.noMeasure')}</option>
            {numeric.map((f) => (
              <option key={f.fieldName} value={f.fieldName}>
                {f.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-label text-fg-muted">
          {t('registry.chemistry.sar.reference')}
          <Select
            size="sm"
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
          >
            <option value="">{t('registry.chemistry.sar.noReference')}</option>
            {joined.map((r) => (
              <option key={r.entry.id} value={r.entry.id}>
                {r.entry.identifier} {r.entry.title}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-col gap-1 text-label text-fg-muted">
          {t('registry.chemistry.sar.scaffold')}
          <span className="flex items-center gap-2">
            {scaffold ? (
              <MolfilePicture
                molfile={scaffold}
                label={t('registry.chemistry.sar.scaffold')}
                height={48}
              />
            ) : null}
            <Button size="sm" disabled={!ocl} onClick={() => setDrawing(true)}>
              {scaffold
                ? t('registry.chemistry.sar.changeScaffold')
                : t('registry.chemistry.sar.drawScaffold')}
            </Button>
            {scaffold ? (
              <Button size="sm" variant="quiet" onClick={() => setScaffold('')}>
                {t('registry.chemistry.sar.clearScaffold')}
              </Button>
            ) : null}
          </span>
        </div>
        {range ? (
          <span className="text-label text-fg-muted">
            {t('registry.chemistry.sar.low')} {range.low} ·{' '}
            {t('registry.chemistry.sar.high')} {range.high}
          </span>
        ) : null}
        <span className="flex-1" />
        {!loading ? (
          <span className="text-label text-fg-muted">
            {t('registry.chemistry.sar.count', { count: rows.length })}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {error ? (
          <div className="p-6">
            <Notice tone="bad" title={t('registry.chemistry.sar.error')}>
              {messageOf(error, '')}
            </Notice>
          </div>
        ) : loading || rows.length > 0 ? (
          <RegistryGrid
            label={t('registry.chemistry.sar.title')}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.entry.id}
            rowLabel={(r) => r.entry.identifier}
            selectable={false}
            rowHeight={80}
            isLoading={loading}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="table"
              title={
                joined.length === 0
                  ? t('registry.chemistry.sar.empty')
                  : t('registry.chemistry.sar.filtered')
              }
            />
          </div>
        )}
      </div>
      <StructureDialog
        open={drawing}
        onOpenChange={setDrawing}
        initial={scaffold}
        mode="query"
        onUse={(molfile) => setScaffold(molfile)}
      />
    </div>
  )
}
