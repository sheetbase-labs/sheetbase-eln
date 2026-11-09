/**
 * Potency across plates: pick analysed plates and see one potency for each
 * sample, with how much the plates disagree.
 */
import { useMemo, useState } from 'react'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Checkbox } from '#/components/ui/checkbox'
import { EmptyState } from '#/components/ui/empty-state'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { t } from '#/copy'
import { relativePotency, summarisePotency } from '#/lib/plate-assay'
import type { PotencySummary } from '#/lib/plate-assay'
import { plateRunReference } from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

import { fmt, qcTone } from './plates-shared'

function unitLabel(s: PotencySummary): string {
  return s.molar ? t('plates.potency.molarUnit') : (s.unit ?? '')
}

export function PotencyPanel({ runs }: { runs: PlateRunRow[] }) {
  const analysed = useMemo(
    () => runs.filter((r) => r.results && r.results.curves.length > 0),
    [runs],
  )

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [includeFailed, setIncludeFailed] = useState(false)
  const [onlyReliable, setOnlyReliable] = useState(false)
  const [reference, setReference] = useState('')

  const summaries = useMemo(
    () =>
      summarisePotency(
        analysed
          .filter((r) => picked.has(r.id))
          .map((r) => ({
            runId: r.id,
            runName: `${plateRunReference(r.number)} ${r.name}`,
            qcStatus: r.qc_status ?? 'not_checked',
            curves: r.results?.curves ?? [],
          })),
        { includeFailed, excludeUnreliable: onlyReliable },
      ),
    [analysed, picked, includeFailed, onlyReliable],
  )

  const relative = useMemo(() => {
    if (!reference) return new Map<string, number>()
    const list = relativePotency(summaries, reference) ?? []

    return new Map(list.map((r) => [r.key, r.ratio]))
  }, [summaries, reference])

  const columns = useMemo<RegistryColumn<PotencySummary>[]>(
    () => [
      {
        id: 'sample',
        header: t('plates.potency.sample'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.label}
          </span>
        ),
      },
      {
        id: 'plates',
        header: t('plates.potency.plates'),
        size: 80,
        cell: ({ row }) => <span className="num">{row.original.n}</span>,
      },
      {
        id: 'geo',
        header: t('plates.potency.geoMean'),
        size: 170,
        cell: ({ row }) => (
          <span className="num">
            {fmt(row.original.geoMean)} {unitLabel(row.original)}
          </span>
        ),
      },
      {
        id: 'pec50',
        header: t('plates.potency.pec50'),
        size: 90,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {fmt(row.original.pEc50, 3)}
          </span>
        ),
      },
      {
        id: 'interval',
        header: t('plates.potency.interval'),
        size: 190,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {row.original.geoMeanCi95
              ? `${fmt(row.original.geoMeanCi95.lo)} – ${fmt(row.original.geoMeanCi95.hi)}`
              : ''}
          </span>
        ),
      },
      {
        id: 'fold',
        header: t('plates.potency.fold'),
        size: 100,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {row.original.foldRange ? `${fmt(row.original.foldRange, 3)}×` : ''}
          </span>
        ),
      },
      {
        id: 'relative',
        header: t('plates.potency.relative'),
        size: 120,
        cell: ({ row }) => {
          const v = relative.get(row.original.key)

          return <span className="num">{v ? `${fmt(v, 3)}×` : ''}</span>
        },
      },
    ],
    [relative],
  )

  if (analysed.length === 0) {
    return (
      <div role="status" className="flex justify-center px-6">
        <EmptyState
          className="items-center py-14 text-center"
          icon="chart"
          title={t('plates.empty.potency')}
          description={t('plates.empty.potencyBody')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4 max-md:px-4">
      <section
        aria-label={t('plates.potency.pick')}
        className="flex flex-col gap-2"
      >
        <h2 className="font-heading text-[15px] font-semibold">
          {t('plates.potency.pick')}
        </h2>
        <p className="text-label text-fg-muted">
          {t('plates.potency.pickHint')}
        </p>
        <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
          {analysed.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 rounded-md px-2 py-1 text-label hover:bg-muted">
                <Checkbox
                  checked={picked.has(r.id)}
                  onCheckedChange={(v) =>
                    setPicked((cur) => {
                      const next = new Set(cur)

                      if (v === true) next.add(r.id)
                      else next.delete(r.id)

                      return next
                    })
                  }
                />
                <span className="mono text-fg-muted">
                  {plateRunReference(r.number)}
                </span>
                <span className="flex-1 truncate">{r.name}</span>
                <Status tone={qcTone(r.qc_status)}>
                  {t(`plates.quality.${r.qc_status ?? 'not_checked'}`)}
                </Status>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-4 text-label">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={includeFailed}
              onCheckedChange={(v) => setIncludeFailed(v === true)}
            />
            {t('plates.potency.includeFailed')}
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={onlyReliable}
              onCheckedChange={(v) => setOnlyReliable(v === true)}
            />
            {t('plates.potency.onlyReliable')}
          </label>
          <span className="text-fg-muted">
            {t('plates.potency.selected', { count: picked.size })}
          </span>
          <span className="flex-1" />
          <label className="flex items-center gap-2">
            {t('plates.potency.reference')}
            <Select
              size="sm"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            >
              <option value="">{t('plates.potency.noReference')}</option>
              {summaries.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </section>
      {picked.size === 0 ? (
        <p className="text-label text-fg-muted">{t('plates.potency.select')}</p>
      ) : summaries.length === 0 ? (
        <p className="text-label text-fg-muted">
          {t('plates.potency.nothing')}
        </p>
      ) : (
        <RegistryGrid
          label={t('plates.potency.label')}
          rows={summaries}
          columns={columns}
          getRowId={(s) => s.key}
        />
      )}
    </div>
  )
}
